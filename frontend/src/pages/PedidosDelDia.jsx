import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconChefHat, IconCarrot, IconCircleCheck, IconAlertTriangle, IconClock, IconProgress, IconProgressCheck } from '@tabler/icons-react'
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

// Contrato "Reflejar producciones en curso en los estados de Producciones del día": texto corto junto
// al estado (nota) y desglose por producción (tooltip) para un semielaborado con producciones
// 'abierta' propias -- mismo patrón de tooltip que tooltipPedidos()/tooltipFaltantes() de arriba.
function formatNotaEnCurso(enCurso, unidad) {
  return `${enCurso.suma.toFixed(3)}${enCurso.todasDefinidas ? '' : '+'} ${unidad} en curso`
}

function tooltipEnCurso(enCurso, unidad) {
  return 'Producciones en curso:\n' + enCurso.producciones
    .map((p) => `• ${p.cantidad != null ? `${p.cantidad.toFixed(3)} ${unidad}` : 'cantidad sin definir'}${p.fecha ? ` · iniciada ${formatFecha(p.fecha)}` : ''}`)
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
// Contrato "Reflejar producciones en curso en los estados de Producciones del día": `enCurso` es
// `{ producciones, suma, todasDefinidas }` para este semielaborado (o undefined si no hay ninguna
// producción 'abierta' de él) -- solo se consulta cuando no hay bloqueo real (semi/ingrediente), igual
// prioridad que el resto de esta función: un bloqueo real siempre gana sobre "hay algo en marcha".
function estadoUnNivel(faltanteSemi, faltanteIngArt, enCurso, necesidad) {
  const semi = faltanteSemi.length > 0
  const ing = faltanteIngArt.length > 0
  if (semi && ing) return 'ambos'
  if (semi) return 'semi'
  if (ing) return 'ingrediente'
  if (enCurso) return enCurso.todasDefinidas && enCurso.suma >= necesidad ? 'en_curso_cubre' : 'en_curso_insuficiente'
  return 'pendiente'
}

// Orden de prioridad del contrato (1 = más urgente/bloqueante) -- el estado final es siempre el peor
// (menor rango) entre todos los aplicables. "en_curso_insuficiente" es más urgente que "pendiente"
// (ya hay algo en marcha, aunque no baste); "en_curso_cubre" es menos urgente que "pendiente" (ya hay
// evidencia concreta de que se está cubriendo, aunque no haya terminado). Usado tanto para el propio
// nivel de un semielaborado (implícito en estadoUnNivel, misma jerarquía) como para reducir la cadena
// completa de un producto final a un único estado en estadoCadenaPF.
const RANGO_ESTADO = { ambos: 1, semi: 2, ingrediente: 3, en_curso_insuficiente: 4, pendiente: 5, en_curso_cubre: 6, ok: 7 }

function peorEstado(a, b) {
  if (a == null) return b
  if (b == null) return a
  return RANGO_ESTADO[a] <= RANGO_ESTADO[b] ? a : b
}

// Estado de un producto final (fix "eliminar excepción 'pendiente no bloquea'"): EXACTAMENTE el mismo
// algoritmo de un nivel (estadoUnNivel) que ya usa correctamente la tabla de semielaborados para sus
// propios hijos directos -- se mira el STOCK REAL de cada línea directa de receta_producto_final
// (`faltantesDirectos`, ya trae ambos tipos: 'semielaborado' e 'ingrediente_articulo'), NO el estado
// calculado/recursivo del semielaborado hijo. Que un semielaborado hijo sea "fácilmente producible"
// (su propio estado sea 'pendiente') no libera al producto final de estar bloqueado si ese
// semielaborado no tiene stock disponible ahora mismo para montarlo/empaquetarlo -- ese era el bug:
// se estaba mirando si el hijo era producible en vez de si estaba disponible. No hace falta bajar más
// niveles: si la línea directa no cubre, el producto final ya está bloqueado, sin importar la cadena
// que haya debajo (mismo criterio no-recursivo que ya usa la hoja).
//
// Las producciones en curso (contrato "Reflejar producciones en curso") SÍ se siguen mirando, pero
// solo del semielaborado DIRECTO (`direccionesSemiDirectas` -- relación de receta_producto_final, no
// el cierre transitivo `cadenaSemisDe` que usa el filtro "Producto final" de la tabla de
// semielaborados, ese no se toca) -- y solo aporta si no hay bloqueo real de por medio (el peor caso
// sigue ganando siempre vía RANGO_ESTADO). Etiqueta DISTINTA ('semis_en_curso_*', no 'en_curso_*')
// para no confundirlo con un futuro estado propio de producción del producto final, que no existe
// todavía. Solo se llama cuando el propio producto final no está cubierto.
function estadoCadenaPF(faltantesDirectos, direccionesSemiDirectas, filasSemiPorId) {
  const faltanteSemi = faltantesDirectos.filter((f) => f.tipo === 'semielaborado')
  const faltanteIngArt = faltantesDirectos.filter((f) => f.tipo === 'ingrediente_articulo')
  const detalle = [...faltanteSemi, ...faltanteIngArt]

  let peor = null
  if (faltanteSemi.length > 0 && faltanteIngArt.length > 0) peor = 'ambos'
  else if (faltanteSemi.length > 0) peor = 'semi'
  else if (faltanteIngArt.length > 0) peor = 'ingrediente'

  const semisEnCurso = []
  for (const semiId of direccionesSemiDirectas) {
    const filaSemi = filasSemiPorId.get(semiId)
    if (!filaSemi || (filaSemi.estado !== 'en_curso_insuficiente' && filaSemi.estado !== 'en_curso_cubre')) continue
    peor = peorEstado(peor, filaSemi.estado)
    semisEnCurso.push(`${filaSemi.nombre}: ${filaSemi.nota}`)
  }

  const estadoFinal = peor ?? 'pendiente' // nada bloquea ni hay nada en marcha -- solo falta montar/empaquetar
  const estado = estadoFinal === 'en_curso_insuficiente' ? 'semis_en_curso_insuficiente'
    : estadoFinal === 'en_curso_cubre' ? 'semis_en_curso_cubre'
    : estadoFinal
  const tooltipExtra = semisEnCurso.length > 0 ? 'Semielaborados en curso:\n' + semisEnCurso.map((l) => `• ${l}`).join('\n') : null
  return { estado, detalle, tooltipExtra }
}

const ESTADOS = {
  ok: { icon: IconCircleCheck, color: 'text-green-600', label: 'OK' },
  pendiente: { icon: IconClock, color: 'text-blue-600', label: 'Pendiente de producir' },
  semi: { icon: IconChefHat, color: 'text-amber-600', label: 'Falta stock de semielaborados' },
  ingrediente: { icon: IconCarrot, color: 'text-orange-600', label: 'Falta stock de ingredientes' },
  ambos: { icon: IconAlertTriangle, color: 'text-red-600', label: 'Falta stock de ambos' },
  // Contrato "Reflejar producciones en curso": pareja para la tabla de semielaborados (estado propio)
  // y pareja para la tabla de productos finales (propagado desde su cadena) -- mismo icono, etiqueta
  // distinta a propósito para no confundir "los semielaborados que necesita están en curso" con un
  // futuro estado propio de producción del producto final (todavía no existe).
  en_curso_insuficiente: { icon: IconProgress, color: 'text-cyan-600', label: 'En curso' },
  en_curso_cubre: { icon: IconProgressCheck, color: 'text-teal-600', label: 'En curso — cubre necesidad' },
  semis_en_curso_insuficiente: { icon: IconProgress, color: 'text-cyan-600', label: 'Semielaborados en curso' },
  semis_en_curso_cubre: { icon: IconProgressCheck, color: 'text-teal-600', label: 'Semielaborados en curso — cubren necesidad' },
}

// Celda de estado compartida por las dos tablas -- antes cada una duplicaba su propio bloque de
// badges/tooltip; con 9 estados el duplicado pesaba más que extraer esto. `nota` es un texto corto
// junto a la etiqueta (ej. cantidad en curso); `tooltipExtra` se añade al tooltip además del
// desglose de `detalle` (faltantes), usado para el desglose de producciones en curso.
function EstadoCelda({ estado, detalle, nota, tooltipExtra }) {
  const cfg = ESTADOS[estado]
  const Icon = cfg.icon
  const partes = []
  if (detalle && detalle.length > 0) partes.push(tooltipFaltantes(detalle))
  if (tooltipExtra) partes.push(tooltipExtra)
  const titulo = partes.length > 0 ? `${cfg.label}:\n${partes.join('\n\n')}` : cfg.label
  return (
    <span title={titulo} className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
      <Icon size={16} />
      <span className="text-xs font-medium whitespace-nowrap">
        {cfg.label}
        {nota && <span className="text-gray-400 font-normal"> ({nota})</span>}
      </span>
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
  const [enCursoPorSemi, setEnCursoPorSemi] = useState(new Map())
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
    // (ver CONTRATO_VISTA_DINAMICA_PRODUCCION.md, Vista 1). Usada SOLO para construir el
    // `Map<item_id, pedido[]>` del tooltip de trazabilidad -- las CANTIDADES de necesidad mostradas ya
    // no salen de aquí, ver más abajo. Se guardan AMBOS niveles ('semielaborado' y 'producto_final')
    // de cada llamada, sin filtrar todavía -- los usan las dos tablas de esta pantalla.
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

    const { pedidosPorItem: mapaPedidosSemi } = agregarPorNivel(resultadosPorPedido, 'semielaborado')
    setPedidosPorSemi(mapaPedidosSemi)

    const { pedidosPorItem: mapaPedidosPF } = agregarPorNivel(resultadosPorPedido, 'producto_final')
    setPedidosPorPF(mapaPedidosPF)

    // Necesidad agregada real (fix "necesidad neta en cascada, no bruta de receta"): a diferencia de
    // arriba, esta SÍ es una única llamada batch con TODOS los pedidos pendientes a la vez -- el
    // déficit (`MAX(0, necesidad - stock)`) no es lineal, así que no se puede calcular por pedido
    // individual y sumar después (el mismo stock físico se descontaría una vez por cada pedido que lo
    // mirase). `necesidades_pedidos()` no se toca -- sigue sirviendo bruta para la trazabilidad de
    // arriba y para las otras dos pantallas que la comparten (`Producciones.jsx`,
    // `ProduccionProductosFinales.jsx`) -- esta es una función nueva y separada,
    // `necesidades_pedidos_cascada()`, que reparte hacia cada semielaborado/ingrediente/artículo
    // solo el déficit real de sus padres (si un padre ya está cubierto con su propio stock, no
    // arrastra ninguna necesidad hacia sus hijos aunque el stock físico de éstos esté en 0). Ver
    // CONTRATO_VISTA_DINAMICA_PRODUCCION.md, addenda "necesidad neta en cascada".
    const { data: dataCascada, error: errorCascada } = await supabase.rpc('necesidades_pedidos_cascada', {
      p_pedido_ids: pedidos.map((p) => p.id),
    })
    if (errorCascada) console.error('Error calculando necesidades en cascada:', errorCascada)
    const filasCascada = dataCascada || []

    const necesidadesSemi = filasCascada
      .filter((f) => f.nivel === 'semielaborado')
      .map((f) => ({ item_id: f.item_id, nombre: f.nombre, unidad: f.unidad, cantidad_necesaria: f.cantidad_necesaria }))
    setNecesidades(necesidadesSemi)

    const necesidadesPFCalc = filasCascada
      .filter((f) => f.nivel === 'producto_final')
      .map((f) => ({ item_id: f.item_id, nombre: f.nombre, unidad: f.unidad, cantidad_necesaria: f.cantidad_necesaria }))
    setNecesidadesPF(necesidadesPFCalc)

    // Stock disponible actual, agregado por semielaborado a partir de stock_lotes_semielaborado
    // (suma de todos sus lotes cerrados) -- independiente del filtro de fecha, es el stock de hoy.
    const resLotes = await supabase.from('stock_lotes_semielaborado').select('semielaborado_id, stock_disponible')
    if (resLotes.error) console.error('Error cargando stock de lotes:', resLotes.error)
    const mapaStock = new Map()
    for (const l of resLotes.data || []) {
      mapaStock.set(l.semielaborado_id, (mapaStock.get(l.semielaborado_id) || 0) + Number(l.stock_disponible))
    }
    setStockPorSemi(mapaStock)

    // Contrato "Reflejar producciones en curso": producciones_semielaborado 'abierta' (Producciones.jsx),
    // agregadas por semielaborado_id -- `todasDefinidas` es false si alguna de las producciones en
    // curso de ese semielaborado no tiene cantidad_objetivo (no se puede confirmar que la suma cubra).
    const resEnCurso = await supabase.from('producciones_semielaborado').select('semielaborado_id, cantidad_objetivo, fecha').eq('estado', 'abierta')
    if (resEnCurso.error) console.error('Error cargando producciones en curso:', resEnCurso.error)
    const mapaEnCurso = new Map()
    for (const p of resEnCurso.data || []) {
      const acc = mapaEnCurso.get(p.semielaborado_id) ?? { producciones: [], suma: 0, todasDefinidas: true }
      const cantidad = p.cantidad_objetivo != null ? Number(p.cantidad_objetivo) : null
      acc.producciones.push({ cantidad, fecha: p.fecha })
      if (cantidad != null) acc.suma += cantidad
      else acc.todasDefinidas = false
      mapaEnCurso.set(p.semielaborado_id, acc)
    }
    setEnCursoPorSemi(mapaEnCurso)

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
        const enCurso = enCursoPorSemi.get(n.item_id)
        const estado = cubierto ? 'ok' : estadoUnNivel(faltanteSemi, faltanteIngArt, enCurso, necesidad)
        const enCursoActivo = (estado === 'en_curso_insuficiente' || estado === 'en_curso_cubre') && enCurso
        return {
          id: n.item_id,
          nombre: n.nombre,
          unidad: n.unidad,
          necesidad,
          disponible,
          cubierto,
          estado,
          faltanteSemi,
          faltanteIngArt,
          nota: enCursoActivo ? formatNotaEnCurso(enCurso, n.unidad) : null,
          tooltipExtra: enCursoActivo ? tooltipEnCurso(enCurso, n.unidad) : null,
          pedidos: pedidosPorSemi.get(n.item_id) || [],
        }
      })
      .sort((a, b) => {
        const da = ordenPorSemi.get(a.id) ?? 0
        const db = ordenPorSemi.get(b.id) ?? 0
        if (da !== db) return da - db
        return a.nombre.localeCompare(b.nombre) // desempate: mismo nivel jerárquico -> alfabético
      })
  }, [necesidades, stockPorSemi, faltantesPorSemi, pedidosPorSemi, ordenPorSemi, enCursoPorSemi])

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
        const { estado, detalle, tooltipExtra } = cubierto
          ? { estado: 'ok', detalle: [], tooltipExtra: null }
          : estadoCadenaPF(faltantesDirectos, dependeDePF.get(n.item_id) || [], filasSemiPorId)
        return {
          id: n.item_id,
          nombre: n.nombre,
          necesidad,
          disponible,
          cubierto,
          estado,
          detalle,
          tooltipExtra,
          pedidos: pedidosPorPF.get(n.item_id) || [],
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [necesidadesPF, stockPorPF, faltantesPorPF, pedidosPorPF, dependeDePF, filasSemiTodas])

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
                  <Td><EstadoCelda estado={f.estado} detalle={f.detalle} tooltipExtra={f.tooltipExtra} /></Td>
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
                  <Td><EstadoCelda estado={f.estado} detalle={[...f.faltanteSemi, ...f.faltanteIngArt]} nota={f.nota} tooltipExtra={f.tooltipExtra} /></Td>
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
