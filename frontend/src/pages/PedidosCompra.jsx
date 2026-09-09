import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import {
  IconPlus, IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconArrowsSort,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, LinkAction, Badge, EmptyState, LoadingState, Drawer, Field, Select, DateInput, MultiSelect } from '../components/ui'
import PedidoCompraForm from '../components/PedidoCompraForm'

const ESTADO_BADGE = {
  pendiente: 'gray',
  recibido: 'green',
  cancelado: 'red',
}

const ESTADOS_PEDIDO_COMPRA = ['pendiente', 'recibido', 'cancelado']

// CONTRATO_DRAWERS_COMPRAS.md, último punto (paginación/filtros/orden server-side): mismo tamaño
// de página que las tres pantallas de Venta (CONTRATO_FILTROS_VENTA.md).
const PAGINA_TAMANO = 20

// CONTRATO_TABLA_COMPRAS.md, sección 4 decisión 4: columna Progreso con fórmula propia, "X/Y
// líneas recibidas" -- sin barra de stock insuficiente ni nada de previsiones_distribucion_pf
// (conceptos de producción que no existen en Compras). Calculable sin ampliar el select() de
// cargarDatos(): entrada_material(cantidad) ya viene embebido por línea (mismo dato que ya usa
// handleEditar para el criterio de bloqueo).
function progresoPedido(p) {
  let recibidas = 0
  for (const linea of p.lineas_pedido_compra) {
    const recibido = (linea.entrada_material || []).reduce((sum, e) => sum + Number(e.cantidad), 0)
    if (recibido >= linea.cantidad) recibidas++
  }
  return { total: p.lineas_pedido_compra.length, recibidas }
}

