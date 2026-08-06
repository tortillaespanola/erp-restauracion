import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { tipo: 'articulo', articulo_id: '', ingrediente_semielaborado_id: '', ingrediente_id: '', cantidad: '' }

function ProductosFinales() {
  const [productos, setProductos] = useState([])
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [ingredientes, setIngredientes] = useState([])
  const [cargando, setCargando] = useState(true)

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resProd, resArt, resSemi, resIngredientes] = await Promise.all([
      supabase
        .from('productos_finales')
        .select(`
          *,
          receta_producto_final(
            id, cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id,
            articulos_compra(nombre, unidad),
            semielaborados(nombre, unidad),
            ingredientes(nombre, unidad)
          )
        `)
        .order('nombre', { ascending: true }),
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('ingredientes').select('id, nombre, unidad').order('nombre'),
    ])

    if (resProd.error) console.error(resProd.error)
    else setProductos(resProd.data)

    if (resArt.error) console.error(resArt.error)
    else setArticulos(resArt.data)

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resIngredientes.error) console.error(resIngredientes.error)
    else setIngredientes(resIngredientes.data)

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
    setPrecioVenta('')
    setNotas('')
    setLineas([{ ...lineaVacia }])
    setEditandoId(null)
  }

  function handleEditar(p) {
    setNombre(p.nombre ?? '')
    setCodigo(p.codigo ?? '')
    setPrecioVenta(p.precio_venta ?? '')
    setNotas(p.notas ?? '')

    const lineasCargadas = p.receta_producto_final.map((l) => ({
      tipo: l.articulo_id ? 'articulo' : l.ingrediente_id ? 'ingrediente' : 'semielaborado',
      articulo_id: l.articulo_id ?? '',
      ingrediente_semielaborado_id: l.ingrediente_semielaborado_id ?? '',
      ingrediente_id: l.ingrediente_id ?? '',
      cantidad: l.cantidad ?? '',
    }))

    setLineas(lineasCargadas.length > 0 ? lineasCargadas : [{ ...lineaVacia }])
    setEditandoId(p.id)
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

    let productoId = editandoId

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('productos_finales')
        .update({
          nombre,
          codigo: codigo || null,
          precio_venta: precioVenta ? parseFloat(precioVenta) : null,
          notas: notas || null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert('Error al actualizar: ' + errorUpdate.message)
        return
      }

      const { error: errorDelete } = await supabase
        .from('receta_producto_final')
        .delete()
        .eq('producto_final_id', editandoId)

      if (errorDelete) {
        alert('Error al actualizar la receta: ' + errorDelete.message)
        return
      }
    } else {
      const { data: prodCreado, error: errorProd } = await supabase
        .from('productos_finales')
        .insert({
          nombre,
          codigo: codigo || null,
          precio_venta: precioVenta ? parseFloat(precioVenta) : null,
          notas: notas || null,
        })
        .select()
        .single()

      if (errorProd) {
        alert('Error al crear el producto: ' + errorProd.message)
        return
      }
      productoId = prodCreado.id
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      producto_final_id: productoId,
      articulo_id: l.tipo === 'articulo' ? parseInt(l.articulo_id) : null,
      ingrediente_semielaborado_id: l.tipo === 'semielaborado' ? parseInt(l.ingrediente_semielaborado_id) : null,
      ingrediente_id: l.tipo === 'ingrediente' ? parseInt(l.ingrediente_id) : null,
      cantidad: parseFloat(l.cantidad),
    }))

    const { error: errorLineas } = await supabase
      .from('receta_producto_final')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      alert('Error al guardar la receta: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    const { count } = await supabase
      .from('producciones_producto_final')
      .select('*', { count: 'exact', head: true })
      .eq('producto_final_id', id)

    if (count > 0) {
      alert(`No puedes borrar este producto: tiene ${count} producción(es) registrada(s). Bórralas primero desde "Producción de productos finales" si de verdad quieres eliminar el producto.`)
      return
    }

    if (!confirm('¿Seguro que quieres borrar este producto final? Se borrará también su receta.')) return

    const { error } = await supabase.from('productos_finales').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    if (editandoId === id) resetForm()
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Productos finales" />

      <Card className="mb-6">
        <CardHeader title={editandoId ? 'Editar producto final' : 'Nuevo producto final'} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Nombre">
                <Input type="text" placeholder="Ej. Paella valenciana" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </Field>
              <Field label="Código corto">
                <Input type="text" placeholder="Ej. PAE" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </Field>
              <Field label="Precio de venta">
                <Input type="number" step="0.01" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} />
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
                        Semielaborado
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
                          {semielaborados.map((s) => (
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
              <Button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar producto final'}</Button>
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
      ) : productos.length === 0 ? (
        <Card><EmptyState>Todavía no hay productos finales dados de alta.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {productos.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938]">
                    {p.nombre} {p.codigo && <span className="text-gray-400 font-mono text-xs">({p.codigo})</span>}
                  </p>
                  {p.precio_venta != null && <p className="text-sm text-gray-500">Precio: {p.precio_venta} €</p>}
                  {p.notas && <p className="text-sm text-gray-400 italic">{p.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(p)}>Editar</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(p.id)}>Borrar</LinkAction>
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
                  {p.receta_producto_final.map((linea) => {
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

export default ProductosFinales
