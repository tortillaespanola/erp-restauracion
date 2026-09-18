import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad } from '../lib/formatCantidad'
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, LinkAction, Field, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer } from '../components/ui'
import AjusteStockForm from '../components/AjusteStockForm'
import ResolverRechazoForm from '../components/ResolverRechazoForm'

// CONTRATO_I18N.md, Fase 0: etiqueta resuelta con t('enums:tipo_ajuste.<clave>') -- ver
// enums.json. Antes TIPO_LABEL tenía el texto español fijo.
const PAGE_SIZE = 20

// La migración 20260907_i18n_idioma_moneda.sql separó motivo_categoria (solo producto_final,
// valor crudo del enum) de motivo (texto libre) en la vista -- antes venían ya concatenados y
// traducidos a español desde el propio SQL. Se recompone aquí, traduciendo solo la categoría.
function motivoMostrado(a, t) {
  if (!a.motivo_categoria) return a.motivo
  const categoria = t(`enums:motivo_categoria.${a.motivo_categoria}`, { defaultValue: a.motivo_categoria })
  return a.motivo ? `${categoria} — ${a.motivo}` : categoria
}

// CONTRATO_AJUSTE_RAPIDO_INVENTARIO.md, Parte B: esta pantalla deja de ser el punto de entrada
// para crear un ajuste (eso vive en el drawer, ver AjusteStockForm.jsx, disparado desde aquí y
// desde Inventario.jsx) y pasa a ser histórico de movimientos -- tabla filtrable y paginada sobre
// la vista historial_ajustes_stock, no una lista de artículos que crece sin límite.
function AjustesStock() {
  const { t } = useTranslation(['common', 'enums', 'ajustes_stock'])
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  // CONTRATO_PROPAGACION_RECHAZOS.md, Parte A: rechazo de cliente pendiente de resolver
  // (abono/reenvío/descarte), sea uno recién declarado en otra pantalla o uno más antiguo.
  const [rechazoAResolver, setRechazoAResolver] = useState(null)
  const [historial, setHistorial] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)

  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [buscarItem, setBuscarItem] = useState('')
  const [buscarMotivo, setBuscarMotivo] = useState('')
  // CONTRATO_AJUSTES_RECHAZO_CLIENTE.md, Fase 2: vista centralizada de rechazos de cliente sin
  // resolver -- complementa los badges por lote/producto (Producciones, AlbaranesVenta,
  // PedidosDelDia) con un filtro sobre el propio histórico, para no tener que recorrer pantalla
  // por pantalla buscando qué queda pendiente de abono/reenvío/descarte.
  const [soloPendientes, setSoloPendientes] = useState(false)

  async function cargarHistorial() {
    setCargando(true)
    let query = supabase.from('historial_ajustes_stock').select('*', { count: 'exact' }).order('fecha', { ascending: false })
    if (fechaDesde) query = query.gte('fecha', fechaDesde)
    if (fechaHasta) query = query.lte('fecha', fechaHasta)
    if (buscarItem.trim()) query = query.ilike('item_nombre', `%${buscarItem.trim()}%`)
    // Busca en motivo (texto libre) Y motivo_categoria (valor crudo del enum, solo producto_final)
    // -- desde que la migración de Fase 0 los separó en dos columnas, buscar solo en `motivo` dejaría
    // de encontrar ajustes de producto_final por su categoría (antes venía concatenada ahí mismo).
    if (buscarMotivo.trim()) {
      const termino = buscarMotivo.trim()
      query = query.or(`motivo.ilike.%${termino}%,motivo_categoria.ilike.%${termino}%`)
    }
    if (soloPendientes) query = query.eq('origen_rechazo', 'cliente').is('tipo_resolucion', null)

    const desde = pagina * PAGE_SIZE
    const { data, error, count } = await query.range(desde, desde + PAGE_SIZE - 1)
    if (error) {
      // No confundir "fallo al cargar" con "sin resultados" -- un 42501 de permisos u otro error
      // de Supabase no debe disfrazarse de "0 coincidencias" (ver diagnóstico: así pasó
      // desapercibido un GRANT que faltaba sobre la vista).
      console.error(error)
      setErrorCarga(error.message)
      setHistorial([])
      setTotal(0)
      setCargando(false)
      return
    }
    setErrorCarga(null)
    setHistorial(data || [])
    setTotal(count || 0)
    setCargando(false)
  }

  useEffect(() => {
    cargarHistorial()
  }, [pagina, fechaDesde, fechaHasta, buscarItem, buscarMotivo, soloPendientes])

  // Cualquier cambio de filtro vuelve a la página 1 -- si no, se puede quedar "atascado" en una
  // página que ya no existe para el nuevo filtro (ej. filtrar y quedarse en la página 3 de 1).
  function conFiltro(setter) {
    return (valor) => { setPagina(0); setter(valor) }
  }
  const handleFechaDesde = conFiltro(setFechaDesde)
  const handleFechaHasta = conFiltro(setFechaHasta)
  const handleBuscarItem = conFiltro(setBuscarItem)
  const handleBuscarMotivo = conFiltro(setBuscarMotivo)
  const handleSoloPendientes = conFiltro(setSoloPendientes)

  async function handleBorrar(a) {
    if (!confirm(t('ajustes_stock:alertas.confirmar_borrar'))) return

    const tabla = a.tipo === 'articulo' ? 'ajustes_articulo' : a.tipo === 'semielaborado' ? 'ajustes_semielaborado' : 'ajustes_producto_final'
    const { error } = await supabase.from(tabla).delete().eq('id', a.id)
    if (error) {
      alert(t('ajustes_stock:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    cargarHistorial()
  }

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title={t('ajustes_stock:titulo')}
        subtitle={t('ajustes_stock:subtitulo')}
      />

      <Card className="mb-6">
        <CardHeader title={t('ajustes_stock:movimientos_titulo')} action={<Button onClick={() => setDrawerAbierto(true)}>{t('ajustes_stock:nuevo_ajuste')}</Button>} />
        <CardBody className="flex flex-wrap gap-3">
          <Field label={t('ajustes_stock:filtros.desde')} className="w-40">
            <DateInput value={fechaDesde} onChange={handleFechaDesde} isClearable />
          </Field>
          <Field label={t('ajustes_stock:filtros.hasta')} className="w-40">
            <DateInput value={fechaHasta} onChange={handleFechaHasta} isClearable />
          </Field>
          <Field label={t('ajustes_stock:filtros.articulo_item')} className="w-56">
            <Input type="text" placeholder={t('ajustes_stock:buscar_por_nombre_placeholder')} value={buscarItem} onChange={(e) => handleBuscarItem(e.target.value)} />
          </Field>
          <Field label={t('ajustes_stock:filtros.motivo')} className="w-56">
            <Input type="text" placeholder={t('ajustes_stock:buscar_por_motivo_placeholder')} value={buscarMotivo} onChange={(e) => handleBuscarMotivo(e.target.value)} />
          </Field>
          <Field label={t('ajustes_stock:filtros.rechazos_pendientes')} className="w-56">
            <label className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 bg-white cursor-pointer">
              <input type="checkbox" checked={soloPendientes} onChange={(e) => handleSoloPendientes(e.target.checked)} />
              {t('ajustes_stock:filtros.solo_pendientes_resolver')}
            </label>
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : errorCarga ? (
        <Card><p className="text-sm text-red-600 py-6 text-center">{t('ajustes_stock:error_cargar_historico', { mensaje: errorCarga })}</p></Card>
      ) : historial.length === 0 ? (
        <Card><EmptyState>{t('ajustes_stock:sin_ajustes_filtro')}</EmptyState></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <Thead>
                <Th>{t('ajustes_stock:tabla.fecha')}</Th>
                <Th>{t('ajustes_stock:tabla.item')}</Th>
                <Th>{t('ajustes_stock:tabla.cantidad')}</Th>
                <Th>{t('ajustes_stock:tabla.motivo')}</Th>
                <Th>{t('ajustes_stock:tabla.usuario')}</Th>
                <Th></Th>
              </Thead>
              <tbody className="divide-y divide-gray-100">
                {historial.map((a) => (
                  <tr key={`${a.tipo}-${a.id}`} className="hover:bg-blue-50/40">
                    <Td className="text-gray-500">{formatFecha(a.fecha)}</Td>
                    <Td className="font-medium">{a.item_nombre} <span className="text-gray-400 text-xs font-normal">({t(`enums:tipo_ajuste.${a.tipo}`, { defaultValue: a.tipo })})</span></Td>
                    <Td className={`font-medium ${a.cantidad >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {a.cantidad >= 0 ? '+' : ''}{formatCantidad(a.cantidad, a.unidad)} {a.unidad}
                    </Td>
                    <Td className="text-gray-500">{motivoMostrado(a, t)}</Td>
                    <Td className="text-gray-500">{a.user_email || '—'}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* CONTRATO_PROPAGACION_RECHAZOS.md, Parte A: solo los rechazos de cliente
                            (origen_rechazo='cliente', siempre tipo='producto_final' -- ver migración)
                            tienen resolución; ya resuelto muestra el desenlace en vez de la acción. */}
                        {a.origen_rechazo === 'cliente' && (
                          a.tipo_resolucion ? (
                            <Badge color="gray">{t(`enums:tipo_resolucion.${a.tipo_resolucion}`, { defaultValue: a.tipo_resolucion })}</Badge>
                          ) : (
                            <LinkAction tone="amber" onClick={() => setRechazoAResolver(a)} className="text-xs">{t('ajustes_stock:resolver')}</LinkAction>
                          )
                        )}
                        <LinkAction tone="red" onClick={() => handleBorrar(a)} className="text-xs">{t('ajustes_stock:borrar')}</LinkAction>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
            <span>{t('ajustes_stock:movimiento_count', { count: total })}</span>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>{t('common:actions.previous')}</Button>
              <span>{t('ajustes_stock:pagina_de', { pagina: pagina + 1, total: totalPaginas })}</span>
              <Button variant="secondary" size="sm" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>{t('common:actions.next')}</Button>
            </div>
          </div>
        </>
      )}

      <Drawer open={drawerAbierto} onClose={() => setDrawerAbierto(false)} title={t('ajustes_stock:drawer_nuevo_ajuste_titulo')}>
        <AjusteStockForm
          onCancelar={() => setDrawerAbierto(false)}
          onGuardado={() => {
            setDrawerAbierto(false)
            setPagina(0)
            cargarHistorial()
          }}
        />
      </Drawer>

      <Drawer open={!!rechazoAResolver} onClose={() => setRechazoAResolver(null)} title={t('ajustes_stock:drawer_resolver_rechazo_titulo')}>
        {rechazoAResolver && (
          <ResolverRechazoForm
            ajuste={rechazoAResolver}
            onOmitir={() => setRechazoAResolver(null)}
            onResuelto={() => {
              setRechazoAResolver(null)
              cargarHistorial()
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

export default AjustesStock
