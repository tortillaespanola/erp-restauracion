import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function AjustesStock() {
  const [tipo, setTipo] = useState('articulo')
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [itemId, setItemId] = useState('')
  const [lotes, setLotes] = useState([])
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)

  async function cargarBase() {
    setCargando(true)
    const [resArt, resSemi, resAjArt, resAjSemi] = await Promise.all([
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('ajustes_articulo').select('*, articulos_compra(nombre, unidad)').order('fecha', { ascending: false }),
      supabase.from('ajustes_semielaborado').select('*, semielaborados(nombre, unidad)').order('fecha', { ascending: false }),
    ])

    if (resArt.error) console.error(resArt.error)
    else setArticulos(resArt.data)

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    const historialArt = (resAjArt.data || []).map((a) => ({
      ...a, tipo: 'articulo', nombre: a.articulos_compra?.nombre, unidad: a.articulos_compra?.unidad,
    }))
    const historialSemi = (resAjSemi.data || []).map((a) => ({
      ...a, tipo: 'semielaborado', nombre: a.semielaborados?.nombre, unidad: a.semielaborados?.unidad,
    }))
    const combinado = [...historialArt, ...historialSemi].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    setHistorial(combinado)

    setCargando(false)
  }

  useEffect(() => {
    cargarBase()
  }, [])

  useEffect(() => {
    async function cargarLotes() {
      setLoteId('')
      if (!itemId) {
        setLotes([])
        return
      }
      if (tipo === 'articulo') {
        const { data } = await supabase
          .from('stock_lotes_articulo')
          .select('*')
          .eq('articulo_id', itemId)
          .order('fecha_recepcion', { ascending: true })
        setLotes(data || [])
      } else {
        const { data } = await supabase
          .from('stock_lotes_semielaborado')
          .select('*')
          .eq('semielaborado_id', itemId)
          .order('fecha', { ascending: true })
        setLotes(data || [])
      }
    }
    cargarLotes()
  }, [tipo, itemId])

  function resetForm() {
    setItemId('')
    setLoteId('')
    setCantidad('')
    setMotivo('')
    setFecha(new Date().toISOString().slice(0, 10))
    setLotes([])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!itemId || !loteId || !cantidad || !motivo) {
      alert('Selecciona el ítem, el lote, la cantidad y el motivo')
      return
    }

    const cant = parseFloat(cantidad)

    if (tipo === 'articulo') {
      const { error } = await supabase.from('ajustes_articulo').insert({
        articulo_id: parseInt(itemId),
        entrada_material_id: parseInt(loteId),
        cantidad: cant,
        motivo,
        fecha,
      })
      if (error) {
        alert('Error al guardar el ajuste: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('ajustes_semielaborado').insert({
        semielaborado_id: parseInt(itemId),
        produccion_id: parseInt(loteId),
        cantidad: cant,
        motivo,
        fecha,
      })
      if (error) {
        alert('Error al guardar el ajuste: ' + error.message)
        return
      }
    }

    resetForm()
    cargarBase()
  }

  async function handleBorrar(a) {
    if (!confirm('¿Seguro que quieres eliminar este ajuste? El stock volverá a su valor anterior.')) return

    const tabla = a.tipo === 'articulo' ? 'ajustes_articulo' : 'ajustes_semielaborado'
    const { error } = await supabase.from(tabla).delete().eq('id', a.id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarBase()
  }

  const items = tipo === 'articulo' ? articulos : semielaborados

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Ajustes de stock</h1>
      <p className="text-slate-500 text-sm mt-1">
        Corrige el stock de un lote concreto por mermas, caducidad, roturas o errores de pesaje. Usa cantidades negativas para restar y positivas para sumar.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <h2 className="font-semibold text-slate-700">Nuevo ajuste</h2>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={tipo === 'articulo'}
              onChange={() => { setTipo('articulo'); setItemId('') }} />
            Artículo de compra
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={tipo === 'semielaborado'}
              onChange={() => { setTipo('semielaborado'); setItemId('') }} />
            Semielaborado
          </label>
        </div>

        <select value={itemId} onChange={(e) => setItemId(e.target.value)}
          required className="border rounded px-3 py-2">
          <option value="">Selecciona {tipo === 'articulo' ? 'artículo' : 'semielaborado'}</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
          ))}
        </select>

        {itemId && (
          <select value={loteId} onChange={(e) => setLoteId(e.target.value)}
            required className="border rounded px-3 py-2">
            <option value="">
              {lotes.length === 0 ? 'Este ítem no tiene lotes con stock' : 'Selecciona el lote a ajustar'}
            </option>
            {lotes.map((l, index) => {
              const id = tipo === 'articulo' ? l.entrada_material_id : l.produccion_id
              const esMasAntiguo = index === 0
              const label = tipo === 'articulo'
                ? `${esMasAntiguo ? '✓ Más antiguo · ' : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${l.fecha_recepcion} · stock actual: ${Number(l.stock_disponible).toFixed(3)}`
                : `${esMasAntiguo ? '✓ Más antiguo · ' : ''}Producción ${l.fecha} · stock actual: ${Number(l.stock_disponible).toFixed(3)}`
              return <option key={id} value={id}>{label}</option>
            })}
          </select>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input type="number" step="0.001" placeholder="Cantidad (+ suma, - resta)" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            required className="border rounded px-3 py-2" />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            required className="border rounded px-3 py-2" />
          <input type="text" placeholder="Motivo (caducidad, rotura, error pesaje...)" value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required className="border rounded px-3 py-2" />
        </div>

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
          Registrar ajuste
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Historial de ajustes</h2>
        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : historial.length === 0 ? (
          <p className="text-slate-500">Todavía no hay ajustes registrados.</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Ítem</th>
                <th className="p-3">Cantidad</th>
                <th className="p-3">Motivo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((a) => (
                <tr key={`${a.tipo}-${a.id}`} className="border-t">
                  <td className="p-3">{a.fecha}</td>
                  <td className="p-3">{a.nombre} <span className="text-slate-400 text-xs">({a.tipo})</span></td>
                  <td className={`p-3 font-medium ${a.cantidad >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {a.cantidad >= 0 ? '+' : ''}{a.cantidad} {a.unidad}
                  </td>
                  <td className="p-3">{a.motivo}</td>
                  <td className="p-3">
                    <button onClick={() => handleBorrar(a)} className="text-red-600 hover:underline text-xs">
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default AjustesStock