import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconTrash } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

async function cargarIngredientesConLotes(semielaboradoId) {
  const { data: receta } = await supabase
    .from('receta_semielaborado')
    .select('id, cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id, articulos_compra(nombre, unidad), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad), ingredientes(nombre, unidad)')
    .eq('semielaborado_id', semielaboradoId)

  return Promise.all(
    (receta || []).map(async (linea) => {
      const esArticuloDirecto = !!linea.articulo_id
      const esIngrediente = !!linea.ingrediente_id
      const esArticulo = esArticuloDirecto || esIngrediente
      let lotes = []

      if (esArticuloDirecto) {
        const { data } = await supabase
          .from('stock_lotes_articulo')
          .select('*')
          .eq('articulo_id', linea.articulo_id)
          .gt('stock_disponible', 0)
          .order('fecha_caducidad', { ascending: true, nullsFirst: false })
        lotes = data || []
      } else if (esIngrediente) {
        const { data: vinculos } = await supabase
          .from('articulo_ingrediente')
          .select('articulo_id')
          .eq('ingrediente_id', linea.ingrediente_id)
        const articuloIds = (vinculos || []).map((v) => v.articulo_id)
        if (articuloIds.length > 0) {
          const { data } = await supabase
            .from('stock_lotes_articulo')
            .select('*')
            .in('articulo_id', articuloIds)
            .gt('stock_disponible', 0)
            .order('fecha_caducidad', { ascending: true, nullsFirst: false })
          lotes = data || []
        }
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
        esIngrediente,
        articulo_id: linea.articulo_id,
        ingrediente_id: linea.ingrediente_id,
        ingrediente_semielaborado_id: linea.ingrediente_semielaborado_id,
        nombre: esArticuloDirecto ? linea.articulos_compra?.nombre : esIngrediente ? linea.ingredientes?.nombre : linea.semielaborados?.nombre,
        unidad: esArticuloDirecto ? linea.articulos_compra?.unidad : esIngrediente ? linea.ingredientes?.unidad : linea.semielaborados?.unidad,
        cantidadOrientativa: linea.cantidad,
        lotes,
      }
    })
  )
}

function nombreIngredienteDeLinea(c) {
  const ing = c.entrada_material?.articulos_compra ?? c.producciones_semielaborado?.semielaborados
  return { nombre: ing?.nombre, unidad: ing?.unidad }
}

