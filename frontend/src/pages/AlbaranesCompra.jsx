import { useState, useEffect, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import {
  IconPlus, IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconArrowsSort,
  IconCircleCheck, IconAlertTriangle, IconCircleHalf2,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, LinkAction, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect } from '../components/ui'
import { saldosDeAlbaranesSueltos, estadoPago, EPSILON } from '../lib/saldosCompra'
import AlbaranCompraForm from '../components/AlbaranCompraForm'
import RegistrarPagoProveedorForm from '../components/RegistrarPagoProveedorForm'

// CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 5: mismo componente/colores que
// ESTADO_FACTURACION_ICONO/ESTADO_COBRO_ICONO/EstadoIcono de AlbaranesVenta.jsx, pero Facturación
// sin distinción particular/empresa (proveedores no tiene un campo de tipo equivalente, y el
// contrato descarta explícitamente añadirlo) -- todo lo no facturado colapsa a un único
// 'pendiente' ámbar, con IconAlertTriangle (mismo icono que usaba el caso ámbar de Venta).
const ESTADO_FACTURACION_ICONO = {
  facturado: { icon: IconCircleCheck, color: 'text-success-600' },
  pendiente: { icon: IconAlertTriangle, color: 'text-warning-600' },
}
const ESTADO_COBRO_ICONO = {
  pagada: { icon: IconCircleCheck, color: 'text-success-600' },
  parcial: { icon: IconCircleHalf2, color: 'text-warning-600' },
  pendiente: { icon: IconAlertTriangle, color: 'text-danger-600' },
}

function EstadoIcono({ cfg, label }) {
  const Icon = cfg.icon
  return (
    <span title={label} className={`inline-flex ${cfg.color}`}>
      <Icon size={18} />
    </span>
  )
}

// CONTRATO_PAGOS_COMPRA.md, paso 4. Bug real corregido en el mismo cambio (confirmado con una
// relación de prueba real insertada y borrada para verificarlo): factura_compra_albaran se embebe
// como OBJETO (o null), NUNCA como array -- mismo motivo que factura_venta_albaran en Venta (UNIQUE
// sobre albaran_compra_id, un albarán solo puede estar en una factura). El precómputo de
// filtroFacturacion de más abajo asumía array (`.length > 0`), así que el filtro "Facturado" nunca
// encontraba nada -- corregido usando esta misma función como única fuente de verdad de "está
// facturado" en toda la pantalla (filtro + saldo/pago), igual que facturaVivaDe() en
// AlbaranesVenta.jsx. Una factura anulada no cuenta como facturación viva -- el albarán vuelve a
// estar disponible para pago directo.
function facturaVivaDe(alb) {
  const rel = alb.factura_compra_albaran
  const facturaAsociada = Array.isArray(rel) ? rel[0] : rel
  return facturaAsociada != null && facturaAsociada.facturas_compra_con_saldo?.anulada === false
}

// CONTRATO_PAGOS_COMPRA.md sección 4.3/paso 4: total de un albarán a partir de sus líneas ya
// embebidas en la query principal (entrada_material) -- misma fórmula que totalesPorAlbaran() en
// saldosCompra.js, sin otra consulta. Idéntico patrón a totalAlbaran() en AlbaranesVenta.jsx.
function totalAlbaran(alb) {
  return (alb.entrada_material || []).reduce(
    (sum, l) => sum + (l.precio ? l.cantidad * l.precio : 0), 0
  )
}

// CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 2: resuelve entrada_material.linea_pedido_compra_id
// -> pedidos_compra.codigo_pedido para la columna "Pedido origen" -- mismo patrón exacto que
// codigosPedidoOrigen() en AlbaranesVenta.jsx (ahí sobre lineas_albaran_venta/lineas_pedido_venta).
// Requiere el embed anidado añadido en cargarDatos() (lineas_pedido_compra(pedido_compra_id,
// pedidos_compra(codigo_pedido)) dentro de entrada_material).
function codigosPedidoOrigen(alb) {
  const codigos = new Set()
  for (const l of alb.entrada_material) {
    const codigo = l.lineas_pedido_compra?.pedidos_compra?.codigo_pedido
    if (codigo) codigos.add(codigo)
  }
  return [...codigos]
}

// CONTRATO_DRAWERS_COMPRAS.md, último punto: mismo tamaño de página que Venta.
const PAGINA_TAMANO = 20

function AlbaranesCompra() {
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'albaranes_compra'])
  const [searchParams] = useSearchParams()
  const pedidoCompraIdParam = searchParams.get('pedido_compra_id')

  const FACTURACION_OPCIONES = [
    { value: 'pendiente', label: t('enums:estado_facturacion.pendiente_facturar') },
    { value: 'facturado', label: t('enums:estado_facturacion.facturado') },
  ]

  const [albaranes, setAlbaranes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [pedidosCompraPendientes, setPedidosCompraPendientes] = useState([])
  const [cargando, setCargando] = useState(true)

  // CONTRATO_DRAWERS_COMPRAS.md, paso 2: mismo patrón de 3 estados que PedidosCompra.jsx --
  // null = cerrado, 'nuevo' = alta, objeto albarán = edición precargada. El objeto de edición
  // lleva además `idsLineaBloqueada` (ver handleEditar), ya resuelto antes de abrir el drawer.
  const [modoDrawer, setModoDrawer] = useState(null)
  // CONTRATO_PAGOS_COMPRA.md sección 4.3/paso 4: null = cerrado; { proveedorId, documento } =
  // abierto y preseleccionado -- mismo patrón que pagoDrawer en FacturasCompra.jsx/AlbaranesVenta.jsx.
  const [pagoDrawer, setPagoDrawer] = useState(null)
  // Saldo pendiente por albarán SUELTO (los ya facturados no entran aquí, su saldo vive en la
  // factura) -- mismo patrón que saldosPorAlbaran en AlbaranesVenta.jsx.
  const [saldosPorAlbaran, setSaldosPorAlbaran] = useState(new Map())
  const filaRefs = useRef(new Map())

  // CONTRATO_TABLA_COMPRAS.md, sección 3: un único id expandido a nivel de pantalla (acordeón),
  // mismo patrón que las pantallas de Venta y que Facturas/Pedidos de compra (pasos 1-2).
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)
  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  const [filtroProveedorId, setFiltroProveedorId] = useState('')
  const [filtroFacturacion, setFiltroFacturacion] = useState([])
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const hayFiltrosActivos = !!filtroProveedorId || filtroFacturacion.length > 0 || !!filtroFechaDesde || !!filtroFechaHasta

  function cambiarFiltroProveedor(id) { setFiltroProveedorId(id); setPagina(1) }
  function cambiarFiltroFacturacion(valores) { setFiltroFacturacion(valores); setPagina(1) }
  function cambiarFiltroFechaDesde(v) { setFiltroFechaDesde(v); setPagina(1) }
  function cambiarFiltroFechaHasta(v) { setFiltroFechaHasta(v); setPagina(1) }
  function limpiarFiltros() {
    setFiltroProveedorId('')
    setFiltroFacturacion([])
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
    setPagina(1)
  }

  // CONTRATO_TABLA_COMPRAS.md, sección 3/7: el <Select> "Ordenar por" desaparece -- su lógica pasa
  // a la cabecera clicable. Única columna ordenable hoy (Fecha), mismo ciclo de 3 estados que
  // AlbaranesVenta.jsx/FacturasCompra.jsx (desc -> asc -> sin orden).
  const [orden, setOrden] = useState({ columna: null, direccion: 'desc' })
  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: 'desc' }
      if (prev.direccion === 'desc') return { columna, direccion: 'asc' }
      return { columna: null, direccion: 'desc' }
    })
    setPagina(1) // cambiar de orden con otra página abierta dejaría una página vacía o repetida
  }
  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-ink-faint" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  const [pagina, setPagina] = useState(1)
  const [totalAlbaranes, setTotalAlbaranes] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalAlbaranes / PAGINA_TAMANO))

  async function cargarDatos() {
    setCargando(true)

    // BLOQUE filtros (mismo patrón que AlbaranesVenta.jsx Bloque 2 de CONTRATO_FILTROS_VENTA.md,
    // reducido a una sola dimensión): Facturación no es una columna real de albaranes_compra --
    // depende de si hay relación en factura_compra_albaran. Se resuelve con un precómputo ligero
    // trayendo solo id+relación de TODOS los albaranes, para obtener una lista de ids que se
    // aplica con .in() a la query principal ANTES de order/range -- solo si el filtro está activo.
    let idsPermitidosPorEstado = null // null = sin restricción por estado
    if (filtroFacturacion.length === 1) {
      const { data: todosAlbaranes, error: errorTodos } = await supabase
        .from('albaranes_compra')
        .select('id, factura_compra_albaran(facturas_compra_con_saldo(anulada))')

      if (errorTodos) {
        console.error('Error precalculando el filtro de facturación de albaranes:', errorTodos)
        idsPermitidosPorEstado = []
      } else {
        const idsFacturados = []
        const idsSueltos = []
        for (const alb of todosAlbaranes) {
          const facturado = facturaVivaDe(alb)
          if (facturado) idsFacturados.push(alb.id)
          else idsSueltos.push(alb.id)
        }
        idsPermitidosPorEstado = filtroFacturacion[0] === 'facturado' ? idsFacturados : idsSueltos
      }
    }

    // CONTRATO_PAGOS_COMPRA.md paso 4: factura_compra_albaran(facturas_compra_con_saldo(anulada))
    // añadido para saber si el albarán está facturado (con factura viva) sin una query aparte --
    // mismo embed que el precómputo del filtro de arriba, única fuente de verdad para toda la
    // pantalla (facturaVivaDe).
    //
    // CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 2: lineas_pedido_compra(pedido_compra_id,
    // pedidos_compra(codigo_pedido)) añadido dentro de entrada_material -- mismo embed de dos
    // niveles que ya usa AlbaranesVenta.jsx (lineas_pedido_venta(pedido_id,
    // pedidos_venta(codigo_pedido))) -- para resolver "Pedido origen" sin una query aparte por fila.
    let albaranesQuery = supabase
      .from('albaranes_compra')
      .select('*, proveedores(nombre_comercial), entrada_material(id, cantidad, precio, fecha_caducidad, notas, codigo_lote, temperatura_recepcion, temperatura_fuera_rango, articulo_id, linea_pedido_compra_id, articulos_compra(nombre, unidad), lineas_pedido_compra(pedido_compra_id, pedidos_compra(codigo_pedido))), factura_compra_albaran(facturas_compra_con_saldo(anulada))', { count: 'exact' })

    if (filtroProveedorId) albaranesQuery = albaranesQuery.eq('proveedor_id', filtroProveedorId)
    if (filtroFechaDesde) albaranesQuery = albaranesQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) albaranesQuery = albaranesQuery.lte('fecha', filtroFechaHasta)
    // -1 como centinela cuando la intersección de estado queda vacía -- fuerza 0 filas en vez de
    // mandar un .in() con array vacío (semántica ambigua en PostgREST).
    if (idsPermitidosPorEstado !== null) {
      albaranesQuery = albaranesQuery.in('id', idsPermitidosPorEstado.length > 0 ? idsPermitidosPorEstado : [-1])
    }

    // CONTRATO_TABLA_COMPRAS.md, sección 3/6: el mecanismo de datos no cambia -- sigue siendo un
    // único .order() server-side, ahora disparado por cambiarOrden() en la cabecera en vez del
    // <Select>.
    albaranesQuery = orden.columna
      ? albaranesQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : albaranesQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id, mismo motivo que en Pedidos: sin él, dos albaranes con la misma
    // fecha no tienen un orden garantizado entre sí al paginar con .range().
    albaranesQuery = albaranesQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    albaranesQuery = albaranesQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resAlbaranes, resProveedores, resPedidosCompra] = await Promise.all([
      albaranesQuery,
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
      supabase
        .from('pedidos_compra')
        .select('id, codigo_pedido, proveedor_id, referencia_proveedor, proveedores(nombre_comercial), lineas_pedido_compra(id, articulo_id, cantidad, precio_unitario, articulos_compra(nombre, unidad))')
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: false }),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else {
      const albaranesCargados = resAlbaranes.data || []
      setAlbaranes(albaranesCargados)
      setTotalAlbaranes(resAlbaranes.count ?? 0)

      // CONTRATO_PAGOS_COMPRA.md paso 4: saldo pendiente solo para sueltos -- un albarán ya
      // facturado (con factura viva) refleja su pago en la factura, no aquí. Mismo patrón que
      // AlbaranesVenta.jsx (Bloque 6 de CONTRATO_PAGOS_VENTA.md).
      const idsSueltos = albaranesCargados.filter((alb) => !facturaVivaDe(alb)).map((alb) => alb.id)
      try {
        const saldos = await saldosDeAlbaranesSueltos(idsSueltos)
        setSaldosPorAlbaran(saldos)
      } catch (error) {
        console.error('Error calculando saldos de albaranes de compra:', error)
        setSaldosPorAlbaran(new Map())
      }
    }

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data || [])

    if (resPedidosCompra.error) console.error(resPedidosCompra.error)
    else setPedidosCompraPendientes(resPedidosCompra.data || [])

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroProveedorId, filtroFacturacion, filtroFechaDesde, filtroFechaHasta])

  // Deep-link desde PedidosCompra.jsx ("Recibir como albarán") -- mismo patrón que
  // AlbaranesVenta.jsx: si llega el query param, abre el drawer de alta solo con montar.
  useEffect(() => {
    if (pedidoCompraIdParam) setModoDrawer('nuevo')
  }, [pedidoCompraIdParam])

  // Las 3 consultas de bloqueo de línea se resuelven aquí, en el padre, ANTES de abrir el drawer
  // -- igual que handleEditar en Pedidos.jsx (venta) -- para no abrir un formulario a medio
  // cargar. El resultado (ids de entrada_material con algún consumo/ajuste asociado) viaja
  // colgado del propio objeto de albarán como `idsLineaBloqueada`, que AlbaranCompraForm.jsx lee
  // para marcar cada línea como `locked` sin repetir las queries.
  async function handleEditar(alb) {
    const entradaIds = alb.entrada_material.map((l) => l.id)
    let idsBloqueados = new Set()

    if (entradaIds.length > 0) {
      const [c1, c2, c3] = await Promise.all([
        supabase.from('consumo_produccion').select('entrada_material_id').in('entrada_material_id', entradaIds),
        supabase.from('consumo_produccion_pf').select('entrada_material_id').in('entrada_material_id', entradaIds),
        supabase.from('ajustes_articulo').select('entrada_material_id').in('entrada_material_id', entradaIds),
      ])
      ;[c1, c2, c3].forEach((res) => {
        (res.data || []).forEach((r) => idsBloqueados.add(r.entrada_material_id))
      })
    }

    setModoDrawer({ ...alb, idsLineaBloqueada: [...idsBloqueados] })
  }

  async function alGuardarAlbaran(idAlbaran) {
    setModoDrawer(null)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idAlbaran)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function alGuardarPago() {
    setPagoDrawer(null)
    cargarDatos()
  }

  async function handleBorrar(alb) {
    // CONTRATO_PAGOS_COMPRA.md sección 8: pago_aplicacion.albaran_compra_id no tiene ON DELETE
    // CASCADE (confirmado con un error real de FK en el paso 2) -- a diferencia del aviso de
    // consumo/ajustes de más abajo (que si permite continuar tras confirmar), un albarán con pagos
    // aplicados NUNCA se puede borrar sin dejar el historial de pagos huérfano: se bloquea del
    // todo, sin llegar a intentar el DELETE. CONTRATO_DRAWERS_COMPRAS.md sección 2.1: albaranes_compra
    // no pasa a soft-delete (a diferencia de facturas_compra), sigue siendo DELETE físico cuando no
    // hay pagos de por medio.
    const { count: countPagos } = await supabase
      .from('pago_aplicacion')
      .select('*', { count: 'exact', head: true })
      .eq('albaran_compra_id', alb.id)

    if (countPagos > 0) {
      alert(t('albaranes_compra:alertas.tiene_pagos_aplicados'))
      return
    }

    const entradaIds = alb.entrada_material.map((l) => l.id)

    let avisos = []
    if (entradaIds.length > 0) {
      const [c1, c2, c3] = await Promise.all([
        supabase.from('consumo_produccion').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
        supabase.from('consumo_produccion_pf').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
        supabase.from('ajustes_articulo').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
      ])
      if (c1.count > 0) avisos.push(t('albaranes_compra:avisos.consumo_semi', { count: c1.count }))
      if (c2.count > 0) avisos.push(t('albaranes_compra:avisos.consumo_pf', { count: c2.count }))
      if (c3.count > 0) avisos.push(t('albaranes_compra:avisos.ajuste', { count: c3.count }))
    }

    const mensaje = avisos.length > 0
      ? t('albaranes_compra:alertas.confirmar_borrar_con_avisos', { lista: avisos.map((a) => '• ' + a).join('\n') })
      : t('albaranes_compra:alertas.confirmar_borrar_sin_avisos')

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('albaranes_compra').delete().eq('id', alb.id)
    if (error) {
      alert(t('albaranes_compra:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    // Si el albarán borrado es justo el que estaba abierto en el drawer de edición, se cierra --
    // mismo criterio que el `if (editandoId === alb.id) resetForm()` del formulario inline
    // original, traducido al nuevo estado modoDrawer.
    toast.success(t('common:feedback.eliminado'))
    if (modoDrawer !== null && typeof modoDrawer === 'object' && modoDrawer.id === alb.id) setModoDrawer(null)
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('albaranes_compra:titulo')} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> {t('albaranes_compra:card_nuevo_titulo')}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-surface border border-border rounded-card">
        <Field label={t('albaranes_compra:filtros.proveedor')} className="w-48">
          <Select value={filtroProveedorId} onChange={(e) => cambiarFiltroProveedor(e.target.value)}>
            <option value="">{t('common:actions.all')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('albaranes_compra:filtros.facturacion')} className="w-48">
          <MultiSelect options={FACTURACION_OPCIONES} selected={filtroFacturacion} onChange={cambiarFiltroFacturacion} placeholder={t('common:actions.all')} />
        </Field>
        <Field label={t('albaranes_compra:filtros.desde')} className="w-40">
          <DateInput value={filtroFechaDesde} onChange={cambiarFiltroFechaDesde} />
        </Field>
        <Field label={t('albaranes_compra:filtros.hasta')} className="w-40">
          <DateInput value={filtroFechaHasta} onChange={cambiarFiltroFechaHasta} />
        </Field>
        {hayFiltrosActivos && (
          <Button type="button" variant="secondary" size="sm" onClick={limpiarFiltros}>{t('albaranes_compra:filtros.limpiar_filtros')}</Button>
        )}
      </div>

      {cargando ? (
        <LoadingState />
      ) : albaranes.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? t('albaranes_compra:sin_albaranes_filtro') : t('albaranes_compra:sin_albaranes')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-sunken">
                <tr className="text-left text-overline text-ink-subtle border-b border-border">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha')} className="flex items-center gap-1 hover:text-ink-body">
                      {t('albaranes_compra:tabla.fecha')} {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_compra:tabla.numero')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_compra:tabla.proveedor')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_compra:tabla.codigo_interno')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_compra:tabla.pedido_origen')}</th>
                  <th className="px-3 py-2.5 font-medium text-center">{t('albaranes_compra:tabla.facturacion')}</th>
                  <th className="px-3 py-2.5 font-medium text-center">{t('albaranes_compra:tabla.cobro')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('albaranes_compra:tabla.acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {albaranes.map((alb) => {
                  // CONTRATO_PAGOS_COMPRA.md paso 4: saldo/estado de pago propio SOLO para sueltos
                  // -- un albarán ya facturado (con factura viva) refleja su pago en la factura de
                  // compra, no aquí. Mismo criterio que AlbaranesVenta.jsx.
                  const facturado = facturaVivaDe(alb)
                  const saldo = facturado ? null : saldosPorAlbaran.get(alb.id)
                  const estado = saldo != null ? estadoPago(saldo, totalAlbaran(alb)) : null
                  const tieneSaldoPendiente = saldo != null && saldo > EPSILON
                  const codigosPedido = codigosPedidoOrigen(alb)
                  const expandido = filaExpandidaId === alb.id
                  return (
                    <Fragment key={alb.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(alb.id, el); else filaRefs.current.delete(alb.id) }}
                        className="border-b border-border-subtle hover:bg-primary-50/40 cursor-pointer"
                        onClick={() => toggleExpandido(alb.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-ink-faint hover:text-ink-body">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-body">{formatFecha(alb.fecha)}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-body">{alb.numero_albaran || t('common:sin_numero')}</td>
                        <td className="px-3 py-3 font-medium text-ink">{alb.proveedores?.nombre_comercial ?? t('compras_comun:sin_proveedor')}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-ink-faint">{alb.codigo_interno || '—'}</td>
                        <td className="px-3 py-3">
                          {codigosPedido.length === 0 ? (
                            <span className="text-ink-faint">—</span>
                          ) : codigosPedido.length === 1 ? (
                            <Badge color="blue">{codigosPedido[0]}</Badge>
                          ) : (
                            <span title={codigosPedido.join(', ')}>
                              <Badge color="blue">{t('albaranes_compra:varios')}</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <EstadoIcono
                            cfg={ESTADO_FACTURACION_ICONO[facturado ? 'facturado' : 'pendiente']}
                            label={t(`enums:estado_facturacion.${facturado ? 'facturado' : 'pendiente_facturar'}`)}
                          />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {estado && <EstadoIcono cfg={ESTADO_COBRO_ICONO[estado]} label={t(`enums:estado_pago.${estado}`)} />}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            {tieneSaldoPendiente && (
                              <LinkAction tone="green" onClick={() => setPagoDrawer({ proveedorId: alb.proveedor_id, documento: { tipo: 'albaran', id: alb.id, saldo } })}>
                                {t('compras_comun:tooltip_registrar_pago')}
                              </LinkAction>
                            )}
                            <LinkAction tone="blue" onClick={() => handleEditar(alb)}>{t('albaranes_compra:editar')}</LinkAction>
                            <LinkAction tone="red" onClick={() => handleBorrar(alb)}>{t('albaranes_compra:borrar')}</LinkAction>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={9} className="p-0">
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-canvas/60 px-3 py-3">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-overline text-ink-subtle border-b border-border">
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.articulo')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.cantidad')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.precio')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.caducidad')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.notas')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.temperatura')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_compra:tabla.lote')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border-subtle">
                                    {alb.entrada_material.map((linea) => (
                                      <tr key={linea.id}>
                                        <td className="py-1.5">{linea.articulos_compra?.nombre}</td>
                                        <td className="py-1.5">{linea.cantidad} {linea.articulos_compra?.unidad}</td>
                                        <td className="py-1.5">{linea.precio ?? '-'}</td>
                                        <td className="py-1.5">{linea.fecha_caducidad ? formatFecha(linea.fecha_caducidad) : '-'}</td>
                                        <td className="py-1.5 text-ink-muted">{linea.notas ?? '-'}</td>
                                        <td className={`py-1.5 ${linea.temperatura_fuera_rango ? 'text-danger-600 font-semibold' : ''}`}>
                                          {linea.temperatura_recepcion != null ? `${linea.temperatura_recepcion}°C` : '-'}
                                          {linea.temperatura_fuera_rango && ' ⚠️'}
                                        </td>
                                        <td className="py-1.5 text-ink-faint font-mono text-xs">{linea.codigo_lote ?? '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!cargando && totalAlbaranes > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-ink-faint">
            {t('albaranes_compra:albaran_pagina_count', { count: totalAlbaranes, pagina, total: totalPaginas })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              {t('common:actions.previous')}
            </Button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPagina(n)}
                className={`w-7 h-7 text-xs rounded-control ${n === pagina ? 'bg-primary-600 text-white' : 'text-ink-muted hover:bg-surface-hover'}`}
              >
                {n}
              </button>
            ))}
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              {t('common:actions.next')}
            </Button>
          </div>
        </div>
      )}

      <Drawer
        open={modoDrawer !== null}
        onClose={() => setModoDrawer(null)}
        title={modoDrawer !== null && typeof modoDrawer === 'object' ? t('albaranes_compra:card_editar_titulo') : t('albaranes_compra:card_nuevo_titulo')}
        anchoClase="max-w-2xl"
      >
        {modoDrawer !== null && (
          <AlbaranCompraForm
            albaran={typeof modoDrawer === 'object' ? modoDrawer : null}
            proveedores={proveedores}
            pedidosCompraPendientes={pedidosCompraPendientes}
            pedidoCompraIdParam={pedidoCompraIdParam}
            onGuardado={alGuardarAlbaran}
            onCancelar={() => setModoDrawer(null)}
          />
        )}
      </Drawer>

      <Drawer open={pagoDrawer !== null} onClose={() => setPagoDrawer(null)} title={t('compras_comun:registrar_pago_proveedor')}>
        {pagoDrawer !== null && (
          <RegistrarPagoProveedorForm
            proveedores={proveedores}
            proveedorIdInicial={pagoDrawer.proveedorId}
            documentoPreseleccionado={pagoDrawer.documento}
            onGuardado={alGuardarPago}
            onCancelar={() => setPagoDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default AlbaranesCompra
