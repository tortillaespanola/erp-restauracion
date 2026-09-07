import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import {
  IconChevronRight, IconChevronDown, IconEdit, IconTruckDelivery, IconX,
  IconAlertTriangle, IconArrowUp, IconArrowDown, IconArrowsSort, IconPlus,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect } from '../components/ui'
import PedidoForm from '../components/PedidoForm'

// BLOQUE 5 (CONTRATO_UX_PEDIDOS_VENTA.md): 20 por página, tal cual sugiere el contrato -- con el
// volumen real (~137 pedidos hoy) da ~7 páginas, cómodo para números de página sin necesitar elipsis
// ni un tamaño distinto.
const PAGINA_TAMANO = 20

// BLOQUE 4 (CONTRATO_UX_PEDIDOS_VENTA.md): el orden por defecto (activos primero, cerrados al
// fondo -- antes calculado en cliente con GRUPO_ESTADO/compararPedidos) ahora se resuelve en
// servidor vía la columna generada pedidos_venta.grupo_estado (migración 20260928), necesaria para
// ser coherente con la paginación por .range() del Bloque 5. Simplificación consciente frente al
// comparador anterior: dentro del grupo "cerrado" ya no se ordena por fecha_entrega_prevista
// descendente (recién cerrados arriba) -- ambos grupos usan la misma dirección ascendente, un
// único .order() de servidor no puede invertir el sentido solo para un grupo.
const ESTADO_BADGE = {
  pendiente: 'gray',
  en_produccion: 'amber',
  servido: 'green',
  cancelado: 'red',
}

// CONTRATO_I18N.md, Fase 0: solo las claves del enum (estables, en español porque así están en
// la BD) viven aquí -- la etiqueta visible se resuelve con t('enums:estado_pedido.<clave>'), ver
// enums.json en cada carpeta de idioma. Antes ESTADO_LABEL tenía el texto español fijo.
const ESTADOS_PEDIDO = ['pendiente', 'en_produccion', 'servido', 'cancelado']

