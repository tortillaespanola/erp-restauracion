import { useState, useEffect, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { descargarAlbaranVentaPdf, imprimirAlbaranVentaPdf, nombreLineaVenta, prepararDocumentoAlbaranVenta } from '../lib/generarAlbaranVentaPdf'
import {
  IconTrash, IconChevronRight, IconChevronDown, IconPrinter, IconDownload, IconPlus,
  IconArrowUp, IconArrowDown, IconArrowsSort, IconCash,
  IconCircleCheck, IconClock, IconAlertTriangle, IconCircleHalf2,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect, LinkAction } from '../components/ui'
import AlbaranVentaForm from '../components/AlbaranVentaForm'
import RegistrarPagoForm from '../components/RegistrarPagoForm'
import AjusteStockForm from '../components/AjusteStockForm'
import ResolverRechazoForm from '../components/ResolverRechazoForm'
import BadgeScrap from '../components/BadgeScrap'
import BadgeRechazoPendiente from '../components/BadgeRechazoPendiente'
import { saldosDeAlbaranesSueltos, estadosPagoDeAlbaranesSueltos, estadoPago, EPSILON, clientesParaDrawer } from '../lib/saldosVenta'

// CONTRATO_I18N.md, Fase 0: icon/color son independientes del idioma y se quedan aquí -- la
// etiqueta se resuelve con t('enums:estado_facturacion.*'/'enums:estado_pago.*') en el render,
// ver enums.json. Antes cada entrada llevaba también un `label` en español fijo.
//
// Rediseño visual Facturación/Cobro: mismo patrón config-por-clave + componente de render que
// EstadoCelda en PedidosDelDia.jsx (icon/color por clave). Facturación distingue pendiente
// por tipo de cliente (empresa = amarillo, más urgente por la obligación de facturar; particular =
// gris) -- Cobro usa los mismos 3 colores tanto si el estado es propio del albarán (suelto) como si
// se hereda de su factura (facturado), nunca gris: "pendiente" pasa a rojo en este rediseño.
const ESTADO_FACTURACION_ICONO = {
  facturado: { icon: IconCircleCheck, color: 'text-green-600' },
  pendiente_particular: { icon: IconClock, color: 'text-gray-400' },
  pendiente_empresa: { icon: IconAlertTriangle, color: 'text-amber-600' },
}
const ESTADO_COBRO_ICONO = {
  pagada: { icon: IconCircleCheck, color: 'text-green-600' },
  parcial: { icon: IconCircleHalf2, color: 'text-amber-600' },
  pendiente: { icon: IconAlertTriangle, color: 'text-red-600' },
}

function EstadoIcono({ cfg, label }) {
  const Icon = cfg.icon
  return (
    <span title={label} className={`inline-flex ${cfg.color}`}>
      <Icon size={18} />
    </span>
  )
}

// Bug corregido (encontrado antes de este rediseño): una factura ANULADA no debe contar como
// facturación viva -- el albarán vuelve a estar disponible para re-facturar (ya establecido en
// CONTRATO_UX_ALBARANES_VENTA.md), pero el cálculo de `facturado` nunca se había actualizado para
// reflejarlo. Único punto de verdad, reutilizado tanto en cargarDatos (idsSueltos/saldosPorAlbaran)
// como en el render de la tabla -- antes había dos copias del mismo `rel != null` sin comprobar
// `anulada`, que ahora quedarían inconsistentes entre sí si solo se corrigiera una.
function facturaVivaDe(alb) {
  const rel = alb.factura_venta_albaran
  const facturaAsociada = Array.isArray(rel) ? rel[0] : rel
  return facturaAsociada != null && facturaAsociada.facturas_venta_con_saldo?.anulada === false
}

// BLOQUE 2 (CONTRATO_FILTROS_VENTA.md), sección 3: dos dimensiones de estado independientes, no
// mezclables en un único MultiSelect -- Facturación (¿tiene relación en factura_venta_albaran?) y
// Cobro (estado de pago calculado, solo aplica a albaranes sueltos).

// Bloque 6 (CONTRATO_PAGOS_VENTA.md): total de un albarán a partir de sus líneas ya embebidas en
// la query principal -- misma fórmula que totalesPorAlbaran en saldosVenta.js, sin otra consulta.
function totalAlbaran(alb) {
  return (alb.lineas_albaran_venta || []).reduce(
    (sum, l) => sum + (l.precio_unitario ? l.cantidad * l.precio_unitario : 0), 0
  )
}

// BLOQUE 3 (CONTRATO_UX_ALBARANES_VENTA.md): códigos de pedido distintos entre las líneas del
// albarán -- 0 códigos = ninguna línea tiene origen, 1 = todas comparten pedido, 2+ = "Varios".
function codigosPedidoOrigen(alb) {
  const codigos = new Set()
  for (const l of alb.lineas_albaran_venta) {
    const codigo = l.lineas_pedido_venta?.pedidos_venta?.codigo_pedido
    if (codigo) codigos.add(codigo)
  }
  return [...codigos]
}

// BLOQUE 2 (CONTRATO_UX_ALBARANES_VENTA.md): factura_venta_albaran embebido para saber si el
// albarán está facturado sin una query aparte por fila -- basta con mirar si el array llega vacío.
// factura_venta_albaran es una tabla puente sin columna `id` propia (solo factura_venta_id +
// albaran_venta_id, ver FacturasVenta.jsx). Rediseño Facturación/Cobro: en vez de pedir solo
// factura_venta_id, se embebe la VISTA facturas_venta_con_saldo (no la tabla) a través de esa
// misma relación -- confirmado que PostgREST la detecta igual que a través de la tabla (mismo
// hallazgo ya documentado en el Bloque 1 de CONTRATO_UX_FACTURAS_VENTA.md). Da en un solo viaje:
// numero_factura y anulada (para saber si la factura sigue viva) y saldo_pendiente/total (para
// heredar el color de Cobro sin una query aparte). clientes.tipo añadido para el color de
// Facturación pendiente (particular=gris, empresa=amarillo).
// BLOQUE 3: linea_pedido_id + lineas_pedido_venta(pedido_id, pedidos_venta(codigo_pedido))
// embebido para resolver el/los pedido(s) de origen de cada línea sin una query aparte -- misma
// query principal, un solo viaje de ida y vuelta.
// CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte B (Paso 4.7): produccion_pf_id + producto_final_id
// añadidos para poder abrir AjusteStockForm pre-rellenado con el lote de producción exacto de la
// línea ("Declarar rechazo de cliente") -- solo aplica a líneas de producto final, no a mercadería
// (articulos_compra), que no tiene noción de producción/lote de origen en este flujo.
const SELECT_ALBARAN_CON_RELACIONES =
  '*, clientes(nombre, direccion, cif, tipo), lineas_albaran_venta(id, cantidad, precio_unitario, descripcion, producto_final_id, produccion_pf_id, productos_finales(nombre, unidades_medida(codigo)), producciones_producto_final(codigo_lote, fecha), articulos_compra(nombre, unidad), linea_pedido_id, lineas_pedido_venta(pedido_id, pedidos_venta(codigo_pedido))), factura_venta_albaran(facturas_venta_con_saldo(numero_factura, anulada, saldo_pendiente, total))'

// BLOQUE 5 (CONTRATO_UX_ALBARANES_VENTA.md): 20 por página, igual que Pedidos -- volumen similar
// (~92 albaranes hoy), da ~5 páginas, cómodo para números de página sin elipsis.
const PAGINA_TAMANO = 20

function AlbaranesVenta() {
  const [searchParams] = useSearchParams()
  const pedidoIdParam = searchParams.get('pedido_id')
  const { t } = useTranslation(['common', 'enums', 'ventas_comun', 'albaranes_venta'])
  const FACTURACION_OPCIONES = [
    { value: 'pendiente', label: t('enums:estado_facturacion.pendiente_facturar') },
    { value: 'facturado', label: t('enums:estado_facturacion.facturado') },
  ]
  const COBRO_OPCIONES = ['pagada', 'parcial', 'pendiente'].map((value) => ({ value, label: t(`enums:estado_pago.${value}`) }))

  const [albaranes, setAlbaranes] = useState([])
  const [clientes, setClientes] = useState([])
  const [clientesActivos, setClientesActivos] = useState([])
  const [productos, setProductos] = useState([])
  const [articulosMercaderia, setArticulosMercaderia] = useState([])
  const [cargando, setCargando] = useState(true)

  // BLOQUE 6: saldo pendiente por albarán SUELTO (los ya facturados no entran aquí) -- para el
  // badge de estado de pago y el icono de acceso rápido. Clave = albaran_venta.id.
  const [saldosPorAlbaran, setSaldosPorAlbaran] = useState(new Map())
  // null = cerrado; { clienteId, documento: { tipo, id, saldo } } = abierto y preseleccionado.
  const [pagoDrawer, setPagoDrawer] = useState(null)

  // BLOQUE 6 (CONTRATO_UX_ALBARANES_VENTA.md): un único booleano para el drawer -- a diferencia de
  // Pedidos, aquí no hay modo edición, así que no hace falta guardar "qué" se está editando, solo
  // si el drawer está abierto o no. Se abre solo o por el botón "Nuevo albarán".
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  // Refs de la fila principal de cada albarán, indexadas por id -- para el scrollIntoView tras
  // guardar desde el drawer, mismo patrón que Pedidos.
  const filaRefs = useRef(new Map())

  useEffect(() => {
    if (pedidoIdParam) setDrawerAbierto(true)
  }, [pedidoIdParam])

  // BLOQUE 4 (CONTRATO_UX_ALBARANES_VENTA.md): un único id expandido a nivel de pantalla (no un
  // Set por fila) para forzar comportamiento acordeón -- expandir un albarán colapsa cualquier otro.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  // CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte B (Paso 4.7): "Declarar rechazo de cliente" sobre una
  // línea de producto final ya entregada -- mismo AjusteStockForm de Inventario.jsx/Producciones.jsx,
  // preseleccionando origen_rechazo='cliente'.
  const [declararRechazoFijo, setDeclararRechazoFijo] = useState(null)
  // CONTRATO_PROPAGACION_RECHAZOS.md, Parte A: ajuste recién insertado (origen_rechazo='cliente'),
  // en espera del paso de resolución (abono/reenvío/descarte) inmediatamente después de declararlo.
  const [rechazoAResolver, setRechazoAResolver] = useState(null)

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // BLOQUE 5: única columna ordenable (Fecha) -- null = orden por defecto (fecha descendente, sin
  // agrupamiento porque aquí no hay estados que preservar, a diferencia de Pedidos).
  const [orden, setOrden] = useState({ columna: null, direccion: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [totalAlbaranes, setTotalAlbaranes] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalAlbaranes / PAGINA_TAMANO))

  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: 'desc' }
      if (prev.direccion === 'desc') return { columna, direccion: 'asc' }
      return { columna: null, direccion: 'desc' }
    })
    setPagina(1) // cambiar de orden con otra página abierta dejaría una página vacía o repetida
  }

  // BLOQUE 2 (CONTRATO_FILTROS_VENTA.md): filtro de Cliente reutiliza `clientes` (ya sin filtro
  // de activo, ver Promise.all de cargarDatos -- lo usa AlbaranVentaForm para la misma lista), sin
  // necesidad de una query aparte.
  const [filtroClienteId, setFiltroClienteId] = useState('')
  const [filtroFacturacion, setFiltroFacturacion] = useState([])
  const [filtroCobro, setFiltroCobro] = useState([])
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const hayFiltrosActivos = !!filtroClienteId || filtroFacturacion.length > 0 || filtroCobro.length > 0 || !!filtroFechaDesde || !!filtroFechaHasta

  function cambiarFiltroCliente(id) { setFiltroClienteId(id); setPagina(1) }
  function cambiarFiltroFacturacion(valores) { setFiltroFacturacion(valores); setPagina(1) }
  function cambiarFiltroCobro(valores) { setFiltroCobro(valores); setPagina(1) }
  function cambiarFiltroFechaDesde(v) { setFiltroFechaDesde(v); setPagina(1) }
  function cambiarFiltroFechaHasta(v) { setFiltroFechaHasta(v); setPagina(1) }
  function limpiarFiltros() {
    setFiltroClienteId('')
    setFiltroFacturacion([])
    setFiltroCobro([])
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
    setPagina(1)
  }

  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  async function cargarDatos() {
    setCargando(true)

    // BLOQUE 2 (CONTRATO_FILTROS_VENTA.md): Facturación y Cobro no son columnas propias de
    // albaranes_venta -- Facturación depende de si hay relación en factura_venta_albaran, Cobro es
    // un saldo calculado (solo para sueltos). Sin una vista como facturas_venta_con_saldo (aquí no
    // hacía falta ninguna hasta ahora, esta pantalla no ordena/agrupa por estado), se resuelve con
    // un precómputo ligero en dos pasos: 1) un id+relación de TODOS los albaranes (sin datos
    // pesados, mismo volumen ~92 filas que ya maneja esta pantalla) para separar facturados de
    // sueltos: 2) para Cobro, el estado de pago de los sueltos vía estadosPagoDeAlbaranesSueltos()
    // (saldosVenta.js), la misma fórmula que ya usa el badge, sin duplicarla. El resultado es una
    // lista de ids que se aplica con .in() a la query principal ANTES de order/range -- solo se
    // ejecuta si alguno de los dos filtros de estado está activo.
    let idsPermitidosPorEstado = null // null = sin restricción por estado
    if (filtroFacturacion.length > 0 || filtroCobro.length > 0) {
      // Fix (mismo bug ya corregido en facturaVivaDe/render): una factura ANULADA no cuenta como
      // facturación viva, así que este precómputo necesita `anulada` de la vista, no solo saber si
      // existe relación -- si no, el filtro Facturación/Cobro quedaría contradiciendo al icono.
      const { data: todosAlbaranes, error: errorTodos } = await supabase
        .from('albaranes_venta')
        .select('id, factura_venta_albaran(facturas_venta_con_saldo(anulada))')

      if (errorTodos) {
        console.error('Error precalculando filtros de estado de albaranes:', errorTodos)
        idsPermitidosPorEstado = []
      } else {
        const idsFacturados = []
        const idsSueltos = []
        for (const alb of todosAlbaranes) {
          const facturado = facturaVivaDe(alb)
          if (facturado) idsFacturados.push(alb.id)
          else idsSueltos.push(alb.id)
        }

        // filtroFacturacion.length === 2 (ambos valores tildados) equivale a "sin restricción" --
        // mismo criterio que filtroFacturacion.length === 0, no hace falta distinguirlos.
        let idsPorFacturacion = null
        if (filtroFacturacion.length === 1) {
          idsPorFacturacion = filtroFacturacion[0] === 'facturado' ? idsFacturados : idsSueltos
        }

        let idsPorCobro = null
        if (filtroCobro.length > 0) {
          const estados = await estadosPagoDeAlbaranesSueltos(idsSueltos)
          idsPorCobro = idsSueltos.filter((id) => filtroCobro.includes(estados.get(id)))
        }

        // AND entre las dos dimensiones (sección 3 del contrato: independientes y combinables) --
        // intersección si las dos están activas a la vez.
        idsPermitidosPorEstado = idsPorFacturacion && idsPorCobro
          ? idsPorFacturacion.filter((id) => idsPorCobro.includes(id))
          : (idsPorFacturacion ?? idsPorCobro ?? [])
      }
    }

    let albaranesQuery = supabase
      .from('albaranes_venta')
      .select(SELECT_ALBARAN_CON_RELACIONES, { count: 'exact' })

    if (filtroClienteId) albaranesQuery = albaranesQuery.eq('cliente_id', filtroClienteId)
    if (filtroFechaDesde) albaranesQuery = albaranesQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) albaranesQuery = albaranesQuery.lte('fecha', filtroFechaHasta)
    // -1 como centinela cuando la intersección de estado queda vacía -- fuerza 0 filas en vez de
    // mandar un .in() con array vacío (semántica ambigua en PostgREST).
    if (idsPermitidosPorEstado !== null) {
      albaranesQuery = albaranesQuery.in('id', idsPermitidosPorEstado.length > 0 ? idsPermitidosPorEstado : [-1])
    }

    // BLOQUE 5: a diferencia de Pedidos, aquí no hay columna de agrupamiento por estado -- el
    // orden por defecto es simplemente fecha descendente, sin paso intermedio de migración.
    albaranesQuery = orden.columna
      ? albaranesQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : albaranesQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id, mismo motivo que en Pedidos: sin él, dos albaranes con la misma
    // fecha no tienen un orden garantizado entre sí, lo que podría repetir o saltarse filas al
    // paginar con .range() entre una página y la siguiente.
    albaranesQuery = albaranesQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    albaranesQuery = albaranesQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resAlbaranes, resClientes, resClientesActivos, resProductos, resArticulos] = await Promise.all([
      albaranesQuery,
      supabase.from('clientes').select('id, nombre').order('nombre'),
      // Bloque 6: mismo filtro activo=true que Pedidos.jsx, para el selector de cliente del
      // drawer de pago (distinto de `clientes`, usado por AlbaranVentaForm y que no filtra).
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('productos_finales').select('id, nombre, precio_venta').order('nombre'),
      supabase.from('articulos_compra').select('id, nombre, unidad').eq('tipo_material', 'TRD').order('nombre'),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else {
      const albaranesCargados = resAlbaranes.data || []
      setAlbaranes(albaranesCargados)
      setTotalAlbaranes(resAlbaranes.count ?? 0)

      // Bloque 6 + fix de facturaVivaDe: mismo criterio "facturado" ya usado en el render (única
      // fuente de verdad ahora, ver arriba) para aislar los sueltos, únicos candidatos a saldo
      // pendiente de cobro directo -- un albarán cuya factura fue anulada vuelve a entrar aquí.
      const idsSueltos = albaranesCargados
        .filter((alb) => !facturaVivaDe(alb))
        .map((alb) => alb.id)
      try {
        const saldos = await saldosDeAlbaranesSueltos(idsSueltos)
        setSaldosPorAlbaran(saldos)
      } catch (error) {
        console.error('Error calculando saldos de albaranes:', error)
        setSaldosPorAlbaran(new Map())
      }
    }

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resClientesActivos.error) console.error(resClientesActivos.error)
    else setClientesActivos(resClientesActivos.data || [])

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulosMercaderia(resArticulos.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroClienteId, filtroFacturacion, filtroCobro, filtroFechaDesde, filtroFechaHasta])

  function alGuardarPago() {
    setPagoDrawer(null)
    cargarDatos()
  }


  async function handleBorrar(id) {
    // CONTRATO_HARDENING_A5_A11.md, A9: mismo caso que ya se resolvió en AlbaranesCompra.jsx
    // (CONTRATO_PAGOS_COMPRA.md sección 8) -- pago_aplicacion.albaran_venta_id tampoco tiene ON
    // DELETE CASCADE (20260930_pagos_venta.sql, misma decisión deliberada que en compras: un pago
    // aplicado nunca debe desaparecer en cascada). Sin este precheck, borrar un albarán con un pago
    // aplicado directamente (no vía factura) fallaba con un error de FK genérico en vez de un
    // mensaje claro, y de forma inconsistente con compras.
    const { count: countPagos } = await supabase
      .from('pago_aplicacion')
      .select('*', { count: 'exact', head: true })
      .eq('albaran_venta_id', id)

    if (countPagos > 0) {
      alert(t('albaranes_venta:alertas.tiene_pagos_aplicados'))
      return
    }

    const { count } = await supabase
      .from('factura_venta_albaran')
      .select('*', { count: 'exact', head: true })
      .eq('albaran_venta_id', id)

    const mensaje = count > 0
      ? t('albaranes_venta:alertas.confirmar_borrar_con_facturas', { count })
      : t('albaranes_venta:alertas.confirmar_borrar_sin_facturas')

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('albaranes_venta').delete().eq('id', id)
    if (error) {
      alert(t('albaranes_venta:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    cargarDatos()
  }

  // BLOQUE 6: tras guardar desde el drawer, cierra, refresca y -- si el albarán guardado sigue
  // presente en la página actual -- hace scroll hasta su fila. requestAnimationFrame da tiempo a
  // que React confirme en el DOM las filas de cargarDatos() antes de buscar la ref (necesario para
  // un alta nueva, cuya fila no existía en el DOM hasta este refresco). Mismo patrón y misma
  // limitación conocida que Pedidos: si el albarán cae en otra página, no hay scroll cruzando
  // páginas.
  async function alGuardarAlbaran(idAlbaran) {
    setDrawerAbierto(false)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idAlbaran)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  return (
    <div>
      <PageHeader title={t('albaranes_venta:titulo')} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setDrawerAbierto(true)}>
          <IconPlus size={15} /> {t('albaranes_venta:nuevo_albaran')}
        </Button>
      </div>

      {/* BLOQUE 2 (CONTRATO_FILTROS_VENTA.md): dos MultiSelect de estado independientes
          (Facturación / Cobro, sección 3 del contrato) -- nunca mezclados en uno solo. */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
        <Field label={t('albaranes_venta:filtros.cliente')} className="w-48">
          <Select value={filtroClienteId} onChange={(e) => cambiarFiltroCliente(e.target.value)}>
            <option value="">{t('common:actions.all')}</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('albaranes_venta:filtros.facturacion')} className="w-48">
          <MultiSelect options={FACTURACION_OPCIONES} selected={filtroFacturacion} onChange={cambiarFiltroFacturacion} placeholder={t('common:actions.all')} />
        </Field>
        <Field label={t('albaranes_venta:filtros.cobro')} className="w-48">
          <MultiSelect options={COBRO_OPCIONES} selected={filtroCobro} onChange={cambiarFiltroCobro} placeholder={t('common:actions.all')} />
        </Field>
        <Field label={t('albaranes_venta:filtros.desde')} className="w-40">
          <DateInput value={filtroFechaDesde} onChange={cambiarFiltroFechaDesde} />
        </Field>
        <Field label={t('albaranes_venta:filtros.hasta')} className="w-40">
          <DateInput value={filtroFechaHasta} onChange={cambiarFiltroFechaHasta} />
        </Field>
        {hayFiltrosActivos && (
          <Button type="button" variant="secondary" size="sm" onClick={limpiarFiltros}>{t('albaranes_venta:filtros.limpiar_filtros')}</Button>
        )}
      </div>

      {cargando ? (
        <LoadingState />
      ) : albaranes.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? t('albaranes_venta:sin_albaranes_filtro') : t('albaranes_venta:sin_albaranes')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha')} className="flex items-center gap-1 hover:text-gray-600">
                      {t('albaranes_venta:tabla.fecha')} {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_venta:tabla.numero')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_venta:tabla.cliente')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('albaranes_venta:tabla.pedido_origen')}</th>
                  <th className="px-3 py-2.5 font-medium text-center">{t('albaranes_venta:tabla.facturacion')}</th>
                  <th className="px-3 py-2.5 font-medium text-center">{t('albaranes_venta:tabla.cobro')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('albaranes_venta:tabla.acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {albaranes.map((alb) => {
                  const expandido = filaExpandidaId === alb.id
                  // Bug encontrado probando con datos reales: factura_venta_albaran tiene un UNIQUE
                  // sobre albaran_venta_id (un albarán solo puede estar en una factura), así que
                  // PostgREST lo embebe como objeto único (o null), NUNCA como array -- asumir array
                  // aquí hacía que `facturado` diera siempre false, tuviese o no factura de verdad.
                  // Corregido además para no contar una factura ANULADA como facturación viva (ver
                  // facturaVivaDe arriba).
                  const facturado = facturaVivaDe(alb)
                  const facturaAsociada = Array.isArray(alb.factura_venta_albaran) ? alb.factura_venta_albaran[0] : alb.factura_venta_albaran
                  const codigosPedido = codigosPedidoOrigen(alb)
                  // Bloque 6: saldo/estado de pago propio SOLO para sueltos -- un albarán ya
                  // facturado (con factura viva) refleja su cobro en la factura, no aquí.
                  const saldo = facturado ? null : saldosPorAlbaran.get(alb.id)
                  const estado = saldo != null ? estadoPago(saldo, totalAlbaran(alb)) : null
                  const tieneSaldoPendiente = saldo != null && saldo > EPSILON

                  // Rediseño Facturación/Cobro: Facturación distingue "pendiente" por tipo de
                  // cliente (empresa = amarillo, obligación legal de facturar; particular = gris).
                  const claveFacturacion = facturado
                    ? 'facturado'
                    : (alb.clientes?.tipo === 'empresa' ? 'pendiente_empresa' : 'pendiente_particular')

                  // Cobro: si hay factura viva, se hereda SU estado (facturas_venta_con_saldo, misma
                  // fórmula de tolerancia que estadoPago ya usa en FacturasVenta.jsx) en vez del
                  // saldo propio del albarán -- el tooltip deja explícito que es el cobro de la
                  // factura, no del albarán, para no confundir con un albarán suelto sin cobrar.
                  let claveCobro = null
                  let tooltipCobro = null
                  if (facturado) {
                    const f = facturaAsociada.facturas_venta_con_saldo
                    claveCobro = estadoPago(Number(f.saldo_pendiente), Number(f.total))
                    tooltipCobro = `${t(`enums:estado_pago.${claveCobro}`)} (factura ${f.numero_factura})`
                  } else if (estado) {
                    claveCobro = estado
                    tooltipCobro = t(`enums:estado_pago.${claveCobro}`)
                  }
                  return (
                    <Fragment key={alb.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(alb.id, el); else filaRefs.current.delete(alb.id) }}
                        className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => toggleExpandido(alb.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(alb.fecha)}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{alb.numero_albaran || t('common:sin_numero')}</td>
                        <td className="px-3 py-3 font-medium text-ink">{alb.clientes?.nombre ?? t('common:sin_cliente')}</td>
                        <td className="px-3 py-3">
                          {codigosPedido.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : codigosPedido.length === 1 ? (
                            <Badge color="blue">{codigosPedido[0]}</Badge>
                          ) : (
                            <span title={codigosPedido.join(', ')}>
                              <Badge color="blue">{t('albaranes_venta:varios')}</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <EstadoIcono
                            cfg={ESTADO_FACTURACION_ICONO[claveFacturacion]}
                            label={t(`enums:estado_facturacion.${claveFacturacion === 'facturado' ? 'facturado' : 'pendiente_facturar'}`)}
                          />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {claveCobro && <EstadoIcono cfg={ESTADO_COBRO_ICONO[claveCobro]} label={tooltipCobro} />}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <button type="button" title={t('common:actions.print')} onClick={() => imprimirAlbaranVentaPdf(prepararDocumentoAlbaranVenta(alb))} className="text-gray-400 hover:text-primary-600">
                              <IconPrinter size={16} />
                            </button>
                            <button type="button" title={t('common:actions.download_pdf')} onClick={() => descargarAlbaranVentaPdf(prepararDocumentoAlbaranVenta(alb))} className="text-gray-400 hover:text-primary-600">
                              <IconDownload size={16} />
                            </button>
                            {tieneSaldoPendiente && (
                              <button
                                type="button" title={t('ventas_comun:tooltip_registrar_cobro')}
                                onClick={() => setPagoDrawer({ clienteId: alb.cliente_id, clienteNombre: alb.clientes?.nombre, documento: { tipo: 'albaran', id: alb.id, saldo } })}
                                className="text-gray-400 hover:text-green-700"
                              >
                                <IconCash size={16} />
                              </button>
                            )}
                            <button type="button" title={t('albaranes_venta:borrar')} onClick={() => handleBorrar(alb.id)} className="text-gray-400 hover:text-red-600">
                              <IconTrash size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={8} className="p-0">
                          {/* BLOQUE 4: grid con altura animable (0fr <-> 1fr) en vez de montar/desmontar
                              la fila -- así el expandir/colapsar tiene una transición CSS suave. */}
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3">
                                {alb.notas && <p className="text-sm text-gray-500 italic mb-2">{alb.notas}</p>}
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                      <th className="py-1.5 font-medium">{t('albaranes_venta:tabla_detalle.producto')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_venta:tabla_detalle.cantidad')}</th>
                                      <th className="py-1.5 font-medium">{t('albaranes_venta:tabla_detalle.precio')}</th>
                                      <th className="py-1.5 font-medium text-right"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {alb.lineas_albaran_venta.map((linea) => (
                                      <tr key={linea.id}>
                                        <td className="py-1.5">{nombreLineaVenta(linea)}</td>
                                        <td className="py-1.5">{linea.cantidad}</td>
                                        {/* Solo líneas de producto final tienen producción/lote de origen que
                                            referenciar -- la mercadería (articulos_compra) no aplica aquí,
                                            fuera de alcance de Parte B (CONTRATO_UI_INCIDENCIAS_STOCK.md). */}
                                        <td className="py-1.5">{linea.precio_unitario ?? '-'}</td>
                                        <td className="py-1.5 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            {linea.produccion_pf_id && <BadgeScrap tipo="producto_final" origenId={linea.produccion_pf_id} />}
                                            {linea.produccion_pf_id && <BadgeRechazoPendiente origenId={linea.produccion_pf_id} />}
                                            {linea.produccion_pf_id && (
                                              <LinkAction
                                                tone="amber"
                                                className="text-xs"
                                                onClick={() =>
                                                  setDeclararRechazoFijo({
                                                    tipo: 'producto_final',
                                                    itemId: linea.producto_final_id,
                                                    itemNombre: linea.productos_finales?.nombre,
                                                    itemUnidad: 'ud',
                                                    loteId: linea.produccion_pf_id,
                                                    loteLabel: `${linea.producciones_producto_final?.codigo_lote ? linea.producciones_producto_final.codigo_lote + ' · ' : ''}${linea.producciones_producto_final?.fecha ? formatFecha(linea.producciones_producto_final.fecha) : ''}`,
                                                    origenRechazo: 'cliente',
                                                    lineaPedidoOrigenId: linea.linea_pedido_id,
                                                  })
                                                }
                                              >
                                                {t('albaranes_venta:declarar_rechazo_cliente')}
                                              </LinkAction>
                                            )}
                                          </div>
                                        </td>
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
          <p className="text-xs text-gray-400">
            {t('albaranes_venta:albaran_pagina_count', { count: totalAlbaranes, pagina, total: totalPaginas })}
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
                className={`w-7 h-7 text-xs rounded-md ${n === pagina ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
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
        open={drawerAbierto}
        onClose={() => setDrawerAbierto(false)}
        title={t('albaranes_venta:nuevo_albaran')}
        anchoClase="max-w-2xl"
      >
        {drawerAbierto && (
          <AlbaranVentaForm
            pedidoIdParam={pedidoIdParam}
            clientes={clientes}
            productos={productos}
            articulosMercaderia={articulosMercaderia}
            onGuardado={alGuardarAlbaran}
            onCancelar={() => setDrawerAbierto(false)}
          />
        )}
      </Drawer>

      <Drawer open={pagoDrawer !== null} onClose={() => setPagoDrawer(null)} title={t('ventas_comun:registrar_pago')}>
        {pagoDrawer !== null && (
          <RegistrarPagoForm
            clientes={clientesParaDrawer(clientesActivos, pagoDrawer)}
            clienteIdInicial={pagoDrawer.clienteId}
            documentoPreseleccionado={pagoDrawer.documento}
            onGuardado={alGuardarPago}
            onCancelar={() => setPagoDrawer(null)}
          />
        )}
      </Drawer>

      <Drawer open={!!declararRechazoFijo} onClose={() => setDeclararRechazoFijo(null)} title={t('albaranes_venta:drawer_declarar_rechazo_titulo')}>
        {declararRechazoFijo && (
          <AjusteStockForm
            fijo={declararRechazoFijo}
            onCancelar={() => setDeclararRechazoFijo(null)}
            onGuardado={(ajusteCreado) => {
              setDeclararRechazoFijo(null)
              cargarDatos()
              // CONTRATO_PROPAGACION_RECHAZOS.md, Parte A (Paso 4.4): encadena directamente el paso
              // de resolución -- todo rechazo de cliente declarado aquí tiene linea_pedido_origen_id,
              // así que "Reenvío" siempre está disponible en este punto de entrada. El insert solo
              // trae columnas crudas de ajustes_producto_final (sin item_nombre/unidad, que viven en
              // la vista historial_ajustes_stock) -- se completan con lo que ya teníamos en `fijo`.
              if (ajusteCreado) {
                setRechazoAResolver({ ...ajusteCreado, item_nombre: declararRechazoFijo.itemNombre, unidad: declararRechazoFijo.itemUnidad })
              }
            }}
          />
        )}
      </Drawer>

      <Drawer open={!!rechazoAResolver} onClose={() => setRechazoAResolver(null)} title={t('albaranes_venta:drawer_resolver_rechazo_titulo')}>
        {rechazoAResolver && (
          <ResolverRechazoForm
            ajuste={rechazoAResolver}
            onOmitir={() => setRechazoAResolver(null)}
            onResuelto={() => {
              setRechazoAResolver(null)
              cargarDatos()
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

export default AlbaranesVenta