function Producciones() {
  const [semielaborados, setSemielaborados] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [cerradas, setCerradas] = useState([])
  const [stockTotal, setStockTotal] = useState([])
  const [cargando, setCargando] = useState(true)

  const [semielaboradoId, setSemielaboradoId] = useState('')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))

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
        fecha: fechaInicio,
      })

    if (error) {
      alert('Error al iniciar la producción: ' + error.message)
      return
    }

    setSemielaboradoId('')
    setFechaInicio(new Date().toISOString().slice(0, 10))
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
    <div>
      <PageHeader title="Producciones" subtitle="Inicia una producción, ve registrando consumos de los lotes que uses, y ciérrala cuando tengas el peso neto final." />

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
            <Field label="Iniciar nueva producción">
              <Select value={semielaboradoId} onChange={(e) => setSemielaboradoId(e.target.value)} required>
                <option value="">Selecciona qué vas a producir</option>
                {semielaborados.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <DateInput value={fechaInicio} onChange={setFechaInicio} required />
            </Field>
            <Button type="submit">Iniciar</Button>
          </form>
        </CardBody>
      </Card>

      {abiertas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Producciones en curso</h2>
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

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Stock actual de semielaborados</h2>
      {cargando ? (
        <LoadingState />
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th>Semielaborado</Th>
              <Th>Stock</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {stockTotal.map((s) => (
                <tr key={s.semielaborado_id} className="hover:bg-blue-50/40">
                  <Td className="font-medium">{s.nombre}</Td>
                  <Td>{Number(s.stock).toFixed(3)} {s.unidad}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Historial de producciones cerradas</h2>
      {cerradas.length === 0 ? (
        <Card><EmptyState>Todavía no hay producciones cerradas.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {cerradas.map((p) => (
            <ProduccionCerrada
              key={p.id}
              produccion={p}
              onCambio={cargarDatos}
              onBorrar={() => handleBorrarCerrada(p.id)}
            />
          ))}
        </div>
      )}
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
    setIngredientes(await cargarIngredientesConLotes(produccion.semielaborado_id))
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
    <Card className="p-4 border-l-4 border-l-amber-400!">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold text-[#1C2938]">{produccion.semielaborados?.nombre} <span className="text-amber-600 text-sm font-normal">— en curso</span></p>
          <p className="text-sm text-gray-500">Iniciada el {produccion.fecha}</p>
        </div>
        <LinkAction tone="red" onClick={onCancelar}>Cancelar producción</LinkAction>
      </div>

      {produccion.consumo_produccion.length > 0 && (
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion.map((c) => {
              const { nombre, unidad } = nombreIngredienteDeLinea(c)
              return (
                <tr key={c.id}>
                  <td className="py-1.5 text-gray-500">{nombre}</td>
                  <td className="py-1.5">{c.cantidad} {unidad}</td>
                  <td className="py-1.5 text-right">
                    <LinkAction tone="red" onClick={() => quitarConsumo(c.id)} className="text-xs">Quitar</LinkAction>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-600">Registrar consumo</h3>
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={`${ing.esArticulo ? 'art' : 'semi'}-${ing.articulo_id ?? ing.ingrediente_id ?? ing.ingrediente_semielaborado_id}`}
              ingrediente={ing}
              fechaDestino={produccion.fecha}
              onAdd={(loteId, cantidad) => registrarConsumo(ing, loteId, cantidad)} />
          ))}
        </div>
      )}

      <div className="border-t border-gray-100 mt-4 pt-4">
        {!cerrando ? (
          <Button variant="success" size="sm" onClick={() => setCerrando(true)}>
            Cerrar producción (indicar cantidad neta)
          </Button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input type="number" step="0.001" placeholder={`Cantidad producida (${produccion.semielaborados?.unidad})`}
              value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
              autoFocus title="Se redondeará a 3 decimales" />
            <Input type="text" placeholder="Notas (mermas, incidencias...)"
              value={notas} onChange={(e) => setNotas(e.target.value)} />
            <Button variant="success" onClick={cerrarProduccion}>Confirmar cierre</Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function IngredienteConsumo({ ingrediente, fechaDestino, onAdd }) {
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')

  function handleAdd() {
    onAdd(loteId, cantidad)
    setLoteId('')
    setCantidad('')
  }

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <p className="text-sm font-medium text-gray-700">
        {ingrediente.nombre}
        <span className="text-gray-400 font-normal"> — orientativo: {ingrediente.cantidadOrientativa} {ingrediente.unidad} por unidad</span>
      </p>

      {ingrediente.lotes.length === 0 ? (
        <p className="text-sm text-red-500 mt-1">Sin stock disponible de este ingrediente.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 mt-2 items-center">
          <Select value={loteId} onChange={(e) => setLoteId(e.target.value)} className="text-sm">
            <option value="">Selecciona lote</option>
            {ingrediente.lotes.map((l) => {
              const id = ingrediente.esArticulo ? l.entrada_material_id : l.produccion_id
              const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
              const label = ingrediente.esArticulo
                ? `${ingrediente.esIngrediente ? `${l.nombre} · ` : ''}${l.proveedor ? `${l.proveedor} · ` : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${l.fecha_recepcion}${l.fecha_caducidad ? ` · cad. ${l.fecha_caducidad}` : ''} · ${l.stock_disponible.toFixed(3)} ${ingrediente.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
                : `${l.codigo_lote ? l.codigo_lote + ' · ' : ''}Producción ${l.fecha} · ${l.stock_disponible.toFixed(3)} ${ingrediente.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
              return <option key={id} value={id}>{label}</option>
            })}
          </Select>
          <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="text-sm" title="Se redondeará a 3 decimales" />
          <LinkAction tone="blue" onClick={handleAdd}>+ Registrar consumo</LinkAction>
        </div>
      )}
    </div>
  )
}

function ProduccionCerrada({ produccion, onCambio, onBorrar }) {
  const [editando, setEditando] = useState(false)

  if (!editando) {
    return (
      <Card className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-semibold text-[#1C2938]">
              {produccion.cantidad_producida} {produccion.semielaborados?.unidad} de {produccion.semielaborados?.nombre}
              {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
            </p>
            <p className="text-sm text-gray-500">{produccion.fecha}</p>
            {produccion.notas && <p className="text-sm text-gray-400 italic">{produccion.notas}</p>}
          </div>
          <div className="flex gap-3 shrink-0">
            <LinkAction tone="blue" onClick={() => setEditando(true)}>Editar</LinkAction>
            <LinkAction tone="red" onClick={onBorrar}>Borrar</LinkAction>
          </div>
        </div>
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion.map((c) => {
              const { nombre, unidad } = nombreIngredienteDeLinea(c)
              return (
                <tr key={c.id}>
                  <td className="py-1.5 text-gray-500">Consumido: {nombre}</td>
                  <td className="py-1.5">{c.cantidad} {unidad}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    )
  }

  return (
    <ProduccionCerradaEdicion
      produccion={produccion}
      onCancelar={() => setEditando(false)}
      onGuardado={() => { setEditando(false); onCambio() }}
    />
  )
}

function ProduccionCerradaEdicion({ produccion, onCancelar, onGuardado }) {
  const [fecha, setFecha] = useState(produccion.fecha)
  const [cantidadProducida, setCantidadProducida] = useState(String(produccion.cantidad_producida))
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [fechaCaducidad, setFechaCaducidad] = useState(produccion.fecha_caducidad ?? '')
  const [lineas, setLineas] = useState(() =>
    produccion.consumo_produccion.map((c) => {
      const { nombre, unidad } = nombreIngredienteDeLinea(c)
      return {
        id: c.id,
        entrada_material_id: c.entrada_material_id,
        produccion_origen_id: c.produccion_origen_id,
        cantidad: String(c.cantidad),
        _deleted: false,
        _nombre: nombre,
        _unidad: unidad,
      }
    })
  )
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    cargarIngredientesConLotes(produccion.semielaborado_id).then((ings) => {
      setIngredientes(ings)
      setCargandoIngredientes(false)
    })
  }, [])

  function cambiarCantidadLinea(index, valor) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, cantidad: valor } : l)))
  }

  function quitarLinea(index) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, _deleted: true } : l)))
  }

  function anadirLinea(ingrediente, loteId, cantidad) {
    const cant = parseFloat(cantidad)
    if (!loteId || !cant || cant <= 0) {
      alert('Selecciona un lote e introduce una cantidad válida')
      return
    }
    setLineas((prev) => [
      ...prev,
      {
        id: null,
        entrada_material_id: ingrediente.esArticulo ? parseInt(loteId) : null,
        produccion_origen_id: ingrediente.esArticulo ? null : parseInt(loteId),
        cantidad: String(cant),
        _deleted: false,
        _nombre: ingrediente.nombre,
        _unidad: ingrediente.unidad,
      },
    ])
  }

  async function guardar() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert('Indica una cantidad producida válida')
      return
    }

    setGuardando(true)

    const p_lineas = lineas.map((l) => ({
      id: l.id,
      entrada_material_id: l.entrada_material_id,
      produccion_origen_id: l.produccion_origen_id,
      cantidad: parseFloat(l.cantidad),
      _deleted: l._deleted,
    }))

    const { error } = await supabase.rpc('rpc_editar_produccion_semielaborado', {
      p_id: produccion.id,
      p_fecha: fecha,
      p_cantidad_producida: parseFloat(cantidadProducida),
      p_notas: notas || null,
      p_lineas,
      p_fecha_caducidad: fechaCaducidad || null,
    })

    setGuardando(false)

    if (error) {
      alert('Edición inválida: ' + error.message)
      return
    }

    onGuardado()
  }

  return (
    <Card className="p-4 border-l-4 border-l-[#0854A0]!">
      <p className="font-semibold text-[#1C2938] mb-3">
        Editando producción de {produccion.semielaborados?.nombre}
        {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Fecha">
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={`Cantidad producida (${produccion.semielaborados?.unidad})`}>
          <Input type="number" step="0.001" value={cantidadProducida}
            onChange={(e) => setCantidadProducida(e.target.value)} title="Se redondeará a 3 decimales" />
        </Field>
        <Field label="Notas">
          <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
        <Field label="Fecha de caducidad (opcional)">
          <DateInput value={fechaCaducidad} onChange={setFechaCaducidad} />
        </Field>
      </div>

      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">Líneas de consumo</p>
      <div className="flex flex-col gap-2">
        {lineas.filter((l) => !l._deleted).map((linea) => {
          const index = lineas.indexOf(linea)
          return (
            <div key={index} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-center border border-gray-200 rounded-md p-2">
              <span className="text-sm text-gray-600">{linea._nombre}</span>
              <Input type="number" step="0.001" value={linea.cantidad}
                onChange={(e) => cambiarCantidadLinea(index, e.target.value)}
                className="text-sm" title="Se redondeará a 3 decimales" />
              <button type="button" onClick={() => quitarLinea(index)} className="text-gray-400 hover:text-red-600 justify-self-center">
                <IconTrash size={16} />
              </button>
            </div>
          )
        })}
        {lineas.every((l) => l._deleted) && <p className="text-sm text-gray-400">Sin líneas de consumo.</p>}
      </div>

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Añadir más consumo</p>
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={`${ing.esArticulo ? 'art' : 'semi'}-${ing.articulo_id ?? ing.ingrediente_id ?? ing.ingrediente_semielaborado_id}`}
              ingrediente={ing}
              fechaDestino={fecha}
              onAdd={(loteId, cantidad) => anadirLinea(ing, loteId, cantidad)} />
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <Button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cambios'}</Button>
        <Button variant="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </Card>
  )
}

export default Producciones
