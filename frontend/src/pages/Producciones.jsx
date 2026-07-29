import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function Producciones() {
  const [semielaborados, setSemielaborados] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [cerradas, setCerradas] = useState([])
  const [stockTotal, setStockTotal] = useState([])
  const [cargando, setCargando] = useState(true)

  const [semielaboradoId, setSemielaboradoId] = useState('')

  async function cargarDatos() {
    setCargando(true)

    const selectCompleto = `
      *,
      semielaborados(nombre, unidad),
      consumo_produccion!consumo_produccion_produccion_id_fkey(
        id, cantidad,
        entrada_material_id, produccion_origen_id,
        entrada_material(articulos_compra(nombre, unidad)),
        producciones_semielaborado!consumo_produccion_produccion_origen_id_fkey(semielaborados(nombre, unidad))
      )
    `

    const [resSemi, resAbiertas, resCerradas, resStock] = await Promise.all([
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('producciones_semielaborado').select(selectCompleto).eq('estado', 'abierta').order('fecha', { ascending: false }),
      supabase.from('producciones_semielaborado').select(selectCompleto).eq('estado', 'cerrada').order('fecha', { ascending: false }),
      supabase.from('stock_semielaborados').select('*'),
    ])

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resAbiertas.error) console.error(resAbiertas.error)
    else setAbiertas(resAbiertas.data)

    if (resCerradas.error) console.error(resCerradas.error)
    else setCerradas(resCerradas.data)

    if (resStock.error) console.error(resStock.error)
    else setStockTotal(resStock.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  async function iniciarProduccion(e) {
    e.preventDefault()
    if (!semielaboradoId) return

    const { error } = await supabase
      .from('producciones_semielaborado')
      .insert({
        semielaborado_id: parseInt(semielaboradoId),
        estado: 'abierta',
        fecha: new Date().toISOString().slice(0, 10),
      })

    if (error) {
      alert('Error al iniciar la producción: ' + error.message)
      return
    }

    setSemielaboradoId('')
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar esta producción abierta? Se revertirán los consumos ya registrados.')) return
    const { error } = await supabase.from('producciones_semielaborado').delete().eq('id', id)
    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function handleBorrarCerrada(id) {
    const [c1, c2, c3] = await Promise.all([
      supabase.from('consumo_produccion').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('consumo_produccion_pf').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('ajustes_semielaborado').select('*', { count: 'exact', head: true }).eq('produccion_id', id),
    ])

    let avisos = []
    if (c1.count > 0) avisos.push(`${c1.count} consumo(s) en otras producciones de semielaborados`)
    if (c2.count > 0) avisos.push(`${c2.count} consumo(s) en producciones de productos finales`)
    if (c3.count > 0) avisos.push(`${c3.count} ajuste(s) de stock`)

    const mensaje = avisos.length > 0
      ? `⚠️ Este lote se usó en:\n\n${avisos.map((a) => '• ' + a).join('\n')}\n\nAl borrarlo, esos consumos/ajustes también se eliminarán. ¿Seguro que quieres continuar?`
      : '¿Seguro que quieres borrar esta producción?'

    if (!confirm(mensaje)) return

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
        Inicia una producción, ve registrando consumos de los lotes que uses, y ciérrala cuando tengas el peso neto final.
      </p>

      <form onSubmit={iniciarProduccion} className="mt-6 bg-white p-4 rounded-lg shadow flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-sm font-semibold text-slate-600 block mb-1">Iniciar nueva producción</label>
          <select value={semielaboradoId} onChange={(e) => setSemielaboradoId(e.target.value)}
            required className="border rounded px-3 py-2 w-full">
            <option value="">Selecciona qué vas a producir</option>
            {semielaborados.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
            ))}
          </select>
        </div>
        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700">
          Iniciar
        </button>
      </form>

      {abiertas.length > 0 && (
        <div className="mt-8">
          <h2 className="font-semibold text-slate-700 mb-3">Producciones en curso</h2>
          <div className="flex flex-col gap-4">
            {abiertas.map((p) => (
              <ProduccionAbierta
                key={p.id}
                produccion={p}
                onCambio={cargarDatos}
                onCancelar={() => handleCancelar(p.id)}
              />
            ))}
          </div>
        </div>
      )}

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
              {stockTotal.map((s) => (
                <tr key={s.semielaborado_id} className="border-t">
                  <td className="p-3">{s.nombre}</td>
                  <td className="p-3">{Number(s.stock).toFixed(2)} {s.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="font-semibold text-slate-700 mb-3">Historial de producciones cerradas</h2>
        {cerradas.length === 0 ? (
          <p className="text-slate-500">Todavía no hay producciones cerradas.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {cerradas.map((p) => (
              <div key={p.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">
                      {p.cantidad_producida} {p.semielaborados?.unidad} de {p.semielaborados?.nombre}
                      {p.codigo_lote && <span className="ml-2 text-xs font-mono text-slate-400">{p.codigo_lote}</span>}
                    </p>
                    <p className="text-sm text-slate-500">{p.fecha}</p>
                    {p.notas && <p className="text-sm text-slate-400 italic">{p.notas}</p>}
                  </div>
                  <button onClick={() => handleBorrarCerrada(p.id)} className="text-red-600 hover:underline text-sm">
                    Borrar
                  </button>
                </div>
                <table className="w-full mt-3 text-sm">
                  <tbody>
                    {p.consumo_produccion.map((c) => {
                      const ingrediente = c.entrada_material?.articulos_compra ?? c.producciones_semielaborado?.semielaborados
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

function ProduccionAbierta({ produccion, onCambio, onCancelar }) {
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)

  const [cantidadProducida, setCantidadProducida] = useState('')
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [cerrando, setCerrando] = useState(false)

  async function cargarIngredientes() {
    setCargandoIngredientes(true)

    const { data: receta } = await supabase
      .from('receta_semielaborado')
      .select('id, cantidad, articulo_id, ingrediente_semielaborado_id, articulos_compra(nombre, unidad), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad)')
      .eq('semielaborado_id', produccion.semielaborado_id)

    const conLotes = await Promise.all(
      (receta || []).map(async (linea) => {
        const esArticulo = !!linea.articulo_id
        let lotes = []

        if (esArticulo) {
          const { data } = await supabase
            .from('stock_lotes_articulo')
            .select('*')
            .eq('articulo_id', linea.articulo_id)
            .gt('stock_disponible', 0)
            .order('fecha_caducidad', { ascending: true, nullsFirst: false })
          lotes = data || []
        } else {
          const { data } = await supabase
            .from('stock_lotes_semielaborado')
            .select('*')
            .eq('semielaborado_id', linea.ingrediente_semielaborado_id)
            .gt('stock_disponible', 0)
            .order('fecha', { ascending: true })
          lotes = data || []
        }

        return {
          esArticulo,
          articulo_id: linea.articulo_id,
          ingrediente_semielaborado_id: linea.ingrediente_semielaborado_id,
          nombre: esArticulo ? linea.articulos_compra?.nombre : linea.semielaborados?.nombre,
          unidad: esArticulo ? linea.articulos_compra?.unidad : linea.semielaborados?.unidad,
          cantidadOrientativa: linea.cantidad,
          lotes,
        }
      })
    )

    setIngredientes(conLotes)
    setCargandoIngredientes(false)
  }

  useEffect(() => {
    cargarIngredientes()
  }, [])

  async function registrarConsumo(ingrediente, loteId, cantidad) {
    const cant = parseFloat(cantidad)
    if (!loteId || !cant || cant <= 0) {
      alert('Selecciona un lote e introduce una cantidad válida')
      return
    }

    const lote = ingrediente.lotes.find((l) =>
      ingrediente.esArticulo ? l.entrada_material_id === parseInt(loteId) : l.produccion_id === parseInt(loteId)
    )
    if (cant > lote.stock_disponible) {
      alert(`Solo quedan ${lote.stock_disponible.toFixed(2)} ${ingrediente.unidad} disponibles en ese lote`)
      return
    }

    const { error } = await supabase.from('consumo_produccion').insert({
      produccion_id: produccion.id,
      entrada_material_id: ingrediente.esArticulo ? parseInt(loteId) : null,
      produccion_origen_id: ingrediente.esArticulo ? null : parseInt(loteId),
      cantidad: cant,
    })

    if (error) {
      alert('Error al registrar el consumo: ' + error.message)
      return
    }

    await cargarIngredientes()
    onCambio()
  }

  async function quitarConsumo(consumoId) {
    const { error } = await supabase.from('consumo_produccion').delete().eq('id', consumoId)
    if (error) {
      alert('Error al quitar el consumo: ' + error.message)
      return
    }
    await cargarIngredientes()
    onCambio()
  }

  async function cerrarProduccion() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert('Indica el peso/cantidad neta producida')
      return
    }

    const { error } = await supabase
      .from('producciones_semielaborado')
      .update({
        cantidad_producida: parseFloat(cantidadProducida),
        estado: 'cerrada',
        notas: notas || null,
      })
      .eq('id', produccion.id)

    if (error) {
      alert('Error al cerrar la producción: ' + error.message)
      return
    }

    onCambio()
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-400">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold">{produccion.semielaborados?.nombre} <span className="text-amber-600 text-sm font-normal">— en curso</span></p>
          <p className="text-sm text-slate-500">Iniciada el {produccion.fecha}</p>
        </div>
        <button onClick={onCancelar} className="text-red-600 hover:underline text-sm">
          Cancelar producción
        </button>
      </div>

      {produccion.consumo_produccion.length > 0 && (
        <table className="w-full mt-3 text-sm">
          <tbody>
            {produccion.consumo_produccion.map((c) => {
              const ingrediente = c.entrada_material?.articulos_compra ?? c.producciones_semielaborado?.semielaborados
              return (
                <tr key={c.id} className="border-t">
                  <td className="py-1 text-slate-500">{ingrediente?.nombre}</td>
                  <td className="py-1">{c.cantidad} {ingrediente?.unidad}</td>
                  <td className="py-1">
                    <button onClick={() => quitarConsumo(c.id)} className="text-red-600 hover:underline text-xs">
                      Quitar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-600">Registrar consumo</h3>
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={`${ing.esArticulo ? 'art' : 'semi'}-${ing.articulo_id ?? ing.ingrediente_semielaborado_id}`}
              ingrediente={ing}
              onAdd={(loteId, cantidad) => registrarConsumo(ing, loteId, cantidad)} />
          ))}
        </div>
      )}

      <div className="border-t mt-4 pt-4">
        {!cerrando ? (
          <button onClick={() => setCerrando(true)}
            className="bg-green-700 text-white rounded px-4 py-2 text-sm hover:bg-green-800">
            Cerrar producción (indicar cantidad neta)
          </button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="number" step="0.01" placeholder={`Cantidad producida (${produccion.semielaborados?.unidad})`}
              value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
              className="border rounded px-3 py-2" autoFocus />
            <input type="text" placeholder="Notas (mermas, incidencias...)"
              value={notas} onChange={(e) => setNotas(e.target.value)}
              className="border rounded px-3 py-2" />
            <button onClick={cerrarProduccion}
              className="bg-green-700 text-white rounded px-4 py-2 hover:bg-green-800">
              Confirmar cierre
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function IngredienteConsumo({ ingrediente, onAdd }) {
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')

  function handleAdd() {
    onAdd(loteId, cantidad)
    setLoteId('')
    setCantidad('')
  }

  return (
    <div className="border rounded-lg p-3">
      <p className="text-sm font-medium text-slate-700">
        {ingrediente.nombre}
        <span className="text-slate-400 font-normal"> — orientativo: {ingrediente.cantidadOrientativa} {ingrediente.unidad} por unidad</span>
      </p>

      {ingrediente.lotes.length === 0 ? (
        <p className="text-sm text-red-500 mt-1">Sin stock disponible de este ingrediente.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 mt-2 items-center">
          <select value={loteId} onChange={(e) => setLoteId(e.target.value)} className="border rounded px-3 py-2 text-sm">
            <option value="">Selecciona lote</option>
            {ingrediente.lotes.map((l) => {
              const id = ingrediente.esArticulo ? l.entrada_material_id : l.produccion_id
              const label = ingrediente.esArticulo
                ? `Albarán ${l.numero_albaran || '(s/n)'} · ${l.fecha_recepcion}${l.fecha_caducidad ? ` · cad. ${l.fecha_caducidad}` : ''} · ${l.stock_disponible.toFixed(2)} ${ingrediente.unidad} disp.`
                : `Producción ${l.fecha} · ${l.stock_disponible.toFixed(2)} ${ingrediente.unidad} disp.`
              return <option key={id} value={id}>{label}</option>
            })}
          </select>
          <input type="number" step="0.01" placeholder="Cantidad" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="border rounded px-3 py-2 text-sm" />
          <button type="button" onClick={handleAdd} className="text-blue-600 hover:underline text-sm">
            + Registrar consumo
          </button>
        </div>
      )}
    </div>
  )
}

export default Producciones