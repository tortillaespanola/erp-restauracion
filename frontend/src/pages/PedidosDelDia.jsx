import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardBody, Field, Select, DateInput, Badge, Button, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

// Vista 1 de CONTRATO_VISTA_DINAMICA_PRODUCCION.md: necesidad real agregada de semielaborado,
// sumando todos los pedidos pendientes que lo requieran (directa o vía receta de producto final),
// reutilizando necesidades_pedidos() -- no se reimplementa la explosión de receta aquí.
function PedidosDelDia() {
  const navigate = useNavigate()

  const [semielaborados, setSemielaborados] = useState([])
  const [necesidades, setNecesidades] = useState([])
  const [stockPorSemi, setStockPorSemi] = useState(new Map())
  const [cargando, setCargando] = useState(true)

  const [semielaboradoFiltro, setSemielaboradoFiltro] = useState('')
  const [fechaMaxima, setFechaMaxima] = useState('')
  const [seleccionId, setSeleccionId] = useState('')

  async function cargarDatos() {
    setCargando(true)
    setSeleccionId('')

    const resSemis = await supabase.from('semielaborados').select('id, nombre, unidad').order('nombre')
    if (resSemis.error) console.error('Error cargando semielaborados:', resSemis.error)
    setSemielaborados(resSemis.data || [])

    // Pedidos pendientes de servir, acotados por la fecha máxima de entrega si se ha filtrado.
    let query = supabase.from('pedidos_venta').select('id').in('estado', ['pendiente', 'en_produccion'])
    if (fechaMaxima) query = query.lte('fecha_entrega_prevista', fechaMaxima)
    const resPedidos = await query
    if (resPedidos.error) console.error('Error cargando pedidos:', resPedidos.error)
    const pedidoIds = (resPedidos.data || []).map((p) => p.id)

    let necesidadesSemi = []
    if (pedidoIds.length > 0) {
      const { data, error } = await supabase.rpc('necesidades_pedidos', { p_pedido_ids: pedidoIds })
      if (error) console.error('Error calculando necesidades:', error)
      else necesidadesSemi = (data || []).filter((n) => n.nivel === 'semielaborado')
    }
    setNecesidades(necesidadesSemi)

    // Stock disponible actual, agregado por semielaborado a partir de stock_lotes_semielaborado
    // (suma de todos sus lotes cerrados) -- independiente del filtro de fecha, es el stock de hoy.
    const resLotes = await supabase.from('stock_lotes_semielaborado').select('semielaborado_id, stock_disponible')
    if (resLotes.error) console.error('Error cargando stock de lotes:', resLotes.error)
    const mapa = new Map()
    for (const l of resLotes.data || []) {
      mapa.set(l.semielaborado_id, (mapa.get(l.semielaborado_id) || 0) + Number(l.stock_disponible))
    }
    setStockPorSemi(mapa)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [fechaMaxima])

  const filas = useMemo(() => {
    return necesidades
      .filter((n) => !semielaboradoFiltro || String(n.item_id) === semielaboradoFiltro)
      .map((n) => {
        const necesidad = Number(n.cantidad_necesaria)
        const disponible = stockPorSemi.get(n.item_id) || 0
        return {
          id: n.item_id,
          nombre: n.nombre,
          unidad: n.unidad,
          necesidad,
          disponible,
          cubierto: disponible >= necesidad,
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [necesidades, stockPorSemi, semielaboradoFiltro])

  // Filtrar a un único semielaborado ya es, en la práctica, seleccionarlo -- se autoselecciona para
  // no obligar a un clic extra cuando ya no hay ambigüedad posible.
  useEffect(() => {
    if (filas.length === 1) setSeleccionId(String(filas[0].id))
  }, [filas])

  const seleccionado = filas.find((f) => String(f.id) === seleccionId)

  function handleProducir() {
    if (!seleccionado) return
    navigate(`/producciones?semielaborado_id=${seleccionado.id}&cantidad=${seleccionado.necesidad}`)
  }

  return (
    <div>
      <PageHeader
        title="Producciones del día"
        subtitle="Necesidad real de cada semielaborado, agregada sobre todos los pedidos pendientes que lo requieran."
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3 items-end">
          <Field label="Semielaborado" className="w-64">
            <Select
              value={semielaboradoFiltro}
              onChange={(e) => { setSemielaboradoFiltro(e.target.value); setSeleccionId('') }}
            >
              <option value="">Todos</option>
              {semielaborados.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha máxima de entrega" className="w-48">
            <DateInput value={fechaMaxima} onChange={setFechaMaxima} isClearable placeholderText="Sin límite" />
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : filas.length === 0 ? (
        <Card><EmptyState>No hay necesidad pendiente de ningún semielaborado en este rango.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden mb-6">
          <Table>
            <Thead>
              <Th></Th>
              <Th>Semielaborado</Th>
              <Th>Necesidad agregada</Th>
              <Th>Stock disponible</Th>
              <Th>Estado</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((f) => (
                <tr key={f.id} className="hover:bg-blue-50/40">
                  <Td>
                    <input
                      type="radio"
                      name="semielaborado-seleccionado"
                      checked={seleccionId === String(f.id)}
                      onChange={() => setSeleccionId(String(f.id))}
                    />
                  </Td>
                  <Td className="font-medium">{f.nombre}</Td>
                  <Td>{f.necesidad.toFixed(3)} {f.unidad}</Td>
                  <Td>{f.disponible.toFixed(3)} {f.unidad}</Td>
                  <Td>
                    <Badge color={f.cubierto ? 'green' : 'red'}>{f.cubierto ? 'Cubierto' : 'Falta stock'}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Button onClick={handleProducir} disabled={!seleccionado}>
        {seleccionado ? `Producir ${seleccionado.nombre}` : 'Producir'}
      </Button>
    </div>
  )
}

export default PedidosDelDia
