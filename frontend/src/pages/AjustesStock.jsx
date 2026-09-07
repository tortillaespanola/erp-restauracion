import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad } from '../lib/formatCantidad'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer } from '../components/ui'
import AjusteStockForm from '../components/AjusteStockForm'

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
  const { t } = useTranslation(['common', 'enums'])
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [historial, setHistorial] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)

  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [buscarItem, setBuscarItem] = useState('')
  const [buscarMotivo, setBuscarMotivo] = useState('')

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
  }, [pagina, fechaDesde, fechaHasta, buscarItem, buscarMotivo])

  // Cualquier cambio de filtro vuelve a la página 1 -- si no, se puede quedar "atascado" en una
  // página que ya no existe para el nuevo filtro (ej. filtrar y quedarse en la página 3 de 1).
  function conFiltro(setter) {
    return (valor) => { setPagina(0); setter(valor) }
  }
  const handleFechaDesde = conFiltro(setFechaDesde)
  const handleFechaHasta = conFiltro(setFechaHasta)
  const handleBuscarItem = conFiltro(setBuscarItem)
  const handleBuscarMotivo = conFiltro(setBuscarMotivo)

  async function handleBorrar(a) {
    if (!confirm('¿Seguro que quieres eliminar este ajuste? El stock volverá a su valor anterior.')) return

    const tabla = a.tipo === 'articulo' ? 'ajustes_articulo' : a.tipo === 'semielaborado' ? 'ajustes_semielaborado' : 'ajustes_producto_final'
    const { error } = await supabase.from(tabla).delete().eq('id', a.id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarHistorial()
  }

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title="Ajustes de stock"
        subtitle="Histórico de correcciones de stock por mermas, caducidad, roturas o errores de pesaje."
      />

      <Card className="mb-6">
        <CardHeader title="Movimientos" action={<Button onClick={() => setDrawerAbierto(true)}>+ Nuevo ajuste</Button>} />
        <CardBody className="flex flex-wrap gap-3">
          <Field label="Desde" className="w-40">
            <DateInput value={fechaDesde} onChange={handleFechaDesde} isClearable />
          </Field>
          <Field label="Hasta" className="w-40">
            <DateInput value={fechaHasta} onChange={handleFechaHasta} isClearable />
          </Field>
          <Field label="Artículo / ítem" className="w-56">
            <Input type="text" placeholder="Buscar por nombre..." value={buscarItem} onChange={(e) => handleBuscarItem(e.target.value)} />
          </Field>
          <Field label="Motivo" className="w-56">
            <Input type="text" placeholder="Buscar por motivo..." value={buscarMotivo} onChange={(e) => handleBuscarMotivo(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : errorCarga ? (
        <Card><p className="text-sm text-red-600 py-6 text-center">Error al cargar el histórico: {errorCarga}</p></Card>
      ) : historial.length === 0 ? (
        <Card><EmptyState>No hay ajustes que coincidan con los filtros.</EmptyState></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <Thead>
                <Th>Fecha</Th>
                <Th>Ítem</Th>
                <Th>Cantidad</Th>
                <Th>Motivo</Th>
                <Th>Usuario</Th>
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
                      <LinkAction tone="red" onClick={() => handleBorrar(a)} className="text-xs">Borrar</LinkAction>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
            <span>{total} movimiento{total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
              <span>Página {pagina + 1} de {totalPaginas}</span>
              <Button variant="secondary" size="sm" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        </>
      )}

      <Drawer open={drawerAbierto} onClose={() => setDrawerAbierto(false)} title="Nuevo ajuste de stock">
        <AjusteStockForm
          onCancelar={() => setDrawerAbierto(false)}
          onGuardado={() => {
            setDrawerAbierto(false)
            setPagina(0)
            cargarHistorial()
          }}
        />
      </Drawer>
    </div>
  )
}

export default AjustesStock