function PedidosCompra() {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'pedidos_compra'])
  const ESTADO_FILTRO_OPCIONES = ESTADOS_PEDIDO_COMPRA.map((value) => ({ value, label: t(`enums:estado_pedido_compra.${value}`) }))

  const [pedidos, setPedidos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)

  // CONTRATO_DRAWERS_COMPRAS.md, paso 1: mismo patrón de 3 estados que Pedidos.jsx (venta) --
  // null = cerrado, 'nuevo' = alta, objeto pedido = edición precargada.
  const [modoDrawer, setModoDrawer] = useState(null)
  // Refs de la fila principal de cada pedido, indexadas por id -- para el scrollIntoView tras
  // guardar desde el drawer, mismo patrón que Pedidos.jsx.
  const filaRefs = useRef(new Map())

  // CONTRATO_TABLA_COMPRAS.md, sección 3: un único id expandido a nivel de pantalla (acordeón),
  // mismo patrón que las pantallas de Venta y que FacturasCompra.jsx (paso 1 de este contrato).
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)
  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // Sin lista de proveedores separada para el filtro (a diferencia de clientes en Venta, que
  // distingue activos/inactivos): proveedores no tiene columna `activo`, así que una única lista
  // sirve tanto para el filtro como para el formulario del drawer.
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

  // CONTRATO_TABLA_COMPRAS.md, sección 3/5: el <Select> "Ordenar por" desaparece -- su lógica pasa
  // a las cabeceras clicables. Dos columnas ordenables (Fecha, Entrega prevista), mismo ciclo de 3
  // estados y misma dirección inicial por columna que Pedidos.jsx (venta): Fecha empieza en
  // descendente (más reciente primero), Entrega prevista empieza en ascendente (más próxima primero).
  const [orden, setOrden] = useState({ columna: null, direccion: 'asc' })
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
    setPagina(1) // cambiar de orden con otra página abierta dejaría una página vacía o repetida
  }
  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  const [pagina, setPagina] = useState(1)
  const [totalPedidos, setTotalPedidos] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalPedidos / PAGINA_TAMANO))

  async function cargarDatos() {
    setCargando(true)

    let pedidosQuery = supabase
      .from('pedidos_compra')
      .select(`
        *,
        proveedores(nombre_comercial),
        lineas_pedido_compra(
          id, articulo_id, cantidad, precio_unitario,
          articulos_compra(nombre, unidad),
          entrada_material(cantidad)
        )
      `, { count: 'exact' })

    if (filtroProveedorId) pedidosQuery = pedidosQuery.eq('proveedor_id', filtroProveedorId)
    if (filtroEstados.length > 0) pedidosQuery = pedidosQuery.in('estado', filtroEstados)
    if (filtroFechaDesde) pedidosQuery = pedidosQuery.gte('fecha', filtroFechaDesde)
    if (filtroFechaHasta) pedidosQuery = pedidosQuery.lte('fecha', filtroFechaHasta)

    // CONTRATO_TABLA_COMPRAS.md, sección 3/6: el mecanismo de datos no cambia -- sigue siendo un
    // único .order() server-side, ahora disparado por cambiarOrden() en la cabecera en vez del
    // <Select>. Sin grupo_estado (CONTRATO_DRAWERS_COMPRAS.md sección 8: fuera de alcance) -- a
    // diferencia de Pedidos.jsx de venta, aquí el orden elegido es la única clave, sin
    // agrupamiento permanente. nullsFirst: false porque fecha_entrega_prevista es nullable.
    pedidosQuery = orden.columna
      ? pedidosQuery.order(orden.columna, { ascending: orden.direccion === 'asc', nullsFirst: false })
      : pedidosQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id: sin él, dos pedidos empatados en la columna de orden no tienen un
    // orden garantizado entre sí, lo que podría repetir o saltarse filas al paginar con .range().
    pedidosQuery = pedidosQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    pedidosQuery = pedidosQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resPedidos, resProveedores] = await Promise.all([
      pedidosQuery,
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resPedidos.error) console.error(resPedidos.error)
    else {
      setPedidos(resPedidos.data || [])
      setTotalPedidos(resPedidos.count ?? 0)
    }

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data || [])

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina, filtroProveedorId, filtroEstados, filtroFechaDesde, filtroFechaHasta])

  // Un pedido con alguna línea ya recibida (entrada_material asociada, aunque sea parcial) no se
  // puede editar -- mismo criterio de bloqueo "todo o nada" que handleEditar en Pedidos.jsx
  // (venta), resuelto aquí sin una query aparte porque entrada_material ya viene embebido por
  // línea en cargarDatos().
  function handleEditar(pedido) {
    const tieneRecibido = pedido.lineas_pedido_compra.some((l) => (l.entrada_material || []).length > 0)
    if (tieneRecibido) {
      alert(t('pedidos_compra:alertas.no_editable'))
      return
    }
    setModoDrawer(pedido)
  }

  // Tras guardar desde el drawer, cierra, refresca y -- si el pedido guardado sigue presente --
  // hace scroll hasta su fila. Mismo patrón que Pedidos.jsx/AlbaranesVenta.jsx.
  async function alGuardarPedido(idPedido) {
    setModoDrawer(null)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idPedido)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  async function handleCancelar(id) {
    if (!confirm(t('pedidos_compra:alertas.confirmar_cancelar'))) return
    const { error } = await supabase.from('pedidos_compra').update({ estado: 'cancelado' }).eq('id', id)
    if (error) {
      alert(t('pedidos_compra:alertas.error_cancelar', { mensaje: error.message }))
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('pedidos_compra:titulo')} subtitle={t('pedidos_compra:subtitulo')} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> {t('pedidos_compra:card_nuevo_titulo')}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
        <Field label={t('pedidos_compra:filtros.proveedor')} className="w-48">
          <Select value={filtroProveedorId} onChange={(e) => cambiarFiltroProveedor(e.target.value)}>
            <option value="">{t('common:actions.all')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('pedidos_compra:filtros.estado')} className="w-56">
          <MultiSelect options={ESTADO_FILTRO_OPCIONES} selected={filtroEstados} onChange={cambiarFiltroEstados} placeholder={t('common:actions.all')} />
        </Field>
        <Field label={t('pedidos_compra:filtros.desde')} className="w-40">
          <DateInput value={filtroFechaDesde} onChange={cambiarFiltroFechaDesde} />
        </Field>
        <Field label={t('pedidos_compra:filtros.hasta')} className="w-40">
          <DateInput value={filtroFechaHasta} onChange={cambiarFiltroFechaHasta} />
        </Field>
        {hayFiltrosActivos && (
          <Button type="button" variant="secondary" size="sm" onClick={limpiarFiltros}>{t('pedidos_compra:filtros.limpiar_filtros')}</Button>
        )}
      </div>

      {cargando ? (
        <LoadingState />
      ) : pedidos.length === 0 ? (
        <Card>
          <EmptyState>
            {hayFiltrosActivos ? t('pedidos_compra:sin_pedidos_filtro') : t('pedidos_compra:sin_pedidos')}
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
                      {t('pedidos_compra:tabla.fecha')} {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('pedidos_compra:tabla.proveedor')}</th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha_entrega_prevista')} className="flex items-center gap-1 hover:text-gray-600">
                      {t('pedidos_compra:tabla.entrega_prevista')} {iconoOrden('fecha_entrega_prevista')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('pedidos_compra:tabla.referencia_proveedor')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pedidos_compra:tabla.progreso')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pedidos_compra:tabla.estado')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('pedidos_compra:tabla.acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const expandido = filaExpandidaId === p.id
                  const puedeGestionar = p.estado !== 'recibido' && p.estado !== 'cancelado'
                  const { total, recibidas } = progresoPedido(p)
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
                          <div className="font-medium text-ink">{p.proveedores?.nombre_comercial ?? t('compras_comun:sin_proveedor')}</div>
                          {p.codigo_pedido && <div className="text-xs font-mono text-gray-400">{p.codigo_pedido}</div>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {p.fecha_entrega_prevista ? formatFecha(p.fecha_entrega_prevista) : '—'}
                        </td>
                        <td className="px-3 py-3 text-gray-600">{p.referencia_proveedor || '—'}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={recibidas === total && total > 0 ? 'text-green-600 font-medium' : 'text-gray-600'}>
                            {t('pedidos_compra:lineas_recibidas', { recibidas, total })}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Badge color={ESTADO_BADGE[p.estado] ?? 'gray'}>{t(`enums:estado_pedido_compra.${p.estado}`, { defaultValue: p.estado })}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            {puedeGestionar && (
                              <>
                                <LinkAction tone="blue" onClick={() => handleEditar(p)}>{t('pedidos_compra:editar')}</LinkAction>
                                <LinkAction tone="blue" onClick={() => navigate(`/albaranes-compra?pedido_compra_id=${p.id}`)}>
                                  {t('pedidos_compra:recibir_como_albaran')}
                                </LinkAction>
                                <LinkAction tone="red" onClick={() => handleCancelar(p.id)}>{t('common:actions.cancel')}</LinkAction>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3">
                                {p.notas && <p className="text-sm text-gray-500 italic mb-2">{p.notas}</p>}
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                      <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.articulo')}</th>
                                      <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.pedido')}</th>
                                      <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.recibido')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {p.lineas_pedido_compra.map((linea) => {
                                      const recibido = (linea.entrada_material || []).reduce((sum, e) => sum + Number(e.cantidad), 0)
                                      const completa = recibido >= linea.cantidad
                                      return (
                                        <tr key={linea.id}>
                                          <td className="py-1.5">{linea.articulos_compra?.nombre}</td>
                                          <td className="py-1.5">{linea.cantidad} {linea.articulos_compra?.unidad}</td>
                                          <td className={`py-1.5 ${completa ? 'text-green-600' : 'text-gray-500'}`}>{recibido} {linea.articulos_compra?.unidad}</td>
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
            {t('pedidos_compra:pedido_pagina_count', { count: totalPedidos, pagina, total: totalPaginas })}
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
        open={modoDrawer !== null}
        onClose={() => setModoDrawer(null)}
        title={modoDrawer !== null && typeof modoDrawer === 'object' ? t('pedidos_compra:card_editar_titulo') : t('pedidos_compra:card_nuevo_titulo')}
      >
        {modoDrawer !== null && (
          <PedidoCompraForm
            pedido={typeof modoDrawer === 'object' ? modoDrawer : null}
            proveedores={proveedores}
            onGuardado={alGuardarPedido}
            onCancelar={() => setModoDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default PedidosCompra
