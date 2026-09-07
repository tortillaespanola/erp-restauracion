import { useState, useEffect, useRef, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import { descargarPdf, imprimirPdf } from '../lib/generarPdf'
import { estadoPago, clientesParaDrawer } from '../lib/saldosVenta'
import { useNegocio } from '../context/useNegocio'
import {
  IconChevronRight, IconChevronDown, IconPrinter, IconDownload, IconCoin, IconBan,
  IconArrowUp, IconArrowDown, IconArrowsSort, IconPlus,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect } from '../components/ui'
import RegistrarPagoForm from '../components/RegistrarPagoForm'
import FacturaVentaForm from '../components/FacturaVentaForm'

const ESTADO_PAGO_BADGE = { pagada: 'green', parcial: 'amber', pendiente: 'gray' }

// BLOQUE 5 (CONTRATO_UX_FACTURAS_VENTA.md): 20 por página, mismo tamaño que Pedidos/Albaranes.
const PAGINA_TAMANO = 20

// BLOQUE 3 (CONTRATO_FILTROS_VENTA.md), sección 4: incluye "Anulada" además de los tres estados
// de pago del badge -- es un estado propio de la factura, no del saldo. CONTRATO_I18N.md, Fase 0:
// solo las claves viven aquí, la etiqueta se resuelve con t('enums:estado_pago.<clave>').
const ESTADOS_FILTRO_FACTURA = ['pendiente', 'parcial', 'pagada', 'anulada']

function FacturasVenta() {
  const { t } = useTranslation(['common', 'enums'])
  const { negocio } = useNegocio()
  const ESTADO_FILTRO_OPCIONES = ESTADOS_FILTRO_FACTURA.map((value) => ({ value, label: t(`enums:estado_pago.${value}`) }))
  const [facturas, setFacturas] = useState([])
  const [clientes, setClientes] = useState([])
  const [clientesActivos, setClientesActivos] = useState([])
  const [cargando, setCargando] = useState(true)

  // null = cerrado; { clienteId, documento: { tipo, id, saldo } } = abierto y preseleccionado.
  const [pagoDrawer, setPagoDrawer] = useState(null)

  // BLOQUE 6: drawer de alta -- solo boolean, sin modo edición (nunca existió, sección 4 del
  // contrato). Refs de la fila principal de cada factura, indexadas por id, para scrollIntoView
  // tras guardar (misma técnica que Pedidos.jsx).
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const filaRefs = useRef(new Map())

  // BLOQUE 3 (CONTRATO_UX_FACTURAS_VENTA.md): un único id expandido a nivel de pantalla (no un Set
  // por fila) para forzar comportamiento acordeón -- mismo patrón que Pedidos/Albaranes.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // BLOQUE 4: columna activa de ordenamiento (null = orden por defecto, fecha descendente dentro
  // de cada grupo) -- solo Fecha es ordenable, sección 2/5 del contrato.
  const [orden, setOrden] = useState({ columna: null, direccion: 'asc' })

  function direccionInicial() {
    return 'desc' // "Fecha" es la fecha de la factura -- más reciente primero, mismo criterio que Pedidos.
  }

  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: direccionInicial(columna) }
      if (prev.direccion === direccionInicial(columna)) {
        return { columna, direccion: direccionInicial(columna) === 'asc' ? 'desc' : 'asc' }
      }
      return { columna: null, direccion: 'asc' }
    })
    setPagina(1) // cambiar de orden con la página 3 abierta dejaría una página vacía o repetida
  }

  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  // BLOQUE 5: página activa (1-indexada) + total de facturas que cumplen el orden actual,
  // reportado por Supabase vía { count: 'exact' } -- necesario para pintar los números de página
  // sin traer todas las filas.
  const [pagina, setPagina] = useState(1)
  const [totalFacturas, setTotalFacturas] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalFacturas / PAGINA_TAMANO))

  // BLOQUE 3 (CONTRATO_FILTROS_VENTA.md): filtro de Cliente reutiliza `clientes` (ya sin filtro de
  // activo, ver Promise.all de cargarDatos -- lo usa FacturaVentaForm para la misma lista).
  const [filtroClienteId, setFiltroClienteId] = useState('')
  const [filtroEstados, setFiltroEstados] = useState([])
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const hayFiltrosActivos = !!filtroClienteId || filtroEstados.length > 0 || !!filtroFechaDesde || !!filtroFechaHasta

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

  async function cargarDatos() {
    setCargando(true)

    // BLOQUE 3 (CONTRATO_FILTROS_VENTA.md): el estado de pago no es una columna de
    // facturas_venta_con_saldo (solo saldo_pendiente/anulada/total, resueltos en Bloque 1) -- no
    // hay forma de comparar saldo_pendiente contra total (dos columnas, no un literal) con un
    // filtro simple de PostgREST, así que se resuelve igual que Facturación/Cobro en
    // AlbaranesVenta.jsx (Bloque 2): un precómputo ligero trayendo solo id/total/saldo/anulada de
    // TODAS las facturas (volumen bajo, mismo criterio), clasificando en cliente con la misma
    // estadoPago() de siempre, para obtener una lista de ids que se aplica con .in() a la query
    // principal. Solo se ejecuta si el filtro de Estado está activo.
    let idsPermitidosPorEstado = null // null = sin restricción por estado
    if (filtroEstados.length > 0) {
      const { data: todasFacturas, error: errorTodas } = await supabase
        .from('facturas_venta_con_saldo')
        .select('id, total, saldo_pendiente, anulada')

      if (errorTodas) {
        console.error('Error precalculando el filtro de estado de facturas:', errorTodas)
        idsPermitidosPorEstado = []
      } else {
        idsPermitidosPorEstado = todasFacturas
          .filter((f) => {
            if (f.anulada) return filtroEstados.includes('anulada')
            return filtroEstados.includes(estadoPago(Number(f.saldo_pendiente), f.total))
          })
          .map((f) => f.id)
      }
    }

    // BLOQUE 4 (CONTRATO_UX_FACTURAS_VENTA.md): se consulta la vista facturas_venta_con_saldo
    // (Bloque 1) en vez de la tabla cruda -- expone saldo_pendiente y prioridad_grupo ya resueltos
    // en servidor, necesarios para ordenar/agrupar sin traer todo y calcular en cliente. Mismo
    // select/embeds de siempre (clientes, factura_venta_albaran->albaranes_venta): PostgREST
    // detecta las relaciones a través de la vista igual que a través de la tabla (verificado en
    // el Bloque 1).
    let facturasQuery = supabase
      .from('facturas_venta_con_saldo')
      .select('*, clientes(nombre, direccion, cif), factura_venta_albaran(albaranes_venta(id, numero_albaran, fecha))', { count: 'exact' })

    // BLOQUE 3: Cliente y rango de fechas, AND entre sí y con el filtro de Estado de arriba.
    if (filtroClienteId) facturasQuery = facturasQuery.eq('cliente_id', filtroClienteId)
    if (filtroFechaDesde) facturasQuery = facturasQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) facturasQuery = facturasQuery.lte('fecha', filtroFechaHasta)
    // -1 como centinela cuando la lista de ids permitidos queda vacía -- fuerza 0 filas en vez de
    // mandar un .in() con array vacío (semántica ambigua en PostgREST).
    if (idsPermitidosPorEstado !== null) {
      facturasQuery = facturasQuery.in('id', idsPermitidosPorEstado.length > 0 ? idsPermitidosPorEstado : [-1])
    }

    // prioridad_grupo (0 Pendiente/Parcial, 1 Pagada, 2 Anulada) es SIEMPRE la primera clave de
    // .order() -- invariante permanente, igual que grupo_estado en pedidos_venta (corrección
    // post-Bloque 5 documentada en CONTRATO_UX_PEDIDOS_VENTA.md). La columna que el usuario elija
    // (o, en su ausencia, fecha descendente) actúa como desempate DENTRO de cada grupo, nunca
    // reemplazando el agrupamiento.
    facturasQuery = facturasQuery.order('prioridad_grupo', { ascending: true })
    facturasQuery = orden.columna
      ? facturasQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : facturasQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id, mismo motivo que en Pedidos: sin él, dos facturas empatadas en
    // prioridad_grupo + fecha no tienen un orden garantizado entre sí en Postgres.
    facturasQuery = facturasQuery.order('id', { ascending: true })

    // BLOQUE 5: .range() en vez de traer todas las facturas -- el conteo total ({ count: 'exact' }
    // arriba) ignora el range, así que sigue reflejando el total real para pintar las páginas.
    const desde = (pagina - 1) * PAGINA_TAMANO
    facturasQuery = facturasQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resFacturas, resClientes, resClientesActivos] = await Promise.all([
      facturasQuery,
      supabase.from('clientes').select('id, nombre, direccion, cif').order('nombre'),
      // Bloque 6: mismo filtro activo=true que Pedidos.jsx, para el selector de cliente del
      // drawer de pago (distinto de `clientes`, que aquí no filtra porque es para el histórico).
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
    ])

    if (resFacturas.error) console.error(resFacturas.error)
    else {
      setFacturas(resFacturas.data || [])
      setTotalFacturas(resFacturas.count ?? 0)
    }

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resClientesActivos.error) console.error(resClientesActivos.error)
    else setClientesActivos(resClientesActivos.data || [])

    setCargando(false)
  }

  function alGuardarPago() {
    setPagoDrawer(null)
    cargarDatos()
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroClienteId, filtroEstados, filtroFechaDesde, filtroFechaHasta])

  // BLOQUE 6: tras guardar desde el drawer, cierra, refresca y -- si la factura guardada sigue
  // presente en la página actual -- hace scroll hasta su fila. requestAnimationFrame da tiempo a
  // que React confirme en el DOM las filas de cargarDatos() antes de buscar la ref (necesario para
  // un alta nueva, cuya fila no existía en el DOM hasta este refresco). Misma limitación conocida
  // que Pedidos/Albaranes: si la factura cae en otra página de paginación, no hay scroll posible.
  async function alGuardarFactura(idFactura) {
    setDrawerAbierto(false)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idFactura)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // BLOQUE 4: anulación en vez de borrado físico -- nunca DELETE, así el numero_factura queda
  // "quemado" para siempre y factura_venta_albaran conserva sus filas (los albaranes vuelven a
  // estar disponibles, ver el filtro de cargarAlbaranesDelCliente más arriba). Sin reactivar.
  async function handleAnular(id) {
    if (!confirm('Esta acción anula la factura de forma permanente, no se puede deshacer. ¿Continuar?')) return

    const { error } = await supabase.from('facturas_venta').update({ anulada: true }).eq('id', id)
    if (error) {
      alert('Error al anular: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function prepararDocumento(f) {
    const albaranIds = f.factura_venta_albaran.map((rel) => rel.albaranes_venta?.id).filter(Boolean)

    const { data: lineasAlbaranes, error } = await supabase
      .from('lineas_albaran_venta')
      .select('cantidad, precio_unitario, productos_finales(nombre), articulos_compra(nombre), descripcion, albaran_venta_id')
      .in('albaran_venta_id', albaranIds)

    if (error) {
      console.error(error)
    }

    const lineas = (lineasAlbaranes || []).map((l) => ({
      concepto: l.productos_finales?.nombre ?? l.articulos_compra?.nombre ?? l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precio_unitario,
    }))

    return {
      numero: f.numero_factura || `#${f.id}`,
      fecha: f.fecha,
      tercero: {
        nombre: f.clientes?.nombre,
        direccion: f.clientes?.direccion,
        cif: f.clientes?.cif,
      },
      lineas,
      // BLOQUE 3: f.total ya viene persistido y fiable desde el INSERT (calcularTotalDeAlbaranes),
      // nunca null para una factura nueva -- ya no hace falta recalcularlo ni un `?? totalCalculado`
      // de respaldo, eso es justo lo que permitía la divergencia listado/PDF que cerramos aquí.
      total: f.total,
    }
  }

  return (
    <div>
      <PageHeader title="Facturas de venta" />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#1C2938]">Listado</h2>
        <Button onClick={() => setDrawerAbierto(true)}>
          <IconPlus size={15} /> Nueva factura
        </Button>
      </div>

      {/* BLOQUE 3 (CONTRATO_FILTROS_VENTA.md): barra de filtros server-side -- Cliente, Estado
          (contra facturas_venta_con_saldo, ver cargarDatos), rango de fechas. */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
        <Field label="Cliente" className="w-48">
          <Select value={filtroClienteId} onChange={(e) => cambiarFiltroCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map((c) => (
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
      ) : facturas.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? 'Ninguna factura coincide con los filtros aplicados.' : 'Todavía no hay facturas registradas.'}
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
                  <th className="px-3 py-2.5 font-medium">Nº Factura</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total</th>
                  <th className="px-3 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => {
                  // BLOQUE 4: saldo_pendiente ya llega calculado desde facturas_venta_con_saldo
                  // (Bloque 1) -- NULL para una factura anulada (sección 4 de
                  // CONTRATO_PAGOS_VENTA.md), su estado ya lo dice el badge "Anulada" de al lado.
                  const saldo = f.saldo_pendiente != null ? Number(f.saldo_pendiente) : null
                  const estado = saldo != null ? estadoPago(saldo, f.total) : null
                  const tieneSaldoPendiente = saldo != null && saldo > 0.005
                  const expandido = filaExpandidaId === f.id
                  return (
                    <Fragment key={f.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(f.id, el); else filaRefs.current.delete(f.id) }}
                        className={`border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer ${f.anulada ? 'opacity-60 bg-gray-50' : ''}`}
                        onClick={() => toggleExpandido(f.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(f.fecha)}</td>
                        <td className={`px-3 py-3 whitespace-nowrap text-[#1C2938] ${f.anulada ? 'line-through' : ''}`}>
                          {f.numero_factura || '(sin número)'}
                        </td>
                        <td className="px-3 py-3">{f.clientes?.nombre ?? 'Sin cliente'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {f.anulada && <Badge color="red">{t('enums:estado_pago.anulada')}</Badge>}
                            {estado && <Badge color={ESTADO_PAGO_BADGE[estado]}>{t(`enums:estado_pago.${estado}`)}</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600">
                          {f.total != null ? formatMoneda(f.total, negocio?.moneda) : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <button type="button" title="Imprimir" onClick={async () => imprimirPdf('Factura', await prepararDocumento(f))} className="text-gray-400 hover:text-gray-600">
                              <IconPrinter size={16} />
                            </button>
                            <button type="button" title="Descargar PDF" onClick={async () => descargarPdf('Factura', await prepararDocumento(f))} className="text-gray-400 hover:text-[#0854A0]">
                              <IconDownload size={16} />
                            </button>
                            {tieneSaldoPendiente && (
                              <button
                                type="button" title="Registrar cobro"
                                onClick={() => setPagoDrawer({ clienteId: f.cliente_id, clienteNombre: f.clientes?.nombre, documento: { tipo: 'factura', id: f.id, saldo } })}
                                className="text-gray-400 hover:text-green-700"
                              >
                                <IconCoin size={16} />
                              </button>
                            )}
                            {!f.anulada && (
                              <button type="button" title="Anular" onClick={() => handleAnular(f.id)} className="text-gray-400 hover:text-red-600">
                                <IconBan size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} className="p-0">
                          {/* BLOQUE 3: grid con altura animable (0fr <-> 1fr) para una transición suave,
                              mismo patrón que Pedidos/Albaranes -- en vez de montar/desmontar la fila. */}
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3 text-sm text-gray-600">
                                <span className="font-medium">Albaranes incluidos: </span>
                                {f.factura_venta_albaran.length === 0
                                  ? '—'
                                  : f.factura_venta_albaran
                                      .map((rel) => `${rel.albaranes_venta?.numero_albaran || '(sin número)'} (${formatFecha(rel.albaranes_venta?.fecha)})`)
                                      .join(', ')}
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

      {!cargando && totalFacturas > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-400">
            {totalFacturas} factura{totalFacturas === 1 ? '' : 's'} · página {pagina} de {totalPaginas}
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

      <Drawer open={pagoDrawer !== null} onClose={() => setPagoDrawer(null)} title="Registrar pago">
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

      {/* BLOQUE 6: ancho más generoso que el max-w-md por defecto (mismo criterio que Albaranes),
          pero sin llegar al max-w-2xl que usa AlbaranVentaForm -- ese formulario necesita esa
          anchura por sus grillas de varias columnas por línea (lote/tanda); este formulario es más
          simple (Cliente + Fecha + una lista vertical de checkboxes), lo único que puede crecer es
          el LARGO de la lista de albaranes (hasta 8 en un caso real visto), no su ancho -- ya
          resuelto por el scroll interno del propio Drawer. max-w-lg da algo más de aire que el
          default sin dejar espacio en blanco de sobra. */}
      <Drawer open={drawerAbierto} onClose={() => setDrawerAbierto(false)} title="Nueva factura" anchoClase="max-w-lg">
        {drawerAbierto && (
          <FacturaVentaForm
            clientes={clientes}
            onGuardado={alGuardarFactura}
            onCancelar={() => setDrawerAbierto(false)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default FacturasVenta
