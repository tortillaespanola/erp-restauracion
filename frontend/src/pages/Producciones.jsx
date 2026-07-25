import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

function Producciones() {
  const [semielaborados, setSemielaborados] = useState([])
  const [producciones, setProducciones] = useState([])
  const [stockArticulos, setStockArticulos] = useState([])
  const [stockSemielaborados, setStockSemielaborados] = useState([])
  const [cargando, setCargando] = useState(true)

  const [semielaboradoId, setSemielaboradoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [notas, setNotas] = useState('')
  const [receta, setReceta] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resSemi, resProd, resStockArt, resStockSemi] = await Promise.all([
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase
        .from('producciones_semielaborado')
        .select('*, semielaborados(nombre, unidad), consumo_produccion(id, cantidad, articulos_compra(nombre, unidad), semielaborados!consumo_produccion_ingrediente_semielaborado_id_fkey(nombre, unidad))')
        .order('fecha', { ascending: false }),
      supabase.from('stock_articulos').select('*'),
      supabase.from('stock_semielaborados').select('*'),
    ])

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resProd.error) console.error(resProd.error)
    else setProducciones(resProd.data)

    if (resStockArt.error) console.error(resStockArt.error)
    else setStockArticulos(resStockArt.data)

    if (resStockSemi.error) console.error(resStockSemi.error)
    else setStockSemielaborados(resStockSemi.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // Cada vez que cambia el semielaborado elegido, cargamos su receta
  useEffect(() => {
    async function cargarReceta() {
      if (!semielaboradoId) {
        setReceta([])
        return
      }
      const { data, error } = await supabase
        .from('receta_semielaborado')
        .select('id, cantidad, articulo_id, ingrediente_semielaborado_id, articulos_compra(nombre, unidad), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad)')
        .eq('semielaborado_id', semielaboradoId)

      if (error) console.error(error)
      else setReceta(data)
    }

    cargarReceta()
  }, [semielaboradoId])

  // Calculamos las cantidades necesarias escaladas según lo que se va a producir,
  // y comprobamos si hay stock suficiente de cada ingrediente
  const necesidades = useMemo(() => {
    const cant = parseFloat(cantidad)
    if (!cant || receta.length === 0) return []

    return receta.map((linea) => {
      const esArticulo = !!linea.articulo_id
      const nombre = esArticulo ? linea.articulos_compra?.nombre : linea.semielaborados?.nombre
      const unidad = esArticulo ? linea.articulos_compra?.unidad : linea.semielaborados?.unidad
      const necesario = linea.cantidad * cant

      const stockDisponible = esArticulo
        ? stockArticulos.find((s) => s.articulo_id === linea.articulo_id)?.stock ?? 0
        : stockSemielaborados.find((s) => s.semielaborado_id === linea.ingrediente_semielaborado_id)?.stock ?? 0

      return {
        ...linea,
        esArticulo,
        nombre,
        unidad,
        necesario,
        stockDisponible,
        suficiente: stockDisponible >= necesario,
      }
    })
  }, [receta, cantidad, stockArticulos, stockSemielaborados])

  const hayStockSuficiente = necesidades.length > 0 && necesidades.every((n) => n.suficiente)

  function resetForm() {
    setSemielaboradoId('')
    setCantidad('')
    setFecha(new Date().toISOString().slice(0, 10))
    setNotas('')
    setReceta([])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (necesidades.length === 0) {
      alert('Selecciona un semielaborado con receta y una cantidad a producir')
      return
    }

    if (!hayStockSuficiente) {
      alert('No hay stock suficiente de uno o más ingredientes. Revisa el detalle antes de guardar.')
      return
    }

    const { data: produccionCreada, error: errorProduccion } = await supabase
      .from('producciones_semielaborado')
      .insert({
        semielaborado_id: parseInt(semielaboradoId),
        cantidad_producida: parseFloat(cantidad),
        fecha,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorProduccion) {
      alert('Error al registrar la producción: ' + errorProduccion.message)
      return
    }

    const consumosParaInsertar = necesidades.map((n) => ({
      produccion_id: produccionCreada.id,
      articulo_id: n.esArticulo ? n.articulo_id : null,
      ingrediente_semielaborado_id: n.esArticulo ? null : n.ingrediente_semielaborado_id,
      cantidad: n.necesario,
    }))

    const { error: errorConsumos } = await supabase
      .from('consumo_produccion')
      .insert(consumosParaInsertar)

    if (errorConsumos) {
      alert('Error al registrar los consumos: ' + errorConsumos.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar esta producción? Se revertirá el consumo de stock.')) return

    const { error } = await supabase.from('producciones_semielaborado').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Producciones</h1>
      <p className="text-slate-500 text-sm mt-1">
        Registra cada vez que produces un semielaborado — el sistema descuenta automáticamente el stock de los ingredientes usados.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">Nueva producción</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={semielaboradoId} onChange={(e) => setSemielaboradoId(e.target.value)}
            required className="border rounded px-3 py-2">
            <option value="">Selecciona semielaborado</option>
            {semielaborados.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
            ))}
          </select>
          <input type="number" step="0.01" placeholder="Cantidad producida" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            required className="border rounded px-3 py-2" />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            required className="border rounded px-3 py-2" />
        </div>

        <input type="text" placeholder="Notas (opcional)" value={notas}
          onChange={(e) => setNotas(e.target.value)}
          className="border rounded px-3 py-2" />

        {necesidades.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-600 mb-2">Consumo previsto</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">Ingrediente</th>
                  <th className="py-1">Necesario</th>
                  <th className="py-1">Stock disponible</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {necesidades.map((n) => (
                  <tr key={n.id} className="border-t">
                    <td className="py-1">{n.nombre}</td>
                    <td className="py-1">{n.necesario.toFixed(2)} {n.unidad}</td>
                    <td className="py-1">{n.stockDisponible.toFixed(2)} {n.unidad}</td>
                    <td className="py-1">
                      {n.suficiente
                        ? <span className="text-green-600">✓ OK</span>
                        : <span className="text-red-600 font-medium">Insuficiente</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!hayStockSuficiente && (
              <p className="text-red-600 text-sm mt-2">
                No podrás guardar esta producción hasta tener stock suficiente de todos los ingredientes.
              </p>
            )}
          </div>
        )}

        <button type="submit"
          disabled={necesidades.length === 0 || !hayStockSuficiente}
          className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start disabled:bg-slate-300 disabled:cursor-not-allowed">
          Registrar producción
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Stock actual de semielaborados</h2>
        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden text-sm mb-8">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-3">Semielaborado</th>
                <th className="p-3">Stock</th>
              </tr>
            </thead>
            <tbody>
              {stockSemielaborados.map((s) => (
                <tr key={s.semielaborado_id} className="border-t">
                  <td className="p-3">{s.nombre}</td>
                  <td className="p-3">{Number(s.stock).toFixed(2)} {s.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="font-semibold text-slate-700 mb-3">Historial de producciones</h2>
        {producciones.length === 0 ? (
          <p className="text-slate-500">Todavía no hay producciones registradas.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {producciones.map((p) => (
              <div key={p.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">
                      {p.cantidad_producida} {p.semielaborados?.unidad} de {p.semielaborados?.nombre}
                    </p>
                    <p className="text-sm text-slate-500">{p.fecha}</p>
                    {p.notas && <p className="text-sm text-slate-400 italic">{p.notas}</p>}
                  </div>
                  <button onClick={() => handleBorrar(p.id)} className="text-red-600 hover:underline text-sm">
                    Borrar
                  </button>
                </div>
                <table className="w-full mt-3 text-sm">
                  <tbody>
                    {p.consumo_produccion.map((c) => {
                      const ingrediente = c.articulos_compra ?? c.semielaborados
                      return (
                        <tr key={c.id} className="border-t">
                          <td className="py-1 text-slate-500">Consumido: {ingrediente?.nombre}</td>
                          <td className="py-1">{c.cantidad} {ingrediente?.unidad}</td>
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

export default Producciones