function Pedidos() {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'enums'])
  // BLOQUE 1 (CONTRATO_FILTROS_VENTA.md): mismas opciones que el enum de estado, en formato
  // {value, label} para el MultiSelect -- recalculado en cada render para reaccionar al cambio
  // de idioma (ver Fase 0 del contrato i18n).
  const ESTADO_FILTRO_OPCIONES = ESTADOS_PEDIDO.map((value) => ({ value, label: t(`enums:estado_pedido.${value}`) }))
  const [pedidos, setPedidos] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [articulosMercaderia, setArticulosMercaderia] = useState([])
  const [cargando, setCargando] = useState(true)

  // BLOQUE 1 (CONTRATO_FILTROS_VENTA.md): lista de TODOS los clientes (activos e inactivos) para
  // el <Select> del filtro -- distinta de `clientes` (activo=true), que sigue siendo solo para el
  // formulario de alta/edición dentro del drawer. Un cliente inactivo puede tener pedidos
  // históricos que se quieran consultar igual.
  const [clientesFiltro, setClientesFiltro] = useState([])
  const [filtroClienteId, setFiltroClienteId] = useState('')
  const [filtroEstados, setFiltroEstados] = useState([])
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const hayFiltrosActivos = !!filtroClienteId || filtroEstados.length > 0 || !!filtroFechaDesde || !!filtroFechaHasta

  // Cualquier cambio de filtro resetea a la página 1 (sección 1 del contrato) -- mismo criterio
  // que ya usa cambiarOrden más abajo, aquí generalizado a los cuatro filtros.
  function cambiarFiltroCliente(id) { setFiltroClienteId(id); setPagina(1) }
  function cambiarFiltroEstados(valores) { setFiltroEstados(valores); setPagina(1) }
  function cambiarFiltroFechaDesde(v) { setFiltroFechaDesde(v); setPagina(1) }
  function cambiarFiltroFechaHasta(v) { setFiltroFechaHasta(v); setPagina(1) }
  function limpiarFiltros() {
    setFiltroClienteId('')
    setFiltroEstados([])
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
    setPagina(1)
  }

  // BLOQUE 6 (CONTRATO_UX_PEDIDOS_VENTA.md): un único estado para el drawer de alta/edición, mismo
  // patrón que Inventario.jsx -- null = cerrado, 'nuevo' = alta, objeto pedido = edición precargada.
  const [modoDrawer, setModoDrawer] = useState(null)
  // Refs de la fila principal de cada pedido, indexadas por id -- para poder hacer scrollIntoView
  // tras guardar desde el drawer sin depender de que la fila esté ya montada de antemano.
  const filaRefs = useRef(new Map())

  // Aviso "tanda de la previsión sin stock suficiente": stock_disponible real de cada tanda con alguna
  // previsión asignada, cargado en un único batch (in produccion_id) tras conocer los pedidos -- nunca
  // una consulta por línea.
  const [stockPorProduccionId, setStockPorProduccionId] = useState(new Map())
  // Fix: el aviso comparaba cantidad_prevista contra el stock físico bruto de la tanda, sin descontar
  // lo que OTRAS previsiones (de otras líneas de pedido) también reclaman de esa misma tanda -- suma de
  // cantidad_prevista por produccion_pf_id, para restar "lo de los demás" al calcular el disponible neto
  // de cada línea.
  const [sumaPrevistoPorProduccionId, setSumaPrevistoPorProduccionId] = useState(new Map())

  // BLOQUE 3 (CONTRATO_UX_PEDIDOS_VENTA.md): un único id expandido a nivel de pantalla (no un Set
  // por fila) para forzar comportamiento acordeón -- expandir un pedido colapsa cualquier otro.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  // BLOQUE 4: columna activa de ordenamiento (null = orden por defecto, ver comentario junto a
  // ESTADO_BADGE) -- solo Fecha y Entrega prevista son ordenables, sección 1 del contrato.
  const [orden, setOrden] = useState({ columna: null, direccion: 'asc' })

  // BLOQUE 5: página activa (1-indexada) + total de pedidos que cumplen el filtro/orden actual,
  // reportado por Supabase vía { count: 'exact' } -- necesario para pintar los números de página sin
  // traer todas las filas.
  const [pagina, setPagina] = useState(1)
  const [totalPedidos, setTotalPedidos] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalPedidos / PAGINA_TAMANO))

  // Corrección tras probar en navegador: "Fecha" es la fecha de creación del pedido -- su
  // convención natural (y la que tenía la query original, .order('fecha', { ascending: false })
  // antes del Bloque 4) es "más reciente primero", así que su primer clic empieza en descendente.
  // "Entrega prevista" es una fecha futura/de planificación -- "más próxima primero" (ascendente)
  // sigue siendo el punto de partida natural para esa columna.
  function direccionInicial(columna) {
    return columna === 'fecha' ? 'desc' : 'asc'
  }

  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: direccionInicial(columna) }
      if (prev.direccion === direccionInicial(columna)) {
        return { columna, direccion: direccionInicial(columna) === 'asc' ? 'desc' : 'asc' }
      }
      return { columna: null, direccion: 'asc' }
    })
    setPagina(1) // cambiar de orden con la página 8 abierta dejaría una página vacía o repetida
  }

  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  async function cargarDatos() {
    setCargando(true)

    let pedidosQuery = supabase
      .from('pedidos_venta')
      .select(`
        *,
        clientes(nombre),
        lineas_pedido_venta(
          id, producto_final_id, articulo_id, descripcion, cantidad, precio_unitario,
          productos_finales(nombre),
          articulos_compra(nombre, unidad),
          lineas_albaran_venta(cantidad),
          previsiones_distribucion_pf(cantidad_prevista, produccion_pf_id)
        )
      `, { count: 'exact' })

    // Corrección tras probar en navegador: grupo_estado (activos arriba, servidos/cancelados al
    // fondo) es un invariante permanente del listado, no solo el criterio "por defecto" -- tiene
    // que ir SIEMPRE primero en el .order(), incluso cuando el usuario elige ordenar por una
    // columna. La columna elegida (o, en su ausencia, fecha) actúa como desempate DENTRO de cada
    // grupo, nunca reemplazando el agrupamiento. Un pedido ya producido/albaranado que sigue
    // "activo" (pendiente/en_producción) debe seguir apareciendo en el grupo de arriba sin
    // importar qué columna esté ordenada.
    //
    // Cambio de criterio de producto (documentado en CONTRATO_UX_PEDIDOS_VENTA.md, no es una
    // regresión respecto al compararPedidos original): la segunda clave por defecto pasa de
    // fecha_entrega_prevista ascendente a fecha descendente -- más reciente primero dentro de cada
    // grupo, sin depender de nullsFirst porque `fecha` es NOT NULL en pedidos_venta.
    // BLOQUE 1 (CONTRATO_FILTROS_VENTA.md): filtros server-side, aplicados ANTES del .order() ya
    // existente -- no tocan la cadena de orden/agrupamiento/paginación de abajo, solo acotan qué
    // filas entran en ella. Cliente y estado con AND entre sí; varios estados a la vez son OR
    // (.in()); rango de fechas con .gte()/.lte() cuando se informan.
    if (filtroClienteId) pedidosQuery = pedidosQuery.eq('cliente_id', filtroClienteId)
    if (filtroEstados.length > 0) pedidosQuery = pedidosQuery.in('estado', filtroEstados)
    if (filtroFechaDesde) pedidosQuery = pedidosQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) pedidosQuery = pedidosQuery.lte('fecha', filtroFechaHasta)

    pedidosQuery = pedidosQuery.order('grupo_estado', { ascending: true })
    pedidosQuery = orden.columna
      ? pedidosQuery.order(orden.columna, { ascending: orden.direccion === 'asc', nullsFirst: false })
      : pedidosQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id: sin él, dos pedidos empatados en grupo_estado + la columna de orden
    // no tienen un orden garantizado entre sí en Postgres, lo que podría repetir o saltarse filas
    // al paginar con .range() entre una página y la siguiente.
    pedidosQuery = pedidosQuery.order('id', { ascending: true })

    // BLOQUE 5: .range() en vez de traer todos los pedidos -- el conteo total ({ count: 'exact' }
    // arriba) ignora el range, así que sigue reflejando el total real para pintar las páginas.
    const desde = (pagina - 1) * PAGINA_TAMANO
    pedidosQuery = pedidosQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resPedidos, resClientes, resClientesFiltro, resProductos, resArticulos] = await Promise.all([
      pedidosQuery,
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
      // BLOQUE 1: sin filtro de activo -- el <Select> del filtro necesita poder elegir un cliente
      // inactivo con pedidos históricos.
      supabase.from('clientes').select('id, nombre').order('nombre'),
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('articulos_compra').select('id, nombre, unidad').eq('tipo_material', 'TRD').order('nombre'),
    ])

    if (resPedidos.error) console.error(resPedidos.error)
    else {
      const pedidosOrdenados = resPedidos.data ?? []
      setPedidos(pedidosOrdenados)
      setTotalPedidos(resPedidos.count ?? 0)

      // Reparto multi-tanda: previsiones_distribucion_pf se embebe ahora como array (ver comentario en
      // el render, más abajo) -- una línea puede aportar varias previsiones a la suma por tanda.
      const idsProduccion = new Set()
      const sumaPrevisto = new Map()
      for (const p of pedidosOrdenados) {
        for (const l of p.lineas_pedido_venta) {
          for (const pd of l.previsiones_distribucion_pf || []) {
            if (pd.produccion_pf_id == null) continue
            idsProduccion.add(pd.produccion_pf_id)
            sumaPrevisto.set(pd.produccion_pf_id, (sumaPrevisto.get(pd.produccion_pf_id) || 0) + Number(pd.cantidad_prevista))
          }
        }
      }
      setSumaPrevistoPorProduccionId(sumaPrevisto)
      if (idsProduccion.size > 0) {
        const resStock = await supabase
          .from('stock_lotes_producto_final')
          .select('produccion_id, stock_disponible')
          .in('produccion_id', [...idsProduccion])
        if (resStock.error) console.error('Error cargando stock de tandas previstas:', resStock.error)
        setStockPorProduccionId(new Map((resStock.data ?? []).map((l) => [l.produccion_id, Number(l.stock_disponible)])))
      } else {
        setStockPorProduccionId(new Map())
      }
    }

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resClientesFiltro.error) console.error(resClientesFiltro.error)
    else setClientesFiltro(resClientesFiltro.data || [])

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulosMercaderia(resArticulos.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroClienteId, filtroEstados, filtroFechaDesde, filtroFechaHasta])

  async function handleEditar(pedido) {
    const lineaIds = pedido.lineas_pedido_venta.map((l) => l.id)

    const [resProduccion, resAlbaran, resProduccionTanda, resSemielaboradoTanda] = await Promise.all([
      supabase.from('producciones_producto_final').select('id', { count: 'exact', head: true }).eq('pedido_id', pedido.id),
      lineaIds.length > 0
        ? supabase.from('lineas_albaran_venta').select('id', { count: 'exact', head: true }).in('linea_pedido_id', lineaIds)
        : Promise.resolve({ count: 0, error: null }),
      // Flujo de tanda (POS_CONTRATOS_PANTALLA.md): producciones_producto_final.pedido_id
      // queda sin rellenar a propósito en ese flujo — el vínculo real es tanda_id, no
      // pedido_id, así que el chequeo de arriba no lo detecta.
      pedido.tanda_id
        ? supabase.from('producciones_producto_final').select('id', { count: 'exact', head: true }).eq('tanda_id', pedido.tanda_id)
        : Promise.resolve({ count: 0, error: null }),
      pedido.tanda_id
        ? supabase.from('producciones_semielaborado').select('id', { count: 'exact', head: true }).eq('tanda_id', pedido.tanda_id)
        : Promise.resolve({ count: 0, error: null }),
    ])

    if (resProduccion.error || resAlbaran.error || resProduccionTanda.error || resSemielaboradoTanda.error) {
      alert('Error al comprobar si el pedido se puede editar: ' + (resProduccion.error || resAlbaran.error || resProduccionTanda.error || resSemielaboradoTanda.error).message)
      return
    }

    if ((resProduccion.count || 0) > 0 || (resAlbaran.count || 0) > 0 || (resProduccionTanda.count || 0) > 0 || (resSemielaboradoTanda.count || 0) > 0) {
      alert('Este pedido ya tiene producción o entregas registradas; no se puede editar todavía — cancélalo y crea uno nuevo, o contacta con soporte.')
      return
    }

    setModoDrawer(pedido)
  }

  // BLOQUE 6: tras guardar desde el drawer, cierra, refresca y -- si el pedido guardado sigue
  // presente en la página actual -- hace scroll hasta su fila. requestAnimationFrame da tiempo a que
  // React confirme en el DOM las filas de cargarDatos() antes de buscar la ref (necesario sobre todo
  // para un alta nueva, cuya fila no existía en el DOM hasta este refresco).
  async function alGuardarPedido(idPedido) {
    setModoDrawer(null)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idPedido)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // BLOQUE 2 (CONTRATO_UX_PEDIDOS_VENTA.md): resumen para la columna Progreso -- misma fórmula de
  // "servido >= cantidad pedida" y misma condición de aviso de stock insuficiente que ya usa la fila
  // expandida (sección "Previsto"/"Servido" de más abajo), sin duplicarla ahí, solo agregada aquí.
  function calcularProgresoPedido(p) {
    let lineasServidas = 0
    let algunaConAvisoStock = false
    for (const linea of p.lineas_pedido_venta) {
      const servido = (linea.lineas_albaran_venta || []).reduce((sum, l) => sum + Number(l.cantidad), 0)
      if (servido >= linea.cantidad) lineasServidas++

      const previsiones = linea.previsiones_distribucion_pf || []
      const tieneAvisoStock = previsiones
        .filter((pd) => pd.produccion_pf_id != null && Number(pd.cantidad_prevista) > 0)
        .some((pd) => {
          const cantidadPd = Number(pd.cantidad_prevista)
          const stockTanda = stockPorProduccionId.get(pd.produccion_pf_id)
          const sumaOtras = (sumaPrevistoPorProduccionId.get(pd.produccion_pf_id) || 0) - cantidadPd
          const disponibleNeto = stockTanda != null ? stockTanda - sumaOtras : null
          return disponibleNeto != null && disponibleNeto < cantidadPd
        })
      if (tieneAvisoStock) algunaConAvisoStock = true
    }
    return { totalLineas: p.lineas_pedido_venta.length, lineasServidas, algunaConAvisoStock }
  }

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar este pedido?')) return
    const { error } = await supabase.from('pedidos_venta').update({ estado: 'cancelado' }).eq('id', id)
    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Pedidos" subtitle="Registra lo que pide un cliente, lanza la producción que haga falta, y créalo como albarán de venta cuando esté listo." />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#1C2938]">Listado</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> Nuevo pedido
        </Button>
      </div>

      {/* BLOQUE 1 (CONTRATO_FILTROS_VENTA.md): barra de filtros server-side -- Cliente (todos,
          activos e inactivos), Estado (MultiSelect, OR entre valores), rango de fechas. Se
          combinan con AND entre sí en cargarDatos(). */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
        <Field label="Cliente" className="w-48">
          <Select value={filtroClienteId} onChange={(e) => cambiarFiltroCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientesFiltro.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" className="w-56">
          <MultiSelect options={ESTADO_FILTRO_OPCIONES} selected={filtroEstados} onChange={cambiarFiltroEstados} placeholder="Todos" />
        </Field>
        <Field label="Desde" className="w-40">
          <DateInput value={filtroFechaDesde} onChange={cambiarFiltroFechaDesde} />
        </Field>
        <Field label="Hasta" className="w-40">
          <DateInput value={filtroFechaHasta} onChange={cambiarFiltroFechaHasta} />
        </Field>
        {hayFiltrosActivos && (
          <Button type="button" variant="secondary" size="sm" onClick={limpiarFiltros}>Limpiar filtros</Button>
        )}
      </div>

      {cargando ? (
        <LoadingState />
      ) : pedidos.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? 'Ningún pedido coincide con los filtros aplicados.' : 'Todavía no hay pedidos registrados.'}
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
                      Fecha {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha_entrega_prevista')} className="flex items-center gap-1 hover:text-gray-600">
                      Entrega prevista {iconoOrden('fecha_entrega_prevista')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium">Progreso</th>
                  <th className="px-3 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const expandido = filaExpandidaId === p.id
                  const puedeGestionar = p.estado !== 'servido' && p.estado !== 'cancelado'
                  const { totalLineas, lineasServidas, algunaConAvisoStock } = calcularProgresoPedido(p)
                  const progresoCompleto = totalLineas > 0 && lineasServidas === totalLineas
                  return (
                    <Fragment key={p.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(p.id, el); else filaRefs.current.delete(p.id) }}
                        className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => toggleExpandido(p.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(p.fecha)}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-[#1C2938]">{p.clientes?.nombre ?? 'Sin cliente'}</div>
                          {p.codigo_pedido && <div className="text-xs font-mono text-gray-400">{p.codigo_pedido}</div>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {p.fecha_entrega_prevista ? formatFecha(p.fecha_entrega_prevista) : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <Badge color={ESTADO_BADGE[p.estado] ?? 'gray'}>{t(`enums:estado_pedido.${p.estado}`, { defaultValue: p.estado })}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={progresoCompleto ? 'text-green-600 font-medium' : 'text-gray-600'}>
                              {lineasServidas}/{totalLineas} líneas servidas
                            </span>
                            {algunaConAvisoStock && (
                              <span title="Alguna línea tiene stock insuficiente en la tanda asignada">
                                <IconAlertTriangle size={14} className="text-red-600" />
                              </span>
                            )}
                          </div>
                          {totalLineas > 0 && (
                            <div className="mt-1 h-[3px] w-24 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${progresoCompleto ? 'bg-green-600' : 'bg-[#0854A0]'}`}
                                style={{ width: `${(lineasServidas / totalLineas) * 100}%` }}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            {puedeGestionar && (
                              <>
                                <button type="button" title="Editar" onClick={() => handleEditar(p)} className="text-gray-400 hover:text-[#0854A0]">
                                  <IconEdit size={16} />
                                </button>
                                <button type="button" title="Crear albarán de venta" onClick={() => navigate(`/albaranes-venta?pedido_id=${p.id}`)} className="text-gray-400 hover:text-[#0854A0]">
                                  <IconTruckDelivery size={16} />
                                </button>
                                <button type="button" title="Cancelar pedido" onClick={() => handleCancelar(p.id)} className="text-gray-400 hover:text-red-600">
                                  <IconX size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} className="p-0">
                          {/* BLOQUE 3: grid con altura animable (0fr <-> 1fr) en vez de montar/desmontar
                              la fila -- así el expandir/colapsar tiene una transición CSS suave. */}
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3">
                                {p.notas && <p className="text-sm text-gray-500 italic mb-2">{p.notas}</p>}
                                <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                  <th className="py-1.5 font-medium">Línea</th>
                                  <th className="py-1.5 font-medium">Pedido</th>
                                  <th className="py-1.5 font-medium">Previsto</th>
                                  <th className="py-1.5 font-medium">Servido</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {p.lineas_pedido_venta.map((linea) => {
                                  const tipo = linea.producto_final_id ? 'producto' : linea.articulo_id ? 'mercaderia' : 'libre'
                                  const nombre = tipo === 'producto' ? linea.productos_finales?.nombre : tipo === 'mercaderia' ? linea.articulos_compra?.nombre : linea.descripcion
                                  const unidad = tipo === 'mercaderia' ? linea.articulos_compra?.unidad : ''
                                  // Reparto multi-tanda: previsiones_distribucion_pf ya no tiene UNIQUE(linea_pedido_id)
                                  // a secas (ahora es UNIQUE(linea_pedido_id, produccion_pf_id), compuesto) -- PostgREST
                                  // solo infiere relación a-uno cuando el UNIQUE cubre EXACTAMENTE la columna del FK
                                  // usada en el embed; un UNIQUE compuesto no cuenta, así que pasa a embeberse como
                                  // array (confirmado por ausencia de cualquier UNIQUE de una sola columna sobre
                                  // linea_pedido_id en pg_constraint -- el índice parcial "sin tanda" tampoco cuenta,
                                  // creado como índice, no como constraint). Una línea puede tener varias previsiones
                                  // (una por tanda) -- se suman todas para "Previsto".
                                  const previsiones = linea.previsiones_distribucion_pf || []
                                  const previsto = previsiones.reduce((sum, pd) => sum + Number(pd.cantidad_prevista), 0)
                                  const servido = (linea.lineas_albaran_venta || []).reduce((sum, l) => sum + Number(l.cantidad), 0)
                                  const completa = servido >= linea.cantidad
                                  // Aviso "tanda sin stock suficiente", por cada previsión con tanda asignada y
                                  // cantidad pendiente de verdad (previsto > 0) -- comparando contra el disponible NETO
                                  // de esa tanda (stock físico menos lo que OTRAS previsiones, de cualquier línea,
                                  // también reclaman de ella).
                                  const previsionesConAviso = previsiones
                                    .filter((pd) => pd.produccion_pf_id != null && Number(pd.cantidad_prevista) > 0)
                                    .map((pd) => {
                                      const cantidadPd = Number(pd.cantidad_prevista)
                                      const stockTanda = stockPorProduccionId.get(pd.produccion_pf_id)
                                      const sumaOtras = (sumaPrevistoPorProduccionId.get(pd.produccion_pf_id) || 0) - cantidadPd
                                      const disponibleNeto = stockTanda != null ? stockTanda - sumaOtras : null
                                      return { disponibleNeto, insuficiente: disponibleNeto != null && disponibleNeto < cantidadPd }
                                    })
                                    .filter((pd) => pd.insuficiente)
                                  const stockInsuficiente = previsionesConAviso.length > 0
                                  return (
                                    <tr key={linea.id}>
                                      <td className="py-1.5">
                                        {nombre}
                                        {tipo === 'mercaderia' && <span className="text-gray-400 text-xs"> (mercadería)</span>}
                                        {tipo === 'libre' && <span className="text-gray-400 text-xs"> (otro/servicio)</span>}
                                      </td>
                                      <td className="py-1.5">{linea.cantidad} {unidad}</td>
                                      <td className={`py-1.5 ${stockInsuficiente ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                        {tipo === 'producto' ? (
                                          <>
                                            {previsto} {unidad}
                                            {stockInsuficiente && (
                                              <span className="text-xs">
                                                {' '}({previsionesConAviso.map((pd) => `solo ${pd.disponibleNeto.toFixed(3)} disp.`).join('; ')} en la tanda asignada)
                                              </span>
                                            )}
                                          </>
                                        ) : '-'}
                                      </td>
                                      <td className={`py-1.5 ${completa ? 'text-green-600' : 'text-gray-500'}`}>{servido} {unidad}</td>
                                    </tr>
                                  )
                                })}
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

      {!cargando && totalPedidos > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-400">
            {totalPedidos} pedido{totalPedidos === 1 ? '' : 's'} · página {pagina} de {totalPaginas}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPagina(n)}
                className={`w-7 h-7 text-xs rounded-md ${n === pagina ? 'bg-[#0854A0] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {n}
              </button>
            ))}
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      <Drawer
        open={modoDrawer !== null}
        onClose={() => setModoDrawer(null)}
        title={modoDrawer !== null && typeof modoDrawer === 'object' ? 'Editar pedido' : 'Nuevo pedido'}
      >
        {modoDrawer !== null && (
          <PedidoForm
            pedido={typeof modoDrawer === 'object' ? modoDrawer : null}
            clientes={clientes}
            productos={productos}
            articulosMercaderia={articulosMercaderia}
            onGuardado={alGuardarPedido}
            onCancelar={() => setModoDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default Pedidos
