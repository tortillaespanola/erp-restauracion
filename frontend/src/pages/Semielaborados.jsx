import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { tipo: 'articulo', articulo_id: '', ingrediente_semielaborado_id: '', ingrediente_id: '', cantidad: '' }

function Semielaborados() {
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
      alert('Añade al menos un ingrediente a la receta')
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
        alert('Error al actualizar: ' + errorUpdate.message)
        return
      }

      const { error: errorDelete } = await supabase
        .from('receta_semielaborado')
        .delete()
        .eq('semielaborado_id', editandoId)

      if (errorDelete) {
        alert('Error al actualizar la receta: ' + errorDelete.message)
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
        alert('Error al crear el semielaborado: ' + errorSemi.message)
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
      alert('Error al guardar la receta: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este semielaborado? Se borrará también su receta.')) return

    const { error } = await supabase.from('semielaborados').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    if (editandoId === id) resetForm()
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Semielaborados" />

      <Card className="mb-6">
        <CardHeader title={editandoId ? 'Editar semielaborado' : 'Nuevo semielaborado'} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Nombre">
                <Input type="text" placeholder="Ej. Sofrito base" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </Field>
              <Field label="Código corto">
                <Input type="text" placeholder="Ej. SOF" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </Field>
              <Field label="Unidad de producción">
                <Select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} required>
                  <option value="">Selecciona unidad</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Días de caducidad por defecto (opcional)">
                <Input type="number" step="1" min="0" placeholder="Ej. 3" value={diasCaducidadDefault}
                  onChange={(e) => setDiasCaducidadDefault(e.target.value)} />
              </Field>
            </div>
            <Field label="Notas (opcional)">
              <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Field>

            <div>
              <SectionLabel>Receta (ingredientes)</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-3 flex flex-col gap-2">
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'articulo'}
                          onChange={() => handleLineaChange(index, 'tipo', 'articulo')} />
                        Artículo de compra
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'ingrediente'}
                          onChange={() => handleLineaChange(index, 'tipo', 'ingrediente')} />
                        Ingrediente (varias variantes)
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'semielaborado'}
                          onChange={() => handleLineaChange(index, 'tipo', 'semielaborado')} />
                        Otro semielaborado
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-center">
                      {linea.tipo === 'articulo' && (
                        <Select value={linea.articulo_id}
                          onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                          required>
                          <option value="">Selecciona artículo</option>
                          {articulos.map((a) => (
                            <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'ingrediente' && (
                        <Select value={linea.ingrediente_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_id', e.target.value)}
                          required>
                          <option value="">Selecciona ingrediente</option>
                          {ingredientes.map((i) => (
                            <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'semielaborado' && (
                        <Select value={linea.ingrediente_semielaborado_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_semielaborado_id', e.target.value)}
                          required>
                          <option value="">Selecciona semielaborado</option>
                          {semielaborados
                            .filter((s) => s.id !== editandoId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                            ))}
                        </Select>
                      )}
                      <Input type="number" step="0.001" placeholder="Cantidad" value={linea.cantidad}
                        onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                        required title="Se redondeará a 3 decimales" />
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-gray-400 hover:text-red-600 justify-self-center">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-[#0854A0] font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> Añadir ingrediente
              </button>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar semielaborado'}</Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={resetForm}>Cancelar</Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Listado</h2>

      {cargando ? (
        <LoadingState />
      ) : semielaborados.length === 0 ? (
        <Card><EmptyState>Todavía no hay semielaborados dados de alta.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {semielaborados.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938]">
                    {s.nombre} {s.codigo && <span className="text-gray-400 font-mono text-xs">({s.codigo})</span>}
                  </p>
                  <p className="text-sm text-gray-500">Unidad: {s.unidad}</p>
                  {s.notas && <p className="text-sm text-gray-400 italic">{s.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(s)}>Editar</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(s.id)}>Borrar</LinkAction>
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">Ingrediente</th>
                    <th className="py-1.5 font-medium">Tipo</th>
                    <th className="py-1.5 font-medium">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {s.receta_semielaborado.map((linea) => {
                    const tipo = linea.articulos_compra ? 'Artículo' : linea.ingredientes ? 'Ingrediente' : 'Semielaborado'
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
