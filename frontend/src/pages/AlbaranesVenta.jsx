import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { descargarPdf, imprimirPdf } from '../lib/generarPdf'

function AlbaranesVenta() {
  const [albaranes, setAlbaranes] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [refrescoStock, setRefrescoStock] = useState(0)

  const [clienteId, setClienteId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resAlbaranes, resClientes, resProductos] = await Promise.all([
      supabase
        .from('albaranes_venta')
        .select('*, clientes(nombre, direccion, cif), lineas_albaran_venta(id, cantidad, precio_unitario, productos_finales(nombre))')
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').order('nombre'),
      supabase.from('productos_finales').select('id, nombre, precio_venta').order('nombre'),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else setAlbaranes(resAlbaranes.data)

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    setCargando(false)
    setRefrescoStock((n) => n + 1)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function resetForm() {
    setClienteId('')
    setNumeroAlbaran('')
    setFecha(new Date().toISOString().slice(0, 10))
    setNotas('')
    setLineas([])
  }

  function cantidadYaEnLineas(produccionId) {
    return lineas
      .filter((l) => l.produccion_pf_id === produccionId)
      .reduce((sum, l) => sum + l.cantidad, 0)
  }

  function addLinea(producto, produccionId, cantidad, precio, stockLoteOriginal) {
    const cant = parseFloat(cantidad)
    const idProduccion = parseInt(produccionId)

    if (!produccionId || !cant || cant <= 0) {
      alert('Selecciona un lote e introduce una cantidad válida')
      return
    }

    const yaUsado = cantidadYaEnLineas(idProduccion)
    const restante = stockLoteOriginal - yaUsado

    if (cant > restante) {
      alert(`Solo quedan ${restante.toFixed(2)} unidades disponibles en ese lote de producción`)
      return
    }

    setLineas((prev) => [
      ...prev,
      {
        producto_final_id: producto.id,
        producto_final_id_display: producto.nombre,
        produccion_pf_id: idProduccion,
        cantidad: cant,
        precio_unitario: precio ? parseFloat(precio) : null,
      },
    ])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (lineas.length === 0) {
      alert('Añade al menos una línea de producto')
      return
    }

    const { data: albaranCreado, error: errorAlbaran } = await supabase
      .from('albaranes_venta')
      .insert({
        cliente_id: parseInt(clienteId),
        numero_albaran: numeroAlbaran || null,
        fecha,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorAlbaran) {
      alert('Error al crear el albarán: ' + errorAlbaran.message)
      return
    }

    const lineasParaInsertar = lineas.map((l) => ({
      albaran_venta_id: albaranCreado.id,
      producto_final_id: l.producto_final_id,
      produccion_pf_id: l.produccion_pf_id,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
    }))

    const { error: errorLineas } = await supabase
      .from('lineas_albaran_venta')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      await supabase.from('albaranes_venta').delete().eq('id', albaranCreado.id)
      alert('Error al guardar las líneas: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este albarán? Se revertirá el stock vendido.')) return

    const { error } = await supabase.from('albaranes_venta').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  function prepararDocumento(alb) {
    return {
      numero: alb.numero_albaran || `#${alb.id}`,
      fecha: alb.fecha,
      tercero: {
        nombre: alb.clientes?.nombre,
        direccion: alb.clientes?.direccion,
        cif: alb.clientes?.cif,
      },
      lineas: alb.lineas_albaran_venta.map((l) => ({
        concepto: l.productos_finales?.nombre,
        cantidad: l.cantidad,
        precioUnitario: l.precio_unitario,
      })),
      total: alb.lineas_albaran_venta.reduce(
        (sum, l) => sum + (l.precio_unitario ? l.cantidad * l.precio_unitario : 0), 0
      ),
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Albaranes de venta</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">Nuevo albarán</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
            required className="border rounded px-3 py-2">
            <option value="">Selecciona cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <input type="text" placeholder="Nº albarán" value={numeroAlbaran}
            onChange={(e) => setNumeroAlbaran(e.target.value)}
            className="border rounded px-3 py-2" />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            required className="border rounded px-3 py-2" />
        </div>
        <input type="text" placeholder="Notas (opcional)" value={notas}
          onChange={(e) => setNotas(e.target.value)}
          className="border rounded px-3 py-2" />

        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Añadir productos</h3>
          <div className="flex flex-col gap-3">
            {productos.map((prod) => (
              <ProductoParaVender
                key={prod.id}
                producto={prod}
                onAdd={addLinea}
                refrescoStock={refrescoStock}
                cantidadYaEnLineas={cantidadYaEnLineas}
              />
            ))}
          </div>
        </div>

        {lineas.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-600 mb-2">Líneas del albarán</h3>
            <table className="w-full text-sm">
              <tbody>
                {lineas.map((l, index) => (
                  <tr key={index} className="border-t">
                    <td className="py-1">{l.producto_final_id_display}</td>
                    <td className="py-1">{l.cantidad} uds.</td>
                    <td className="py-1">{l.precio_unitario != null ? `${l.precio_unitario} €/ud` : '-'}</td>
                    <td className="py-1">
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-red-600 hover:underline text-xs">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
          Guardar albarán
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : albaranes.length === 0 ? (
          <p className="text-slate-500">Todavía no hay albaranes de venta registrados.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {albaranes.map((alb) => (
              <div key={alb.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{alb.clientes?.nombre ?? 'Sin cliente'}</p>
                    <p className="text-sm text-slate-500">
                      Albarán {alb.numero_albaran || '(sin número)'} · {alb.fecha}
                    </p>
                    {alb.notas && <p className="text-sm text-slate-400 italic">{alb.notas}</p>}
                  </div>
                  <div className="flex gap-3 items-start">
                    <button onClick={() => imprimirPdf('Albarán', prepararDocumento(alb))}
                      className="text-slate-600 hover:underline text-sm">
                      Imprimir
                    </button>
                    <button onClick={() => descargarPdf('Albarán', prepararDocumento(alb))}
                      className="text-blue-600 hover:underline text-sm">
                      Descargar PDF
                    </button>
                    <button onClick={() => handleBorrar(alb.id)} className="text-red-600 hover:underline text-sm">
                      Borrar
                    </button>
                  </div>
                </div>

                <table className="w-full mt-3 text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">Producto</th>
                      <th className="py-1">Cantidad</th>
                      <th className="py-1">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alb.lineas_albaran_venta.map((linea) => (
                      <tr key={linea.id} className="border-t">
                        <td className="py-1">{linea.productos_finales?.nombre}</td>
                        <td className="py-1">{linea.cantidad}</td>
                        <td className="py-1">{linea.precio_unitario ?? '-'}</td>
                      </tr>
                    ))}
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

function ProductoParaVender({ producto, onAdd, refrescoStock, cantidadYaEnLineas }) {
  const [lotes, setLotes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [precio, setPrecio] = useState(producto.precio_venta ?? '')

  useEffect(() => {
    async function cargarLotes() {
      const { data } = await supabase
        .from('stock_lotes_producto_final')
        .select('*')
        .eq('producto_final_id', producto.id)
        .gt('stock_disponible', 0)
        .order('fecha', { ascending: true })
      setLotes(data || [])
      setCargando(false)
    }
    cargarLotes()
  }, [producto.id, refrescoStock])

  function handleAdd() {
    const lote = lotes.find((l) => l.produccion_id === parseInt(loteId))
    onAdd(producto, loteId, cantidad, precio, lote?.stock_disponible ?? 0)
    setLoteId('')
    setCantidad('')
  }

  if (cargando) return null

  const lotesConDisponibleReal = lotes
    .map((l) => ({ ...l, disponibleReal: l.stock_disponible - cantidadYaEnLineas(l.produccion_id) }))
    .filter((l) => l.disponibleReal > 0)

  if (lotesConDisponibleReal.length === 0) return null

  return (
    <div className="border rounded-lg p-3">
      <p className="text-sm font-medium text-slate-700">{producto.nombre}</p>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
        <select value={loteId} onChange={(e) => setLoteId(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="">Selecciona lote de producción</option>
          {lotesConDisponibleReal.map((l) => (
            <option key={l.produccion_id} value={l.produccion_id}>
              Producción {l.fecha} · {l.disponibleReal.toFixed(2)} disp.
            </option>
          ))}
        </select>
        <input type="number" step="0.01" placeholder="Cantidad" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="border rounded px-3 py-2 text-sm" />
        <input type="number" step="0.01" placeholder="Precio/ud" value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="border rounded px-3 py-2 text-sm" />
        <button type="button" onClick={handleAdd} className="text-blue-600 hover:underline text-sm">
          + Añadir
        </button>
      </div>
    </div>
  )
}

export default AlbaranesVenta