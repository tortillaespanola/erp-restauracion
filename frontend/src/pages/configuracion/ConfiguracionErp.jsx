import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, Textarea } from '../../components/ui'
import { IDIOMAS_VALIDOS } from '../../i18n'

// CONTRATO_CONFIGURACION_SUBMENUS.md, sección 6: idioma por defecto de documentos, reutilizando
// empresa_config.idioma (ya existe desde CONTRATO_I18N.md -- verificado en vivo, sin migración
// nueva para esto). Este contrato solo guarda el valor, no lo aplica todavía a la generación de
// PDF (queda para el contrato de configuración de facturas).
//
// CONTRATO_PIE_DOCUMENTO.md, sección 4: eslogan/comentario_eslogan/pagina_web se añaden a este
// mismo formulario (todos campos de empresa_config) en vez de crear una tarjeta aparte -- un único
// submit que guarda los 4 campos a la vez, mismo patrón que ConfiguracionGeneral.jsx, en vez del
// autoguardado por campo que tenía el idioma antes de este contrato.
function MarcaDocumentos() {
  const { t } = useTranslation(['configuracion', 'enums'])
  const [form, setForm] = useState({ negocio_id: null, idioma: 'es', eslogan: '', comentario_eslogan: '', pagina_web: '' })
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      const { data, error } = await supabase
        .from('empresa_config')
        .select('negocio_id, idioma, eslogan, comentario_eslogan, pagina_web')
        .single()
      if (error) console.error(error)
      else setForm(data)
      setCargando(false)
    }
    cargar()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const { negocio_id, ...payload } = form
    const { error } = await supabase.from('empresa_config').update(payload).eq('negocio_id', negocio_id)
    if (error) {
      alert(t('configuracion:alertas.error_guardar', { mensaje: error.message }))
      return
    }
    toast.success(t('configuracion:alertas.guardado_correctamente'))
  }

  if (cargando) return null

  return (
    <Card className="mt-6">
      <CardHeader title={t('configuracion:erp.titulo_marca')} />
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label={t('configuracion:erp.idioma_documentos')} className="max-w-xs">
            <Select value={form.idioma} onChange={(e) => handleChange('idioma', e.target.value)}>
              {IDIOMAS_VALIDOS.map((codigo) => (
                <option key={codigo} value={codigo}>{t(`enums:idioma.${codigo}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('configuracion:erp.eslogan')}>
            <Input type="text" value={form.eslogan ?? ''} onChange={(e) => handleChange('eslogan', e.target.value)} />
          </Field>
          <Field label={t('configuracion:erp.comentario_eslogan')}>
            <Textarea rows={2} value={form.comentario_eslogan ?? ''} onChange={(e) => handleChange('comentario_eslogan', e.target.value)} />
          </Field>
          <Field label={t('configuracion:erp.pagina_web')} className="max-w-xs">
            <Input type="text" value={form.pagina_web ?? ''} onChange={(e) => handleChange('pagina_web', e.target.value)} />
          </Field>

          <Button type="submit" className="self-start mt-1">{t('configuracion:guardar')}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

// CONTRATO_GENERICO_CATALOGO.md, Fase 2: categorias_articulo no tiene UNIQUE en BD sobre
// nombre/acronimo -- se advierte de duplicados en la UI (comparación case-insensitive, trim),
// pero no se bloquean (añadir el UNIQUE queda fuera de alcance, ver contrato sección 7).
const categoriaVacia = { nombre: '', acronimo: '' }

function CategoriasArticulo() {
  const { t } = useTranslation(['common', 'configuracion'])
  const [categorias, setCategorias] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(categoriaVacia)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarCategorias() {
    setCargando(true)
    const { data, error } = await supabase.from('categorias_articulo').select('id, nombre, acronimo').order('nombre')
    if (error) console.error('Error cargando categorías:', error)
    else setCategorias(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarCategorias()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function resetForm() {
    setForm(categoriaVacia)
    setEditandoId(null)
  }

  function handleEditar(c) {
    setForm({ nombre: c.nombre, acronimo: c.acronimo })
    setEditandoId(c.id)
  }

  function hayDuplicado() {
    const nombreNorm = form.nombre.trim().toLowerCase()
    const acronimoNorm = form.acronimo.trim().toLowerCase()
    return categorias.some((c) =>
      c.id !== editandoId &&
      (c.nombre.trim().toLowerCase() === nombreNorm || c.acronimo.trim().toLowerCase() === acronimoNorm)
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (hayDuplicado() && !confirm(t('configuracion:categorias.alertas.confirmar_duplicado'))) {
      return
    }

    const payload = { nombre: form.nombre.trim(), acronimo: form.acronimo.trim() }

    const { error } = editandoId
      ? await supabase.from('categorias_articulo').update(payload).eq('id', editandoId)
      : await supabase.from('categorias_articulo').insert(payload)

    if (error) {
      alert(t('configuracion:categorias.alertas.error_guardar', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    resetForm()
    cargarCategorias()
  }

  async function handleBorrar(id) {
    if (!confirm(t('configuracion:categorias.alertas.confirmar_borrar'))) return

    const { error } = await supabase.from('categorias_articulo').delete().eq('id', id)
    if (error) {
      alert(t('configuracion:categorias.alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    if (editandoId === id) resetForm()
    cargarCategorias()
  }

  return (
    <Card className="mt-6">
      <CardHeader title={t('configuracion:categorias.titulo')} />
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end mb-4">
          <Field label={t('configuracion:categorias.campos.nombre')}>
            <Input type="text" value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)} required />
          </Field>
          <Field label={t('configuracion:categorias.campos.acronimo')}>
            <Input type="text" value={form.acronimo} onChange={(e) => handleChange('acronimo', e.target.value.toUpperCase())} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{editandoId ? t('common:actions.save') : t('configuracion:categorias.anadir')}</Button>
            {editandoId && (
              <Button type="button" variant="secondary" onClick={resetForm}>{t('common:actions.cancel')}</Button>
            )}
          </div>
        </form>

        {cargando ? (
          <p className="text-sm text-gray-400">{t('common:actions.loading')}</p>
        ) : categorias.length === 0 ? (
          <p className="text-sm text-gray-400">{t('configuracion:categorias.sin_categorias')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {categorias.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5">{c.nombre}</td>
                  <td className="py-1.5 text-gray-400 font-mono">{c.acronimo}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <LinkAction tone="blue" onClick={() => handleEditar(c)} className="mr-3">{t('configuracion:categorias.editar')}</LinkAction>
                    <LinkAction tone="red" onClick={() => handleBorrar(c.id)}>{t('configuracion:categorias.borrar')}</LinkAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

// CONTRATO_GENERICO_CATALOGO.md, Fase 2: unidades_medida no tiene GRANT delete para
// authenticated (a diferencia de las demás tablas de catálogo) -- se replica esa misma
// restricción en la UI en vez de añadir el grant. Sin botón de borrar, deliberadamente.
const unidadVacia = { codigo: '', nombre: '', tipo: 'peso' }
const TIPOS_UNIDAD = ['peso', 'volumen', 'unidad']

function UnidadesMedida() {
  const { t } = useTranslation(['common', 'enums', 'configuracion'])
  const [unidades, setUnidades] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(unidadVacia)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarUnidades() {
    setCargando(true)
    const { data, error } = await supabase.from('unidades_medida').select('id, codigo, nombre, tipo').order('codigo')
    if (error) console.error('Error cargando unidades de medida:', error)
    else setUnidades(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarUnidades()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function resetForm() {
    setForm(unidadVacia)
    setEditandoId(null)
  }

  function handleEditar(u) {
    setForm({ codigo: u.codigo, nombre: u.nombre, tipo: u.tipo })
    setEditandoId(u.id)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const payload = { codigo: form.codigo.trim(), nombre: form.nombre.trim(), tipo: form.tipo }

    const { error } = editandoId
      ? await supabase.from('unidades_medida').update(payload).eq('id', editandoId)
      : await supabase.from('unidades_medida').insert(payload)

    if (error) {
      alert(t('configuracion:unidades.alertas.error_guardar', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    resetForm()
    cargarUnidades()
  }

  return (
    <Card className="mt-6">
      <CardHeader title={t('configuracion:unidades.titulo')} />
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr_auto] gap-3 items-end mb-4">
          <Field label={t('configuracion:unidades.campos.codigo')}>
            <Input type="text" value={form.codigo} onChange={(e) => handleChange('codigo', e.target.value)} required />
          </Field>
          <Field label={t('configuracion:unidades.campos.nombre')}>
            <Input type="text" value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)} required />
          </Field>
          <Field label={t('configuracion:unidades.campos.tipo')}>
            <Select value={form.tipo} onChange={(e) => handleChange('tipo', e.target.value)} required>
              {TIPOS_UNIDAD.map((tipo) => (
                <option key={tipo} value={tipo}>{t(`enums:unidad_tipo.${tipo}`)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{editandoId ? t('common:actions.save') : t('configuracion:unidades.anadir')}</Button>
            {editandoId && (
              <Button type="button" variant="secondary" onClick={resetForm}>{t('common:actions.cancel')}</Button>
            )}
          </div>
        </form>

        {cargando ? (
          <p className="text-sm text-gray-400">{t('common:actions.loading')}</p>
        ) : unidades.length === 0 ? (
          <p className="text-sm text-gray-400">{t('configuracion:unidades.sin_unidades')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {unidades.map((u) => (
                <tr key={u.id}>
                  <td className="py-1.5 font-mono">{u.codigo}</td>
                  <td className="py-1.5">{u.nombre}</td>
                  <td className="py-1.5 text-gray-400">{t(`enums:unidad_tipo.${u.tipo}`)}</td>
                  <td className="py-1.5 text-right">
                    <LinkAction tone="blue" onClick={() => handleEditar(u)}>{t('configuracion:unidades.editar')}</LinkAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

function ConfiguracionErp() {
  return (
    <>
      <CategoriasArticulo />
      <UnidadesMedida />
      <MarcaDocumentos />
    </>
  )
}

export default ConfiguracionErp
