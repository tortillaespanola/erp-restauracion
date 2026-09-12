import { useState, useEffect, useRef, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import {
  IconPlus, IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconArrowsSort,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, LinkAction, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect } from '../components/ui'
import { useNegocio } from '../context/useNegocio'
import { EPSILON } from '../lib/saldosCompra'
import FacturaCompraForm from '../components/FacturaCompraForm'
import RegistrarPagoProveedorForm from '../components/RegistrarPagoProveedorForm'

// CONTRATO_PAGOS_COMPRA.md sección 4.4: mismos colores que ESTADO_PAGO_BADGE de FacturasVenta.jsx,
// más 'sin_total' (blue) -- caso nuevo sin equivalente en venta (facturas_venta.total nunca es
// NULL). estado_pago llega ya resuelto desde facturas_compra_con_saldo, no se recalcula aquí.
const ESTADO_PAGO_BADGE = { pagada: 'green', parcial: 'amber', pendiente: 'gray', anulada: 'red', sin_total: 'blue' }

// CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 3: filtro de Estado nuevo, alcanzando paridad con
// FacturasVenta.jsx -- a diferencia de venta (4 valores), aquí son 5 porque estado_pago ya
// distingue 'sin_total' (facturas_compra.total nullable) de 'pendiente'.
const ESTADOS_FILTRO_FACTURA = ['pendiente', 'parcial', 'pagada', 'sin_total', 'anulada']

// CONTRATO_DRAWERS_COMPRAS.md, último punto: mismo tamaño de página que Venta.
const PAGINA_TAMANO = 20

function FacturasCompra() {
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'facturas_compra'])
  const { negocio } = useNegocio()
  const ESTADO_FILTRO_OPCIONES = ESTADOS_FILTRO_FACTURA.map((value) => ({ value, label: t(`enums:estado_pago.${value}`) }))

  const [facturas, setFacturas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)

  // CONTRATO_DRAWERS_COMPRAS.md, paso 3: mismo patrón de 3 estados que Pedidos/AlbaranesCompra.jsx
  // -- null = cerrado, 'nuevo' = alta, objeto factura = edición precargada.
  const [modoDrawer, setModoDrawer] = useState(null)
  // CONTRATO_PAGOS_COMPRA.md sección 4.3: null = cerrado; { proveedorId, documento } = abierto y
  // preseleccionado -- mismo patrón que pagoDrawer en FacturasVenta.jsx.
  const [pagoDrawer, setPagoDrawer] = useState(null)
  const filaRefs = useRef(new Map())

  // CONTRATO_TABLA_COMPRAS.md, sección 3: un único id expandido a nivel de pantalla (acordeón),
  // mismo patrón que las 4 pantallas de Venta.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)
  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  const [filtroProveedorId, setFiltroProveedorId] = useState('')
  const [filtroEstados, setFiltroEstados] = useState([])
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const hayFiltrosActivos = !!filtroProveedorId || filtroEstados.length > 0 || !!filtroFechaDesde || !!filtroFechaHasta

  function cambiarFiltroProveedor(id) { setFiltroProveedorId(id); setPagina(1) }
  function cambiarFiltroEstados(valores) { setFiltroEstados(valores); setPagina(1) }
  function cambiarFiltroFechaDesde(v) { setFiltroFechaDesde(v); setPagina(1) }
  function cambiarFiltroFechaHasta(v) { setFiltroFechaHasta(v); setPagina(1) }
  function limpiarFiltros() {
    setFiltroProveedorId('')
    setFiltroEstados([])
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
    setPagina(1)
  }

  // CONTRATO_TABLA_COMPRAS.md, sección 3: el <Select> "Ordenar por" desaparece -- su lógica pasa a
  // las cabeceras clicables. Única columna ordenable (Fecha), mismo ciclo de 3 estados que
  // AlbaranesVenta.jsx/Pagos.jsx (desc -> asc -> sin orden).
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
  const [totalFacturas, setTotalFacturas] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalFacturas / PAGINA_TAMANO))

  async function cargarDatos() {
    setCargando(true)

    // CONTRATO_PAGOS_COMPRA.md sección 4.4/paso 3: se consulta facturas_compra_con_saldo (paso 2,
    // ya aplicada) en vez de la tabla cruda -- expone saldo_pendiente/estado_pago ya resueltos en
    // servidor, necesarios para el badge y para decidir si el icono de "Registrar pago" aparece.
    // PostgREST resuelve los mismos embeds a través de la vista que a través de la tabla (mismo
    // criterio ya verificado para facturas_venta_con_saldo).
    //
    // CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 3: a diferencia de FacturasVenta.jsx (que
    // necesita un precómputo de ids porque su vista no expone estado_pago como columna), aquí
    // basta un .in('estado_pago', ...) directo -- facturas_compra_con_saldo ya resuelve estado_pago
    // en servidor (ver 20261003_vista_facturas_compra_con_saldo.sql), sin necesitar una consulta
    // aparte para clasificar.
    let facturasQuery = supabase
      .from('facturas_compra_con_saldo')
      .select('*, proveedores(nombre_comercial), factura_compra_albaran(albaranes_compra(id, numero_albaran, fecha))', { count: 'exact' })

    if (filtroProveedorId) facturasQuery = facturasQuery.eq('proveedor_id', filtroProveedorId)
    if (filtroEstados.length > 0) facturasQuery = facturasQuery.in('estado_pago', filtroEstados)
    if (filtroFechaDesde) facturasQuery = facturasQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) facturasQuery = facturasQuery.lte('fecha', filtroFechaHasta)

    // CONTRATO_TABLA_COMPRAS.md, sección 3/6: el mecanismo de datos no cambia -- sigue siendo un
    // único .order() server-side, ahora disparado por cambiarOrden() en la cabecera en vez del
    // <Select>. Sin prioridad_grupo: a diferencia de FacturasVenta.jsx, esta pantalla nunca agrupó
    // por estado antes de este cambio, y el contrato no pide introducirlo ahora.
    facturasQuery = orden.columna
      ? facturasQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : facturasQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id, mismo motivo que en Pedidos/Albaranes de compra.
    facturasQuery = facturasQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    facturasQuery = facturasQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resFacturas, resProveedores] = await Promise.all([
      facturasQuery,
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resFacturas.error) console.error(resFacturas.error)
    else {
      setFacturas(resFacturas.data || [])
      setTotalFacturas(resFacturas.count ?? 0)
    }

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data || [])

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroProveedorId, filtroEstados, filtroFechaDesde, filtroFechaHasta])

  async function alGuardarFactura(idFactura) {
    setModoDrawer(null)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idFactura)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // CONTRATO_PAGOS_COMPRA.md sección 2.1: anulación en vez de borrado físico -- requisito previo
  // indispensable ahora que pago_aplicacion puede apuntar a una factura de compra (paso 3): un
  // DELETE físico dejaría el historial de pagos huérfano, y de hecho ya falla con un error de FK
  // real si la factura tiene pagos aplicados (confirmado en el paso 2 de este contrato). Mismo
  // patrón que handleAnular() en FacturasVenta.jsx -- sin edición, sin borrado físico, solo
  // apagado simple con rastro de auditoría.
  async function handleAnular(id) {
    if (!confirm(t('facturas_compra:alertas.confirmar_anular'))) return

    const { error } = await supabase.from('facturas_compra').update({ anulada: true }).eq('id', id)
    if (error) {
      alert(t('facturas_compra:alertas.error_anular', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.anulado'))
    if (modoDrawer !== null && typeof modoDrawer === 'object' && modoDrawer.id === id) setModoDrawer(null)
    cargarDatos()
  }

  function alGuardarPago() {
    setPagoDrawer(null)
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('facturas_compra:titulo')} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> {t('facturas_compra:card_nuevo_titulo')}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-surface border border-border rounded-card">
        <Field label={t('facturas_compra:filtros.proveedor')} className="w-48">
          <Select value={filtroProveedorId} onChange={(e) => cambiarFiltroProveedor(e.target.value)}>
            <option value="">{t('common:actions.all')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('facturas_compra:filtros.estado')} className="w-56">
          <MultiSelect options={ESTADO_FILTRO_OPCIONES} selected={filtroEstados} onChange={cambiarFiltroEstados} placeholder={t('common:actions.all')} />
        </Field>
        <Field label={t('facturas_compra:filtros.desde')} className="w-40">
          <DateInput value={filtroFechaDesde} onChange={cambiarFiltroFechaDesde} />
        </Field>
        <Field label={t('facturas_compra:filtros.hasta')} className="w-40">
          <DateInput value={filtroFechaHasta} onChange={cambiarFiltroFechaHasta} />
        </Field>
        {hayFiltrosActivos && (
          <Button type="button" variant="secondary" size="sm" onClick={limpiarFiltros}>{t('facturas_compra:filtros.limpiar_filtros')}</Button>
        )}
      </div>

      {cargando ? (
        <LoadingState />
      ) : facturas.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? t('facturas_compra:sin_facturas_filtro') : t('facturas_compra:sin_facturas')}
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
                      {t('facturas_compra:tabla.fecha')} {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('facturas_compra:tabla.numero')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('facturas_compra:tabla.proveedor')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('facturas_compra:tabla.estado')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('facturas_compra:tabla.total')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('facturas_compra:tabla.codigo_interno')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('facturas_compra:tabla.acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => {
                  // CONTRATO_PAGOS_COMPRA.md sección 4.4: saldo_pendiente/estado_pago ya llegan
                  // calculados desde facturas_compra_con_saldo (paso 2) -- NULL para anulada y
                  // para sin_total, estado_pago es lo que distingue cuál de los dos motivos es.
                  const saldo = f.saldo_pendiente != null ? Number(f.saldo_pendiente) : null
                  const tieneSaldoPendiente = saldo != null && saldo > EPSILON
                  const expandido = filaExpandidaId === f.id
                  return (
                    <Fragment key={f.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(f.id, el); else filaRefs.current.delete(f.id) }}
                        className={`border-b border-border-subtle hover:bg-primary-50/40 cursor-pointer ${f.anulada ? 'opacity-60 bg-surface-sunken' : ''}`}
                        onClick={() => toggleExpandido(f.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-ink-faint hover:text-ink-body">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-body">{formatFecha(f.fecha)}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink">{f.numero_factura || t('common:sin_numero')}</td>
                        <td className={`px-3 py-3 font-medium text-ink ${f.anulada ? 'line-through' : ''}`}>
                          {f.proveedores?.nombre_comercial ?? t('compras_comun:sin_proveedor')}
                        </td>
                        <td className="px-3 py-3">
                          <Badge color={ESTADO_PAGO_BADGE[f.estado_pago]}>{t(`enums:estado_pago.${f.estado_pago}`)}</Badge>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-ink-body">
                          {f.total != null ? formatMoneda(f.total, negocio?.moneda) : '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-ink-faint">{f.codigo_interno || '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            {tieneSaldoPendiente && (
                              <LinkAction tone="green" onClick={() => setPagoDrawer({ proveedorId: f.proveedor_id, documento: { tipo: 'factura', id: f.id, saldo } })}>
                                {t('compras_comun:tooltip_registrar_pago')}
                              </LinkAction>
                            )}
                            {!f.anulada && (
                              <>
                                <LinkAction tone="blue" onClick={() => setModoDrawer(f)}>{t('facturas_compra:editar')}</LinkAction>
                                <LinkAction tone="red" onClick={() => handleAnular(f.id)}>{t('facturas_compra:anular')}</LinkAction>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-canvas/60 px-3 py-3 text-sm text-ink-body">
                                <span className="font-medium">{t('facturas_compra:albaranes_incluidos')}</span>
                                {f.factura_compra_albaran.length === 0
                                  ? '—'
                                  : f.factura_compra_albaran
                                      .map((rel) => `${rel.albaranes_compra?.numero_albaran || t('common:sin_numero')} (${formatFecha(rel.albaranes_compra?.fecha)})`)
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
          <p className="text-xs text-ink-faint">
            {t('facturas_compra:factura_pagina_count', { count: totalFacturas, pagina, total: totalPaginas })}
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
        title={modoDrawer !== null && typeof modoDrawer === 'object' ? t('facturas_compra:card_editar_titulo') : t('facturas_compra:card_nuevo_titulo')}
        anchoClase="max-w-lg"
      >
        {modoDrawer !== null && (
          <FacturaCompraForm
            factura={typeof modoDrawer === 'object' ? modoDrawer : null}
            proveedores={proveedores}
            onGuardado={alGuardarFactura}
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

export default FacturasCompra
