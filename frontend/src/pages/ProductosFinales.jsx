import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const lineaVacia = { tipo: 'articulo', articulo_id: '', ingrediente_semielaborado_id: '', cantidad: '' }

function ProductosFinales() {
  const [productos, setProductos] = useState([])
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [cargando, setCargando] = useState(true)

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resProd, resArt, resSemi] = await Promise.all([
      supabase
        .from('productos_finales')
        .select(`
          *,
          receta_producto_final(
            id, cantidad, articulo_id, ingrediente_semielaborado_id,
            articulos_compra(nombre, unidad),
            semielaborados(nombre, unidad)
          )
        `)
        .order('nombre', { ascending: true }),
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
    ])

    if (resProd.error) console.error(resProd.error)
    else setProductos(resProd.data)

    if (resArt.error) console.error(resArt.error)
    else setArticulos(resArt.data)

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

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
      tipo: l.articulo_id ? 'articulo' : 'semielaborado',
      articulo_id: l.articulo_id ?? '',
      ingrediente_semielaborado_id: l.ingrediente_semielaborado_id ?? '',
      cantidad: l.cantidad ?? '',
    }))

    setLineas(lineasCargadas.length > 0 ? lineasCargadas : [{ ...lineaVacia }])
    setEditandoId(p.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter(
      (l) => l.cantidad && (l.articulo_id || l.ingrediente_semielaborado_id)
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
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Productos finales</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">
          {editandoId ? 'Editar producto final' : 'Nuevo producto final'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input type="text" placeholder="Nombre (ej. Paella valenciana)" value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required className="border rounded px-3 py-2" />
          <input type="text" placeholder="Código corto (ej. PAE)" value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="border rounded px-3 py-2" />
          <input type="number" step="0.01" placeholder="Precio de venta" value={precioVenta}
            onChange={(e) => setPrecioVenta(e.target.value)}
            className="border rounded px-3 py-2" />
        </div>
        <input type="text" placeholder="Notas (opcional)" value={notas}
          onChange={(e) => setNotas(e.target.value)}
          className="border rounded px-3 py-2" />

        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Receta (ingredientes)</h3>
          <div className="flex flex-col gap-3">
            {lineas.map((linea, index) => (
              <div key={index} className="border rounded-lg p-3 flex flex-col gap-2">
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={linea.tipo === 'articulo'}
                      onChange={() => handleLineaChange(index, 'tipo', 'articulo')} />
                    Artículo de compra
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={linea.tipo === 'semielaborado'}
                      onChange={() => handleLineaChange(index, 'tipo', 'semielaborado')} />
                    Semielaborado
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-center">
                  {linea.tipo === 'articulo' ? (
                    <select value={linea.articulo_id}
                      onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                      required className="border rounded px-3 py-2">
                      <option value="">Selecciona artículo</option>
                      {articulos.map((a) => (
                        <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                      ))}
                    </select>
                  ) : (
                    <select value={linea.ingrediente_semielaborado_id}
                      onChange={(e) => handleLineaChange(index, 'ingrediente_semielaborado_id', e.target.value)}
                      required className="border rounded px-3 py-2">
                      <option value="">Selecciona semielaborado</option>
                      {semielaborados.map((s) => (
                        <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                      ))}
                    </select>
                  )}
                  <input type="number" step="0.01" placeholder="Cantidad" value={linea.cantidad}
                    onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                    required className="border rounded px-3 py-2" />
                  <button type="button" onClick={() => removeLinea(index)}
                    className="text-red-600 hover:underline text-sm">
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addLinea}
            className="mt-2 text-sm text-blue-600 hover:underline">
            + Añadir ingrediente
          </button>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700">
            {editandoId ? 'Guardar cambios' : 'Guardar producto final'}
          </button>
          {editandoId && (
            <button type="button" onClick={resetForm}
              className="bg-slate-200 text-slate-700 rounded px-4 py-2 hover:bg-slate-300">
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : productos.length === 0 ? (
          <p className="text-slate-500">Todavía no hay productos finales dados de alta.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {productos.map((p) => (
              <div key={p.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">
                      {p.nombre} {p.codigo && <span className="text-slate-400 font-mono text-xs">({p.codigo})</span>}
                    </p>
                    {p.precio_venta != null && <p className="text-sm text-slate-500">Precio: {p.precio_venta} €</p>}
                    {p.notas && <p className="text-sm text-slate-400 italic">{p.notas}</p>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => handleEditar(p)} className="text-blue-600 hover:underline text-sm">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(p.id)} className="text-red-600 hover:underline text-sm">
                      Borrar
                    </button>
                  </div>
                </div>

                <table className="w-full mt-3 text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">Ingrediente</th>
                      <th className="py-1">Tipo</th>
                      <th className="py-1">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.receta_producto_final.map((linea) => {
                      const esArticulo = !!linea.articulos_compra
                      const ingrediente = esArticulo ? linea.articulos_compra : linea.semielaborados
                      return (
                        <tr key={linea.id} className="border-t">
                          <td className="py-1">{ingrediente?.nombre ?? '—'}</td>
                          <td className="py-1 text-slate-400">{esArticulo ? 'Artículo' : 'Semielaborado'}</td>
                          <td className="py-1">{linea.cantidad} {ingrediente?.unidad}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ProductosFinales