import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select } from '../components/ui'

function Configuracion() {
  const { t } = useTranslation(['configuracion'])
  const [form, setForm] = useState({
    nombre: '', razon_fiscal: '', cif: '', direccion: '', telefono: '', email: '', logo_url: '',
  })
  const [cargando, setCargando] = useState(true)
  const [subiendoLogo, setSubiendoLogo] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase.from('empresa_config').select('*').single()
    if (error) console.error(error)
    else setForm(data)
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const { error } = await supabase.from('empresa_config').update(form).eq('negocio_id', form.negocio_id)
    if (error) {
      alert(t('configuracion:alertas.error_guardar', { mensaje: error.message }))
      return
    }
    alert(t('configuracion:alertas.guardado_correctamente'))
  }

  async function handleLogoChange(e) {
    const file = e.target.files[0]
    if (!file) return

    setSubiendoLogo(true)
    const nombreArchivo = `logo-${Date.now()}.${file.name.split('.').pop()}`

    const { error: errorUpload } = await supabase.storage
      .from('logos')
      .upload(nombreArchivo, file, { upsert: true })

    if (errorUpload) {
      alert(t('configuracion:alertas.error_subir_logo', { mensaje: errorUpload.message }))
      setSubiendoLogo(false)
      return
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(nombreArchivo)
    setForm((prev) => ({ ...prev, logo_url: data.publicUrl }))
    setSubiendoLogo(false)
  }

  if (cargando) return <div className="text-sm text-gray-400">{t('configuracion:cargando')}</div>

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('configuracion:titulo')} subtitle={t('configuracion:subtitulo')} />

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field label={t('configuracion:campos.logo')}>
              {form.logo_url && (
                <img src={form.logo_url} alt="Logo" className="h-16 object-contain mb-2 border border-gray-200 rounded p-1" />
              )}
              <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
              {subiendoLogo && <p className="text-sm text-gray-400 mt-1">{t('configuracion:subiendo')}</p>}
            </Field>

            <Field label={t('configuracion:campos.nombre_comercial')}>
              <Input type="text" value={form.nombre ?? ''} onChange={(e) => handleChange('nombre', e.target.value)} />
            </Field>
            <Field label={t('configuracion:campos.razon_fiscal')}>
              <Input type="text" value={form.razon_fiscal ?? ''} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
            </Field>
            <Field label={t('configuracion:campos.cif')}>
              <Input type="text" value={form.cif ?? ''} onChange={(e) => handleChange('cif', e.target.value)} />
            </Field>
            <Field label={t('configuracion:campos.direccion')}>
              <Input type="text" value={form.direccion ?? ''} onChange={(e) => handleChange('direccion', e.target.value)} />
            </Field>
            <Field label={t('configuracion:campos.telefono')}>
              <Input type="text" value={form.telefono ?? ''} onChange={(e) => handleChange('telefono', e.target.value)} />
            </Field>
            <Field label={t('configuracion:campos.email')}>
              <Input type="email" value={form.email ?? ''} onChange={(e) => handleChange('email', e.target.value)} />
            </Field>

            <Button type="submit" className="self-start mt-1">{t('configuracion:guardar')}</Button>
          </form>
        </CardBody>
      </Card>

      <CategoriasArticulo />
      <UnidadesMedida />
    </div>
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

export default Configuracion
