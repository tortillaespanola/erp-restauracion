import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, DateInput, Badge, EmptyState, LoadingState } from '../components/ui'
import { formatFecha } from '../lib/formatFecha'

const SIN_FECHA = '__sin_fecha__'

function PedidosDelDia() {
  const navigate = useNavigate()
  const [pedidosRaw, setPedidosRaw] = useState([])
  const [tandaIdsConSemi, setTandaIdsConSemi] = useState(new Set())
  const [tandaIdsConPF, setTandaIdsConPF] = useState(new Set())
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [seleccion, setSeleccion] = useState({})

  async function cargarDatos() {
    setCargando(true)

    const { data: pedidos, error } = await supabase
      .from('pedidos_venta')
      .select(`
        id, tanda_id, fecha_entrega_prevista,
        clientes(nombre),
        lineas_pedido_venta(id, producto_final_id, cantidad, productos_finales(nombre))
      `)
      .in('estado', ['pendiente', 'en_produccion'])
      .order('fecha_entrega_prevista', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('Error cargando pedidos:', error)
      setCargando(false)
      return
    }

    const tandaIds = [...new Set(pedidos.map((p) => p.tanda_id).filter(Boolean))]

    let semiSet = new Set()
    let pfSet = new Set()
    if (tandaIds.length > 0) {
      const [resSemi, resPF] = await Promise.all([
        supabase.from('producciones_semielaborado').select('tanda_id').in('tanda_id', tandaIds),
        supabase.from('producciones_producto_final').select('tanda_id').in('tanda_id', tandaIds),
      ])
      semiSet = new Set((resSemi.data || []).map((r) => r.tanda_id))
      pfSet = new Set((resPF.data || []).map((r) => r.tanda_id))
    }

    setPedidosRaw(pedidos)
    setTandaIdsConSemi(semiSet)
    setTandaIdsConPF(pfSet)
    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // Jerarquía producto_final -> fecha_entrega_prevista (cubeta "sin fecha" aparte, siempre al final) -> cliente.
  // Un pedido con líneas de más de un producto_final aparece como fila en cada sección de producto que le
  // corresponda, pero solo puede pertenecer a UNA tanda (pedidos_venta.tanda_id es singular, no N:M) — en cuanto
  // se confirma en una tanda desde cualquiera de sus secciones, aparece bloqueado ("ya en tanda") en las demás.
  const grupos = useMemo(() => {
    const porProducto = new Map()

    for (const p of pedidosRaw) {
      for (const linea of p.lineas_pedido_venta) {
        if (!linea.producto_final_id) continue
        if (desde && p.fecha_entrega_prevista && p.fecha_entrega_prevista < desde) continue
        if (hasta && p.fecha_entrega_prevista && p.fecha_entrega_prevista > hasta) continue

        const pfId = linea.producto_final_id
        if (!porProducto.has(pfId)) {
          porProducto.set(pfId, { id: pfId, nombre: linea.productos_finales?.nombre ?? '(sin nombre)', porFecha: new Map() })
        }
        const producto = porProducto.get(pfId)

        const fechaKey = p.fecha_entrega_prevista ?? SIN_FECHA
        if (!producto.porFecha.has(fechaKey)) {
          producto.porFecha.set(fechaKey, { key: fechaKey, fecha: p.fecha_entrega_prevista, pedidosMap: new Map() })
        }
        const grupoFecha = producto.porFecha.get(fechaKey)

        if (grupoFecha.pedidosMap.has(p.id)) {
          grupoFecha.pedidosMap.get(p.id).cantidad += Number(linea.cantidad)
        } else {
          grupoFecha.pedidosMap.set(p.id, {
            pedidoId: p.id,
            tandaId: p.tanda_id,
            cliente: p.clientes?.nombre ?? 'Sin cliente',
            cantidad: Number(linea.cantidad),
          })
        }
      }
    }

    return [...porProducto.values()]
      .map((producto) => {
        const gruposFecha = [...producto.porFecha.values()]
          .map((g) => {
            const pedidos = [...g.pedidosMap.values()]
            const tandaId = pedidos.find((p) => p.tandaId)?.tandaId ?? null
            return {
              ...g,
              pedidos,
              total: pedidos.reduce((sum, p) => sum + p.cantidad, 0),
              tandaId,
              estadoSemi: tandaId && tandaIdsConSemi.has(tandaId) ? 'generado' : 'pendiente',
              estadoPF: tandaId && tandaIdsConPF.has(tandaId) ? 'generado' : 'pendiente',
            }
          })
          .sort((a, b) => {
            if (a.key === SIN_FECHA) return 1
            if (b.key === SIN_FECHA) return -1
            return a.key.localeCompare(b.key)
          })
        return { ...producto, gruposFecha }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [pedidosRaw, desde, hasta, tandaIdsConSemi, tandaIdsConPF])

  // Una Mezcla puede repartirse entre productos finales distintos (ej. Tortilla Grande y Pequeña
  // desde la misma producción de semielaborado) — la tanda se reutiliza por FECHA, no por
  // producto+fecha, para no forzar una tanda separada por cada sección de producto. Cuando un grupo
  // sin tanda propia comparte fecha con exactamente una tanda ya confirmada en otro producto, se
  // ofrece compartirla explícitamente (ver render) en vez de fusionar en silencio por coincidencia
  // de fecha — dos productos pueden coincidir de fecha sin compartir Mezcla realmente.
  const tandasPorFecha = useMemo(() => {
    const porFecha = new Map()
    for (const producto of grupos) {
      for (const g of producto.gruposFecha) {
        if (!g.tandaId) continue
        if (!porFecha.has(g.key)) porFecha.set(g.key, new Map())
        porFecha.get(g.key).set(g.tandaId, producto.nombre)
      }
    }
    const resultado = new Map()
    for (const [fechaKey, porTanda] of porFecha) {
      resultado.set(fechaKey, [...porTanda.entries()].map(([tandaId, productoNombre]) => ({ tandaId, productoNombre })))
    }
    return resultado
  }, [grupos])

  useEffect(() => {
    setSeleccion((prev) => {
      const next = { ...prev }
      for (const producto of grupos) {
        for (const g of producto.gruposFecha) {
          for (const p of g.pedidos) {
            if (!p.tandaId && !(p.pedidoId in next)) next[p.pedidoId] = true
          }
        }
      }
      return next
    })
  }, [grupos])

  function toggleUno(pedidoId) {
    setSeleccion((prev) => ({ ...prev, [pedidoId]: !prev[pedidoId] }))
  }

  function toggleTodos(grupoFecha) {
    const nuevos = grupoFecha.pedidos.filter((p) => !p.tandaId)
    const marcarTodos = !nuevos.every((p) => seleccion[p.pedidoId])
    setSeleccion((prev) => {
      const next = { ...prev }
      for (const p of nuevos) next[p.pedidoId] = marcarTodos
      return next
    })
  }

  async function confirmarEnTanda(grupoFecha, tandaIdForzado) {
    const nuevos = grupoFecha.pedidos.filter((p) => !p.tandaId && seleccion[p.pedidoId])
    if (nuevos.length === 0) return

    let tandaId = tandaIdForzado ?? grupoFecha.tandaId
    if (!tandaId) {
      const payload = grupoFecha.key === SIN_FECHA ? { estado: 'abierta' } : { estado: 'abierta', fecha: grupoFecha.fecha }
      const { data, error } = await supabase.from('tandas_produccion').insert(payload).select('id').single()
      if (error) {
        alert('Error al crear la tanda: ' + error.message)
        return
      }
      tandaId = data.id
    }

    const { error } = await supabase
      .from('pedidos_venta')
      .update({ tanda_id: tandaId })
      .in('id', nuevos.map((p) => p.pedidoId))

    if (error) {
      alert('Error al asignar los pedidos a la tanda: ' + error.message)
      return
    }

    cargarDatos()
  }

  return (
    <div>
      <PageHeader
        title="Pedidos del día"
        subtitle="Agrupa los pedidos pendientes por producto final y fecha de entrega prevista, para decidir qué tanda de producción abrir."
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3 items-end">
          <Field label="Desde" className="w-40">
            <DateInput value={desde} onChange={setDesde} isClearable placeholderText="Sin límite" />
          </Field>
          <Field label="Hasta" className="w-40">
            <DateInput value={hasta} onChange={setHasta} isClearable placeholderText="Sin límite" />
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : grupos.length === 0 ? (
        <Card><EmptyState>No hay pedidos pendientes de tanda en este rango.</EmptyState></Card>
      ) : (
        grupos.map((producto) => (
          <Card key={producto.id} className="mb-6">
            <CardHeader title={producto.nombre} />
            <CardBody className="p-0">
              <div className="divide-y divide-gray-100">
                {producto.gruposFecha.map((g) => {
                  const nuevos = g.pedidos.filter((p) => !p.tandaId)
                  const nuevosSeleccionados = nuevos.filter((p) => seleccion[p.pedidoId])
                  const todosMarcados = nuevos.length > 0 && nuevos.every((p) => seleccion[p.pedidoId])
                  const esSinFecha = g.key === SIN_FECHA
                  const candidatosCompartir = !g.tandaId ? (tandasPorFecha.get(g.key) || []) : []
                  const puedeCompartir = candidatosCompartir.length === 1

                  return (
                    <div key={g.key} className={`p-4 ${esSinFecha ? 'bg-gray-50/60' : ''}`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <input
                          type="checkbox"
                          checked={todosMarcados}
                          disabled={nuevos.length === 0}
                          onChange={() => toggleTodos(g)}
                        />
                        <span className={esSinFecha ? 'italic text-gray-400 text-sm' : 'font-medium text-[#1C2938] text-sm'}>
                          {esSinFecha ? 'Sin fecha de entrega prevista' : formatFecha(g.fecha)}
                        </span>
                        <Badge color={g.estadoSemi === 'generado' ? 'green' : 'gray'}>
                          Semielab. {g.estadoSemi === 'generado' ? 'generado' : 'pendiente'}
                        </Badge>
                        <Badge color={g.estadoPF === 'generado' ? 'green' : 'gray'}>
                          Producto final {g.estadoPF === 'generado' ? 'generado' : 'pendiente'}
                        </Badge>
                        <span className="ml-auto font-bold text-[#1C2938]">{g.total}</span>
                      </div>

                      <div className="mt-2 flex flex-col gap-1 pl-7">
                        {g.pedidos.map((p) => (
                          <label
                            key={p.pedidoId}
                            className={`flex items-center gap-2 text-sm ${p.tandaId ? 'text-gray-400' : 'text-gray-600'}`}
                          >
                            <input
                              type="checkbox"
                              checked={p.tandaId ? true : !!seleccion[p.pedidoId]}
                              disabled={!!p.tandaId}
                              onChange={() => toggleUno(p.pedidoId)}
                            />
                            <span>{p.cliente}</span>
                            {p.tandaId && <span className="text-[10px] text-gray-400">(ya en tanda)</span>}
                            <span className="ml-auto">{p.cantidad}</span>
                          </label>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-3 flex-wrap">
                        {g.tandaId ? (
                          <Button size="sm" disabled={nuevosSeleccionados.length === 0} onClick={() => confirmarEnTanda(g, g.tandaId)}>
                            Añadir a tanda existente
                          </Button>
                        ) : puedeCompartir ? (
                          <>
                            <Button
                              size="sm"
                              disabled={nuevosSeleccionados.length === 0}
                              onClick={() => confirmarEnTanda(g, candidatosCompartir[0].tandaId)}
                            >
                              Añadir a la tanda existente (compartiendo con {candidatosCompartir[0].productoNombre})
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={nuevosSeleccionados.length === 0}
                              onClick={() => confirmarEnTanda(g, null)}
                            >
                              Crear tanda independiente
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" disabled={nuevosSeleccionados.length === 0} onClick={() => confirmarEnTanda(g, null)}>
                            Confirmar tanda
                          </Button>
                        )}
                        {g.tandaId && (g.estadoSemi === 'generado' || g.estadoPF === 'generado') && (
                          <span className="text-xs text-amber-600">
                            ⚠ Esta tanda ya tiene producción registrada — añadir pedidos generará un déficit a repartir en el cierre.
                          </span>
                        )}
                        {g.tandaId && (
                          <LinkAction tone="green" onClick={() => navigate(`/producciones?tanda_id=${g.tandaId}`)} className="text-xs">
                            Producir semielaborado →
                          </LinkAction>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  )
}

export default PedidosDelDia
