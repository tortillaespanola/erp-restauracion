import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconChefHat, IconCarrot } from '@tabler/icons-react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { validarStockReceta } from '../lib/validarStockReceta'
import { PageHeader, Card, CardBody, Field, Select, DateInput, Badge, Button, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

// Jerarquía hoja→raíz (CONTRATO_VISTA_DINAMICA_PRODUCCION.md): dado el conjunto pequeño de
// semielaborados ya presentes en el resultado, resuelve solo las relaciones semielaborado→
// semielaborado ENTRE MIEMBROS DE ESE MISMO CONJUNTO -- si A depende de un semielaborado que hoy no
// tiene necesidad pendiente (no está en `ids`), esa dependencia no cuenta para el orden (no bloquea
// nada real en esta tabla). No toca necesidades_pedidos() ni calcula profundidad global de receta.
// Solo aplica a la tabla de semielaborados -- los productos finales no dependen unos de otros
// (Tabla 2 usa orden alfabético simple, sin jerarquía).
async function calcularOrdenJerarquico(ids) {
  const profundidad = new Map(ids.map((id) => [id, 0]))
  if (ids.length === 0) return profundidad

  const { data } = await supabase
    .from('receta_semielaborado')
    .select('semielaborado_id, ingrediente_semielaborado_id')
    .in('semielaborado_id', ids)
    .not('ingrediente_semielaborado_id', 'is', null)

  const dependeDe = new Map(ids.map((id) => [id, []]))
  for (const fila of data || []) {
    if (ids.includes(fila.ingrediente_semielaborado_id)) {
      dependeDe.get(fila.semielaborado_id)?.push(fila.ingrediente_semielaborado_id)
    }
  }

  // CHECK no_auto_referencia en receta_semielaborado ya impide la autorreferencia directa, y
  // necesidades_pedidos() ya validó (con su propia guarda) que no hay ciclo real en el histórico que
  // llegó hasta aquí -- el `visitando` de abajo es solo una defensa extra para no colgar el render si
  // algún día apareciera un ciclo indirecto no cubierto por ese CHECK.
  function calcular(id, visitando) {
    if (visitando.has(id)) return 0
    const hijos = dependeDe.get(id) || []
    if (hijos.length === 0) return 0
    visitando.add(id)
    const nivel = 1 + Math.max(...hijos.map((h) => calcular(h, visitando)))
    visitando.delete(id)
    return nivel
  }
  for (const id of ids) profundidad.set(id, calcular(id, new Set()))

  return profundidad
}

function tooltipPedidos(pedidos) {
  if (pedidos.length === 0) return 'Ningún pedido pendiente en este rango lo requiere directamente en este momento.'
  return 'Pedidos que generan esta necesidad:\n' + pedidos
    .map((p) => `• ${p.codigo || `#${p.pedidoId}`} · ${p.cliente} · entrega ${p.fechaEntrega ? formatFecha(p.fechaEntrega) : 'sin fecha'}`)
    .join('\n')
}

function tooltipFaltantes(faltantes) {
  return faltantes
    .map((f) => `Falta ${(f.necesario - f.disponible).toFixed(3)} ${f.unidad} de ${f.nombre} (disponible: ${f.disponible.toFixed(3)} ${f.unidad})`)
    .join('\n')
}

// Agrega las filas de un nivel concreto ('semielaborado' | 'producto_final') a través de los
// resultados de necesidades_pedidos() ya obtenidos UNA VEZ POR PEDIDO -- ambos niveles vienen en la
// misma respuesta de cada llamada, así que reutilizar los mismos resultados para las dos tablas no
// cuesta ninguna llamada adicional.
function agregarPorNivel(resultadosPorPedido, nivel) {
  const necesidadesAgregadas = new Map()
  const pedidosPorItem = new Map()
  for (const { pedido, filas } of resultadosPorPedido) {
    for (const f of filas) {
      if (f.nivel !== nivel) continue
      const acc = necesidadesAgregadas.get(f.item_id) ?? { item_id: f.item_id, nombre: f.nombre, unidad: f.unidad, cantidad_necesaria: 0 }
      acc.cantidad_necesaria += Number(f.cantidad_necesaria)
      necesidadesAgregadas.set(f.item_id, acc)

      const lista = pedidosPorItem.get(f.item_id) ?? []
      lista.push({ pedidoId: pedido.id, codigo: pedido.codigo_pedido, cliente: pedido.clientes?.nombre ?? 'Sin cliente', fechaEntrega: pedido.fecha_entrega_prevista })
      pedidosPorItem.set(f.item_id, lista)
    }
  }
  return { necesidades: [...necesidadesAgregadas.values()], pedidosPorItem }
}

// Vista 1 de CONTRATO_VISTA_DINAMICA_PRODUCCION.md: necesidad real agregada de semielaborado,
// sumando todos los pedidos pendientes que lo requieran (directa o vía receta de producto final),
// reutilizando necesidades_pedidos() -- no se reimplementa la explosión de receta aquí.
// Tabla 2 (misma pantalla): mismo tratamiento un nivel arriba, para producto final -- solo
// informativa en esta iteración (sin selección, sin botón "Producir", ver contrato).
function PedidosDelDia() {
  const navigate = useNavigate()

  const [semielaborados, setSemielaborados] = useState([])
  const [necesidades, setNecesidades] = useState([])
  const [stockPorSemi, setStockPorSemi] = useState(new Map())
  const [pedidosPorSemi, setPedidosPorSemi] = useState(new Map())
  const [faltantesPorSemi, setFaltantesPorSemi] = useState(new Map())
  const [ordenPorSemi, setOrdenPorSemi] = useState(new Map())
  const [cargando, setCargando] = useState(true)

  const [necesidadesPF, setNecesidadesPF] = useState([])
  const [stockPorPF, setStockPorPF] = useState(new Map())
  const [pedidosPorPF, setPedidosPorPF] = useState(new Map())
  const [faltantesPorPF, setFaltantesPorPF] = useState(new Map())

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
    let query = supabase.from('pedidos_venta').select('id, codigo_pedido, fecha_entrega_prevista, clientes(nombre)').in('estado', ['pendiente', 'en_produccion'])
    if (fechaMaxima) query = query.lte('fecha_entrega_prevista', fechaMaxima)
    const resPedidos = await query
    if (resPedidos.error) console.error('Error cargando pedidos:', resPedidos.error)
    const pedidos = resPedidos.data || []

    // Trazabilidad a pedido/cliente/fecha: una llamada a necesidades_pedidos() POR pedido, no una
    // batch con todos los ids -- la llamada batch agrega y pierde la referencia al pedido de origen
    // (ver CONTRATO_VISTA_DINAMICA_PRODUCCION.md, Vista 1). El total agregado por ítem se reconstruye
    // sumando las cantidades de cada llamada individual -- matemáticamente idéntico al resultado de
    // la llamada batch (la multiplicación de receta se distribuye sobre la suma). Se guardan AMBOS
    // niveles ('semielaborado' y 'producto_final') de cada llamada, sin filtrar todavía -- los usan
    // las dos tablas de esta pantalla.
    const resultadosPorPedido = await Promise.all(
      pedidos.map(async (p) => {
        const { data, error } = await supabase.rpc('necesidades_pedidos', { p_pedido_ids: [p.id] })
        if (error) {
          console.error(`Error calculando necesidades del pedido ${p.id}:`, error)
          return { pedido: p, filas: [] }
        }
        return { pedido: p, filas: (data || []).filter((n) => n.nivel === 'semielaborado' || n.nivel === 'producto_final') }
      })
    )

    const { necesidades: necesidadesSemi, pedidosPorItem: mapaPedidosSemi } = agregarPorNivel(resultadosPorPedido, 'semielaborado')
    setNecesidades(necesidadesSemi)
    setPedidosPorSemi(mapaPedidosSemi)

    const { necesidades: necesidadesPFCalc, pedidosPorItem: mapaPedidosPF } = agregarPorNivel(resultadosPorPedido, 'producto_final')
    setNecesidadesPF(necesidadesPFCalc)
    setPedidosPorPF(mapaPedidosPF)

    // Stock disponible actual, agregado por semielaborado a partir de stock_lotes_semielaborado
    // (suma de todos sus lotes cerrados) -- independiente del filtro de fecha, es el stock de hoy.
    const resLotes = await supabase.from('stock_lotes_semielaborado').select('semielaborado_id, stock_disponible')
    if (resLotes.error) console.error('Error cargando stock de lotes:', resLotes.error)
    const mapaStock = new Map()
    for (const l of resLotes.data || []) {
      mapaStock.set(l.semielaborado_id, (mapaStock.get(l.semielaborado_id) || 0) + Number(l.stock_disponible))
    }
    setStockPorSemi(mapaStock)

    // Mismo patrón de agregación, para stock de producto final.
    const resLotesPF = await supabase.from('stock_lotes_producto_final').select('producto_final_id, stock_disponible')
    if (resLotesPF.error) console.error('Error cargando stock de lotes de producto final:', resLotesPF.error)
    const mapaStockPF = new Map()
    for (const l of resLotesPF.data || []) {
      mapaStockPF.set(l.producto_final_id, (mapaStockPF.get(l.producto_final_id) || 0) + Number(l.stock_disponible))
    }
    setStockPorPF(mapaStockPF)

    // Orden jerárquico hoja→raíz sobre el conjunto de semielaborados con necesidad pendiente. No
    // aplica a productos finales (no dependen unos de otros) -- esa tabla ordena alfabético sin más.
    setOrdenPorSemi(await calcularOrdenJerarquico(necesidadesSemi.map((n) => n.item_id)))

    // Badges de tipo de bloqueo: solo tiene sentido comprobar la receta de los ítems que hoy están
    // en rojo (stock ya cerrado insuficiente para la necesidad agregada) -- si ya hay suficiente
    // producido, no hace falta mirar si se podría producir más.
    const faltantesMap = new Map()
    await Promise.all(
      necesidadesSemi.map(async (n) => {
        const cantidad = Number(n.cantidad_necesaria)
        const disponible = mapaStock.get(n.item_id) || 0
        if (cantidad <= 0 || disponible >= cantidad) return
        const faltantes = await validarStockReceta('semielaborado', n.item_id, cantidad)
        if (faltantes.length > 0) faltantesMap.set(n.item_id, faltantes)
      })
    )
    setFaltantesPorSemi(faltantesMap)

    const faltantesMapPF = new Map()
    await Promise.all(
      necesidadesPFCalc.map(async (n) => {
        const cantidad = Number(n.cantidad_necesaria)
        const disponible = mapaStockPF.get(n.item_id) || 0
        if (cantidad <= 0 || disponible >= cantidad) return
        const faltantes = await validarStockReceta('producto_final', n.item_id, cantidad)
        if (faltantes.length > 0) faltantesMapPF.set(n.item_id, faltantes)
      })
    )
    setFaltantesPorPF(faltantesMapPF)

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
        const faltantes = faltantesPorSemi.get(n.item_id) || []
        return {
          id: n.item_id,
          nombre: n.nombre,
          unidad: n.unidad,
          necesidad,
          disponible,
          cubierto: disponible >= necesidad,
          faltanteSemi: faltantes.filter((f) => f.tipo === 'semielaborado'),
          faltanteIngArt: faltantes.filter((f) => f.tipo === 'ingrediente_articulo'),
          pedidos: pedidosPorSemi.get(n.item_id) || [],
        }
      })
      .sort((a, b) => {
        const da = ordenPorSemi.get(a.id) ?? 0
        const db = ordenPorSemi.get(b.id) ?? 0
        if (da !== db) return da - db
        return a.nombre.localeCompare(b.nombre) // desempate: mismo nivel jerárquico -> alfabético
      })
  }, [necesidades, stockPorSemi, faltantesPorSemi, pedidosPorSemi, ordenPorSemi, semielaboradoFiltro])

  // Tabla 2 -- sin jerarquía entre productos finales, orden alfabético simple.
  const filasPF = useMemo(() => {
    return necesidadesPF
      .map((n) => {
        const necesidad = Number(n.cantidad_necesaria)
        const disponible = stockPorPF.get(n.item_id) || 0
        const faltantes = faltantesPorPF.get(n.item_id) || []
        return {
          id: n.item_id,
          nombre: n.nombre,
          necesidad,
          disponible,
          cubierto: disponible >= necesidad,
          faltanteSemi: faltantes.filter((f) => f.tipo === 'semielaborado'),
          faltanteIngArt: faltantes.filter((f) => f.tipo === 'ingrediente_articulo'),
          pedidos: pedidosPorPF.get(n.item_id) || [],
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [necesidadesPF, stockPorPF, faltantesPorPF, pedidosPorPF])

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
              <Th></Th>
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
                  <Td className="font-medium">
                    <span title={tooltipPedidos(f.pedidos)}>{f.nombre}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {f.faltanteSemi.length > 0 && (
                        <span title={`Bloqueado por semielaborado-hijo pendiente de producir:\n${tooltipFaltantes(f.faltanteSemi)}`}
                          className="inline-flex items-center text-amber-600">
                          <IconChefHat size={16} />
                        </span>
                      )}
                      {f.faltanteIngArt.length > 0 && (
                        <span title={`Bloqueado por ingrediente/artículo comprado:\n${tooltipFaltantes(f.faltanteIngArt)}`}
                          className="inline-flex items-center text-orange-600">
                          <IconCarrot size={16} />
                        </span>
                      )}
                    </div>
                  </Td>
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

      <h2 className="text-sm font-semibold text-[#1C2938] mt-8 mb-3">Necesidad de productos finales</h2>
      {cargando ? (
        <LoadingState />
      ) : filasPF.length === 0 ? (
        <Card><EmptyState>No hay necesidad pendiente de ningún producto final en este rango.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <Thead>
              <Th>Producto final</Th>
              <Th></Th>
              <Th>Necesidad agregada</Th>
              <Th>Stock disponible</Th>
              <Th>Estado</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {filasPF.map((f) => (
                <tr key={f.id} className="hover:bg-blue-50/40">
                  <Td className="font-medium">
                    <span title={tooltipPedidos(f.pedidos)}>{f.nombre}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {f.faltanteSemi.length > 0 && (
                        <span title={`Bloqueado por semielaborado-hijo pendiente de producir:\n${tooltipFaltantes(f.faltanteSemi)}`}
                          className="inline-flex items-center text-amber-600">
                          <IconChefHat size={16} />
                        </span>
                      )}
                      {f.faltanteIngArt.length > 0 && (
                        <span title={`Bloqueado por ingrediente/artículo comprado:\n${tooltipFaltantes(f.faltanteIngArt)}`}
                          className="inline-flex items-center text-orange-600">
                          <IconCarrot size={16} />
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>{f.necesidad.toFixed(3)} uds</Td>
                  <Td>{f.disponible.toFixed(3)} uds</Td>
                  <Td>
                    <Badge color={f.cubierto ? 'green' : 'red'}>{f.cubierto ? 'Cubierto' : 'Falta stock'}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export default PedidosDelDia
