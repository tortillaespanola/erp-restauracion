import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconChefHat, IconCarrot, IconCircleCheck, IconAlertTriangle, IconClock } from '@tabler/icons-react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { validarStockReceta } from '../lib/validarStockReceta'
import { PageHeader, Card, CardBody, Field, Select, DateInput, Button, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

// Jerarquía hoja→raíz (CONTRATO_VISTA_DINAMICA_PRODUCCION.md): dado el conjunto pequeño de
// semielaborados ya presentes en el resultado, resuelve solo las relaciones semielaborado→
// semielaborado ENTRE MIEMBROS DE ESE MISMO CONJUNTO -- si A depende de un semielaborado que hoy no
// tiene necesidad pendiente (no está en `ids`), esa dependencia no cuenta para el orden (no bloquea
// nada real en esta tabla). No toca necesidades_pedidos() ni calcula profundidad global de receta.
// Devuelve también `dependeDe` (el mismo mapa de adyacencia ya calculado para la profundidad) --
// reutilizado por la trazabilidad descendente producto final -> semielaborados (contrato "Reordenación
// y mejora de estados"), para no duplicar esta misma consulta.
async function calcularOrdenJerarquico(ids) {
  const profundidad = new Map(ids.map((id) => [id, 0]))
  const dependeDe = new Map(ids.map((id) => [id, []]))
  if (ids.length === 0) return { profundidad, dependeDe }

  const { data } = await supabase
    .from('receta_semielaborado')
    .select('semielaborado_id, ingrediente_semielaborado_id')
    .in('semielaborado_id', ids)
    .not('ingrediente_semielaborado_id', 'is', null)

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

  return { profundidad, dependeDe }
}

// Cierre transitivo de semielaborados de la cadena de un producto final -- sigue
// dependeDePF (relación directa producto_final -> semielaborado) y luego dependeDeSemi
// (semielaborado -> semielaborado) hasta agotar la cadena. Pura, sin llamadas a la base de datos:
// ambos mapas de adyacencia ya están calculados en cargarDatos(). Usada tanto para el filtro
// descendente ("Producto final" -> qué semielaborados mostrar) como para el estado agregado de la
// tabla de productos finales (qué semielaborados de la cadena están cubiertos o no).
function cadenaSemisDe(pfId, dependeDePF, dependeDeSemi) {
  const visitados = new Set()
  const pendientes = [...(dependeDePF.get(pfId) || [])]
  while (pendientes.length > 0) {
    const id = pendientes.pop()
    if (visitados.has(id)) continue
    visitados.add(id)
    for (const hijo of dependeDeSemi.get(id) || []) pendientes.push(hijo)
  }
  return visitados
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

// Estado a un nivel (tabla de semielaborados, criterio sin cambios respecto al contrato anterior):
// solo mira la propia receta del semielaborado, no baja más. Solo se llama cuando el propio ítem ya
// NO está cubierto (ver filasSemiTodas) -- 'pendiente' es el caso real más común de una pantalla de
// "qué producir hoy": nada bloquea, sencillamente no se ha producido todavía. Verificado con datos
// reales (ZZ_Albondiga frita: necesidad 4, disponible 0, receta con stock de sobra en sus 2
// ingredientes) que devolvía 'ok' antes de este ajuste -- un check verde junto a "disponible: 0.000"
// se lee como "ya resuelto" y el operador se saltaría una producción real pendiente. Decisión
// confirmada explícitamente: nunca usar 'ok' para algo con necesidad sin cubrir, aunque sea
// perfectamente producible con lo que hay en stock.
function estadoUnNivel(faltanteSemi, faltanteIngArt) {
  const semi = faltanteSemi.length > 0
  const ing = faltanteIngArt.length > 0
  if (semi && ing) return 'ambos'
  if (semi) return 'semi'
  if (ing) return 'ingrediente'
  return 'pendiente'
}

// Estado de toda la cadena (tabla de productos finales, criterio nuevo de este contrato): recorre el
// cierre transitivo de semielaborados (`cadenaSemis`) reutilizando el ESTADO ya resuelto de cada uno en
// la tabla de semielaborados (global, sin filtrar) -- no vuelve a consultar la base de datos. Un
// semielaborado en estado 'ok' no aporta nada (ya cubierto). Uno en 'pendiente' (sin bloqueo, solo
// falta producirlo) tampoco cuenta como bloqueo para el producto final -- mismo criterio que la hoja:
// "todavía no producido" no es lo mismo que "bloqueado". Solo 'semi'/'ingrediente'/'ambos' (un bloqueo
// real más abajo en la cadena) propaga faltaSemi/faltaIngrediente hacia arriba. Los faltantes DIRECTOS
// del producto final que sean de tipo 'ingrediente_articulo' (ej. packaging, sin cadena propia) sí son
// bloqueo real siempre. Los de tipo 'semielaborado' de ese mismo listado directo se descartan aquí a
// propósito -- esa misma información ya llega, correctamente clasificada, a través de `cadenaSemis`
// (que incluye las dependencias directas), así que no se duplica ni se repite el bug de la hoja un
// nivel más arriba. Solo se llama cuando el propio producto final no está cubierto.
function estadoCadenaPF(faltantesDirectos, cadenaSemis, filasSemiPorId) {
  let faltaSemi = false
  let faltaIngrediente = false
  const detalle = []

  for (const f of faltantesDirectos) {
    if (f.tipo !== 'ingrediente_articulo') continue // el tipo 'semielaborado' se resuelve vía cadenaSemis
    detalle.push(f)
    faltaIngrediente = true
  }

  for (const semiId of cadenaSemis) {
    const filaSemi = filasSemiPorId.get(semiId)
    if (!filaSemi || filaSemi.estado === 'ok' || filaSemi.estado === 'pendiente') continue
    detalle.push({ nombre: filaSemi.nombre, unidad: filaSemi.unidad, necesario: filaSemi.necesidad, disponible: filaSemi.disponible })
    if (filaSemi.estado === 'semi' || filaSemi.estado === 'ambos') faltaSemi = true
    if (filaSemi.estado === 'ingrediente' || filaSemi.estado === 'ambos') {
      faltaIngrediente = true
      detalle.push(...filaSemi.faltanteIngArt)
    }
  }

  if (faltaSemi && faltaIngrediente) return { estado: 'ambos', detalle }
  if (faltaSemi) return { estado: 'semi', detalle }
  if (faltaIngrediente) return { estado: 'ingrediente', detalle }
  return { estado: 'pendiente', detalle: [] } // nada bloquea -- solo falta producir, igual que la hoja
}

const ESTADOS = {
  ok: { icon: IconCircleCheck, color: 'text-green-600', label: 'OK' },
  pendiente: { icon: IconClock, color: 'text-blue-600', label: 'Pendiente de producir' },
  semi: { icon: IconChefHat, color: 'text-amber-600', label: 'Falta stock de semielaborados' },
  ingrediente: { icon: IconCarrot, color: 'text-orange-600', label: 'Falta stock de ingredientes' },
  ambos: { icon: IconAlertTriangle, color: 'text-red-600', label: 'Falta stock de ambos' },
}

// Celda de estado compartida por las dos tablas -- antes cada una duplicaba su propio bloque de
// badges/tooltip; con los 4 estados el duplicado pesaba más que extraer esto.
function EstadoCelda({ estado, detalle }) {
  const cfg = ESTADOS[estado]
  const Icon = cfg.icon
  const titulo = detalle && detalle.length > 0 ? `${cfg.label}:\n${tooltipFaltantes(detalle)}` : cfg.label
  return (
    <span title={titulo} className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
      <Icon size={16} />
      <span className="text-xs font-medium whitespace-nowrap">{cfg.label}</span>
    </span>
  )
}

// Vista 1 de CONTRATO_VISTA_DINAMICA_PRODUCCION.md, reordenada por el contrato "Reordenación y
// mejora de estados": tabla de productos finales arriba (trazabilidad descendente, filtro de entrada),
// tabla de semielaborados abajo (con la selección y el botón "Producir", sin cambios de comportamiento
// ahí). El filtro "Producto final" decide qué FILAS de semielaborados se muestran -- las cantidades
// siguen siendo la necesidad global agregada de todos los pedidos pendientes, igual que sin filtrar.
function PedidosDelDia() {
  const navigate = useNavigate()

  const [productosFinales, setProductosFinales] = useState([])
  const [necesidades, setNecesidades] = useState([])
  const [stockPorSemi, setStockPorSemi] = useState(new Map())
  const [pedidosPorSemi, setPedidosPorSemi] = useState(new Map())
  const [faltantesPorSemi, setFaltantesPorSemi] = useState(new Map())
  const [ordenPorSemi, setOrdenPorSemi] = useState(new Map())
  const [dependeDeSemi, setDependeDeSemi] = useState(new Map())
  const [cargando, setCargando] = useState(true)

  const [necesidadesPF, setNecesidadesPF] = useState([])
  const [stockPorPF, setStockPorPF] = useState(new Map())
  const [pedidosPorPF, setPedidosPorPF] = useState(new Map())
  const [faltantesPorPF, setFaltantesPorPF] = useState(new Map())
  const [dependeDePF, setDependeDePF] = useState(new Map())

  const [productoFinalFiltro, setProductoFinalFiltro] = useState('')
  const [fechaMaxima, setFechaMaxima] = useState('')
  const [seleccionId, setSeleccionId] = useState('')

  async function cargarDatos() {
    setCargando(true)
    setSeleccionId('')

    const resProductos = await supabase.from('productos_finales').select('id, nombre').order('nombre')
    if (resProductos.error) console.error('Error cargando productos finales:', resProductos.error)
    setProductosFinales(resProductos.data || [])

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

    // Orden jerárquico hoja→raíz sobre el conjunto de semielaborados con necesidad pendiente, y el
    // mismo mapa de adyacencia reutilizado para la trazabilidad descendente de más abajo. No aplica a
    // productos finales (no dependen unos de otros) -- esa tabla ordena alfabético sin más.
    const { profundidad: ordenSemiCalc, dependeDe: dependeDeSemiCalc } = await calcularOrdenJerarquico(necesidadesSemi.map((n) => n.item_id))
    setOrdenPorSemi(ordenSemiCalc)
    setDependeDeSemi(dependeDeSemiCalc)

    // Relación directa producto_final -> semielaborado (receta_producto_final), para el filtro
    // descendente "Producto final" y para el estado agregado de toda la cadena. Acotada a los
    // productos finales con necesidad pendiente, igual criterio que calcularOrdenJerarquico -- si un
    // producto final tiene necesidad y depende de un semielaborado, ese semielaborado tiene necesidad
    // también (la cascada de necesidades_pedidos() ya lo garantiza), así que no hay hueco de cobertura.
    const idsPF = necesidadesPFCalc.map((n) => n.item_id)
    const dependeDePFCalc = new Map(idsPF.map((id) => [id, []]))
    if (idsPF.length > 0) {
      const resRecetaPF = await supabase
        .from('receta_producto_final')
        .select('producto_final_id, ingrediente_semielaborado_id')
        .in('producto_final_id', idsPF)
        .not('ingrediente_semielaborado_id', 'is', null)
      if (resRecetaPF.error) console.error('Error cargando dependencias de producto final:', resRecetaPF.error)
      for (const fila of resRecetaPF.data || []) {
        dependeDePFCalc.get(fila.producto_final_id)?.push(fila.ingrediente_semielaborado_id)
      }
    }
    setDependeDePF(dependeDePFCalc)

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

  // Tabla de semielaborados, SIEMPRE global (sin filtrar) -- el filtro de producto final decide qué
  // filas de aquí se muestran (más abajo), nunca qué cantidad se calcula. Estado a un nivel, igual
  // criterio que antes de este contrato.
  const filasSemiTodas = useMemo(() => {
    return necesidades
      .map((n) => {
        const necesidad = Number(n.cantidad_necesaria)
        const disponible = stockPorSemi.get(n.item_id) || 0
        const faltantes = faltantesPorSemi.get(n.item_id) || []
        const faltanteSemi = faltantes.filter((f) => f.tipo === 'semielaborado')
        const faltanteIngArt = faltantes.filter((f) => f.tipo === 'ingrediente_articulo')
        const cubierto = disponible >= necesidad
        return {
          id: n.item_id,
          nombre: n.nombre,
          unidad: n.unidad,
          necesidad,
          disponible,
          cubierto,
          estado: cubierto ? 'ok' : estadoUnNivel(faltanteSemi, faltanteIngArt),
          faltanteSemi,
          faltanteIngArt,
          pedidos: pedidosPorSemi.get(n.item_id) || [],
        }
      })
      .sort((a, b) => {
        const da = ordenPorSemi.get(a.id) ?? 0
        const db = ordenPorSemi.get(b.id) ?? 0
        if (da !== db) return da - db
        return a.nombre.localeCompare(b.nombre) // desempate: mismo nivel jerárquico -> alfabético
      })
  }, [necesidades, stockPorSemi, faltantesPorSemi, pedidosPorSemi, ordenPorSemi])

  // Cierre transitivo de semielaborados de la cadena del producto final filtrado -- null si no hay
  // filtro (sin restringir filas).
  const cadenaDelFiltro = useMemo(() => {
    if (!productoFinalFiltro) return null
    return cadenaSemisDe(parseInt(productoFinalFiltro), dependeDePF, dependeDeSemi)
  }, [productoFinalFiltro, dependeDePF, dependeDeSemi])

  // Filas realmente mostradas en la tabla de semielaborados -- mismos objetos que filasSemiTodas
  // (mismas cantidades globales), solo se filtran las filas visibles.
  const filasSemi = useMemo(() => {
    if (!cadenaDelFiltro) return filasSemiTodas
    return filasSemiTodas.filter((f) => cadenaDelFiltro.has(f.id))
  }, [filasSemiTodas, cadenaDelFiltro])

  // Tabla de productos finales -- estado de TODA la cadena (no solo un nivel), reutilizando el estado
  // ya resuelto de la tabla de semielaborados (global, sin filtrar) para no repetir consultas. Sin
  // jerarquía entre productos finales -- orden alfabético simple.
  const filasPF = useMemo(() => {
    const filasSemiPorId = new Map(filasSemiTodas.map((f) => [f.id, f]))
    return necesidadesPF
      .map((n) => {
        const necesidad = Number(n.cantidad_necesaria)
        const disponible = stockPorPF.get(n.item_id) || 0
        const cubierto = disponible >= necesidad
        const faltantesDirectos = faltantesPorPF.get(n.item_id) || []
        const { estado, detalle } = cubierto
          ? { estado: 'ok', detalle: [] }
          : estadoCadenaPF(faltantesDirectos, cadenaSemisDe(n.item_id, dependeDePF, dependeDeSemi), filasSemiPorId)
        return {
          id: n.item_id,
          nombre: n.nombre,
          necesidad,
          disponible,
          cubierto,
          estado,
          detalle,
          pedidos: pedidosPorPF.get(n.item_id) || [],
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [necesidadesPF, stockPorPF, faltantesPorPF, pedidosPorPF, dependeDePF, dependeDeSemi, filasSemiTodas])

  // Filtrar a un único producto final ya deja, en la práctica, un único semielaborado visible casi
  // siempre -- se autoselecciona para no obligar a un clic extra cuando ya no hay ambigüedad posible.
  useEffect(() => {
    if (filasSemi.length === 1) setSeleccionId(String(filasSemi[0].id))
  }, [filasSemi])

  const seleccionado = filasSemi.find((f) => String(f.id) === seleccionId)

  function handleProducir() {
    if (!seleccionado) return
    navigate(`/producciones?semielaborado_id=${seleccionado.id}&cantidad=${seleccionado.necesidad}`)
  }

  return (
    <div>
      <PageHeader
        title="Producciones del día"
        subtitle="Necesidad real agregada de productos finales y semielaborados, sobre todos los pedidos pendientes."
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3 items-end">
          <Field label="Producto final" className="w-64">
            <Select
              value={productoFinalFiltro}
              onChange={(e) => { setProductoFinalFiltro(e.target.value); setSeleccionId('') }}
            >
              <option value="">Todos</option>
              {productosFinales.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha máxima de entrega" className="w-48">
            <DateInput value={fechaMaxima} onChange={setFechaMaxima} isClearable placeholderText="Sin límite" />
          </Field>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Productos finales</h2>
      {cargando ? (
        <LoadingState />
      ) : filasPF.length === 0 ? (
        <Card><EmptyState>No hay necesidad pendiente de ningún producto final en este rango.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th>Producto final</Th>
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
                  <Td>{f.necesidad.toFixed(3)} uds</Td>
                  <Td>{f.disponible.toFixed(3)} uds</Td>
                  <Td><EstadoCelda estado={f.estado} detalle={f.detalle} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Semielaborados</h2>
      {cargando ? (
        <LoadingState />
      ) : filasSemi.length === 0 ? (
        <Card><EmptyState>{productoFinalFiltro ? 'Ese producto final no depende de ningún semielaborado con necesidad pendiente.' : 'No hay necesidad pendiente de ningún semielaborado en este rango.'}</EmptyState></Card>
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
              {filasSemi.map((f) => (
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
                  <Td>{f.necesidad.toFixed(3)} {f.unidad}</Td>
                  <Td>{f.disponible.toFixed(3)} {f.unidad}</Td>
                  <Td><EstadoCelda estado={f.estado} detalle={[...f.faltanteSemi, ...f.faltanteIngArt]} /></Td>
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
