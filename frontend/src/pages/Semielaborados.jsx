import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { tipo: 'articulo', articulo_id: '', ingrediente_semielaborado_id: '', ingrediente_id: '', cantidad: '' }

function Semielaborados() {
  const { t } = useTranslation(['common', 'recetas_comun', 'semielaborados'])
  const [semielaborados, setSemielaborados] = useState([])
  const [articulos, setArticulos] = useState([])
  const [ingredientes, setIngredientes] = useState([])
  const [unidades, setUnidades] = useState([])
  const [cargando, setCargando] = useState(true)

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [diasCaducidadDefault, setDiasCaducidadDefault] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resSemi, resArticulos, resIngredientes, resUnidades] = await Promise.all([
      supabase
        .from('semielaborados')
        .select(`
          *,
          receta_semielaborado!receta_semielaborado_semielaborado_id_fkey(
            id,
            cantidad,
            articulo_id,
            ingrediente_semielaborado_id,
            ingrediente_id,
            articulos_compra(nombre, unidad),
            semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad),
            ingredientes(nombre, unidad)
          )
        `)
        .order('nombre', { ascending: true }),
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('ingredientes').select('id, nombre, unidad').order('nombre'),
      supabase.from('unidades_medida').select('id, codigo, nombre').order('codigo'),
    ])

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulos(resArticulos.data)

    if (resIngredientes.error) console.error(resIngredientes.error)
    else setIngredientes(resIngredientes.data)

    if (resUnidades.error) console.error('Error cargando unidades:', resUnidades.error)
    else setUnidades(resUnidades.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'tipo') {
        copia[index].articulo_id = ''
        copia[index].ingrediente_semielaborado_id = ''
        copia[index].ingrediente_id = ''
      }
      return copia
    })
  }

  function addLinea() {
    setLineas((prev) => [...prev, { ...lineaVacia }])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setNombre('')
    setCodigo('')
    setUnidadId('')
    setDiasCaducidadDefault('')
    setNotas('')
    setLineas([{ ...lineaVacia }])
    setEditandoId(null)
  }

  function handleEditar(s) {
    setNombre(s.nombre ?? '')
    setCodigo(s.codigo ?? '')
    setUnidadId(s.unidad_id ? String(s.unidad_id) : '')
    setDiasCaducidadDefault(s.dias_caducidad_default ?? '')
    setNotas(s.notas ?? '')

    const lineasCargadas = s.receta_semielaborado.map((l) => ({
      tipo: l.articulo_id ? 'articulo' : l.ingrediente_id ? 'ingrediente' : 'semielaborado',
      articulo_id: l.articulo_id ?? '',
      ingrediente_semielaborado_id: l.ingrediente_semielaborado_id ?? '',
      ingrediente_id: l.ingrediente_id ?? '',
      cantidad: l.cantidad ?? '',
    }))

    setLineas(lineasCargadas.length > 0 ? lineasCargadas : [{ ...lineaVacia }])
    setEditandoId(s.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter(
      (l) => l.cantidad && (l.articulo_id || l.ingrediente_semielaborado_id || l.ingrediente_id)
    )
    if (lineasValidas.length === 0) {
      alert(t('recetas_comun:alertas.sin_ingredientes_receta'))
      return
    }

    let semielaboradoId = editandoId

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('semielaborados')
        .update({
          nombre,
          codigo: codigo || null,
          unidad_id: parseInt(unidadId),
          dias_caducidad_default: diasCaducidadDefault ? parseInt(diasCaducidadDefault) : null,
          notas: notas || null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert(t('recetas_comun:alertas.error_actualizar', { mensaje: errorUpdate.message }))
        return
      }

      const { error: errorDelete } = await supabase
        .from('receta_semielaborado')
        .delete()
        .eq('semielaborado_id', editandoId)

      if (errorDelete) {
        alert(t('recetas_comun:alertas.error_actualizar_receta', { mensaje: errorDelete.message }))
        return
      }
    } else {
      const { data: semiCreado, error: errorSemi } = await supabase
        .from('semielaborados')
        .insert({
          nombre,
          codigo: codigo || null,
          unidad_id: parseInt(unidadId),
          dias_caducidad_default: diasCaducidadDefault ? parseInt(diasCaducidadDefault) : null,
          notas: notas || null,
        })
        .select()
        .single()

      if (errorSemi) {
        alert(t('semielaborados:alertas.error_crear_semielaborado', { mensaje: errorSemi.message }))
        return
      }
      semielaboradoId = semiCreado.id
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      semielaborado_id: semielaboradoId,
      articulo_id: l.tipo === 'articulo' ? parseInt(l.articulo_id) : null,
      ingrediente_semielaborado_id: l.tipo === 'semielaborado' ? parseInt(l.ingrediente_semielaborado_id) : null,
      ingrediente_id: l.tipo === 'ingrediente' ? parseInt(l.ingrediente_id) : null,
      cantidad: parseFloat(l.cantidad),
    }))

    const { error: errorLineas } = await supabase
      .from('receta_semielaborado')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      alert(t('recetas_comun:alertas.error_guardar_receta', { mensaje: errorLineas.message }))
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    if (!confirm(t('semielaborados:alertas.confirmar_borrar'))) return

    const { error } = await supabase.from('semielaborados').delete().eq('id', id)
    if (error) {
      alert(t('recetas_comun:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    if (editandoId === id) resetForm()
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('semielaborados:titulo')} />

      <Card className="mb-6">
        <CardHeader title={editandoId ? t('semielaborados:card_editar_titulo') : t('semielaborados:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={t('recetas_comun:campos.nombre')}>
                <Input type="text" placeholder={t('semielaborados:nombre_placeholder')} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </Field>
              <Field label={t('recetas_comun:campos.codigo_corto')}>
                <Input type="text" placeholder={t('semielaborados:codigo_placeholder')} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </Field>
              <Field label={t('semielaborados:campos.unidad_produccion')}>
                <Select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} required>
                  <option value="">{t('semielaborados:selecciona_unidad')}</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('recetas_comun:campos.dias_caducidad_opcional')}>
                <Input type="number" step="1" min="0" placeholder="Ej. 3" value={diasCaducidadDefault}
                  onChange={(e) => setDiasCaducidadDefault(e.target.value)} />
              </Field>
            </div>
            <Field label={t('recetas_comun:campos.notas_opcional')}>
              <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Field>

            <div>
              <SectionLabel>{t('recetas_comun:receta_titulo')}</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-3 flex flex-col gap-2">
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'articulo'}
                          onChange={() => handleLineaChange(index, 'tipo', 'articulo')} />
                        {t('recetas_comun:tipo_articulo')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'ingrediente'}
                          onChange={() => handleLineaChange(index, 'tipo', 'ingrediente')} />
                        {t('recetas_comun:tipo_ingrediente')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'semielaborado'}
                          onChange={() => handleLineaChange(index, 'tipo', 'semielaborado')} />
                        {t('semielaborados:tipo_otro_semielaborado')}
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-center">
                      {linea.tipo === 'articulo' && (
                        <Select value={linea.articulo_id}
                          onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_articulo')}</option>
                          {articulos.map((a) => (
                            <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'ingrediente' && (
                        <Select value={linea.ingrediente_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_ingrediente')}</option>
                          {ingredientes.map((i) => (
                            <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'semielaborado' && (
                        <Select value={linea.ingrediente_semielaborado_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_semielaborado_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_semielaborado')}</option>
                          {semielaborados
                            .filter((s) => s.id !== editandoId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                            ))}
                        </Select>
                      )}
                      <Input type="number" step="0.001" placeholder={t('recetas_comun:tabla.cantidad')} value={linea.cantidad}
                        onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                        required title={t('common:redondea_3_decimales')} />
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-gray-400 hover:text-red-600 justify-self-center">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-primary-600 font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> {t('recetas_comun:anadir_ingrediente')}
              </button>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editandoId ? t('semielaborados:guardar_cambios') : t('semielaborados:guardar_semielaborado')}</Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={resetForm}>{t('common:actions.cancel')}</Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('common:listado_titulo')}</h2>

      {cargando ? (
        <LoadingState />
      ) : semielaborados.length === 0 ? (
        <Card><EmptyState>{t('semielaborados:sin_semielaborados')}</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {semielaborados.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-ink">
                    {s.nombre} {s.codigo && <span className="text-gray-400 font-mono text-xs">({s.codigo})</span>}
                  </p>
                  <p className="text-sm text-gray-500">{t('semielaborados:unidad_label', { unidad: s.unidad })}</p>
                  {s.notas && <p className="text-sm text-gray-400 italic">{s.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(s)}>{t('recetas_comun:editar')}</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(s.id)}>{t('recetas_comun:borrar')}</LinkAction>
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.ingrediente')}</th>
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.tipo')}</th>
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.cantidad')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {s.receta_semielaborado.map((linea) => {
                    const tipo = linea.articulos_compra ? t('recetas_comun:tipo_label.articulo') : linea.ingredientes ? t('recetas_comun:tipo_label.ingrediente') : t('recetas_comun:tipo_label.semielaborado')
                    const fuente = linea.articulos_compra ?? linea.ingredientes ?? linea.semielaborados
                    return (
                      <tr key={linea.id}>
                        <td className="py-1.5">{fuente?.nombre ?? '—'}</td>
                        <td className="py-1.5 text-gray-400">{tipo}</td>
                        <td className="py-1.5">{linea.cantidad} {fuente?.unidad}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default Semielaborados
