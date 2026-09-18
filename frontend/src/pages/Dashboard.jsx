// dashboard-flowbase-spec.md: primer Dashboard principal de FlowBase -- "centro de comando", no
// una colección de gráficos. Alcance real implementado (sección 13, "Recommended MVP" del propio
// contrato): 4 KPI Cards (Tier 1), Centro de Excepciones (los 4 tipos catalogados en la sección
// 8, más completos que el mínimo de 3 de la sección 13 porque salen del mismo dato ya cargado) y
// Acciones Rápidas. Deliberadamente FUERA de esta primera versión (contrato, sección 13): Tier 2
// (grid de KPIs secundarios), sparklines/gráficos de tendencia histórica (el hueco de agosto en
// AlpenWerk los ensucia sin aportar nada hoy) y cualquier KPI de merma/BOM que el propio contrato
// marca como no soportado por los datos actuales.
//
// Sin capa de servicios (igual que el resto del proyecto): esta pantalla llama a supabase.from()
// directamente. Reutiliza vistas/RPCs ya existentes en vez de reinventar fórmulas (contrato,
// sección 14.2): facturas_venta_con_saldo para AR, stock_lotes_producto_final para stock
// negativo, historial_ajustes_stock para rechazos de cliente pendientes (misma query que
// BadgeRechazoPendiente.jsx).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  IconClipboardList, IconFileDollar, IconPlayerPlay, IconClipboardCheck,
  IconPlus, IconStack2, IconTools, IconRefresh, IconAlertTriangle,
} from '@tabler/icons-react'
import { supabase } from '../lib/supabase'
import { useNegocio } from '../context/useNegocio'
import { useReferenceDate } from '../hooks/useReferenceDate'
import { formatMoneda, formatCantidad } from '../lib/formatCantidad'
import { formatFecha } from '../lib/formatFecha'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Badge, Field, DateInput, EmptyState, LoadingState } from '../components/ui'

const BARRA_ESTADO = {
  critical: 'bg-danger-600',
  warning: 'bg-warning-600',
  ok: 'bg-success-600',
  neutral: 'bg-border-strong',
}

const ICONO_ESTADO = {
  critical: 'bg-danger-50 text-danger-600',
  warning: 'bg-warning-50 text-warning-600',
  ok: 'bg-success-50 text-success-600',
  neutral: 'bg-surface-sunken text-ink-muted',
}

function KpiCard({ icon: Icon, title, value, description, status = 'neutral', onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full text-left bg-surface rounded-card border border-border shadow-card p-4 pl-5 flex flex-col gap-2 overflow-hidden hover:border-border-strong transition-colors"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${BARRA_ESTADO[status]}`} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-overline text-ink-subtle">{title}</span>
        <span className={`w-7 h-7 rounded-control flex items-center justify-center shrink-0 ${ICONO_ESTADO[status]}`}>
          <Icon size={15} stroke={1.75} />
        </span>
      </div>
      <span className="text-display font-mono tabular-nums text-ink">{value}</span>
      {description && <span className="text-micro text-ink-subtle">{description}</span>}
    </button>
  )
}

// Una fila por tipo de excepción (contrato, sección 8) -- lista sus instancias reales debajo del
// título en vez de solo un contador, porque con el volumen real de AlpenWerk (2-3 casos por
// tipo) mostrar solo "2" es menos útil que ver cuáles. Un único botón de acción por grupo (no por
// instancia): las pantallas destino no soportan filtrar por un lote/ajuste concreto vía URL hoy
// -- llevar "a un clic" de la pantalla correcta es honesto, fingir que aterriza ya filtrado en
// esa fila concreta no lo sería.
function GrupoExcepcion({ severidad, titulo, descripcion, items, accionLabel, onAccion }) {
  if (items.length === 0) return null
  const colorBadge = severidad === 'critical' ? 'red' : 'amber'
  return (
    <div className="py-3 border-b border-border-subtle last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0">
          <Badge color={colorBadge}>{items.length}</Badge>
          <div className="min-w-0">
            <p className="text-meta font-semibold text-ink-body">{titulo}</p>
            <p className="text-micro text-ink-subtle">{descripcion}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onAccion} className="shrink-0">
          {accionLabel}
        </Button>
      </div>
      <ul className="mt-2 ml-8 flex flex-col gap-0.5">
        {items.slice(0, 5).map((item, i) => (
          <li key={i} className="text-micro text-ink-muted truncate">— {item}</li>
        ))}
        {items.length > 5 && (
          <li className="text-micro text-ink-subtle">+{items.length - 5} más</li>
        )}
      </ul>
    </div>
  )
}

function restarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

const DIAS_ESTANCAMIENTO = 15

function Dashboard() {
  const navigate = useNavigate()
  const { t } = useTranslation(['dashboard', 'common'])
  const { negocio } = useNegocio()
  const { fechaReferencia, setFechaReferencia, esFechaReal, resetear } = useReferenceDate()

  const [cargando, setCargando] = useState(true)
  const [kpis, setKpis] = useState(null)
  const [excepciones, setExcepciones] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function cargar() {
      setCargando(true)
      try {
        const [
          resPedidosVenta,
          resFacturasVenta,
          resWipSemi,
          resWipPf,
          resPedidosCompra,
          resStockNegativoPf,
          resRechazosPendientes,
          resArticulos,
          resRecetaPf,
        ] = await Promise.all([
          supabase.from('pedidos_venta').select('id, estado, lineas_pedido_venta(cantidad, precio_unitario)'),
          supabase.from('facturas_venta_con_saldo').select('id, anulada, saldo_pendiente'),
          supabase.from('producciones_semielaborado').select('id, fecha, semielaborados(nombre)').eq('estado', 'abierta'),
          supabase.from('producciones_producto_final').select('id, fecha, productos_finales(nombre)').eq('estado', 'abierta'),
          supabase.from('pedidos_compra').select('id, fecha_entrega_prevista').in('estado', ['pendiente', 'parcial']),
          supabase.from('stock_lotes_producto_final').select('produccion_id, nombre, codigo_lote, stock_disponible').lt('stock_disponible', 0),
          supabase.from('historial_ajustes_stock').select('id, item_nombre, cantidad, fecha').eq('tipo', 'producto_final').eq('origen_rechazo', 'cliente').is('tipo_resolucion', null),
          supabase.from('articulos_compra').select('id, nombre, articulo_proveedor(proveedor_id)'),
          supabase.from('receta_producto_final').select('articulo_id, productos_finales(nombre)').not('articulo_id', 'is', null),
        ])

        for (const r of [
          resPedidosVenta, resFacturasVenta, resWipSemi, resWipPf, resPedidosCompra,
          resStockNegativoPf, resRechazosPendientes, resArticulos, resRecetaPf,
        ]) {
          if (r.error) throw r.error
        }
        if (cancelado) return

        // Tier 1 -- KPI 1: cartera de ventas (pedidos vendidos, ni entregados ni facturados).
        const backlogCHF = (resPedidosVenta.data || [])
          .filter((p) => ['pendiente', 'en_produccion', 'parcial'].includes(p.estado))
          .reduce((sum, p) => sum + (p.lineas_pedido_venta || [])
            .reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario || 0), 0), 0)

        // KPI 2: cuentas por cobrar -- saldo_pendiente ya viene calculado por la vista, nunca se
        // recalcula aquí (mismo criterio que saldosVenta.js: un único sitio de verdad por fórmula).
        const openAR = (resFacturasVenta.data || [])
          .filter((f) => !f.anulada && Number(f.saldo_pendiente) > 0.005)
          .reduce((sum, f) => sum + Number(f.saldo_pendiente), 0)

        // KPI 3: producción en curso.
        const wipSemi = resWipSemi.data || []
        const wipPf = resWipPf.data || []
        const activeWip = wipSemi.length + wipPf.length

        // KPI 4: compras retrasadas -- comparación de string ISO, no Date, mismo criterio que el
        // resto del proyecto para fechas 'yyyy-mm-dd' (evita el desfase de huso horario que ya
        // documenta formatFecha.js para el caso inverso).
        const pedidosCompraAbiertos = resPedidosCompra.data || []
        const overduePOs = pedidosCompraAbiertos.filter(
          (p) => p.fecha_entrega_prevista && p.fecha_entrega_prevista < fechaReferencia
        )

        setKpis({ backlogCHF, openAR, activeWip, overduePOs })

        // Excepción A: stock negativo de producto final.
        const stockNegativo = (resStockNegativoPf.data || []).map(
          (l) => `${l.nombre} (${l.codigo_lote || `#${l.produccion_id}`}): ${formatCantidad(l.stock_disponible)}`
        )

        // Excepción B: rechazo de cliente sin resolver -- misma condición que BadgeRechazoPendiente.jsx.
        const rechazosPendientes = (resRechazosPendientes.data || []).map(
          (r) => `${r.item_nombre} — ${formatFecha(r.fecha)}`
        )

        // Excepción C: producción estancada (abierta hace más de 15 días).
        const fechaLimite = restarDias(fechaReferencia, DIAS_ESTANCAMIENTO)
        const estancadas = [
          ...wipSemi.map((p) => ({ fecha: p.fecha, nombre: p.semielaborados?.nombre || `#${p.id}` })),
          ...wipPf.map((p) => ({ fecha: p.fecha, nombre: p.productos_finales?.nombre || `#${p.id}` })),
        ]
          .filter((p) => p.fecha && p.fecha < fechaLimite)
          .map((p) => `${p.nombre} — abierta desde ${formatFecha(p.fecha)}`)

        // Excepción D: artículos de una fórmula de producto final sin proveedor asignado --
        // "crítico" porque hace falta para producir, no cualquiera de los artículos sin proveedor
        // del catálogo (ese universo más amplio, 40 artículos en AlpenWerk, no todos con receta
        // activa, queda fuera de esta alerta a propósito).
        const idsConProveedor = new Set(
          (resArticulos.data || []).filter((a) => (a.articulo_proveedor || []).length > 0).map((a) => a.id)
        )
        const nombreArticulo = new Map((resArticulos.data || []).map((a) => [a.id, a.nombre]))
        const bomSinProveedor = new Map() // articulo_id -> Set(nombre producto final)
        for (const linea of resRecetaPf.data || []) {
          if (linea.articulo_id == null || idsConProveedor.has(linea.articulo_id)) continue
          if (!bomSinProveedor.has(linea.articulo_id)) bomSinProveedor.set(linea.articulo_id, new Set())
          bomSinProveedor.get(linea.articulo_id).add(linea.productos_finales?.nombre || '—')
        }
        const bomSinProveedorItems = [...bomSinProveedor.entries()].map(
          ([articuloId, productos]) => `${nombreArticulo.get(articuloId) || `#${articuloId}`} → ${[...productos].join(', ')}`
        )

        setExcepciones({ stockNegativo, rechazosPendientes, estancadas, bomSinProveedorItems })
      } catch (err) {
        if (!cancelado) toast.error(err.message)
      } finally {
        if (!cancelado) setCargando(false)
      }
    }

    cargar()
    return () => { cancelado = true }
  }, [fechaReferencia])

  const moneda = negocio?.moneda || 'CHF'
  const hayExcepciones = excepciones && (
    excepciones.stockNegativo.length > 0 ||
    excepciones.rechazosPendientes.length > 0 ||
    excepciones.estancadas.length > 0 ||
    excepciones.bomSinProveedorItems.length > 0
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('dashboard:titulo')} subtitle={t('dashboard:subtitulo', { negocio: negocio?.nombre || '' })} />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <Field label={t('dashboard:fecha_referencia.label')} className="w-44">
            <DateInput value={fechaReferencia} onChange={setFechaReferencia} />
          </Field>
          {!esFechaReal && (
            <LinkAction tone="blue" onClick={resetear} className="mb-2.5 flex items-center gap-1">
              <IconRefresh size={13} /> {t('dashboard:fecha_referencia.resetear')}
            </LinkAction>
          )}
          <p className="text-micro text-ink-subtle mb-2.5">{t('dashboard:fecha_referencia.nota')}</p>
        </CardBody>
      </Card>

      {cargando || !kpis ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={IconClipboardList}
              title={t('dashboard:kpi.sales_backlog.titulo')}
              value={formatMoneda(kpis.backlogCHF, moneda)}
              description={t('dashboard:kpi.sales_backlog.descripcion')}
              status="neutral"
              onClick={() => navigate('/pedidos')}
            />
            <KpiCard
              icon={IconFileDollar}
              title={t('dashboard:kpi.open_ar.titulo')}
              value={formatMoneda(kpis.openAR, moneda)}
              description={t('dashboard:kpi.open_ar.descripcion')}
              status={kpis.openAR > 0.005 ? 'warning' : 'ok'}
              onClick={() => navigate('/facturas-venta')}
            />
            <KpiCard
              icon={IconPlayerPlay}
              title={t('dashboard:kpi.active_wip.titulo')}
              value={formatCantidad(kpis.activeWip, 'ud')}
              description={t('dashboard:kpi.active_wip.descripcion')}
              status="neutral"
              onClick={() => navigate('/producciones')}
            />
            <KpiCard
              icon={IconClipboardCheck}
              title={t('dashboard:kpi.overdue_pos.titulo')}
              value={formatCantidad(kpis.overduePOs.length, 'ud')}
              description={t('dashboard:kpi.overdue_pos.descripcion')}
              status={kpis.overduePOs.length > 0 ? 'critical' : 'ok'}
              onClick={() => navigate('/pedidos-compra')}
            />
          </div>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <IconAlertTriangle size={16} className="text-warning-600" />
                  {t('dashboard:exceptions.titulo')}
                </span>
              }
            />
            <CardBody>
              <p className="text-micro text-ink-subtle -mt-1 mb-1">{t('dashboard:exceptions.subtitulo')}</p>
              {!hayExcepciones ? (
                <EmptyState>{t('dashboard:exceptions.vacio')}</EmptyState>
              ) : (
                <div>
                  <GrupoExcepcion
                    severidad="critical"
                    titulo={t('dashboard:exceptions.stock_negativo.titulo')}
                    descripcion={t(
                      excepciones.stockNegativo.length === 1
                        ? 'dashboard:exceptions.stock_negativo.descripcion_one'
                        : 'dashboard:exceptions.stock_negativo.descripcion_other',
                      { count: excepciones.stockNegativo.length }
                    )}
                    items={excepciones.stockNegativo}
                    accionLabel={t('dashboard:exceptions.stock_negativo.accion')}
                    onAccion={() => navigate('/ajustes-stock')}
                  />
                  <GrupoExcepcion
                    severidad="warning"
                    titulo={t('dashboard:exceptions.rechazo_pendiente.titulo')}
                    descripcion={t(
                      excepciones.rechazosPendientes.length === 1
                        ? 'dashboard:exceptions.rechazo_pendiente.descripcion_one'
                        : 'dashboard:exceptions.rechazo_pendiente.descripcion_other',
                      { count: excepciones.rechazosPendientes.length }
                    )}
                    items={excepciones.rechazosPendientes}
                    accionLabel={t('dashboard:exceptions.rechazo_pendiente.accion')}
                    onAccion={() => navigate('/ajustes-stock')}
                  />
                  <GrupoExcepcion
                    severidad="warning"
                    titulo={t('dashboard:exceptions.produccion_estancada.titulo')}
                    descripcion={t(
                      excepciones.estancadas.length === 1
                        ? 'dashboard:exceptions.produccion_estancada.descripcion_one'
                        : 'dashboard:exceptions.produccion_estancada.descripcion_other',
                      { count: excepciones.estancadas.length }
                    )}
                    items={excepciones.estancadas}
                    accionLabel={t('dashboard:exceptions.produccion_estancada.accion')}
                    onAccion={() => navigate('/producciones')}
                  />
                  <GrupoExcepcion
                    severidad="warning"
                    titulo={t('dashboard:exceptions.bom_sin_proveedor.titulo')}
                    descripcion={t(
                      excepciones.bomSinProveedorItems.length === 1
                        ? 'dashboard:exceptions.bom_sin_proveedor.descripcion_one'
                        : 'dashboard:exceptions.bom_sin_proveedor.descripcion_other',
                      { count: excepciones.bomSinProveedorItems.length }
                    )}
                    items={excepciones.bomSinProveedorItems}
                    accionLabel={t('dashboard:exceptions.bom_sin_proveedor.accion')}
                    onAccion={() => navigate('/articulos')}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('dashboard:quick_actions.titulo')} />
            <CardBody className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => navigate('/pedidos')}>
                <IconPlus size={15} /> {t('dashboard:quick_actions.nueva_venta')}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/pedidos-del-dia')}>
                <IconStack2 size={15} /> {t('dashboard:quick_actions.produccion_dia')}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/pedidos-compra')}>
                <IconPlus size={15} /> {t('dashboard:quick_actions.nueva_compra')}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/ajustes-stock')}>
                <IconTools size={15} /> {t('dashboard:quick_actions.ajuste_stock')}
              </Button>
            </CardBody>
          </Card>

          <p className="text-micro text-ink-subtle">
            <span className="font-semibold">{t('dashboard:proximamente.titulo')}:</span> {t('dashboard:proximamente.texto')}
          </p>
        </>
      )}
    </div>
  )
}

export default Dashboard
