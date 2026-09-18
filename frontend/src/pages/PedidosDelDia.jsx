import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconStack3, IconComponents, IconCircleCheck, IconAlertTriangle, IconClock, IconProgress, IconProgressCheck, IconChevronRight, IconChevronDown, IconPlayerPlay, IconArrowsExchange } from '@tabler/icons-react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { validarStockReceta } from '../lib/validarStockReceta'
import { estadoCaducidad, diasParaCaducar } from '../lib/caducidadLote'
import { PageHeader, Card, CardBody, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'
import BadgeScrap from '../components/BadgeScrap'
import BadgeRechazoPendiente from '../components/BadgeRechazoPendiente'

// CONTRATO_BADGE_CADUCIDAD_LOTES.md: selector de tanda (produccion_pf_id) para el desglose de una
// línea -- también itera lotes de stock_lotes_producto_final, aunque el contrato no lo mencione
// explícitamente (ver auditoría). Sin fecha de destino propia (no es una venta/consumo con fecha),
// se compara siempre contra hoy. Extraído porque se usa en dos <Select> de tanda (reasignar / split
// nuevo) con el mismo formato de opción.
function avisoCaducidadTanda(fechaCaducidad, t) {
  const estado = estadoCaducidad(fechaCaducidad)
  if (estado === 'caducado') return t('pedidos_del_dia:tanda_caducada_aviso')
  if (estado === 'proximo') return t('pedidos_del_dia:tanda_proxima_caducar_aviso', { dias: diasParaCaducar(fechaCaducidad) })
  return ''
}

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

// CONTRATO_I18N.md, Fase 1: estas 4 funciones construyen texto de tooltip mezclando plantilla fija
// con datos (código/cliente/fecha de pedido, nombre/cantidad de ítem) -- reciben `t` como parámetro
// en vez de useTranslation() porque son funciones puras, no componentes; `t` se las pasa el
// componente que las llama, ya suscrito a i18next.
function tooltipPedidos(pedidos, t) {
  if (pedidos.length === 0) return t('pedidos_del_dia:tooltip_pedidos_ninguno')
  return t('pedidos_del_dia:tooltip_pedidos_titulo') + '\n' + pedidos
    .map((p) => `• ${t('pedidos_del_dia:tooltip_pedido_linea', {
      codigo: p.codigo || `#${p.pedidoId}`,
      cliente: p.cliente,
      fecha: p.fechaEntrega ? formatFecha(p.fechaEntrega) : t('pedidos_del_dia:sin_fecha'),
    })}`)
    .join('\n')
}

function tooltipFaltantes(faltantes, t) {
  return faltantes
    .map((f) => t('pedidos_del_dia:tooltip_faltantes_linea', {
      falta: (f.necesario - f.disponible).toFixed(3), unidad: f.unidad, nombre: f.nombre, disponible: f.disponible.toFixed(3),
    }))
    .join('\n')
}

// Contrato "Reflejar producciones en curso en los estados de Producciones del día": texto corto junto
// al estado (nota) y desglose por producción (tooltip) para un semielaborado con producciones
// 'abierta' propias -- mismo patrón de tooltip que tooltipPedidos()/tooltipFaltantes() de arriba.
function formatNotaEnCurso(enCurso, unidad, t) {
  return t('pedidos_del_dia:nota_en_curso', { valor: `${enCurso.suma.toFixed(3)}${enCurso.todasDefinidas ? '' : '+'}`, unidad })
}

function tooltipEnCurso(enCurso, unidad, t) {
  return t('pedidos_del_dia:tooltip_en_curso_titulo') + '\n' + enCurso.producciones
    .map((p) => `• ${p.cantidad != null ? t('pedidos_del_dia:tooltip_en_curso_linea_cantidad', { cantidad: p.cantidad.toFixed(3), unidad }) : t('pedidos_del_dia:tooltip_en_curso_cantidad_sin_definir')}${p.fecha ? t('pedidos_del_dia:tooltip_en_curso_iniciada', { fecha: formatFecha(p.fecha) }) : ''}`)
    .join('\n')
}

// Agrega las filas de un nivel concreto ('semielaborado' | 'producto_final') a través de los
// resultados de necesidades_pedidos() ya obtenidos UNA VEZ POR PEDIDO -- ambos niveles vienen en la
// misma respuesta de cada llamada, así que reutilizar los mismos resultados para las dos tablas no
// cuesta ninguna llamada adicional.
function agregarPorNivel(resultadosPorPedido, nivel, t) {
  const necesidadesAgregadas = new Map()
  const pedidosPorItem = new Map()
  for (const { pedido, filas } of resultadosPorPedido) {
    for (const f of filas) {
      if (f.nivel !== nivel) continue
      const acc = necesidadesAgregadas.get(f.item_id) ?? { item_id: f.item_id, nombre: f.nombre, unidad: f.unidad, cantidad_necesaria: 0 }
      acc.cantidad_necesaria += Number(f.cantidad_necesaria)
      necesidadesAgregadas.set(f.item_id, acc)

      const lista = pedidosPorItem.get(f.item_id) ?? []
      lista.push({ pedidoId: pedido.id, codigo: pedido.codigo_pedido, cliente: pedido.clientes?.nombre ?? t('common:sin_cliente'), fechaEntrega: pedido.fecha_entrega_prevista })
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

// Addenda "reordenamiento por estado": mismo RANGO_ESTADO de arriba como criterio de ordenación de
// filas, no uno nuevo. La tabla de productos finales usa etiquetas renombradas para el estado "semis
// en curso" (`semis_en_curso_insuficiente`/`semis_en_curso_cubre`, ver estadoCadenaPF) que no existen
// como claves en RANGO_ESTADO -- este helper las remite a su rango base antes de comparar.
function rangoDeEstado(estado) {
  if (estado === 'semis_en_curso_insuficiente') return RANGO_ESTADO.en_curso_insuficiente
  if (estado === 'semis_en_curso_cubre') return RANGO_ESTADO.en_curso_cubre
  return RANGO_ESTADO[estado]
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
function estadoCadenaPF(faltantesDirectos, direccionesSemiDirectas, filasSemiPorId, t) {
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
  const tooltipExtra = semisEnCurso.length > 0 ? t('pedidos_del_dia:tooltip_semis_en_curso_titulo') + '\n' + semisEnCurso.map((l) => `• ${l}`).join('\n') : null
  return { estado, detalle, tooltipExtra }
}

// Celda de estado compartida por las dos tablas -- antes cada una duplicaba su propio bloque de
// badges/tooltip; con 9 estados el duplicado pesaba más que extraer esto. `nota` es un texto corto
// junto a la etiqueta (ej. cantidad en curso); `tooltipExtra` se añade al tooltip además del
// desglose de `detalle` (faltantes), usado para el desglose de producciones en curso.
//
// CONTRATO_I18N.md, Fase 1: las etiquetas de estado son texto calculado en cliente, NUNCA valores
// crudos de un enum de BD -- viven en su propio namespace estados_calculados.json, jamás en
// enums.json (ver Fase 0).
const ESTADOS_ICONO = {
  ok: { icon: IconCircleCheck, color: 'text-green-600' },
  pendiente: { icon: IconClock, color: 'text-blue-600' },
  semi: { icon: IconStack3, color: 'text-amber-600' },
  ingrediente: { icon: IconComponents, color: 'text-orange-600' },
  ambos: { icon: IconAlertTriangle, color: 'text-red-600' },
  en_curso_insuficiente: { icon: IconProgress, color: 'text-cyan-600' },
  en_curso_cubre: { icon: IconProgressCheck, color: 'text-teal-600' },
  semis_en_curso_insuficiente: { icon: IconProgress, color: 'text-cyan-600' },
  semis_en_curso_cubre: { icon: IconProgressCheck, color: 'text-teal-600' },
}

function EstadoCelda({ estado, detalle, nota, tooltipExtra }) {
  const { t } = useTranslation(['estados_calculados', 'pedidos_del_dia'])
  const cfg = ESTADOS_ICONO[estado]
  const Icon = cfg.icon
  const label = t(`estados_calculados:produccion_pf.${estado}`)
  const partes = []
  if (detalle && detalle.length > 0) partes.push(tooltipFaltantes(detalle, t))
  if (tooltipExtra) partes.push(tooltipExtra)
  const titulo = partes.length > 0 ? `${label}:\n${partes.join('\n\n')}` : label
  return (
    <span title={titulo} className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
      <Icon size={16} />
      <span className="text-xs font-medium whitespace-nowrap">
        {label}
        {nota && <span className="text-gray-400 font-normal"> ({nota})</span>}
      </span>
    </span>
  )
}

// Addenda "contribución por padre en el desglose (fix Fricción 2)": construye una fila de desglose a
// partir de una línea de `validarStockReceta(tipo, id, necesidadPadre, false)` (nivel directo de
// receta, sin filtrar a solo faltantes) -- `linea.necesario` ya ES la contribución de ESTE padre
// concreto (cantidad_por_unidad_receta × necesidad_objetivo del padre, calculado por validarStockReceta
// con la `cantidad` que se le pasó), NUNCA la necesidad agregada global del hijo. Antes esta función
// reemplazaba ese número por la fila YA calculada de la tabla de Semielaborados (necesidad GLOBAL,
// suma de TODOS los padres) -- bug real confirmado con datos reales: ZZ_MEZCLATORTILLAPATATASINCEB,
// consumido por ZZ_TORTILLACONCEBOLLAGRANDE y ZZ_TORTILLASINCEBOLLAGRANDE, mostraba su necesidad
// agregada total (8.400 kg) IDÉNTICA en el desglose de ambos padres por separado, dando a entender que
// cada uno por sí solo necesitaba 8.4 kg completos.
//
// `disponible` SÍ sigue siendo el stock global disponible del hijo (no se reparte/prorratea por
// padre) -- verificado contra `necesidades_pedidos_cascada()` (supabase/migrations/20260903_...sql):
// el déficit se calcula como `greatest(necesidad_agregada_TOTAL - stock_TOTAL, 0)`, stock como un pool
// compartido único, nunca reservado por padre -- mismo criterio aquí, cada línea compara su propia
// contribución contra el stock global completo, independiente de las demás líneas que también tiren
// de él.
//
// `estado`: para un ingrediente/artículo hoja (sin tabla propia en esta pantalla) reutiliza los mismos
// 2 estados que ya existían ('ok' / 'ingrediente'), sin inventar uno nuevo. Para un semielaborado-hijo,
// ya NO se reutiliza el estado de su fila global (mismo bug de la Fricción 2, aplicado al estado en vez
// de a la cifra) -- se recalcula con el mismo `estadoUnNivel()` de la tabla principal, pero contra la
// contribución de este padre: si el stock global ya cubre la contribución, 'ok' directo; si no, se
// pide (una consulta adicional, solo en este caso) la propia receta del hijo a esa cantidad para saber
// si el bloqueo es de sus propios semielaborados/ingredientes, más `enCursoPorSemi` (sin consulta
// nueva, ya cargado) para la nota "en curso" -- mismo criterio de 1 nivel, mismo cálculo, distinta
// cantidad de referencia.
//
// `padreOk` (addenda "estado del desglose cuando el padre ya está OK"): con el padre ya cubierto por
// su propio stock (ej. ZZ_ALBODIGACONTOMATE 4/4), el consumo de sus hijos YA ocurrió -- comparar la
// contribución contra el stock ACTUAL del hijo (ya vaciado por ese mismo consumo) da un falso
// "pendiente"/"falta stock". El estado OK del padre certifica que esa necesidad se satisfizo, así que
// con `padreOk` se fuerza `estado: 'ok'` en TODAS las líneas del desglose sin mirar su stock (ni
// gastar la consulta adicional de faltantes, ya no hace falta) -- las cifras de necesidad/disponible
// se siguen mostrando tal cual, solo cambia el badge. Sin `padreOk`, comportamiento idéntico a antes.
async function construirFilaDesglose(linea, enCursoPorSemi, padreOk) {
  if (linea.tipo === 'semielaborado') {
    const necesidad = linea.necesario
    const disponible = linea.disponible
    let estado = 'ok'
    if (!padreOk && disponible < necesidad) {
      const faltantes = await validarStockReceta('semielaborado', linea.id, necesidad)
      const faltanteSemi = faltantes.filter((f) => f.tipo === 'semielaborado')
      const faltanteIngArt = faltantes.filter((f) => f.tipo === 'ingrediente_articulo')
      estado = estadoUnNivel(faltanteSemi, faltanteIngArt, enCursoPorSemi.get(linea.id), necesidad)
    }
    return { tipo: 'semielaborado', nombre: linea.nombre, unidad: linea.unidad, necesidad, disponible, estado }
  }
  return {
    tipo: 'ingrediente',
    nombre: linea.nombre,
    unidad: linea.unidad,
    necesidad: linea.necesario,
    disponible: linea.disponible,
    estado: padreOk || linea.disponible >= linea.necesario ? 'ok' : 'ingrediente',
  }
}

// Sub-tabla de desglose, misma tarjeta visual de "Estimación para X" en Producciones.jsx (tabla ligera
// sin Thead, no la envoltura Card/Table completa) -- `cargando === true` mientras se resuelve la
// consulta bajo demanda del primer expand; `filas` queda cacheada por id en el componente padre, no se
// vuelve a pedir en expands posteriores de la misma sesión de la pantalla.
function DesgloseComponentes({ filas, colSpan }) {
  const { t } = useTranslation('pedidos_del_dia')
  return (
    <tr>
      <Td colSpan={colSpan} className="bg-gray-50/60 py-2">
        {filas === 'cargando' ? (
          <p className="text-xs text-gray-400 px-2 py-1">{t('cargando_desglose')}</p>
        ) : filas.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-1">{t('sin_semielaborados_ni_ingredientes')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {filas.map((f) => (
                <tr key={`${f.tipo}-${f.nombre}`}>
                  <td className="pl-8 pr-2 py-1 text-gray-600">{f.nombre}</td>
                  <td className="px-2 py-1 text-gray-500">{f.tipo === 'semielaborado' ? t('tabla_desglose.semielaborado') : t('tabla_desglose.ingrediente')}</td>
                  <td className="px-2 py-1">{f.necesidad.toFixed(3)} {f.unidad}</td>
                  <td className="px-2 py-1 text-gray-500">{t('disponible_prefijo', { valor: f.disponible.toFixed(3), unidad: f.unidad })}</td>
                  <td className="px-2 py-1"><EstadoCelda estado={f.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Td>
    </tr>
  )
}

// Capa B (CONTRATO_VISTA_PRODUCCION_PRODUCTOS_FINALES.md, Paso 2): desglose de PRODUCTOS FINALES --
// ya no muestra la cadena de receta/semielaborados (eso se retira de aquí, sigue disponible dentro de
// "Producción en curso" en ProduccionProductosFinales.jsx, que ya fusiona estimación/disponible por
// línea desde Capa A) -- muestra la distribución PROVISIONAL de lo producido hoy hacia los pedidos de
// cliente pendientes, vía distribucion_prevista_pf(). `filas` es el array crudo devuelto por la
// función (siempre al menos una fila desde el ajuste "sin líneas", ver esa migración) -- `linea_pedido_id
// == null` en la única fila es la señal de "sin pedidos pendientes", con los totales igualmente
// visibles. `valorDe`/`onCambiar`/`onGuardar` gestionan el borrador editable de cantidad_prevista por
// línea, igual patrón (onChange local + onBlur guarda) que "Cantidad objetivo" en ProduccionAbierta.
function DesgloseDistribucionPF({
  filas, colSpan, valorDe, onCambiar, onGuardar, tandas, tandaEditando, onAbrirTanda, onCambiarTanda,
  nuevoSplitLinea, nuevoSplitCantidad, nuevoSplitTanda, onAbrirNuevoSplit, onCancelarNuevoSplit,
  onCambiarNuevoSplitCantidad, onCambiarNuevoSplitTanda, onGuardarNuevoSplit,
}) {
  const { t } = useTranslation(['common', 'pedidos_del_dia'])

  if (filas === 'cargando') {
    return (
      <tr>
        <Td colSpan={colSpan} className="bg-gray-50/60 py-2">
          <p className="text-xs text-gray-400 px-2 py-1">{t('pedidos_del_dia:cargando_distribucion')}</p>
        </Td>
      </tr>
    )
  }

  // filas solo llega vacío si la RPC falló (ver cargarDistribucionPF) -- con la función ya siempre
  // devolviendo al menos una fila de totales, un array vacío aquí es señal de error, no de "sin datos".
  if (filas.length === 0) {
    return (
      <tr>
        <Td colSpan={colSpan} className="bg-gray-50/60 py-2">
          <p className="text-xs text-red-500 px-2 py-1">{t('pedidos_del_dia:error_cargar_distribucion')}</p>
        </Td>
      </tr>
    )
  }

  const [resumen] = filas
  const sinPedidos = filas.length === 1 && filas[0].linea_pedido_id == null
  // Fix: "Residual libre" comparaba lo distribuido contra total_producido_hoy (distribucion_prevista_pf,
  // filtrado a fecha = current_date) -- daba falso aviso en cuanto una tanda con stock real disponible
  // tenía `fecha` de un día distinto a hoy (cierre con fecha retroactiva). Se compara en su lugar contra
  // el stock real total (`tandas`, misma fuente que ya usa el aviso de tanda insuficiente por línea más
  // abajo), sin importar en qué fecha se produjo.
  const stockRealDisponible = (tandas || []).reduce((sum, t) => sum + Number(t.stock_disponible), 0)

  // Reparto multi-tanda: filas.map ya no basta -- distribucion_prevista_pf() puede devolver varias
  // filas para la misma línea de pedido (una por tanda), y su orden no las garantiza adyacentes (el
  // ORDER BY de la función es por fecha_entrega_prevista/pedido_id, no por línea). Se agrupan aquí
  // explícitamente, conservando el orden de primera aparición.
  const grupos = []
  const indicePorLinea = new Map()
  // Fix: aviso de tanda insuficiente en Producciones del día, mismo cálculo de disponible neto que ya
  // usa Pedidos.jsx -- suma de cantidad_prevista por tanda a través de TODAS las líneas de este
  // producto final (ya vienen todas en `filas`, sin consulta aparte).
  const sumaPrevistoPorTanda = new Map()
  if (!sinPedidos) {
    for (const f of filas) {
      if (indicePorLinea.has(f.linea_pedido_id)) {
        grupos[indicePorLinea.get(f.linea_pedido_id)].filas.push(f)
      } else {
        indicePorLinea.set(f.linea_pedido_id, grupos.length)
        grupos.push({ linea_pedido_id: f.linea_pedido_id, filas: [f] })
      }
      if (f.produccion_pf_id != null) {
        sumaPrevistoPorTanda.set(f.produccion_pf_id, (sumaPrevistoPorTanda.get(f.produccion_pf_id) || 0) + Number(f.cantidad_prevista))
      }
    }
  }

  return (
    <tr>
      <Td colSpan={colSpan} className="bg-gray-50/60 py-2">
        <div className="px-2 py-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 border-b border-gray-200 pb-2 mb-2">
          <span>{t('pedidos_del_dia:producido_hoy', { valor: Number(resumen.total_producido_hoy).toFixed(3) })}</span>
          <span>{t('pedidos_del_dia:stock_disponible_resumen', { valor: stockRealDisponible.toFixed(3) })}</span>
          <span>{t('pedidos_del_dia:distribuido', { valor: Number(resumen.total_distribuido).toFixed(3) })}</span>
          {(() => {
            const residualLibre = stockRealDisponible - Number(resumen.total_distribuido)
            return (
              <span className={residualLibre < 0 ? 'text-red-600 font-medium' : ''}>
                {t('pedidos_del_dia:residual_libre', { valor: residualLibre.toFixed(3) })}
                {residualLibre < 0 && t('pedidos_del_dia:residual_libre_excede')}
              </span>
            )
          })()}
        </div>

        {sinPedidos ? (
          <p className="text-xs text-gray-400 px-2 py-1">{t('pedidos_del_dia:sin_pedidos_pendientes')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="pl-8 pr-2 py-1 font-medium">{t('pedidos_del_dia:tabla_distribucion.cliente')}</th>
                <th className="px-2 py-1 font-medium">{t('pedidos_del_dia:tabla_distribucion.pedido')}</th>
                <th className="px-2 py-1 font-medium">{t('pedidos_del_dia:tabla_distribucion.entrega_prevista')}</th>
                <th className="px-2 py-1 font-medium">{t('pedidos_del_dia:tabla_distribucion.pedido')}</th>
                <th className="px-2 py-1 font-medium">{t('pedidos_del_dia:tabla_distribucion.previsto')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grupos.map((grupo) => {
                const tandasProducto = tandas || []
                // Tandas ya usadas por ESTA línea (en cualquiera de sus filas-tanda) -- una tanda que
                // ya tiene su propio reparto no debe reofrecerse como "otra tanda" a la que repartir.
                const tandasUsadasPorLinea = new Set(
                  grupo.filas.map((f) => f.produccion_pf_id).filter((id) => id != null).map((id) => Number(id))
                )
                const hayTandaLibreParaRepartir = tandasProducto.some((t) => !tandasUsadasPorLinea.has(Number(t.produccion_id)))
                const editandoNuevoSplit = nuevoSplitLinea === grupo.linea_pedido_id
                // Fix: línea ya servida del todo (cantidad_pedida - servido <= 0) -- puede seguir
                // dentro de un pedido abierto por OTRA línea distinta. cantidad_pedida/servido son
                // agregados a nivel de línea, iguales en todas las filas-tanda del grupo -- basta con
                // mirar la primera. Sin controles activos: cantidad en texto plano, sin "+ repartir".
                const lineaYaServida = Number(grupo.filas[0].cantidad_pedida) - Number(grupo.filas[0].servido) <= 0

                return (
                  <Fragment key={grupo.linea_pedido_id}>
                    {grupo.filas.map((f, indice) => {
                      const esPrimeraDelGrupo = indice === 0
                      // Tanda actualmente asignada, buscada dentro de las tandas con stock disponible ya
                      // cargadas para este producto final -- si produccion_pf_id apunta a una tanda que ya
                      // no tiene stock (caso raro), tandaActual sale undefined y se muestra un texto de
                      // reserva.
                      const tandaActual = f.produccion_pf_id != null
                        ? tandasProducto.find((t) => Number(t.produccion_id) === Number(f.produccion_pf_id))
                        : null
                      // Fix: contar tandasProducto.length > 1 no bastaba -- si la tanda ya asignada se
                      // vació (stock_disponible=0), queda excluida de esta lista (ya filtrada a > 0) y con
                      // una sola tanda restante el conteo daba 1, ocultando el selector aunque esa tanda SÍ
                      // fuera una alternativa real. Se compara contra la tanda asignada: hay alternativa si
                      // existe alguna tanda en la lista distinta de la actual, o si todavía no hay ninguna
                      // asignada y la lista tiene al menos una.
                      const hayAlternativas = f.produccion_pf_id != null
                        ? tandasProducto.some((t) => Number(t.produccion_id) !== Number(f.produccion_pf_id))
                        : tandasProducto.length > 0
                      const editandoTanda = tandaEditando === f.linea_pedido_id
                      // Fix: con cantidad_prevista = 0 (previsión ya completamente cubierta por un
                      // albarán real) no hay nada que redistribuir -- mostrar tanda/icono de swap ahí es
                      // ruido, aunque hayAlternativas dé true (puede seguir apuntando a una tanda ya
                      // vacía, heredada del trigger de reconstrucción). No afecta a hayAlternativas en sí,
                      // solo a si se pinta.
                      const hayCantidadPrevista = Number(f.cantidad_prevista) !== 0
                      // Fix: mismo cálculo de disponible neto que el aviso de Pedidos.jsx -- stock de
                      // la tanda menos lo que OTRAS previsiones (de cualquier línea) también reclaman
                      // de ella. Sin aviso en líneas ya servidas del todo (nada que solucionar ahí).
                      const stockTandaBruto = tandaActual?.stock_disponible != null ? Number(tandaActual.stock_disponible) : null
                      const sumaOtrasPrevisiones = f.produccion_pf_id != null
                        ? (sumaPrevistoPorTanda.get(f.produccion_pf_id) || 0) - Number(f.cantidad_prevista)
                        : null
                      const disponibleNeto = stockTandaBruto != null ? stockTandaBruto - sumaOtrasPrevisiones : null
                      const tandaInsuficiente = !lineaYaServida && hayCantidadPrevista && disponibleNeto != null && disponibleNeto < Number(f.cantidad_prevista)

                      return (
                        <tr key={`${f.linea_pedido_id}-${f.produccion_pf_id}`}>
                          <td className="pl-8 pr-2 py-1 text-gray-700">{esPrimeraDelGrupo ? f.cliente_nombre : ''}</td>
                          <td className="px-2 py-1 text-gray-500 font-mono text-xs">{esPrimeraDelGrupo ? f.codigo_pedido : ''}</td>
                          <td className="px-2 py-1 text-gray-500">{esPrimeraDelGrupo ? (f.fecha_entrega_prevista ? formatFecha(f.fecha_entrega_prevista) : t('pedidos_del_dia:sin_fecha')) : ''}</td>
                          <td className="px-2 py-1">{esPrimeraDelGrupo ? Number(f.cantidad_pedida).toFixed(3) : ''}</td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              {lineaYaServida ? (
                                <span className="text-sm text-gray-500">{Number(f.cantidad_prevista).toFixed(3)}</span>
                              ) : (
                                <>
                                  <Input
                                    type="number"
                                    step="0.001"
                                    value={valorDe(f)}
                                    onChange={(e) => onCambiar(f.linea_pedido_id, f.produccion_pf_id, e.target.value)}
                                    onBlur={() => onGuardar(f)}
                                    className="text-sm w-28 py-1"
                                  />
                                  {hayAlternativas && hayCantidadPrevista && (
                                    <button
                                      type="button"
                                      onClick={() => onAbrirTanda(editandoTanda ? null : f.linea_pedido_id)}
                                      className="text-gray-400 hover:text-primary-600"
                                      title={t('pedidos_del_dia:cambiar_tanda_title')}
                                    >
                                      <IconArrowsExchange size={15} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                            {hayCantidadPrevista && (
                              <p className={`text-[11px] mt-0.5 ${tandaInsuficiente ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                                {f.produccion_pf_id == null
                                  ? t('pedidos_del_dia:sin_tanda_asignada')
                                  : tandaActual
                                    ? `${t('pedidos_del_dia:tanda_fecha', { fecha: formatFecha(tandaActual.fecha) })}${tandaInsuficiente ? t('pedidos_del_dia:solo_disp', { valor: disponibleNeto.toFixed(3) }) : ''}`
                                    : t('pedidos_del_dia:tanda_asignada')}
                              </p>
                            )}
                            {!lineaYaServida && editandoTanda && hayCantidadPrevista && (
                              <Select
                                value={f.produccion_pf_id ?? ''}
                                onChange={(e) => onCambiarTanda(f, e.target.value ? parseInt(e.target.value) : null)}
                                className="text-xs mt-1 py-1 w-40"
                              >
                                <option value="">{t('pedidos_del_dia:sin_tanda_asignada')}</option>
                                {tandasProducto.map((t2) => (
                                  <option key={t2.produccion_id} value={t2.produccion_id}>
                                    {formatFecha(t2.fecha)} · {t('pedidos_del_dia:disp_sufijo', { valor: Number(t2.stock_disponible).toFixed(3) })}{avisoCaducidadTanda(t2.fecha_caducidad, t)}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {editandoNuevoSplit && (
                      <tr>
                        <td className="pl-8 pr-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            step="0.001"
                            placeholder={t('pedidos_del_dia:cantidad_placeholder')}
                            value={nuevoSplitCantidad}
                            onChange={(e) => onCambiarNuevoSplitCantidad(e.target.value)}
                            className="text-sm w-28 py-1"
                          />
                          <Select
                            value={nuevoSplitTanda}
                            onChange={(e) => onCambiarNuevoSplitTanda(e.target.value)}
                            className="text-xs mt-1 py-1 w-40"
                          >
                            <option value="">{t('pedidos_del_dia:selecciona_tanda')}</option>
                            {tandasProducto
                              .filter((t2) => !tandasUsadasPorLinea.has(Number(t2.produccion_id)))
                              .map((t2) => (
                                <option key={t2.produccion_id} value={t2.produccion_id}>
                                  {formatFecha(t2.fecha)} · {t('pedidos_del_dia:disp_sufijo', { valor: Number(t2.stock_disponible).toFixed(3) })}{avisoCaducidadTanda(t2.fecha_caducidad, t)}
                                </option>
                              ))}
                          </Select>
                          <div className="flex gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => onGuardarNuevoSplit(grupo.linea_pedido_id, tandasUsadasPorLinea)}
                              className="text-xs text-primary-600 hover:underline"
                            >
                              {t('common:actions.save')}
                            </button>
                            <button type="button" onClick={onCancelarNuevoSplit} className="text-xs text-gray-400 hover:underline">
                              {t('common:actions.cancel')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {!lineaYaServida && !editandoNuevoSplit && hayTandaLibreParaRepartir && (
                      <tr>
                        <td className="pl-8 pr-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => onAbrirNuevoSplit(grupo.linea_pedido_id)}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            {t('pedidos_del_dia:repartir_otra_tanda')}
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Td>
    </tr>
  )
}

// Vista 1 de CONTRATO_VISTA_DINAMICA_PRODUCCION.md, reordenada por el contrato "Reordenación y
// mejora de estados": tabla de productos finales arriba (trazabilidad descendente, filtro de entrada),
// tabla de semielaborados abajo (con la selección y el botón "Producir", sin cambios de comportamiento
// ahí). El filtro "Producto final" decide qué FILAS de semielaborados se muestran -- las cantidades
// siguen siendo la necesidad global agregada de todos los pedidos pendientes, igual que sin filtrar.
function PedidosDelDia() {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'pedidos_del_dia'])

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
  const [producidoHoyPorPF, setProducidoHoyPorPF] = useState(new Map())
  const [pedidosPorPF, setPedidosPorPF] = useState(new Map())
  const [faltantesPorPF, setFaltantesPorPF] = useState(new Map())
  const [dependeDePF, setDependeDePF] = useState(new Map())

  const [productoFinalFiltro, setProductoFinalFiltro] = useState('')
  const [fechaMaxima, setFechaMaxima] = useState('')

  // Addenda "desglose por componente en Producciones del día": qué filas están expandidas (Set de
  // ids) y el desglose ya resuelto por id ('cargando' mientras se pide, filas[] cuando llega) -- cache
  // por pantalla, se reinicia en cada cargarDatos() para no arrastrar un desglose calculado contra
  // datos de antes de un cambio de filtro de fecha.
  const [expandidosSemi, setExpandidosSemi] = useState(new Set())
  const [expandidosPF, setExpandidosPF] = useState(new Set())
  const [desgloseSemiPorId, setDesgloseSemiPorId] = useState(new Map())
  // Capa B, Paso 2: desglosePFPorId ahora cachea filas de distribucion_prevista_pf() (cliente/pedido/
  // previsión), no la cadena de receta -- se REFRESCA en cada expand (no se queda cacheado para
  // siempre como el de semielaborados) porque el propio operador edita cantidad_prevista desde aquí y
  // los totales deben reflejar el cambio sin recargar toda la pantalla.
  const [desglosePFPorId, setDesglosePFPorId] = useState(new Map())
  // Borrador editable de cantidad_prevista (clave: "linea_pedido_id-produccion_pf_id", ver
  // claveBorrador -- reparto multi-tanda: una línea puede tener varias previsiones, cada una con su
  // propio borrador) -- mismo patrón onChange-local/onBlur-guarda que "Cantidad objetivo" en
  // ProduccionAbierta (Capa A). Se limpia la entrada tras guardarla con éxito, para que vuelva a
  // reflejar el valor ya confirmado por el servidor en el siguiente refresco.
  const [borradorPrevision, setBorradorPrevision] = useState(new Map())
  // Capa C, Paso 2: tandas con stock disponible por producto final (para el selector de tanda del
  // desglose) y qué línea de pedido tiene ese selector abierto en este momento (una sola a la vez).
  const [tandasPFPorId, setTandasPFPorId] = useState(new Map())
  const [tandaEditandoLinea, setTandaEditandoLinea] = useState(null)
  // Reparto multi-tanda: borrador del "+ repartir en otra tanda" -- un solo editor abierto a la vez
  // (mismo criterio que tandaEditandoLinea), sin persistir hasta guardarlo como fila nueva real.
  const [nuevoSplitLinea, setNuevoSplitLinea] = useState(null)
  const [nuevoSplitCantidad, setNuevoSplitCantidad] = useState('')
  const [nuevoSplitTanda, setNuevoSplitTanda] = useState('')

  async function cargarDatos() {
    setCargando(true)
    setExpandidosSemi(new Set())
    setExpandidosPF(new Set())
    setDesgloseSemiPorId(new Map())
    setDesglosePFPorId(new Map())
    setBorradorPrevision(new Map())
    setTandasPFPorId(new Map())
    setTandaEditandoLinea(null)
    setNuevoSplitLinea(null)
    setNuevoSplitCantidad('')
    setNuevoSplitTanda('')

    const resProductos = await supabase.from('productos_finales').select('id, nombre').order('nombre')
    if (resProductos.error) console.error('Error cargando productos finales:', resProductos.error)
    setProductosFinales(resProductos.data || [])

    // Pedidos pendientes de servir, acotados por la fecha máxima de entrega si se ha filtrado.
    // CONTRATO_ESTADO_PARCIAL_PEDIDOS.md: 'parcial' entra aquí igual que 'pendiente'/'en_produccion'
    // -- un pedido servido a medias sigue necesitando producción/planificación para el resto.
    let query = supabase.from('pedidos_venta').select('id, codigo_pedido, fecha_entrega_prevista, clientes(nombre)').in('estado', ['pendiente', 'en_produccion', 'parcial'])
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

    const { pedidosPorItem: mapaPedidosSemi } = agregarPorNivel(resultadosPorPedido, 'semielaborado', t)
    setPedidosPorSemi(mapaPedidosSemi)

    const { pedidosPorItem: mapaPedidosPF } = agregarPorNivel(resultadosPorPedido, 'producto_final', t)
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

    // Fix "botón play precarga necesidad total en vez de lo que falta por fabricar": producido HOY en
    // tandas ya cerradas, agregado por producto final -- mismo criterio que total_producido_hoy de
    // distribucion_prevista_pf() (estado='cerrada' AND fecha=hoy), NO el stock_disponible de arriba
    // (que descuenta lo ya albaranado, una pregunta distinta: "cuánto falta por ENTREGAR", no "cuánto
    // falta por FABRICAR"). Usado solo por handleProducirPF, no se muestra en la tabla.
    const hoy = new Date().toISOString().slice(0, 10)
    const resProducidoHoyPF = await supabase
      .from('producciones_producto_final')
      .select('producto_final_id, cantidad_producida')
      .eq('estado', 'cerrada')
      .eq('fecha', hoy)
    if (resProducidoHoyPF.error) console.error('Error cargando producido hoy de producto final:', resProducidoHoyPF.error)
    const mapaProducidoHoyPF = new Map()
    for (const p of resProducidoHoyPF.data || []) {
      mapaProducidoHoyPF.set(p.producto_final_id, (mapaProducidoHoyPF.get(p.producto_final_id) || 0) + Number(p.cantidad_producida))
    }
    setProducidoHoyPorPF(mapaProducidoHoyPF)

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
          nota: enCursoActivo ? formatNotaEnCurso(enCurso, n.unidad, t) : null,
          tooltipExtra: enCursoActivo ? tooltipEnCurso(enCurso, n.unidad, t) : null,
          pedidos: pedidosPorSemi.get(n.item_id) || [],
        }
      })
      .sort((a, b) => {
        // Addenda "reordenamiento por estado": criterio primario, empuja los "OK" al final de la
        // tabla y mantiene arriba lo que requiere acción -- el orden jerárquico (hoja->raíz) que ya
        // existía pasa a ser el desempate DENTRO de un mismo estado, sigue siendo el orden correcto
        // para decidir por cuál empezar entre varios semielaborados igual de urgentes.
        const ra = rangoDeEstado(a.estado)
        const rb = rangoDeEstado(b.estado)
        if (ra !== rb) return ra - rb
        const da = ordenPorSemi.get(a.id) ?? 0
        const db = ordenPorSemi.get(b.id) ?? 0
        if (da !== db) return da - db
        return a.nombre.localeCompare(b.nombre) // desempate final: alfabético
      })
  }, [necesidades, stockPorSemi, faltantesPorSemi, pedidosPorSemi, ordenPorSemi, enCursoPorSemi, t])

  // Índice por id de filasSemiTodas -- usado tanto por el estado agregado de productos finales
  // (estadoCadenaPF, sin cambios) como por el desglose por componente (construirFilaDesglose, addenda
  // "desglose por componente"), hoisted para no calcularlo dos veces.
  const filasSemiPorId = useMemo(() => new Map(filasSemiTodas.map((f) => [f.id, f])), [filasSemiTodas])

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
    return necesidadesPF
      .map((n) => {
        const necesidad = Number(n.cantidad_necesaria)
        const disponible = stockPorPF.get(n.item_id) || 0
        const cubierto = disponible >= necesidad
        const faltantesDirectos = faltantesPorPF.get(n.item_id) || []
        const { estado, detalle, tooltipExtra } = cubierto
          ? { estado: 'ok', detalle: [], tooltipExtra: null }
          : estadoCadenaPF(faltantesDirectos, dependeDePF.get(n.item_id) || [], filasSemiPorId, t)
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
      .sort((a, b) => {
        // Addenda "reordenamiento por estado": mismo criterio que la tabla de semielaborados --
        // antes ordenaba solo alfabético, que ahora pasa a ser el desempate.
        const ra = rangoDeEstado(a.estado)
        const rb = rangoDeEstado(b.estado)
        if (ra !== rb) return ra - rb
        return a.nombre.localeCompare(b.nombre)
      })
  }, [necesidadesPF, stockPorPF, faltantesPorPF, pedidosPorPF, dependeDePF, filasSemiPorId, t])

  // Addenda "botón play por fila": inicia producción directa de un semielaborado, sin selección
  // previa -- sustituye por completo al radio + botón "Producir" general (decisión confirmada: hoy no
  // existe ningún flujo real de producir varios semielaborados a la vez, Producciones.jsx solo acepta
  // un semielaborado_id por navegación, así que mantener ambos caminos sería funcionalidad duplicada).
  function handleProducir(fila) {
    navigate(`/producciones?semielaborado_id=${fila.id}&cantidad=${fila.necesidad}`)
  }

  // Capa B, Paso 2: mismo patrón que handleProducir de semielaborados, hacia ProduccionProductosFinales.jsx
  // (?producto_final_id=&cantidad=, ya leídos ahí desde Capa A) -- precarga cantidad objetivo, editable
  // sin bloqueo, igual criterio confirmado que el resto del sistema.
  //
  // Fix: al producir el mismo producto final en varias tandas el mismo día, precargar fila.necesidad
  // (la necesidad agregada TOTAL, bruta -- necesidades_pedidos_cascada() nunca la neta para el nivel
  // producto_final, ver esa función) hacía que la segunda tanda partiera otra vez de la necesidad
  // completa, ignorando lo ya fabricado hoy. Se descuenta aquí lo producido HOY en tandas cerradas de
  // este producto (producidoHoyPorPF) -- explícitamente NO stockPorPF/disponible, que descuenta lo ya
  // ALBARANADO: la cantidad objetivo de producción debe reflejar cuánto falta por FABRICAR, no cuánto
  // falta por entregar (eso es previsiones_distribucion_pf, una cuestión distinta).
  function handleProducirPF(fila) {
    const producidoHoy = producidoHoyPorPF.get(fila.id) || 0
    const residual = Math.max(0, fila.necesidad - producidoHoy)
    navigate(`/produccion-productos?producto_final_id=${fila.id}&cantidad=${residual}`)
  }

  // Addenda "desglose por componente en Producciones del día": expande/contrae una fila y, si es la
  // primera vez que se expande, pide su desglose bajo demanda (una sola vez, cacheado por id en
  // desgloseSemiPorId -- expands posteriores de la misma fila no repiten la consulta).
  async function toggleExpandSemi(fila) {
    setExpandidosSemi((prev) => {
      const next = new Set(prev)
      if (next.has(fila.id)) next.delete(fila.id)
      else next.add(fila.id)
      return next
    })
    if (desgloseSemiPorId.has(fila.id)) return
    setDesgloseSemiPorId((prev) => new Map(prev).set(fila.id, 'cargando'))
    const lineas = await validarStockReceta('semielaborado', fila.id, fila.necesidad, false)
    const filas = await Promise.all(lineas.map((l) => construirFilaDesglose(l, enCursoPorSemi, fila.estado === 'ok')))
    setDesgloseSemiPorId((prev) => new Map(prev).set(fila.id, filas))
  }

  // Capa B, Paso 2: carga (o recarga) la distribución prevista de un producto final -- extraída de
  // toggleExpandPF para poder llamarla también tras guardar una previsión (refresco de totales), no
  // solo al expandir.
  // Capa C, Paso 2: junto a la distribución, carga también las tandas con stock disponible de ese
  // producto final (para el selector de tanda del desglose) -- misma fuente y mismo `order by fecha
  // asc` que ya usan AlbaranesVenta.jsx y CierreTanda.jsx para elegir lote.
  async function cargarDistribucionPF(productoFinalId) {
    setDesglosePFPorId((prev) => new Map(prev).set(productoFinalId, 'cargando'))
    const [resDistribucion, resTandas] = await Promise.all([
      supabase.rpc('distribucion_prevista_pf', { p_producto_final_id: productoFinalId }),
      supabase
        .from('stock_lotes_producto_final')
        .select('produccion_id, fecha, stock_disponible, codigo_lote, fecha_caducidad')
        .eq('producto_final_id', productoFinalId)
        .gt('stock_disponible', 0)
        .order('fecha', { ascending: true }),
    ])
    if (resDistribucion.error) {
      console.error('Error calculando distribución prevista:', resDistribucion.error)
      setDesglosePFPorId((prev) => new Map(prev).set(productoFinalId, []))
      return
    }
    setDesglosePFPorId((prev) => new Map(prev).set(productoFinalId, resDistribucion.data || []))
    setTandasPFPorId((prev) => new Map(prev).set(productoFinalId, resTandas.data || []))
  }

  // A diferencia de toggleExpandSemi, SIEMPRE recarga al expandir (no cachea para siempre) -- la
  // distribución es editable desde aquí mismo, y "producido hoy" puede cambiar mientras la pantalla
  // sigue abierta (otra tanda que cierra).
  async function toggleExpandPF(fila) {
    const estabaExpandido = expandidosPF.has(fila.id)
    setExpandidosPF((prev) => {
      const next = new Set(prev)
      if (next.has(fila.id)) next.delete(fila.id)
      else next.add(fila.id)
      return next
    })
    if (!estabaExpandido) await cargarDistribucionPF(fila.id)
  }

  // Reparto multi-tanda: una línea puede tener varias previsiones (una por tanda), así que el
  // borrador ya no puede vivir en linea_pedido_id a secas -- clave compuesta con la tanda de esa fila
  // concreta (null se normaliza a la cadena 'null', clave estable para la fila "sin tanda asignada").
  function claveBorrador(lineaPedidoId, produccionPfId) {
    return `${lineaPedidoId}-${produccionPfId ?? 'null'}`
  }

  function valorPrevision(f) {
    const clave = claveBorrador(f.linea_pedido_id, f.produccion_pf_id)
    return borradorPrevision.has(clave) ? borradorPrevision.get(clave) : String(f.cantidad_prevista)
  }

  function cambiarBorradorPrevision(lineaPedidoId, produccionPfId, valor) {
    setBorradorPrevision((prev) => new Map(prev).set(claveBorrador(lineaPedidoId, produccionPfId), valor))
  }

  // Reparto multi-tanda: ya no se puede usar upsert con onConflict sobre la tanda NUEVA para cambiar
  // la tanda de una previsión existente -- el onConflict compara contra los valores que se están
  // insertando, no contra la fila actual, así que si la tanda cambia, "upsert por la combinación
  // nueva" o bien inserta una fila nueva (dejando huérfana la vieja, con su cantidad vieja intacta) o
  // bien fusiona con OTRA fila que ya tuviera esa tanda -- ninguna de las dos actualiza la fila que en
  // realidad se quería cambiar. Por eso se hace un UPDATE dirigido a la fila por su tanda ANTERIOR
  // (produccionPfIdActual, con `.is()` si es null); si no hay ninguna fila previa que actualizar
  // (previsión completamente nueva, primera vez que se fija cantidad para esa línea), se inserta.
  // Cubre a la vez "editar cantidad sin tocar la tanda" (la fila se actualiza a sí misma, sin cambio
  // de tanda) y "cambiar de tanda" (reasignación manual, o de "sin tanda" a la sugerencia FIFO).
  async function actualizarOInsertarPrevision(productoFinalId, lineaPedidoId, produccionPfIdActual, produccionPfIdNuevo, cantidadPrevista) {
    let query = supabase
      .from('previsiones_distribucion_pf')
      .update({ cantidad_prevista: cantidadPrevista, produccion_pf_id: produccionPfIdNuevo })
      .eq('linea_pedido_id', lineaPedidoId)
    query = produccionPfIdActual == null ? query.is('produccion_pf_id', null) : query.eq('produccion_pf_id', produccionPfIdActual)
    const { data, error } = await query.select('id')
    if (error) return { error }
    if (data.length > 0) return { error: null }
    return await supabase
      .from('previsiones_distribucion_pf')
      .insert({ producto_final_id: productoFinalId, linea_pedido_id: lineaPedidoId, cantidad_prevista: cantidadPrevista, produccion_pf_id: produccionPfIdNuevo })
  }

  // Sin validación de stock, coherente con el resto de este contrato (advertencia visual si
  // residual_libre sale negativo, nunca bloqueo). Refresca la distribución de ese producto final tras
  // guardar, para que los totales reflejen el cambio al instante. `productoFinalId` lo pasa el
  // llamante (la fila padre ya expandida), no se recalcula por búsqueda inversa.
  //
  // Capa C, Paso 2: si la previsión todavía no tiene tanda asignada (f.produccion_pf_id nulo), se
  // sugiere automáticamente la tanda FIFO al guardar la cantidad. Si ya tenía una asignada -- por FIFO
  // en una edición anterior, o elegida a mano vía cambiarTandaPrevision() -- esa elección se respeta y
  // no se pisa: editar solo la cantidad nunca debe deshacer en silencio un cambio manual de tanda.
  async function guardarPrevision(f, productoFinalId) {
    const clave = claveBorrador(f.linea_pedido_id, f.produccion_pf_id)
    const valor = borradorPrevision.get(clave)
    if (valor === undefined) return // sin edición real, no golpear la base de datos
    const cantidad = parseFloat(valor)
    if (Number.isNaN(cantidad) || cantidad < 0) return
    if (cantidad === Number(f.cantidad_prevista)) {
      setBorradorPrevision((prev) => {
        const next = new Map(prev)
        next.delete(clave)
        return next
      })
      return
    }

    let produccionPfId = f.produccion_pf_id ?? null
    if (produccionPfId == null) {
      const { data: sugerencia } = await supabase.rpc('tanda_fifo_producto_final', { p_producto_final_id: productoFinalId })
      produccionPfId = sugerencia?.[0]?.produccion_id ?? null
    }

    const { error } = await actualizarOInsertarPrevision(productoFinalId, f.linea_pedido_id, f.produccion_pf_id, produccionPfId, cantidad)
    if (error) {
      alert(t('pedidos_del_dia:alertas.error_guardar_prevision', { mensaje: error.message }))
      return
    }
    setBorradorPrevision((prev) => {
      const next = new Map(prev)
      next.delete(clave)
      return next
    })
    await cargarDistribucionPF(productoFinalId)
  }

  // Capa C, Paso 2: cambio manual de tanda desde el selector del desglose (icono, visible solo cuando
  // hay más de una tanda con stock). Mantiene la cantidad ya prevista, solo cambia produccion_pf_id.
  async function cambiarTandaPrevision(f, productoFinalId, produccionPfIdNuevo) {
    const { error } = await actualizarOInsertarPrevision(productoFinalId, f.linea_pedido_id, f.produccion_pf_id, produccionPfIdNuevo, Number(f.cantidad_prevista))
    if (error) {
      alert(t('pedidos_del_dia:alertas.error_cambiar_tanda', { mensaje: error.message }))
      return
    }
    setTandaEditandoLinea(null)
    await cargarDistribucionPF(productoFinalId)
  }

  // Reparto multi-tanda: "+ repartir en otra tanda" -- abre un borrador local (cantidad + tanda
  // vacías) para añadir una previsión NUEVA a una línea que ya tiene al menos una. Un solo borrador
  // abierto a la vez, mismo criterio que tandaEditandoLinea.
  function abrirNuevoSplit(lineaPedidoId) {
    setNuevoSplitLinea(lineaPedidoId)
    setNuevoSplitCantidad('')
    setNuevoSplitTanda('')
  }

  function cancelarNuevoSplit() {
    setNuevoSplitLinea(null)
    setNuevoSplitCantidad('')
    setNuevoSplitTanda('')
  }

  // Siempre INSERT (nunca upsert): es, por definición, una previsión que no existe todavía para esa
  // combinación línea+tanda. `tandasYaUsadas` (calculado por el llamante a partir de las filas ya
  // visibles de esa línea) evita que el operador elija sin querer una tanda que otra fila de la misma
  // línea ya está usando -- un upsert ahí fusionaría/pisaría esa otra fila en vez de crear una nueva.
  async function guardarNuevoSplit(productoFinalId, lineaPedidoId, tandasYaUsadas) {
    const cantidad = parseFloat(nuevoSplitCantidad)
    if (Number.isNaN(cantidad) || cantidad <= 0) {
      alert(t('pedidos_del_dia:alertas.cantidad_invalida_reparto'))
      return
    }
    if (!nuevoSplitTanda) {
      alert(t('pedidos_del_dia:alertas.selecciona_tanda_reparto'))
      return
    }
    const produccionPfId = parseInt(nuevoSplitTanda)
    if (tandasYaUsadas.has(produccionPfId)) {
      alert(t('pedidos_del_dia:alertas.tanda_ya_usada'))
      return
    }
    const { error } = await supabase
      .from('previsiones_distribucion_pf')
      .insert({ producto_final_id: productoFinalId, linea_pedido_id: lineaPedidoId, cantidad_prevista: cantidad, produccion_pf_id: produccionPfId })
    if (error) {
      alert(t('pedidos_del_dia:alertas.error_guardar_reparto', { mensaje: error.message }))
      return
    }
    cancelarNuevoSplit()
    await cargarDistribucionPF(productoFinalId)
  }

  return (
    <div>
      <PageHeader
        title={t('pedidos_del_dia:titulo')}
        subtitle={t('pedidos_del_dia:subtitulo')}
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3 items-end">
          <Field label={t('pedidos_del_dia:campos.producto_final')} className="w-64">
            <Select
              value={productoFinalFiltro}
              onChange={(e) => setProductoFinalFiltro(e.target.value)}
            >
              <option value="">{t('common:actions.all')}</option>
              {productosFinales.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('pedidos_del_dia:campos.fecha_maxima_entrega')} className="w-48">
            <DateInput value={fechaMaxima} onChange={setFechaMaxima} isClearable placeholderText={t('pedidos_del_dia:sin_limite_placeholder')} />
          </Field>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('pedidos_del_dia:productos_finales_titulo')}</h2>
      {cargando ? (
        <LoadingState />
      ) : filasPF.length === 0 ? (
        <Card><EmptyState>{t('pedidos_del_dia:sin_necesidad_pf')}</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th></Th>
              <Th></Th>
              <Th>{t('pedidos_del_dia:tabla.producto_final')}</Th>
              <Th>{t('pedidos_del_dia:tabla.necesidad_agregada')}</Th>
              <Th>{t('pedidos_del_dia:tabla.stock_disponible')}</Th>
              <Th>{t('pedidos_del_dia:tabla.estado')}</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {filasPF.map((f) => {
                const expandido = expandidosPF.has(f.id)
                return (
                  <Fragment key={f.id}>
                    <tr className="hover:bg-blue-50/40">
                      <Td>
                        <button type="button" onClick={() => toggleExpandPF(f)} className="text-gray-400 hover:text-gray-600" title={t('pedidos_del_dia:ver_desglose_title')}>
                          {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </button>
                      </Td>
                      {/* Capa B, Paso 2: mismo patrón que el botón play de Semielaborados (fix Fricción 1 --
                          oculto/deshabilitado en OK, sobreproducir sigue siendo posible entrando directo a
                          Producción de productos finales). */}
                      <Td>
                        {f.estado === 'ok' ? (
                          <span title={t('pedidos_del_dia:necesidad_cubierta_pf_title')} className="text-gray-300 inline-flex">
                            <IconPlayerPlay size={16} />
                          </span>
                        ) : (
                          <button type="button" onClick={() => handleProducirPF(f)} className="text-primary-600 hover:text-primary-700" title={t('pedidos_del_dia:producir_title', { nombre: f.nombre })}>
                            <IconPlayerPlay size={16} />
                          </button>
                        )}
                      </Td>
                      <Td className="font-medium">
                        <span title={tooltipPedidos(f.pedidos, t)}>{f.nombre}</span>
                        <span className="ml-2"><BadgeScrap tipo="producto_final" itemId={f.id} /></span>
                        <span className="ml-2"><BadgeRechazoPendiente itemId={f.id} /></span>
                      </Td>
                      <Td>{f.necesidad.toFixed(3)} uds</Td>
                      <Td>{f.disponible.toFixed(3)} uds</Td>
                      <Td><EstadoCelda estado={f.estado} detalle={f.detalle} tooltipExtra={f.tooltipExtra} /></Td>
                    </tr>
                    {expandido && (
                      <DesgloseDistribucionPF
                        filas={desglosePFPorId.get(f.id) ?? 'cargando'}
                        colSpan={6}
                        valorDe={valorPrevision}
                        onCambiar={cambiarBorradorPrevision}
                        onGuardar={(linea) => guardarPrevision(linea, f.id)}
                        tandas={tandasPFPorId.get(f.id)}
                        tandaEditando={tandaEditandoLinea}
                        onAbrirTanda={setTandaEditandoLinea}
                        onCambiarTanda={(linea, produccionPfId) => cambiarTandaPrevision(linea, f.id, produccionPfId)}
                        nuevoSplitLinea={nuevoSplitLinea}
                        nuevoSplitCantidad={nuevoSplitCantidad}
                        nuevoSplitTanda={nuevoSplitTanda}
                        onAbrirNuevoSplit={abrirNuevoSplit}
                        onCancelarNuevoSplit={cancelarNuevoSplit}
                        onCambiarNuevoSplitCantidad={setNuevoSplitCantidad}
                        onCambiarNuevoSplitTanda={setNuevoSplitTanda}
                        onGuardarNuevoSplit={(lineaPedidoId, tandasYaUsadas) => guardarNuevoSplit(f.id, lineaPedidoId, tandasYaUsadas)}
                      />
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-ink mb-3">{t('pedidos_del_dia:semielaborados_titulo')}</h2>
      {cargando ? (
        <LoadingState />
      ) : filasSemi.length === 0 ? (
        <Card><EmptyState>{productoFinalFiltro ? t('pedidos_del_dia:sin_necesidad_semi_filtro') : t('pedidos_del_dia:sin_necesidad_semi')}</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden mb-6">
          <Table>
            <Thead>
              <Th></Th>
              <Th></Th>
              <Th>{t('pedidos_del_dia:tabla.semielaborado')}</Th>
              <Th>{t('pedidos_del_dia:tabla.necesidad_agregada')}</Th>
              <Th>{t('pedidos_del_dia:tabla.stock_disponible')}</Th>
              <Th>{t('pedidos_del_dia:tabla.estado')}</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {filasSemi.map((f) => {
                const expandido = expandidosSemi.has(f.id)
                return (
                  <Fragment key={f.id}>
                    <tr className="hover:bg-blue-50/40">
                      <Td>
                        <button type="button" onClick={() => toggleExpandSemi(f)} className="text-gray-400 hover:text-gray-600" title={t('pedidos_del_dia:ver_desglose_title')}>
                          {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </button>
                      </Td>
                      {/* Addenda "fix Fricción 1: play deshabilitado en OK" -- con necesidad ya cubierta no
                          tiene sentido este atajo; sobreproducir sigue siendo posible desde Producciones. */}
                      <Td>
                        {f.estado === 'ok' ? (
                          <span title={t('pedidos_del_dia:necesidad_cubierta_semi_title')} className="text-gray-300 inline-flex">
                            <IconPlayerPlay size={16} />
                          </span>
                        ) : (
                          <button type="button" onClick={() => handleProducir(f)} className="text-primary-600 hover:text-primary-700" title={t('pedidos_del_dia:producir_title', { nombre: f.nombre })}>
                            <IconPlayerPlay size={16} />
                          </button>
                        )}
                      </Td>
                      <Td className="font-medium">
                        <span title={tooltipPedidos(f.pedidos, t)}>{f.nombre}</span>
                        <span className="ml-2"><BadgeScrap tipo="semielaborado" itemId={f.id} /></span>
                      </Td>
                      <Td>{f.necesidad.toFixed(3)} {f.unidad}</Td>
                      <Td>{f.disponible.toFixed(3)} {f.unidad}</Td>
                      <Td><EstadoCelda estado={f.estado} detalle={[...f.faltanteSemi, ...f.faltanteIngArt]} nota={f.nota} tooltipExtra={f.tooltipExtra} /></Td>
                    </tr>
                    {expandido && <DesgloseComponentes filas={desgloseSemiPorId.get(f.id) ?? 'cargando'} colSpan={6} />}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export default PedidosDelDia
