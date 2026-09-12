import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, DateInput, Field, Input, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

function claveAsignacion(productoId, pedidoId) {
  return `${productoId}-${pedidoId}`
}

function CierreTanda() {
  const { t } = useTranslation(['common', 'cierre_tanda'])
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tandaId = searchParams.get('tanda_id')

  const [pedidos, setPedidos] = useState([])
  const [producciones, setProducciones] = useState([])
  const [lotesStock, setLotesStock] = useState([])
  const [cargando, setCargando] = useState(true)
  const [asignaciones, setAsignaciones] = useState({})
  const [fechaCierre, setFechaCierre] = useState(() => new Date().toISOString().slice(0, 10))
  const [confirmando, setConfirmando] = useState(false)

  async function cargarDatos() {
    setCargando(true)

    const [resPedidos, resProducciones] = await Promise.all([
      supabase
        .from('pedidos_venta')
        .select(`
          id, cliente_id, clientes(nombre),
          lineas_pedido_venta(id, producto_final_id, articulo_id, descripcion, cantidad, precio_unitario,
            productos_finales(nombre), lineas_albaran_venta(cantidad))
        `)
        .eq('tanda_id', tandaId),
      supabase
        .from('producciones_producto_final')
        .select('id, producto_final_id, cantidad_producida, fecha, productos_finales(nombre)')
        .eq('tanda_id', tandaId)
        .eq('estado', 'cerrada'),
    ])

    const pedidosData = resPedidos.data || []
    const produccionesData = resProducciones.data || []
    const produccionIds = produccionesData.map((p) => p.id)

    const resLotes = produccionIds.length > 0
      ? await supabase.from('stock_lotes_producto_final').select('*').in('produccion_id', produccionIds)
      : { data: [] }

    setPedidos(pedidosData)
    setProducciones(produccionesData)
    setLotesStock(resLotes.data || [])
    setCargando(false)
  }

  useEffect(() => {
    if (tandaId) cargarDatos()
  }, [tandaId])

  // Un grupo por producto_final con demanda pendiente en la tanda -- una tanda puede tener pedidos
  // de más de un producto (ver Parte 1, tanda compartible), así que el déficit se calcula por
  // producto, no globalizado para toda la tanda.
  const grupos = useMemo(() => {
    const porProducto = new Map()

    for (const p of pedidos) {
      for (const linea of p.lineas_pedido_venta) {
        if (!linea.producto_final_id) continue
        const entregado = (linea.lineas_albaran_venta || []).reduce((s, e) => s + Number(e.cantidad), 0)
        const pendiente = Number(linea.cantidad) - entregado
        if (pendiente <= 0) continue

        if (!porProducto.has(linea.producto_final_id)) {
          porProducto.set(linea.producto_final_id, { id: linea.producto_final_id, nombre: linea.productos_finales?.nombre, pedidos: [] })
        }
        porProducto.get(linea.producto_final_id).pedidos.push({
          pedidoId: p.id,
          lineaPedidoId: linea.id,
          cliente: p.clientes?.nombre ?? t('cierre_tanda:sin_cliente'),
          cantidadPedida: pendiente,
          precioUnitario: linea.precio_unitario,
        })
      }
    }

    return [...porProducto.values()].map((g) => {
      const lotes = lotesStock.filter((l) =>
        producciones.some((pr) => pr.id === l.produccion_id && pr.producto_final_id === g.id)
      )
      const disponibleTotal = lotes.reduce((s, l) => s + Number(l.stock_disponible), 0)
      const totalPedido = g.pedidos.reduce((s, p) => s + p.cantidadPedida, 0)
      return { ...g, lotes, disponibleTotal, totalPedido, deficit: disponibleTotal < totalPedido }
    })
  }, [pedidos, producciones, lotesStock])

  const lineasLibresPorPedido = useMemo(() => {
    const mapa = new Map()
    for (const p of pedidos) {
      const libres = p.lineas_pedido_venta
        .filter((l) => !l.producto_final_id && !l.articulo_id && l.descripcion)
        .map((l) => ({ ...l, entregado: (l.lineas_albaran_venta || []).reduce((s, e) => s + Number(e.cantidad), 0) }))
        .filter((l) => Number(l.cantidad) - l.entregado > 0)
      if (libres.length > 0) mapa.set(p.id, libres)
    }
    return mapa
  }, [pedidos])

  // Reparto por defecto: sin déficit, lo asignado es siempre lo pedido (no editable). Con déficit,
  // reparto FIFO por orden de llegada como sugerencia de partida -- el operador decide de verdad
  // editando los inputs, nunca se escribe nada hasta que confirma.
  useEffect(() => {
    setAsignaciones((prev) => {
      const next = { ...prev }
      for (const g of grupos) {
        if (!g.deficit) {
          for (const p of g.pedidos) next[claveAsignacion(g.id, p.pedidoId)] = p.cantidadPedida
          continue
        }
        const yaInicializado = g.pedidos.some((p) => claveAsignacion(g.id, p.pedidoId) in prev)
        if (yaInicializado) continue
        let restante = g.disponibleTotal
        for (const p of g.pedidos) {
          const asign = Math.max(0, Math.min(p.cantidadPedida, restante))
          next[claveAsignacion(g.id, p.pedidoId)] = asign
          restante -= asign
        }
      }
      return next
    })
  }, [grupos])

  function actualizarAsignacion(productoId, pedidoId, valor) {
    setAsignaciones((prev) => ({ ...prev, [claveAsignacion(productoId, pedidoId)]: valor === '' ? '' : parseFloat(valor) }))
  }

  async function confirmarCierre() {
    for (const g of grupos) {
      const totalAsignado = g.pedidos.reduce((s, p) => s + (Number(asignaciones[claveAsignacion(g.id, p.pedidoId)]) || 0), 0)
      if (totalAsignado > g.disponibleTotal + 0.0001) {
        alert(t('cierre_tanda:alertas.supera_disponible', { nombre: g.nombre, asignado: totalAsignado.toFixed(3), disponible: g.disponibleTotal.toFixed(3) }))
        return
      }
    }

    setConfirmando(true)

    const porPedido = new Map()
    function entradaDe(pedidoId, clienteId) {
      if (!porPedido.has(pedidoId)) porPedido.set(pedidoId, { clienteId, lineasProducto: [], lineasLibres: [], deficits: [] })
      return porPedido.get(pedidoId)
    }

    for (const g of grupos) {
      for (const p of g.pedidos) {
        const asignado = Number(asignaciones[claveAsignacion(g.id, p.pedidoId)]) || 0
        if (asignado <= 0) continue

        let restante = asignado
        const pedido = pedidos.find((pv) => pv.id === p.pedidoId)
        const entry = entradaDe(p.pedidoId, pedido.cliente_id)

        for (const lote of g.lotes) {
          if (restante <= 0) break
          const usar = Math.min(restante, Number(lote.stock_disponible))
          if (usar <= 0) continue
          entry.lineasProducto.push({
            producto_final_id: g.id,
            produccion_pf_id: lote.produccion_id,
            cantidad: usar,
            linea_pedido_id: p.lineaPedidoId,
            precio_unitario: p.precioUnitario ?? null,
          })
          restante -= usar
        }

        if (asignado < p.cantidadPedida) {
          entry.deficits.push({
            producto_final_id: g.id,
            produccion_pf_id: g.lotes[0]?.produccion_id ?? null,
            cantidad_negativa: p.cantidadPedida - asignado,
          })
        }
      }
    }

    for (const p of pedidos) {
      const libres = lineasLibresPorPedido.get(p.id)
      if (!libres) continue
      const entry = entradaDe(p.id, p.cliente_id)
      for (const l of libres) {
        entry.lineasLibres.push({
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad) - l.entregado,
          precio_unitario: l.precio_unitario,
          linea_pedido_id: l.id,
        })
      }
    }

    for (const [, entry] of porPedido) {
      if (entry.lineasProducto.length === 0 && entry.lineasLibres.length === 0) continue

      const { data: albaran, error: errAlbaran } = await supabase
        .from('albaranes_venta')
        .insert({ cliente_id: entry.clienteId, fecha: fechaCierre })
        .select()
        .single()

      if (errAlbaran) {
        alert(t('cierre_tanda:alertas.error_crear_albaran', { mensaje: errAlbaran.message }))
        setConfirmando(false)
        return
      }

      const lineasParaInsertar = [...entry.lineasProducto, ...entry.lineasLibres].map((l) => ({
        albaran_venta_id: albaran.id,
        producto_final_id: l.producto_final_id ?? null,
        produccion_pf_id: l.produccion_pf_id ?? null,
        descripcion: l.descripcion ?? null,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario ?? null,
        linea_pedido_id: l.linea_pedido_id ?? null,
      }))

      const { data: lineasCreadas, error: errLineas } = await supabase
        .from('lineas_albaran_venta')
        .insert(lineasParaInsertar)
        .select()

      if (errLineas) {
        await supabase.from('albaranes_venta').delete().eq('id', albaran.id)
        alert(t('cierre_tanda:alertas.error_guardar_lineas', { mensaje: errLineas.message }))
        setConfirmando(false)
        return
      }

      for (const def of entry.deficits) {
        const lineaCorrespondiente = lineasCreadas.find((lc) => lc.producto_final_id === def.producto_final_id)
        if (!lineaCorrespondiente) continue
        const { error: errIncidencia } = await supabase.from('incidencias_stock_producto_final').insert({
          produccion_pf_id: def.produccion_pf_id,
          linea_albaran_venta_id: lineaCorrespondiente.id,
          cantidad_negativa: def.cantidad_negativa,
          motivo: 'stock_negativo',
          estado: 'pendiente',
        })
        if (errIncidencia) {
          console.error('Error registrando incidencia de déficit:', errIncidencia)
          toast.error(t('cierre_tanda:alertas.error_incidencia_stock', { mensaje: errIncidencia.message }))
        }
      }
    }

    toast.success(t('cierre_tanda:alertas.cierre_completado'))
    setConfirmando(false)
    await cargarDatos()
  }

  if (!tandaId) {
    return (
      <div>
        <PageHeader title={t('cierre_tanda:titulo')} />
        <Card><EmptyState>{t('cierre_tanda:sin_tanda_aviso')}</EmptyState></Card>
      </div>
    )
  }

  const hayAlgoQueRepartir = grupos.some((g) => g.pedidos.length > 0) || lineasLibresPorPedido.size > 0

  return (
    <div>
      <PageHeader
        title={t('cierre_tanda:titulo')}
        subtitle={t('cierre_tanda:subtitulo')}
      />

      {cargando ? (
        <LoadingState />
      ) : !hayAlgoQueRepartir ? (
        <Card><EmptyState>{t('cierre_tanda:nada_que_repartir')}</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardBody className="flex items-end gap-3">
              <Field label={t('cierre_tanda:fecha_albaranes_label')} className="w-48">
                <DateInput value={fechaCierre} onChange={setFechaCierre} required />
              </Field>
            </CardBody>
          </Card>

          {grupos.map((g) => {
            const totalAsignado = g.pedidos.reduce((s, p) => s + (Number(asignaciones[claveAsignacion(g.id, p.pedidoId)]) || 0), 0)
            return (
              <Card key={g.id} className="mb-6">
                <CardHeader
                  title={g.nombre}
                  action={
                    g.deficit ? (
                      <Badge color="amber">{t('cierre_tanda:deficit_badge', { disponible: g.disponibleTotal.toFixed(3), pedido: g.totalPedido.toFixed(3) })}</Badge>
                    ) : (
                      <Badge color="green">{t('cierre_tanda:sin_deficit_badge')}</Badge>
                    )
                  }
                />
                <CardBody className="p-0">
                  <Table>
                    <Thead>
                      <Th>{t('cierre_tanda:tabla.cliente')}</Th>
                      <Th>{t('cierre_tanda:tabla.pedido')}</Th>
                      <Th>{t('cierre_tanda:tabla.a_entregar')}</Th>
                    </Thead>
                    <tbody className="divide-y divide-border-subtle">
                      {g.pedidos.map((p) => (
                        <tr key={p.pedidoId}>
                          <Td className="font-medium">{p.cliente}</Td>
                          <Td>{p.cantidadPedida.toFixed(3)}</Td>
                          <Td>
                            {g.deficit ? (
                              <Input
                                type="number"
                                step="0.001"
                                className="w-28"
                                value={asignaciones[claveAsignacion(g.id, p.pedidoId)] ?? ''}
                                onChange={(e) => actualizarAsignacion(g.id, p.pedidoId, e.target.value)}
                              />
                            ) : (
                              <span>{p.cantidadPedida.toFixed(3)}</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {g.deficit && (
                    <p className={`text-xs px-4 py-2 ${totalAsignado > g.disponibleTotal + 0.0001 ? 'text-danger-600' : 'text-ink-muted'}`}>
                      {t('cierre_tanda:asignado_resumen', { asignado: totalAsignado.toFixed(3), disponible: g.disponibleTotal.toFixed(3) })}
                      {totalAsignado > g.disponibleTotal + 0.0001 && t('cierre_tanda:supera_disponible_aviso')}
                    </p>
                  )}
                </CardBody>
              </Card>
            )
          })}

          {lineasLibresPorPedido.size > 0 && (
            <Card className="mb-6">
              <CardHeader title={t('cierre_tanda:lineas_libres_titulo')} />
              <CardBody className="p-0">
                <Table>
                  <Thead>
                    <Th>{t('cierre_tanda:tabla_libres.cliente')}</Th>
                    <Th>{t('cierre_tanda:tabla_libres.descripcion')}</Th>
                    <Th>{t('cierre_tanda:tabla_libres.cantidad')}</Th>
                  </Thead>
                  <tbody className="divide-y divide-border-subtle">
                    {[...lineasLibresPorPedido.entries()].flatMap(([pedidoId, libres]) => {
                      const pedido = pedidos.find((p) => p.id === pedidoId)
                      return libres.map((l) => (
                        <tr key={l.id}>
                          <Td className="font-medium">{pedido?.clientes?.nombre ?? t('cierre_tanda:sin_cliente')}</Td>
                          <Td>{l.descripcion}</Td>
                          <Td>{(Number(l.cantidad) - l.entregado).toFixed(3)}</Td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          )}

          <Button onClick={confirmarCierre} disabled={confirmando}>
            {confirmando ? t('cierre_tanda:repartiendo') : t('cierre_tanda:cerrar_y_repartir')}
          </Button>
        </>
      )}
    </div>
  )
}

export default CierreTanda
