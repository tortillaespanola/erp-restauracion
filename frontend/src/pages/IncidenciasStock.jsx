import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad } from '../lib/formatCantidad'
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, Field, Input, DateInput, Select, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer } from '../components/ui'

const PAGE_SIZE = 20

// CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte A: los 4 tipos existentes (ver
// 20261023_vista_incidencias_stock.sql) y su tabla base -- necesaria para saber dónde hacer el
// UPDATE de `estado` al marcar como revisada, igual que AjustesStock.jsx resuelve la tabla para
// borrar (mismo patrón, no una RPC nueva).
const TIPOS = ['stock_articulo', 'stock_semielaborado', 'stock_producto_final', 'reparto_pedido']
const TABLA_POR_TIPO = {
  stock_articulo: 'incidencias_stock_articulo',
  stock_semielaborado: 'incidencias_stock_semielaborado',
  stock_producto_final: 'incidencias_stock_producto_final',
  reparto_pedido: 'incidencias_reparto_pedido',
}
const ESTADOS = ['pendiente', 'regularizado', 'ignorado']
const ESTADO_COLOR = { pendiente: 'amber', regularizado: 'green', ignorado: 'gray' }

function claveFila(i) {
  return `${i.tipo}-${i.id}`
}

function IncidenciasStock() {
  const { t } = useTranslation(['common', 'enums', 'incidencias'])
  const [incidencias, setIncidencias] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [seleccionadas, setSeleccionadas] = useState(new Set())
  const [actualizando, setActualizando] = useState(false)
  const [drawerIncidencia, setDrawerIncidencia] = useState(null)

  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  // Por defecto solo "pendiente" -- es lo accionable; regularizadas/ignoradas quedan a un filtro
  // de distancia, igual que un histórico ya resuelto no debería ser el caso por defecto.
  const [filtroEstado, setFiltroEstado] = useState('pendiente')
  const [buscarItem, setBuscarItem] = useState('')

  async function cargarIncidencias() {
    setCargando(true)
    let query = supabase.from('vista_incidencias_stock').select('*', { count: 'exact' }).order('detectada_en', { ascending: false })
    if (fechaDesde) query = query.gte('detectada_en', fechaDesde)
    if (fechaHasta) query = query.lte('detectada_en', `${fechaHasta}T23:59:59`)
    if (filtroTipo) query = query.eq('tipo', filtroTipo)
    if (filtroEstado) query = query.eq('estado', filtroEstado)
    if (buscarItem.trim()) query = query.ilike('item_nombre', `%${buscarItem.trim()}%`)

    const desde = pagina * PAGE_SIZE
    const { data, error, count } = await query.range(desde, desde + PAGE_SIZE - 1)
    if (error) {
      // Mismo criterio que AjustesStock.jsx: un error de permisos no debe disfrazarse de "sin
      // resultados" -- ver comentario en 20261023_vista_incidencias_stock.sql sobre el GRANT.
      console.error(error)
      setErrorCarga(error.message)
      setIncidencias([])
      setTotal(0)
      setCargando(false)
      return
    }
    setErrorCarga(null)
    setIncidencias(data || [])
    setTotal(count || 0)
    setSeleccionadas(new Set())
    setCargando(false)
  }

  useEffect(() => {
    cargarIncidencias()
  }, [pagina, fechaDesde, fechaHasta, filtroTipo, filtroEstado, buscarItem])

  function conFiltro(setter) {
    return (valor) => { setPagina(0); setter(valor) }
  }
  const handleFechaDesde = conFiltro(setFechaDesde)
  const handleFechaHasta = conFiltro(setFechaHasta)
  const handleFiltroTipo = conFiltro(setFiltroTipo)
  const handleFiltroEstado = conFiltro(setFiltroEstado)
  const handleBuscarItem = conFiltro(setBuscarItem)

  function toggleSeleccion(clave) {
    setSeleccionadas((prev) => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  function toggleSeleccionTodas() {
    setSeleccionadas((prev) => (prev.size === incidencias.length ? new Set() : new Set(incidencias.map(claveFila))))
  }

  // No es una vista actualizable (UNION ALL de 4 tablas, ver la propia vista) -- se agrupa por
  // tabla base según `tipo` y se hace un UPDATE por tabla, protegido por las mismas políticas RLS
  // que ya tienen las 4 tablas.
  async function marcarComo(nuevoEstado, filas) {
    if (filas.length === 0) return
    setActualizando(true)
    const idsPorTabla = new Map()
    for (const f of filas) {
      const tabla = TABLA_POR_TIPO[f.tipo]
      if (!idsPorTabla.has(tabla)) idsPorTabla.set(tabla, [])
      idsPorTabla.get(tabla).push(f.id)
    }
    for (const [tabla, ids] of idsPorTabla) {
      const { error } = await supabase.from(tabla).update({ estado: nuevoEstado }).in('id', ids)
      if (error) {
        setActualizando(false)
        alert(t('incidencias:alertas.error_actualizar', { mensaje: error.message }))
        return
      }
    }
    setActualizando(false)
    toast.success(t('common:feedback.guardado'))
    setDrawerIncidencia(null)
    cargarIncidencias()
  }

  function marcarSeleccionadasComo(nuevoEstado) {
    const filas = incidencias.filter((i) => seleccionadas.has(claveFila(i)))
    marcarComo(nuevoEstado, filas)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader title={t('incidencias:titulo')} subtitle={t('incidencias:subtitulo')} />

      <Card className="mb-6">
        <CardHeader title={t('common:listado_titulo')} />
        <CardBody className="flex flex-wrap gap-3">
          <Field label={t('incidencias:filtros.desde')} className="w-40">
            <DateInput value={fechaDesde} onChange={handleFechaDesde} isClearable />
          </Field>
          <Field label={t('incidencias:filtros.hasta')} className="w-40">
            <DateInput value={fechaHasta} onChange={handleFechaHasta} isClearable />
          </Field>
          <Field label={t('incidencias:filtros.tipo')} className="w-48">
            <Select value={filtroTipo} onChange={(e) => handleFiltroTipo(e.target.value)}>
              <option value="">{t('common:actions.all')}</option>
              {TIPOS.map((tipo) => (
                <option key={tipo} value={tipo}>{t(`enums:tipo_incidencia.${tipo}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('incidencias:filtros.estado')} className="w-40">
            <Select value={filtroEstado} onChange={(e) => handleFiltroEstado(e.target.value)}>
              <option value="">{t('common:actions.all')}</option>
              {ESTADOS.map((estado) => (
                <option key={estado} value={estado}>{t(`enums:estado_incidencia.${estado}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('incidencias:filtros.item')} className="w-56">
            <Input type="text" placeholder={t('incidencias:buscar_por_nombre_placeholder')} value={buscarItem} onChange={(e) => handleBuscarItem(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      {seleccionadas.size > 0 && (
        <Card className="mb-3">
          <CardBody className="flex items-center justify-between py-3">
            <span className="text-sm text-gray-600">
              {t('incidencias:seleccionadas', { count: seleccionadas.size })}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={actualizando} onClick={() => marcarSeleccionadasComo('ignorado')}>
                {t('incidencias:marcar_ignoradas')}
              </Button>
              <Button size="sm" disabled={actualizando} onClick={() => marcarSeleccionadasComo('regularizado')}>
                {t('incidencias:marcar_regularizadas')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {cargando ? (
        <LoadingState />
      ) : errorCarga ? (
        <Card><p className="text-sm text-red-600 py-6 text-center">{t('incidencias:error_cargar', { mensaje: errorCarga })}</p></Card>
      ) : incidencias.length === 0 ? (
        <Card><EmptyState>{t('incidencias:sin_incidencias_filtro')}</EmptyState></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <Thead>
                <Th className="w-8">
                  <input type="checkbox" checked={seleccionadas.size === incidencias.length} onChange={toggleSeleccionTodas} />
                </Th>
                <Th>{t('incidencias:tabla.fecha')}</Th>
                <Th>{t('incidencias:tabla.tipo')}</Th>
                <Th>{t('incidencias:tabla.item')}</Th>
                <Th>{t('incidencias:tabla.referencia')}</Th>
                <Th>{t('incidencias:tabla.cantidad')}</Th>
                <Th>{t('incidencias:tabla.motivo')}</Th>
                <Th>{t('incidencias:tabla.estado')}</Th>
              </Thead>
              <tbody className="divide-y divide-gray-100">
                {incidencias.map((i) => {
                  const clave = claveFila(i)
                  return (
                    <tr key={clave} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setDrawerIncidencia(i)}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={seleccionadas.has(clave)} onChange={() => toggleSeleccion(clave)} />
                      </Td>
                      <Td className="text-gray-500 whitespace-nowrap">{formatFecha(i.detectada_en)}</Td>
                      <Td className="text-gray-500">{t(`enums:tipo_incidencia.${i.tipo}`)}</Td>
                      <Td className="font-medium">{i.item_nombre}</Td>
                      <Td className="text-gray-500 font-mono text-xs">{i.referencia}</Td>
                      <Td className={i.cantidad != null && Number(i.cantidad) < 0 ? 'text-red-600' : 'text-gray-500'}>
                        {i.cantidad != null ? `${formatCantidad(i.cantidad, i.item_unidad)} ${i.item_unidad || ''}` : '—'}
                      </Td>
                      <Td className="text-gray-500">{t(`enums:motivo_incidencia.${i.motivo}`, { defaultValue: i.motivo })}</Td>
                      <Td><Badge color={ESTADO_COLOR[i.estado]}>{t(`enums:estado_incidencia.${i.estado}`)}</Badge></Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </Card>

          <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
            <span>{t('incidencias:incidencia_count', { count: total })}</span>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>{t('common:actions.previous')}</Button>
              <span>{t('incidencias:pagina_de', { pagina: pagina + 1, total: totalPaginas })}</span>
              <Button variant="secondary" size="sm" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>{t('common:actions.next')}</Button>
            </div>
          </div>
        </>
      )}

      <Drawer open={!!drawerIncidencia} onClose={() => setDrawerIncidencia(null)} title={t('incidencias:drawer_titulo')}>
        {drawerIncidencia && (
          <div className="flex flex-col gap-3 text-sm">
            <DrawerCampo label={t('incidencias:drawer.tipo')} valor={t(`enums:tipo_incidencia.${drawerIncidencia.tipo}`)} />
            <DrawerCampo label={t('incidencias:drawer.item')} valor={drawerIncidencia.item_nombre} />
            <DrawerCampo label={t('incidencias:drawer.referencia')} valor={drawerIncidencia.referencia} />
            <DrawerCampo
              label={t('incidencias:drawer.cantidad')}
              valor={drawerIncidencia.cantidad != null ? `${formatCantidad(drawerIncidencia.cantidad, drawerIncidencia.item_unidad)} ${drawerIncidencia.item_unidad || ''}` : '—'}
            />
            <DrawerCampo label={t('incidencias:drawer.motivo')} valor={t(`enums:motivo_incidencia.${drawerIncidencia.motivo}`, { defaultValue: drawerIncidencia.motivo })} />
            <DrawerCampo label={t('incidencias:drawer.detectada_en')} valor={formatFecha(drawerIncidencia.detectada_en)} />
            {drawerIncidencia.nota && <DrawerCampo label={t('incidencias:drawer.nota')} valor={drawerIncidencia.nota} />}
            <DrawerCampo label={t('incidencias:drawer.estado')} valor={<Badge color={ESTADO_COLOR[drawerIncidencia.estado]}>{t(`enums:estado_incidencia.${drawerIncidencia.estado}`)}</Badge>} />

            <div className="flex gap-2 mt-2">
              <Button variant="secondary" size="sm" disabled={actualizando} onClick={() => marcarComo('ignorado', [drawerIncidencia])}>
                {t('incidencias:marcar_ignorada')}
              </Button>
              <Button size="sm" disabled={actualizando} onClick={() => marcarComo('regularizado', [drawerIncidencia])}>
                {t('incidencias:marcar_regularizada')}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

function DrawerCampo({ label, valor }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-ink">{valor || '—'}</p>
    </div>
  )
}

export default IncidenciasStock
