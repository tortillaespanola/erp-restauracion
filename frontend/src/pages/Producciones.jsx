import { useState, useEffect, useMemo, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { validarStockReceta } from '../lib/validarStockReceta'
import { IconTrash, IconWand, IconCircleCheck, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Badge, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'
import CancelarProduccionForm from '../components/CancelarProduccionForm'

// CONTRATO_MEJORAS_MES.md, punto 1.4: 20 por página, mismo tamaño que Pedidos/Albaranes/Facturas.
const PAGINA_TAMANO = 20

// CONTRATO_MEJORAS_MES.md, punto 1.5: estado de consumo de una tanda de semielaborado -- no toca
// stock_lotes_semielaborado, se calcula aparte a partir de consumo_produccion/consumo_produccion_pf/
// ajustes_semielaborado ya agregados por produccion_origen_id/produccion_id (ver cargarHistorial).
// Mismo criterio de tolerancia (EPS) que el resto del proyecto (ej. `necesario > disponible + 0.0001`
// en validarStockReceta.js). Corrección post-implementación (caso real WIP-MIXKZ-260060): `consumido`
// ya llega con los ajustes restados (ver cargarHistorial) -- puede superar `cantidadProducida` (un
// ajuste negativo grande) o quedar por debajo de 0 (uno positivo grande), por eso el % se acota
// explícitamente entre 0 y 100 antes de decidir el badge.
//
// CONTRATO_I18N.md, Fase 1: `t` se pasa como parámetro (función pura, no componente) -- las
// etiquetas viven en estados_calculados.json, nunca en enums.json (son estado calculado en cliente,
// no un valor crudo de un CHECK de BD).
const EPS = 0.0005
function estadoConsumo(cantidadProducida, consumido, t) {
  const cantidad = Number(cantidadProducida) || 0
  const cons = Number(consumido) || 0
  if (cons <= EPS) return { color: 'gray', texto: t('estados_calculados:consumo.no_consumido') }
  const pctBruto = cantidad > 0 ? (cons / cantidad) * 100 : 100
  const pct = Math.max(0, Math.min(100, pctBruto))
  if (pct >= 100 - EPS) return { color: 'green', texto: t('estados_calculados:consumo.completo') }
  return { color: 'amber', texto: t('estados_calculados:consumo.parcial', { pct: pct.toFixed(0) }) }
}

// Nivel 'semielaborado' de necesidades_pedidos() sobre los pedidos de una tanda — usado tanto para
// preseleccionar qué semielaborado producir (si solo hace falta uno) como para sugerir cuánto, en
// ambos casos recalculado en vivo contra el conjunto ACTUAL de pedidos de la tanda (no memorizado
// desde la Pantalla 1), para que siga siendo correcto si luego se añaden pedidos a la tanda.
async function necesidadesSemielaboradoDeTanda(tandaId) {
  const { data: pedidos } = await supabase.from('pedidos_venta').select('id').eq('tanda_id', tandaId)
  const pedidoIds = (pedidos || []).map((p) => p.id)
  if (pedidoIds.length === 0) return []

  const { data: necesidades, error } = await supabase.rpc('necesidades_pedidos', { p_pedido_ids: pedidoIds })
  if (error) {
    console.error('Error calculando necesidades de la tanda:', error)
    return []
  }
  return (necesidades || []).filter((n) => n.nivel === 'semielaborado')
}

// Trae TODOS los lotes disponibles de cada tipo (artículo/semielaborado),
// sin filtrar por receta — entrada #9: se permite elegir cualquiera,
// marcando cada lote como esDeReceta o no, para poder destacar el normal
// y detectar una sustitución excepcional al confirmar.
async function cargarIngredientesConLotes(semielaboradoId) {
  const [{ data: receta }, { data: todosLotesArticulo }, { data: todosLotesSemi }, { data: todosArticulos }] = await Promise.all([
    supabase
      .from('receta_semielaborado')
      .select('id, cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id, articulos_compra(nombre, unidad, categoria_id), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad), ingredientes(nombre, unidad)')
      .eq('semielaborado_id', semielaboradoId),
    supabase.from('stock_lotes_articulo').select('*').gt('stock_disponible', 0).order('fecha_caducidad', { ascending: true, nullsFirst: false }),
    supabase.from('stock_lotes_semielaborado').select('*').gt('stock_disponible', 0).order('fecha', { ascending: true }),
    supabase.from('articulos_compra').select('id, categoria_id'),
  ])

  const categoriaPorArticulo = new Map((todosArticulos || []).map((a) => [a.id, a.categoria_id]))

  return Promise.all(
    (receta || []).map(async (linea) => {
      const esArticuloDirecto = !!linea.articulo_id
      const esIngrediente = !!linea.ingrediente_id
      const esArticulo = esArticuloDirecto || esIngrediente
      let lotes
      let articuloIdsDeReceta

      if (esArticulo) {
        articuloIdsDeReceta = [linea.articulo_id]
        if (esIngrediente) {
          const { data: vinculos } = await supabase
            .from('articulo_ingrediente')
            .select('articulo_id')
            .eq('ingrediente_id', linea.ingrediente_id)
          articuloIdsDeReceta = (vinculos || []).map((v) => v.articulo_id)
        }
        // "Otros artículos disponibles" (#9) solo dentro de la misma categoría
        // que pide la receta — un packaging nunca debe ofrecerse como
        // sustituto de una materia prima, aunque ambos tengan stock.
        const categoriaDeReceta = categoriaPorArticulo.get(articuloIdsDeReceta[0])
        lotes = (todosLotesArticulo || [])
          .filter((l) => categoriaPorArticulo.get(l.articulo_id) === categoriaDeReceta)
          .map((l) => ({ ...l, esDeReceta: articuloIdsDeReceta.includes(l.articulo_id) }))
      } else {
        lotes = (todosLotesSemi || []).map((l) => ({ ...l, esDeReceta: l.semielaborado_id === linea.ingrediente_semielaborado_id }))
      }

      return {
        esArticulo,
        esIngrediente,
        articulo_id: linea.articulo_id,
        ingrediente_id: linea.ingrediente_id,
        ingrediente_semielaborado_id: linea.ingrediente_semielaborado_id,
        // Addenda "consumo registrado por ingrediente": TODOS los articulo_id que resuelven esta línea
        // de receta (uno solo si es directa, varios si es ingrediente genérico vía articulo_ingrediente)
        // -- antes se calculaba pero no se exponía, solo hacía falta para filtrar lotes. Permite
        // reconstruir cuánto se ha consumido YA de esta línea sin depender de que el nombre del lote
        // específico coincida con el nombre genérico de receta (no coinciden: ej. receta "Aceite de
        // oliva" vs lote "AOVE Hacendado 1L").
        articuloIdsDeReceta,
        nombre: esArticuloDirecto ? linea.articulos_compra?.nombre : esIngrediente ? linea.ingredientes?.nombre : linea.semielaborados?.nombre,
        unidad: esArticuloDirecto ? linea.articulos_compra?.unidad : esIngrediente ? linea.ingredientes?.unidad : linea.semielaborados?.unidad,
        cantidadOrientativa: linea.cantidad,
        lotes,
      }
    })
  )
}

// CONTRATO_VISTA_DINAMICA_PRODUCCION.md, addenda "Nivel directo de receta en Vista 2
// (2026-09-04)": nivel DIRECTO de `receta_semielaborado` del semielaborado
// indicado -- mismo criterio de resolución (ingrediente_id -> articulo vía articulo_ingrediente) y
// mismo alcance de una sola consulta que `validarStockReceta()`, no la explosión recursiva completa
// hasta materia prima que tenía antes esta función (BFS nivel a nivel vía `frontera`). Bajar más de
// un nivel hacía aparecer aquí ingredientes de sub-semielaborados (ej. AOVE, Carne Picada) que ya se
// habían consumido al producir esos sub-semielaborados -- ver esa addenda para el caso real
// (ZZ_ALBODIGACONTOMATE) que lo confirmó.
//
// `ratioPorUnidad`: cantidad de ese ítem necesaria para producir 1 unidad del semielaborado raíz --
// al ser un único nivel, es directamente la `cantidad` de la línea de receta (sin acumular ratio de
// ningún padre), sumando si el mismo artículo se alcanza por más de una línea (ver fusión de hoja
// más abajo).
async function cargarCadenaCompleta(semielaboradoId) {
  const { data: receta } = await supabase
    .from('receta_semielaborado')
    .select('cantidad, articulo_id, ingrediente_id, ingrediente_semielaborado_id, articulos_compra(nombre, unidad), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad), ingredientes(nombre, unidad)')
    .eq('semielaborado_id', semielaboradoId)

  const lineasSemi = (receta || []).filter((l) => l.ingrediente_semielaborado_id)
  const idsSemis = lineasSemi.map((l) => l.ingrediente_semielaborado_id)
  const idsIngredientes = (receta || []).filter((l) => l.ingrediente_id).map((l) => l.ingrediente_id)

  // Los ingredientes genéricos (tabla `ingredientes`) no tienen stock propio -- se resuelven a través
  // de los artículos vinculados (articulo_ingrediente), igual criterio que validarStockReceta.js.
  const [resStockSemis, resVinculos] = await Promise.all([
    idsSemis.length > 0
      ? supabase.from('stock_semielaborados').select('semielaborado_id, nombre, unidad, stock').in('semielaborado_id', idsSemis)
      : Promise.resolve({ data: [] }),
    idsIngredientes.length > 0
      ? supabase.from('articulo_ingrediente').select('articulo_id, ingrediente_id').in('ingrediente_id', idsIngredientes)
      : Promise.resolve({ data: [] }),
  ])

  const stockPorSemi = new Map((resStockSemis.data || []).map((s) => [s.semielaborado_id, Number(s.stock)]))

  const articuloIdsPorIngrediente = new Map()
  for (const v of resVinculos.data || []) {
    const lista = articuloIdsPorIngrediente.get(v.ingrediente_id) || []
    lista.push(v.articulo_id)
    articuloIdsPorIngrediente.set(v.ingrediente_id, lista)
  }

  const filasSemis = lineasSemi.map((l) => ({
    tipo: 'semielaborado',
    nombre: l.semielaborados?.nombre,
    unidad: l.semielaborados?.unidad,
    stock: stockPorSemi.get(l.ingrediente_semielaborado_id) || 0,
    ratioPorUnidad: Number(l.cantidad),
  }))

  // Dos líneas de receta distintas pueden acabar tirando del MISMO artículo -- una referenciándolo
  // directo (articulo_id) y otra vía un ingrediente genérico (ingrediente_id) que solo mapea a ese
  // artículo. Es el mismo stock físico, así que deben fundirse en una sola fila hoja, no duplicarse
  // (verificado con datos reales: un artículo aparecía dos veces con el mismo stock disponible cada
  // vez). Se agrupa por el conjunto (ordenado) de articulo_id que resuelve cada línea -- si coincide
  // exactamente, es la misma fila, y sus ratios se suman.
  const gruposHoja = new Map() // clave canónica "a:id1,id2" -> {nombre, unidad, articuloIds, ratioPorUnidad}
  for (const linea of receta || []) {
    if (linea.articulo_id) {
      const clave = `a:${linea.articulo_id}`
      const existente = gruposHoja.get(clave)
      if (existente) existente.ratioPorUnidad += Number(linea.cantidad)
      else gruposHoja.set(clave, { nombre: linea.articulos_compra?.nombre, unidad: linea.articulos_compra?.unidad, articuloIds: [linea.articulo_id], ratioPorUnidad: Number(linea.cantidad) })
    } else if (linea.ingrediente_id) {
      const articuloIds = [...(articuloIdsPorIngrediente.get(linea.ingrediente_id) || [])].sort((a, b) => a - b)
      const clave = articuloIds.length > 0 ? `a:${articuloIds.join(',')}` : `i:${linea.ingrediente_id}`
      const existente = gruposHoja.get(clave)
      if (existente) existente.ratioPorUnidad += Number(linea.cantidad)
      else gruposHoja.set(clave, { nombre: linea.ingredientes?.nombre, unidad: linea.ingredientes?.unidad, articuloIds, ratioPorUnidad: Number(linea.cantidad) })
    }
  }

  const idsArticulosRelevantes = [...new Set([...gruposHoja.values()].flatMap((g) => g.articuloIds))]
  const resStockArticulos = idsArticulosRelevantes.length > 0
    ? await supabase.from('stock_lotes_articulo').select('articulo_id, stock_disponible').in('articulo_id', idsArticulosRelevantes)
    : { data: [] }

  const stockPorArticulo = new Map()
  for (const l of resStockArticulos.data || []) {
    stockPorArticulo.set(l.articulo_id, (stockPorArticulo.get(l.articulo_id) || 0) + Number(l.stock_disponible))
  }

  const filasHoja = [...gruposHoja.values()].map((g) => ({
    tipo: 'ingrediente',
    nombre: g.nombre,
    unidad: g.unidad,
    stock: g.articuloIds.reduce((s, aId) => s + (stockPorArticulo.get(aId) || 0), 0),
    ratioPorUnidad: g.ratioPorUnidad,
  }))

  return [...filasSemis, ...filasHoja].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'semielaborado' ? -1 : 1
    return a.nombre.localeCompare(b.nombre)
  })
}

function nombreIngredienteDeLinea(c) {
  const ing = c.entrada_material?.articulos_compra ?? c.producciones_semielaborado?.semielaborados
  return { nombre: ing?.nombre, unidad: ing?.unidad }
}

function claveIngrediente(ing) {
  return `${ing.esArticulo ? 'art' : 'semi'}-${ing.articulo_id ?? ing.ingrediente_id ?? ing.ingrediente_semielaborado_id}`
}

function Producciones() {
  const [searchParams] = useSearchParams()
  const tandaId = searchParams.get('tanda_id')
  const { t } = useTranslation(['common', 'produccion_comun', 'producciones'])

  const [semielaborados, setSemielaborados] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [cargando, setCargando] = useState(true)

  // CONTRATO_MEJORAS_MES.md, punto 1: historial general de producciones cerradas, paginado
  // server-side -- ya no depende de haber seleccionado un semielaborado (punto 1.1/1.2).
  const [historial, setHistorial] = useState([])
  const [cargandoHistorial, setCargandoHistorial] = useState(true)
  const [historialPagina, setHistorialPagina] = useState(1)
  const [totalHistorial, setTotalHistorial] = useState(0)
  const totalPaginasHistorial = Math.max(1, Math.ceil(totalHistorial / PAGINA_TAMANO))
  // Punto 1.5: consumido "aguas abajo" de cada tanda visible en la página actual -- Map id ->
  // { consumido, detalle: [{tipo, nombre, fecha, cantidad}] }, recalculado en cada carga de página.
  const [consumidoPorTanda, setConsumidoPorTanda] = useState(new Map())
  // Punto 1.3: un único id expandido a la vez (acordeón), mismo patrón que AlbaranesVenta.jsx BLOQUE 4.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // Vista 2 (addenda "Rediseño de tablas informativas"): stock de la cadena transitiva completa del
  // semielaborado seleccionado en "Iniciar nueva producción" -- reactivo al cambio de selección, sin
  // botón adicional (punto 3 del contrato).
  const [cadenaStock, setCadenaStock] = useState([])
  const [cadenaCargando, setCadenaCargando] = useState(false)

  // Precarga desde Vista 1 (CONTRATO_VISTA_DINAMICA_PRODUCCION.md): PedidosDelDia.jsx navega aquí
  // con semielaborado_id y cantidad ya calculados -- ambos quedan como valor por defecto editable,
  // no bloqueado.
  const [semielaboradoId, setSemielaboradoId] = useState(searchParams.get('semielaborado_id') || '')
  const [cantidadPlan, setCantidadPlan] = useState(searchParams.get('cantidad') || '')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))
  const [faltantes, setFaltantes] = useState([])
  const [validandoStock, setValidandoStock] = useState(false)

  // Si solo hace falta un semielaborado para esta tanda, se preselecciona — si hiciera falta más de
  // uno (hoy no hay caso real), se deja sin preseleccionar para que el operador elija con criterio.
  useEffect(() => {
    if (!tandaId) return
    necesidadesSemielaboradoDeTanda(tandaId).then((semis) => {
      if (semis.length === 1) setSemielaboradoId(String(semis[0].item_id))
    })
  }, [tandaId])

  // Validación previa de stock (Vista 2 del contrato): solo se recalcula cuando hay semielaborado y
  // cantidad a producir, los dos datos que hacen falta para comparar necesidad contra disponible. Sin
  // cantidad no hay nada que validar -- el flujo manual (sin venir de Vista 1) sigue sin bloquearse.
  useEffect(() => {
    const cantidad = parseFloat(cantidadPlan)
    if (!semielaboradoId || !cantidad || cantidad <= 0) {
      setFaltantes([])
      return
    }
    let cancelado = false
    setValidandoStock(true)
    validarStockReceta('semielaborado', parseInt(semielaboradoId), cantidad).then((resultado) => {
      if (!cancelado) {
        setFaltantes(resultado)
        setValidandoStock(false)
      }
    })
    return () => { cancelado = true }
  }, [semielaboradoId, cantidadPlan])

  // Reactividad de la Vista 2 (punto 3 del contrato): se recalcula solo con cambiar la selección, sin
  // esperar a "Iniciar". Si se llega vía ?semielaborado_id= ya viene precargado desde el estado
  // inicial (arriba), así que este efecto arranca en el primer render sin parpadeo de estado vacío
  // (punto 4) -- el "cargando" que se ve es el spinner, no el mensaje de "sin selección".
  useEffect(() => {
    if (!semielaboradoId) {
      setCadenaStock([])
      return
    }
    let cancelado = false
    setCadenaCargando(true)
    cargarCadenaCompleta(parseInt(semielaboradoId)).then((filas) => {
      if (!cancelado) {
        setCadenaStock(filas)
        setCadenaCargando(false)
      }
    })
    return () => { cancelado = true }
  }, [semielaboradoId])

  async function cargarDatos() {
    setCargando(true)

    // `articulo_id` en entrada_material y `semielaborado_id` en producciones_semielaborado (addenda
    // "consumo registrado por ingrediente"): antes no se pedían -- necesarios para saber a qué línea
    // de receta pertenece cada consumo YA confirmado (una línea de ingrediente genérico puede resolver
    // a varios articulo_id distintos vía articulo_ingrediente, así que no basta con comparar nombres).
    const selectCompleto = `
      *,
      semielaborados(nombre, unidad),
      consumo_produccion!consumo_produccion_produccion_id_fkey(
        id, cantidad,
        entrada_material_id, produccion_origen_id,
        entrada_material(articulo_id, articulos_compra(nombre, unidad)),
        producciones_semielaborado!consumo_produccion_produccion_origen_id_fkey(semielaborado_id, semielaborados(nombre, unidad))
      )
    `

    const [resSemi, resAbiertas] = await Promise.all([
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('producciones_semielaborado').select(selectCompleto).eq('estado', 'abierta').order('fecha', { ascending: false }),
    ])

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resAbiertas.error) console.error(resAbiertas.error)
    else setAbiertas(resAbiertas.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // CONTRATO_MEJORAS_MES.md, punto 1: historial paginado server-side (mismo patrón .range() +
  // { count: 'exact' } que FacturasVenta.jsx/AlbaranesVenta.jsx), filtrado por semielaboradoId solo
  // si hay uno seleccionado ("Todos" = sin filtro, punto 1.2). El select de cada fila reutiliza
  // EXACTAMENTE el mismo embed de consumo_produccion que antes traía cargarDatos() para `cerradas`
  // -- el bloque 1 del detalle expandible (ingredientes consumidos por esta producción) no cambia de
  // fondo, solo de sitio (punto 1.6.1).
  async function cargarHistorial() {
    setCargandoHistorial(true)

    let historialQuery = supabase
      .from('producciones_semielaborado')
      .select(
        `
        *,
        semielaborados(nombre, unidad),
        consumo_produccion!consumo_produccion_produccion_id_fkey(
          id, cantidad,
          entrada_material_id, produccion_origen_id,
          entrada_material(articulo_id, articulos_compra(nombre, unidad)),
          producciones_semielaborado!consumo_produccion_produccion_origen_id_fkey(semielaborado_id, semielaborados(nombre, unidad))
        )
      `,
        { count: 'exact' }
      )
      .in('estado', ['cerrada', 'cancelada'])

    if (semielaboradoId) historialQuery = historialQuery.eq('semielaborado_id', parseInt(semielaboradoId))

    historialQuery = historialQuery.order('fecha', { ascending: false }).order('id', { ascending: true })
    const desde = (historialPagina - 1) * PAGINA_TAMANO
    historialQuery = historialQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const { data: dataHistorial, error: errorHistorial, count } = await historialQuery
    if (errorHistorial) {
      console.error('Error cargando el historial de producciones:', errorHistorial)
      setHistorial([])
      setTotalHistorial(0)
      setConsumidoPorTanda(new Map())
      setCargandoHistorial(false)
      return
    }

    setHistorial(dataHistorial || [])
    setTotalHistorial(count ?? 0)

    // Punto 1.5: consumido aguas abajo de cada tanda VISIBLE en esta página -- tres consultas propias
    // (no toca stock_lotes_semielaborado), agregadas en cliente por produccion_origen_id/produccion_id.
    // Punto 1.6.2/1.6.3: se reutiliza el mismo resultado para los detalles "Consumido por" y "Ajustes
    // de stock" de la fila expandible, sin una segunda consulta. Corrección post-implementación (caso
    // real WIP-MIXKZ-260060): la primera versión no restaba ajustes_semielaborado, mostrando "Parcial"
    // en lotes cuyo stock_disponible real ya era 0 por una corrección manual.
    const idsVisibles = (dataHistorial || []).map((p) => p.id)
    const mapaConsumido = new Map()
    if (idsVisibles.length > 0) {
      const [resConsumo, resConsumoPF, resAjustes] = await Promise.all([
        supabase
          .from('consumo_produccion')
          .select('produccion_origen_id, cantidad, producciones_semielaborado!consumo_produccion_produccion_id_fkey(fecha, semielaborados(nombre))')
          .in('produccion_origen_id', idsVisibles),
        supabase
          .from('consumo_produccion_pf')
          .select('produccion_origen_id, cantidad, producciones_producto_final!consumo_produccion_pf_produccion_pf_id_fkey(fecha, productos_finales(nombre))')
          .in('produccion_origen_id', idsVisibles),
        supabase
          .from('ajustes_semielaborado')
          .select('produccion_id, cantidad, motivo, fecha')
          .in('produccion_id', idsVisibles),
      ])

      if (resConsumo.error) console.error('Error cargando consumo aguas abajo (semielaborado):', resConsumo.error)
      if (resConsumoPF.error) console.error('Error cargando consumo aguas abajo (producto final):', resConsumoPF.error)
      if (resAjustes.error) console.error('Error cargando ajustes de stock:', resAjustes.error)

      const obtener = (id) => {
        let entrada = mapaConsumido.get(id)
        if (!entrada) {
          entrada = { consumido: 0, detalle: [], ajustesTotal: 0, ajustesDetalle: [] }
          mapaConsumido.set(id, entrada)
        }
        return entrada
      }
      for (const c of resConsumo.data || []) {
        const entrada = obtener(c.produccion_origen_id)
        entrada.consumido += Number(c.cantidad)
        entrada.detalle.push({
          tipo: 'semielaborado',
          nombre: c.producciones_semielaborado?.semielaborados?.nombre,
          fecha: c.producciones_semielaborado?.fecha,
          cantidad: Number(c.cantidad),
        })
      }
      for (const c of resConsumoPF.data || []) {
        const entrada = obtener(c.produccion_origen_id)
        entrada.consumido += Number(c.cantidad)
        entrada.detalle.push({
          tipo: 'producto_final',
          nombre: c.producciones_producto_final?.productos_finales?.nombre,
          fecha: c.producciones_producto_final?.fecha,
          cantidad: Number(c.cantidad),
        })
      }
      // Punto 1.5 (fórmula corregida): consumido neto = consumo registrado - ajustes -- mismo signo que
      // la vista stock_lotes_semielaborado (`+ ajustes`), aquí en su complemento: un ajuste negativo
      // (merma/corrección a la baja) SUMA a "consumido" (menos queda por consumir); uno positivo resta.
      for (const a of resAjustes.data || []) {
        const entrada = obtener(a.produccion_id)
        entrada.consumido -= Number(a.cantidad)
        entrada.ajustesTotal += Number(a.cantidad)
        entrada.ajustesDetalle.push({ cantidad: Number(a.cantidad), motivo: a.motivo, fecha: a.fecha })
      }
    }
    setConsumidoPorTanda(mapaConsumido)

    setCargandoHistorial(false)
  }

  useEffect(() => {
    cargarHistorial()
  }, [semielaboradoId, historialPagina])

  async function iniciarProduccion(e) {
    e.preventDefault()
    if (!semielaboradoId) return

    // Addenda "Cantidad objetivo y estimación en Producción en curso": la cantidad indicada aquí (si
    // la hay) se persiste como cantidad_objetivo, para que la tarjeta de "Producción en curso" pueda
    // mostrarla y la estimación de la cadena tenga con qué calcular -- antes se perdía al iniciar.
    const cantidadInicial = parseFloat(cantidadPlan)
    const { error } = await supabase
      .from('producciones_semielaborado')
      .insert({
        semielaborado_id: parseInt(semielaboradoId),
        estado: 'abierta',
        fecha: fechaInicio,
        tanda_id: tandaId || null,
        cantidad_objetivo: cantidadInicial > 0 ? cantidadInicial : null,
      })

    if (error) {
      alert(t('produccion_comun:alertas.error_iniciar_produccion', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    setSemielaboradoId('')
    setCantidadPlan('')
    setFechaInicio(new Date().toISOString().slice(0, 10))
    cargarDatos()
  }

  async function handleBorrarCerrada(id) {
    const [c1, c2, c3] = await Promise.all([
      supabase.from('consumo_produccion').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('consumo_produccion_pf').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('ajustes_semielaborado').select('*', { count: 'exact', head: true }).eq('produccion_id', id),
    ])

    let avisos = []
    if (c1.count > 0) avisos.push(t('producciones:avisos.consumo_semi', { count: c1.count }))
    if (c2.count > 0) avisos.push(t('producciones:avisos.consumo_pf', { count: c2.count }))
    if (c3.count > 0) avisos.push(t('producciones:avisos.ajuste', { count: c3.count }))

    const mensaje = avisos.length > 0
      ? t('producciones:confirmar_borrar_con_avisos', { lista: avisos.map((a) => '• ' + a).join('\n') })
      : t('producciones:confirmar_borrar_sin_avisos')

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('producciones_semielaborado').delete().eq('id', id)
    if (error) {
      alert(t('produccion_comun:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    cargarHistorial()
  }

  const semielaboradoSeleccionado = semielaborados.find((s) => String(s.id) === semielaboradoId)

  // Fix "filtrado de Producciones en curso": mismo criterio, sin selección se ven todas (sin cambios).
  const abiertasFiltradas = useMemo(() => {
    if (!semielaboradoId) return abiertas
    return abiertas.filter((p) => p.semielaborado_id === parseInt(semielaboradoId))
  }, [abiertas, semielaboradoId])

  // Extraído por reutilizarse en dos posiciones distintas de la página según haya o no selección
  // (con selección va entre Stock disponible e Historial; sin selección va justo tras el formulario)
  // -- es una función que devuelve JSX invocada directamente, no un componente anidado. Sin filtro y
  // sin ninguna producción en curso no se renderiza nada (comportamiento previo sin cambios); con
  // filtro se muestra siempre el título, con un estado vacío si no hay ninguna de ese semielaborado.
  function bloqueProduccionesEnCurso(lista, mensajeVacio) {
    if (lista.length === 0 && !mensajeVacio) return null
    return (
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-ink mb-3">{t('produccion_comun:producciones_en_curso')}</h2>
        {lista.length === 0 ? (
          <Card><EmptyState>{mensajeVacio}</EmptyState></Card>
        ) : (
          <div className="flex flex-col gap-4">
            {lista.map((p) => (
              <ProduccionAbierta
                key={p.id}
                produccion={p}
                onCambio={cargarDatos}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('producciones:titulo')}
        subtitle={tandaId ? t('producciones:subtitulo_tanda') : t('producciones:subtitulo_normal')}
      />

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
            <Field label={t('produccion_comun:campos.iniciar_nueva_produccion')}>
              <Select
                value={semielaboradoId}
                onChange={(e) => { setSemielaboradoId(e.target.value); setCantidadPlan(''); setHistorialPagina(1) }}
                required
              >
                <option value="">{t('produccion_comun:campos.selecciona_que_produces')}</option>
                {semielaborados.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                ))}
              </Select>
            </Field>
            <Field label={t('produccion_comun:campos.fecha')}>
              <DateInput value={fechaInicio} onChange={setFechaInicio} required />
            </Field>
            <Field label={t('producciones:cantidad_a_producir_opcional')}>
              <Input type="number" step="0.001" value={cantidadPlan} onChange={(e) => setCantidadPlan(e.target.value)}
                placeholder={t('producciones:sin_validar_placeholder')} title={t('common:redondea_3_decimales')} />
            </Field>
            <Button type="submit">{t('produccion_comun:campos.iniciar')}</Button>
          </form>

          {validandoStock && <p className="text-xs text-gray-400 mt-2">{t('producciones:comprobando_stock')}</p>}

          {!validandoStock && faltantes.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-sm font-semibold text-amber-700 mb-1">
                {t('producciones:aviso_stock_insuficiente_titulo')}
              </p>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {faltantes.map((f, i) => (
                  <li key={i}>
                    {t('producciones:falta_de', { falta: (f.necesario - f.disponible).toFixed(3), unidad: f.unidad, nombre: f.nombre, disponible: f.disponible.toFixed(3) })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      {/* CONTRATO_MEJORAS_MES.md, punto 1.1/1.2: Stock disponible solo tiene sentido con un
          semielaborado seleccionado (es la cadena de receta de ESE semielaborado) -- se sigue
          ocultando sin selección, sin cambios respecto al comportamiento anterior. Producciones en
          curso también sigue el mismo criterio de siempre (filtradas si hay selección, todas si no).
          El Historial, en cambio, ya NO depende de la selección -- se ve siempre, paginado, filtrado
          solo si se ha elegido un semielaborado concreto (punto 1.1: "aplica al historial general
          completo, no solo a una vista filtrada"). */}
      {semielaboradoId && (
        <>
          <h2 className="text-sm font-semibold text-ink mb-3">
            {semielaboradoSeleccionado ? t('producciones:stock_disponible_para', { nombre: semielaboradoSeleccionado.nombre }) : t('producciones:stock_disponible_titulo')}
          </h2>
          {cargando || cadenaCargando ? (
            <LoadingState />
          ) : cadenaStock.length === 0 ? (
            <Card className="mb-8"><EmptyState>{t('producciones:sin_receta')}</EmptyState></Card>
          ) : (
            <Card className="overflow-hidden mb-8">
              <Table>
                <Thead>
                  <Th>{t('producciones:tabla.nombre')}</Th>
                  <Th>{t('producciones:tabla.tipo')}</Th>
                  <Th>{t('producciones:tabla.stock_disponible')}</Th>
                </Thead>
                <tbody className="divide-y divide-gray-100">
                  {cadenaStock.map((f) => (
                    <tr key={`${f.tipo}-${f.nombre}`} className="hover:bg-blue-50/40">
                      <Td className="font-medium">{f.nombre}</Td>
                      <Td className="text-gray-500">{f.tipo === 'semielaborado' ? t('producciones:tabla.semielaborado') : t('producciones:tabla.ingrediente')}</Td>
                      <Td>{f.stock.toFixed(3)} {f.unidad}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}

      {bloqueProduccionesEnCurso(abiertasFiltradas, semielaboradoId ? t('producciones:sin_produccion_en_curso') : null)}

      <h2 className="text-sm font-semibold text-ink mb-3">
        {semielaboradoSeleccionado ? t('producciones:historial_titulo_de', { nombre: semielaboradoSeleccionado.nombre }) : t('producciones:historial_titulo')}
      </h2>
      {cargandoHistorial ? (
        <LoadingState />
      ) : historial.length === 0 ? (
        <Card className="mb-8">
          <EmptyState>
            {semielaboradoId ? t('producciones:sin_producciones_cerradas_de') : t('producciones:sin_producciones_cerradas')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden mb-3">
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_comun:campos.fecha')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('producciones:tabla_historial.semielaborado')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_comun:tabla.cantidad_producida')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_comun:tabla.notas')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('producciones:tabla_historial.estado_consumo')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('produccion_comun:tabla.acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((p) => (
                  <ProduccionCerrada
                    key={p.id}
                    produccion={p}
                    expandido={filaExpandidaId === p.id}
                    onToggleExpandir={() => toggleExpandido(p.id)}
                    consumidoInfo={consumidoPorTanda.get(p.id)}
                    onCambio={cargarHistorial}
                    onBorrar={() => handleBorrarCerrada(p.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!cargandoHistorial && totalHistorial > 0 && (
        <div className="flex items-center justify-between mb-8">
          <p className="text-xs text-gray-400">
            {t('produccion_comun:historial_pagina_count', { count: totalHistorial, pagina: historialPagina, total: totalPaginasHistorial })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button" variant="secondary" size="sm"
              disabled={historialPagina === 1}
              onClick={() => setHistorialPagina((p) => p - 1)}
            >
              {t('common:actions.previous')}
            </Button>
            {Array.from({ length: totalPaginasHistorial }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHistorialPagina(n)}
                className={`w-7 h-7 text-xs rounded-md ${n === historialPagina ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {n}
              </button>
            ))}
            <Button
              type="button" variant="secondary" size="sm"
              disabled={historialPagina === totalPaginasHistorial}
              onClick={() => setHistorialPagina((p) => p + 1)}
            >
              {t('common:actions.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProduccionAbierta({ produccion, onCambio }) {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'produccion_comun', 'producciones'])
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [filasConsumo, setFilasConsumo] = useState({})
  const [confirmando, setConfirmando] = useState(false)
  const [cancelando, setCancelando] = useState(false)

  const [cantidadProducida, setCantidadProducida] = useState('')
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [cerrando, setCerrando] = useState(false)

  const [cantidadObjetivo, setCantidadObjetivo] = useState('')
  const [cantidadSugerida, setCantidadSugerida] = useState(null)

  // Addenda "Cantidad objetivo y estimación en Producción en curso": `objetivo` es el valor
  // PERSISTIDO (columna cantidad_objetivo, la que se indicó al pulsar "Iniciar" o la que se ajuste
  // aquí) -- distinto de `cantidadObjetivo` de arriba, que es solo la precarga ephemeral de consumos
  // sugeridos del flujo de tanda y no se toca. Se guarda al perder el foco (ajuste de
  // referencia/planificación puro: no modifica consumo_produccion ni cierra la producción).
  const [objetivo, setObjetivo] = useState(produccion.cantidad_objetivo != null ? String(produccion.cantidad_objetivo) : '')
  const [guardandoObjetivo, setGuardandoObjetivo] = useState(false)

  // Cadena transitiva completa (mismo cálculo que "Stock disponible para X" a nivel de página, ver
  // cargarCadenaCompleta) para la estimación de esta tarjeta -- se carga una sola vez al montar, el
  // objetivo solo multiplica ratioPorUnidad en el render, sin recargar la cadena en cada tecleo.
  const [cadenaEstimacion, setCadenaEstimacion] = useState([])
  const [cadenaEstimacionCargando, setCadenaEstimacionCargando] = useState(true)

  async function cargarIngredientes() {
    setCargandoIngredientes(true)
    setIngredientes(await cargarIngredientesConLotes(produccion.semielaborado_id))
    setCargandoIngredientes(false)
  }

  useEffect(() => {
    cargarIngredientes()
  }, [])

  useEffect(() => {
    cargarCadenaCompleta(produccion.semielaborado_id).then((filas) => {
      setCadenaEstimacion(filas)
      setCadenaEstimacionCargando(false)
    })
  }, [])

  async function guardarObjetivo() {
    const valor = objetivo === '' ? null : parseFloat(objetivo)
    if (valor != null && (Number.isNaN(valor) || valor <= 0)) return
    if (valor === (produccion.cantidad_objetivo ?? null)) return
    setGuardandoObjetivo(true)
    const { error } = await supabase.from('producciones_semielaborado').update({ cantidad_objetivo: valor }).eq('id', produccion.id)
    setGuardandoObjetivo(false)
    if (error) {
      alert(t('produccion_comun:alertas.error_guardar_objetivo', { mensaje: error.message }))
      return
    }
    onCambio()
  }

  // Recalculado en vivo contra el conjunto actual de pedidos de la tanda, no memorizado desde la
  // Pantalla 1 — sigue siendo correcto si se añaden pedidos a la tanda después de abrir esta producción.
  useEffect(() => {
    if (!produccion.tanda_id) return
    necesidadesSemielaboradoDeTanda(produccion.tanda_id).then((semis) => {
      const fila = semis.find((s) => s.item_id === produccion.semielaborado_id)
      if (fila) setCantidadSugerida(Number(fila.cantidad_necesaria))
    })
  }, [])

  // Precarga automática, solo la primera vez que hay dato suficiente (cantidadObjetivo vacío evita
  // repetirla en recargas posteriores de `ingredientes`, ej. tras confirmar consumo) — el usuario
  // puede editar cantidadObjetivo y volver a precargar explícitamente con "Recalcular consumos".
  useEffect(() => {
    if (cantidadSugerida == null || ingredientes.length === 0 || cantidadObjetivo) return
    setCantidadObjetivo(String(cantidadSugerida))
    const precarga = {}
    for (const ing of ingredientes) {
      precarga[claveIngrediente(ing)] = { loteId: '', cantidad: (ing.cantidadOrientativa * cantidadSugerida).toFixed(3) }
    }
    setFilasConsumo(precarga)
  }, [cantidadSugerida, ingredientes])

  function recalcularConsumosSugeridos() {
    const objetivo = parseFloat(cantidadObjetivo)
    if (!objetivo || objetivo <= 0) return
    setFilasConsumo((prev) => {
      const next = {}
      for (const ing of ingredientes) {
        const clave = claveIngrediente(ing)
        next[clave] = { ...(prev[clave] ?? { loteId: '' }), cantidad: (ing.cantidadOrientativa * objetivo).toFixed(3) }
      }
      return next
    })
  }

  function filaDe(ing) {
    return filasConsumo[claveIngrediente(ing)] ?? { loteId: '', cantidad: '' }
  }

  function actualizarFila(ing, valor) {
    setFilasConsumo((prev) => ({ ...prev, [claveIngrediente(ing)]: valor }))
  }

  // Addenda "reorganización del bloque de registro de consumo": Map nombre -> fila de cadenaEstimacion,
  // para fusionar estimación/disponible dentro de cada línea de "Registrar consumo" (antes vivían en un
  // bloque aparte arriba). Mismo emparejamiento por nombre que ya usaba ese bloque -- ambas fuentes
  // vienen de una consulta de un solo nivel sobre la misma receta_semielaborado.semielaborado_id.
  const estimacionPorNombre = useMemo(() => new Map(cadenaEstimacion.map((f) => [f.nombre, f])), [cadenaEstimacion])

  // Addenda "consumo registrado por ingrediente": cuánto se ha CONFIRMADO ya (consumo_produccion, no el
  // borrador filasConsumo) de cada línea de receta -- cruza cada consumo por su articulo_id/
  // semielaborado_id real (ver selectCompleto y cargarIngredientesConLotes) en vez de por nombre, que no
  // coincide para un ingrediente genérico resuelto a un artículo comprado con otro nombre comercial.
  const consumoRegistradoPorIngrediente = useMemo(() => {
    const mapa = new Map()
    for (const c of produccion.consumo_produccion) {
      const ing = ingredientes.find((i) =>
        i.esArticulo
          ? c.entrada_material?.articulo_id != null && i.articuloIdsDeReceta?.includes(c.entrada_material.articulo_id)
          : c.producciones_semielaborado?.semielaborado_id === i.ingrediente_semielaborado_id
      )
      if (!ing) continue
      const clave = claveIngrediente(ing)
      mapa.set(clave, (mapa.get(clave) || 0) + Number(c.cantidad))
    }
    return mapa
  }, [produccion.consumo_produccion, ingredientes])

  const objetivoNum = parseFloat(objetivo)
  const hayObjetivo = objetivoNum > 0

  function precargarConEstimacion(ing, estimacion) {
    actualizarFila(ing, { ...filaDe(ing), cantidad: estimacion.necesario.toFixed(3) })
  }

  // Estimación completa de cada línea (necesario/disponible/insuficiente/registrado/cubierto) -- null
  // sin cantidad objetivo definida o si esa línea no tiene fila en cadenaEstimacion (mismo umbral que
  // ya usaba el bloque de estimación separado: antes ocultaba TODO el bloque sin objetivo, aquí oculta
  // solo la parte de estimación de cada línea, manteniendo "orientativo"). `cubierto` (addenda
  // "reordenamiento por consumo registrado" y "listo para cerrar"): consumo YA confirmado >= lo
  // estimado para el objetivo actual -- mismo criterio para ambos puntos, no se duplica. En línea
  // dentro del useMemo (no una función aparte) para que exhaustive-deps pueda listar sus dependencias
  // reales sin que la identidad de una función redefinida cada render invalide la memoización.
  const filasConEstimacion = useMemo(
    () =>
      ingredientes.map((ing) => {
        if (!hayObjetivo) return { ing, estimacion: null }
        const fila = estimacionPorNombre.get(ing.nombre)
        if (!fila) return { ing, estimacion: null }
        const necesario = fila.ratioPorUnidad * objetivoNum
        const disponible = fila.stock
        const registrado = consumoRegistradoPorIngrediente.get(claveIngrediente(ing)) || 0
        return {
          ing,
          estimacion: {
            necesario,
            disponible,
            insuficiente: necesario > disponible + 0.0001,
            registrado,
            cubierto: registrado >= necesario - 0.0001,
          },
        }
      }),
    [ingredientes, hayObjetivo, estimacionPorNombre, consumoRegistradoPorIngrediente, objetivoNum]
  )

  // Addenda "reordenamiento por consumo registrado": mismo criterio de reordenamiento que Producciones
  // del día (Bloque 3a, punto 2) -- lo pendiente arriba, lo ya cubierto abajo. Sin objetivo definido no
  // hay estimación contra la que comparar (`estimacion` es null para todas), así que no se reordena --
  // sort estable, se queda en el orden de receta de siempre.
  const filasOrdenadas = useMemo(() => {
    return [...filasConEstimacion].sort((a, b) => {
      const cubiertoA = a.estimacion?.cubierto ?? false
      const cubiertoB = b.estimacion?.cubierto ?? false
      if (cubiertoA !== cubiertoB) return cubiertoA ? 1 : -1
      return 0
    })
  }, [filasConEstimacion])

  // Addenda "indicador listo para cerrar": todas las líneas con estimación cubierta por su consumo
  // registrado -- puramente informativo, nunca deshabilita "Cerrar producción" (decisión explícita:
  // cerrar con más o menos de lo estimado es una decisión operativa del operador, no un requisito del
  // sistema). Sin objetivo definido no hay nada que evaluar -- no se muestra el indicador.
  const listoParaCerrar = hayObjetivo && ingredientes.length > 0 && filasConEstimacion.every(({ estimacion }) => estimacion?.cubierto)

  function filasCompletas() {
    return ingredientes
      .map((ing) => ({ ing, fila: filaDe(ing) }))
      .filter(({ fila }) => fila.loteId && parseFloat(fila.cantidad) > 0)
  }

  async function confirmarConsumo() {
    const completas = filasCompletas()
    if (completas.length === 0) {
      alert(t('produccion_comun:rellena_lote_cantidad'))
      return
    }

    setConfirmando(true)

    const filas = completas.map(({ ing, fila }) => {
      const loteId = parseInt(fila.loteId)
      const lote = ing.lotes.find((l) => (ing.esArticulo ? l.entrada_material_id : l.produccion_id) === loteId)
      const esSustitucion = !!lote && !lote.esDeReceta
      return {
        produccion_id: produccion.id,
        entrada_material_id: ing.esArticulo ? loteId : null,
        produccion_origen_id: ing.esArticulo ? null : loteId,
        cantidad: parseFloat(fila.cantidad),
        motivo: esSustitucion ? 'sustitucion_excepcional' : null,
        nota: esSustitucion ? (fila.nota || null) : null,
      }
    })

    const { error } = await supabase.from('consumo_produccion').insert(filas)

    setConfirmando(false)

    if (error) {
      alert(t('produccion_comun:alertas.ninguna_linea_guardada', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    setFilasConsumo({})
    await cargarIngredientes()
    onCambio()
  }

  async function quitarConsumo(consumoId) {
    const { error } = await supabase.from('consumo_produccion').delete().eq('id', consumoId)
    if (error) {
      alert(t('produccion_comun:alertas.error_quitar_consumo', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    await cargarIngredientes()
    onCambio()
  }

  async function cerrarProduccion() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert(t('produccion_comun:alertas.indica_cantidad_valida'))
      return
    }

    const pendientes = filasCompletas().length
    if (pendientes > 0) {
      const continuar = confirm(t('produccion_comun:pendientes_sin_confirmar', { count: pendientes }))
      if (!continuar) return
    }

    const { error } = await supabase
      .from('producciones_semielaborado')
      .update({
        cantidad_producida: parseFloat(cantidadProducida),
        estado: 'cerrada',
        notas: notas || null,
      })
      .eq('id', produccion.id)

    if (error) {
      alert(t('produccion_comun:alertas.error_cerrar_produccion', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))

    // Addenda "Navegación tras cerrar producción — vuelve a Producciones del día": a diferencia del
    // resto de acciones de esta tarjeta (que se quedan en /producciones y refrescan con onCambio()),
    // cerrar es el final natural del flujo -- el operador vuelve al panel de "qué producir hoy",
    // origen habitual de esta pantalla, en vez de quedarse en una tarjeta que ya no tiene nada que
    // registrar.
    navigate('/pedidos-del-dia')
  }

  return (
    <Card className="p-4 border-l-4 border-l-amber-400!">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold text-ink">{produccion.semielaborados?.nombre} <span className="text-amber-600 text-sm font-normal">— {t('produccion_comun:en_curso_badge')}</span></p>
          <p className="text-sm text-gray-500">{t('produccion_comun:iniciada_el', { fecha: formatFecha(produccion.fecha) })}</p>
        </div>
        {!cancelando && <LinkAction tone="red" onClick={() => setCancelando(true)}>{t('produccion_comun:cancelar_produccion')}</LinkAction>}
      </div>

      {cancelando && (
        <div className="mt-3 bg-red-50/60 border border-red-100 rounded-md p-3">
          <CancelarProduccionForm
            tipo="semielaborado"
            produccionId={produccion.id}
            onCancelado={() => { setCancelando(false); onCambio() }}
            onCerrar={() => setCancelando(false)}
          />
        </div>
      )}

      <div className="mt-3 flex items-end gap-3 flex-wrap">
        <Field label={t('produccion_comun:cantidad_objetivo', { unidad: produccion.semielaborados?.unidad })} className="w-56">
          <Input
            type="number"
            step="0.001"
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            onBlur={guardarObjetivo}
            placeholder={t('produccion_comun:sin_definir')}
            title={t('produccion_comun:ajuste_referencia_title')}
          />
        </Field>
        {guardandoObjetivo && <span className="text-xs text-gray-400">{t('common:actions.saving')}</span>}
      </div>

      {produccion.tanda_id && (
        <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-md p-3 flex items-end gap-3 flex-wrap">
          <Field label={t('producciones:cantidad_sugerida_tanda', { unidad: produccion.semielaborados?.unidad })} className="w-64">
            <Input
              type="number"
              step="0.001"
              value={cantidadObjetivo}
              onChange={(e) => setCantidadObjetivo(e.target.value)}
              placeholder={cantidadSugerida != null ? String(cantidadSugerida) : t('producciones:calculando_placeholder')}
            />
          </Field>
          <LinkAction tone="blue" onClick={recalcularConsumosSugeridos} className="text-xs">
            {t('producciones:recalcular_consumos')}
          </LinkAction>
        </div>
      )}

      {/* Addenda "reorganización del bloque de registro de consumo": botones de acción movidos aquí,
          por encima de "Consumo ya registrado" y "Registrar consumo" -- visibles sin scroll aunque la
          lista de ingredientes sea larga (antes quedaban al final de la tarjeta). */}
      <div className="border-t border-gray-100 mt-4 pt-4 flex items-center gap-3 flex-wrap">
        {!cargandoIngredientes && (
          <Button variant="success" size="sm" onClick={confirmarConsumo} disabled={confirmando}>
            {confirmando ? t('produccion_comun:confirmando') : `${t('produccion_comun:confirmar_consumo')}${filasCompletas().length > 0 ? ` (${filasCompletas().length})` : ''}`}
          </Button>
        )}
        {!cerrando && (
          <Button variant="success" size="sm" onClick={() => setCerrando(true)}>
            {t('produccion_comun:cerrar_produccion_boton')}
          </Button>
        )}
        {/* Addenda "indicador listo para cerrar": puramente informativo, no deshabilita ni sustituye al
            botón de arriba -- cerrar con más o menos de lo estimado sigue siendo decisión del operador. */}
        {listoParaCerrar && (
          <span className="text-xs text-green-700 font-medium inline-flex items-center gap-1">
            <IconCircleCheck size={14} /> {t('produccion_comun:consumo_suficiente_cerrar')}
          </span>
        )}
      </div>

      {cerrando && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Input type="number" step="0.001" placeholder={t('produccion_comun:cantidad_producida', { unidad: produccion.semielaborados?.unidad })}
            value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
            autoFocus title={t('common:redondea_3_decimales')} />
          <Input type="text" placeholder={t('produccion_comun:notas_placeholder')}
            value={notas} onChange={(e) => setNotas(e.target.value)} />
          <Button variant="success" onClick={cerrarProduccion}>{t('produccion_comun:confirmar_cierre')}</Button>
        </div>
      )}

      {produccion.consumo_produccion.length > 0 && (
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion.map((c) => {
              const { nombre, unidad } = nombreIngredienteDeLinea(c)
              return (
                <tr key={c.id}>
                  <td className="py-1.5 text-gray-500">{nombre}</td>
                  <td className="py-1.5">{c.cantidad} {unidad}</td>
                  <td className="py-1.5 text-right">
                    <LinkAction tone="red" onClick={() => quitarConsumo(c.id)} className="text-xs">{t('produccion_comun:quitar')}</LinkAction>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-600">{t('produccion_comun:registrar_consumo_titulo')}</h3>
          {filasOrdenadas.map(({ ing, estimacion }) => (
            <IngredienteConsumo key={claveIngrediente(ing)}
              ingrediente={ing}
              fechaDestino={produccion.fecha}
              value={filaDe(ing)}
              onChange={(valor) => actualizarFila(ing, valor)}
              estimacion={estimacion}
              cargandoEstimacion={hayObjetivo && cadenaEstimacionCargando}
              // Addenda "precarga solo sin consumo previo": con registrado > 0 (parcial o completo),
              // precargar la estimación TOTAL machacaría lo ya registrado con una cifra que ya no
              // corresponde a lo que falta -- ver esa addenda para el caso real que lo confirmó.
              onPrecargar={estimacion && estimacion.registrado === 0 ? () => precargarConEstimacion(ing, estimacion) : null} />
          ))}
        </div>
      )}
    </Card>
  )
}

// Fila controlada (lote + cantidad): el padre decide qué hacer con las
// líneas rellenas (confirmar en bloque, añadir a una edición, etc.) —
// este componente no tiene acción ni estado propios.
function labelLote(ingrediente, l, fechaDestino, t) {
  const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
  const aviso = caducado ? t('produccion_comun:lote_caducado_aviso') : ''
  const stockDisp = t('produccion_comun:lote_stock_disp', { stock: l.stock_disponible.toFixed(3), unidad: l.unidad })
  if (ingrediente.esArticulo) {
    const proveedor = l.proveedor ? `${l.proveedor} · ` : ''
    const numero = l.numero_albaran || t('produccion_comun:lote_sin_numero')
    const cad = l.fecha_caducidad ? ` · ${t('produccion_comun:lote_caducidad_abrev', { fecha: formatFecha(l.fecha_caducidad) })}` : ''
    return `${l.nombre} · ${proveedor}${t('produccion_comun:lote_albaran', { numero })} · ${formatFecha(l.fecha_recepcion)}${cad} · ${stockDisp}${aviso}`
  }
  const codigo = l.codigo_lote ? l.codigo_lote + ' · ' : ''
  return `${l.nombre} · ${codigo}${t('produccion_comun:lote_produccion_label', { fecha: formatFecha(l.fecha) })} · ${stockDisp}${aviso}`
}

// Addenda "reorganización del bloque de registro de consumo": `estimacion` ({necesario, disponible,
// insuficiente, registrado, cubierto} | null -- null sin cantidad objetivo o mientras se calcula) y
// `onPrecargar` (null si no hay estimación con la que precargar) fusionan aquí lo que antes vivía en un
// bloque de tabla aparte arriba de la tarjeta -- mismo dato, junto a "orientativo" de cada línea.
function IngredienteConsumo({ ingrediente, fechaDestino, value, onChange, estimacion, cargandoEstimacion, onPrecargar }) {
  const { t } = useTranslation(['produccion_comun'])
  const [mostrarSustituto, setMostrarSustituto] = useState(false)
  const idDeLote = (l) => (ingrediente.esArticulo ? l.entrada_material_id : l.produccion_id)
  const deReceta = ingrediente.lotes.filter((l) => l.esDeReceta)
  const otros = ingrediente.lotes.filter((l) => !l.esDeReceta)
  const loteSeleccionado = ingrediente.lotes.find((l) => value.loteId && idDeLote(l) === parseInt(value.loteId))
  const esSustitucion = !!loteSeleccionado && !loteSeleccionado.esDeReceta
  const panelSustitutoVisible = mostrarSustituto || esSustitucion

  function opcion(l) {
    return <option key={idDeLote(l)} value={idDeLote(l)}>{labelLote(ingrediente, l, fechaDestino, t)}</option>
  }

  return (
    <div className={`border rounded-md p-3 ${estimacion?.cubierto ? 'opacity-70' : ''} ${esSustitucion ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
      <p className="text-sm font-medium text-gray-700 flex items-center gap-2 flex-wrap">
        <span>
          {ingrediente.nombre}
          <span className="text-gray-400 font-normal"> — {t('orientativo', { cantidad: ingrediente.cantidadOrientativa, unidad: ingrediente.unidad })}</span>
          {cargandoEstimacion && <span className="text-gray-400 font-normal"> · {t('calculando_estimacion')}</span>}
          {estimacion && (
            <span className={`font-normal ${estimacion.insuficiente ? 'text-red-600' : 'text-gray-400'}`}>
              {' '}· {t('estimacion_linea', { necesario: estimacion.necesario.toFixed(3), unidad: ingrediente.unidad, disponible: estimacion.disponible.toFixed(3) })}
              {estimacion.insuficiente ? ` — ${t('insuficiente')}` : ''}
              {estimacion.registrado > 0 && ` · ${t('registrado_linea', { registrado: estimacion.registrado.toFixed(3), unidad: ingrediente.unidad })}${estimacion.cubierto ? ` ${t('cubre_estimacion')}` : ''}`}
            </span>
          )}
        </span>
        {onPrecargar && (
          <button type="button" onClick={onPrecargar}
            className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 text-xs shrink-0"
            title={t('precargar_estimacion_title')}>
            <IconWand size={14} /> {t('usar_estimacion')}
          </button>
        )}
        {esSustitucion && <span className="text-xs font-semibold text-amber-600">{t('sustitucion_badge')}</span>}
      </p>

      {deReceta.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 mt-2 items-center">
          <Select value={esSustitucion ? '' : value.loteId}
            onChange={(e) => onChange({ ...value, loteId: e.target.value, nota: '' })} className="text-sm">
            <option value="">{t('selecciona_lote')}</option>
            {deReceta.map(opcion)}
          </Select>
          <Input type="number" step="0.001" placeholder={t('cantidad_placeholder')} value={value.cantidad}
            onChange={(e) => onChange({ ...value, cantidad: e.target.value })}
            className="text-sm" title={t('common:redondea_3_decimales')} />
        </div>
      )}

      {deReceta.length === 0 && !panelSustitutoVisible && (
        <p className="text-sm text-red-500 mt-1">{t('sin_stock_ingrediente')}</p>
      )}

      {otros.length > 0 && !panelSustitutoVisible && (
        <LinkAction tone="blue" onClick={() => setMostrarSustituto(true)} className="text-xs mt-2 inline-block">
          {t('buscar_sustituto')}
        </LinkAction>
      )}

      {otros.length > 0 && panelSustitutoVisible && (
        <div className="mt-2 pt-2 border-t border-amber-200">
          <p className="text-xs font-semibold text-amber-700 mb-1.5 uppercase tracking-wide">{t('sustitucion_titulo')}</p>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 items-center">
            <Select value={esSustitucion ? value.loteId : ''}
              onChange={(e) => onChange({ ...value, loteId: e.target.value })} className="text-sm">
              <option value="">{t('selecciona_lote_sustituto')}</option>
              {otros.map(opcion)}
            </Select>
            {deReceta.length === 0 && (
              <Input type="number" step="0.001" placeholder={t('cantidad_placeholder')} value={value.cantidad}
                onChange={(e) => onChange({ ...value, cantidad: e.target.value })}
                className="text-sm" title={t('common:redondea_3_decimales')} />
            )}
          </div>
          <Input type="text" placeholder={t('motivo_sustitucion_placeholder')} value={value.nota ?? ''}
            onChange={(e) => onChange({ ...value, nota: e.target.value })}
            className="text-sm mt-2 w-full" />
        </div>
      )}
    </div>
  )
}

// CONTRATO_MEJORAS_MES.md, punto 1.3/1.6: fila de tabla con acordeón (mismo patrón que
// AlbaranesVenta.jsx BLOQUE 4) en vez de la <Card> apilada anterior. `expandido`/`onToggleExpandir`
// vienen del padre (acordeón de una sola fila a la vez); `editando` sigue siendo estado LOCAL de
// esta fila, exactamente igual que antes -- entrar en edición fuerza la fila abierta (`abierto =
// expandido || editando`) sin depender de si el padre ya la había expandido primero.
function ProduccionCerrada({ produccion, expandido, onToggleExpandir, consumidoInfo, onCambio, onBorrar }) {
  const { t } = useTranslation(['common', 'produccion_comun', 'producciones'])
  const [editando, setEditando] = useState(false)
  const abierto = expandido || editando

  // CONTRATO_AUDITORIA_CANCELACION_PRODUCCION.md: una producción 'cancelada' ya no tiene consumo
  // propio que mostrar (el RPC de cancelación borra sus filas de consumo_produccion al revertir el
  // stock, ver 20261020) -- se muestra el motivo/usuario/fecha de la cancelación en su lugar, y se
  // ocultan Editar/Borrar (dejarlas visibles permitiría deshacer con un DELETE el propio rastro de
  // auditoría que este contrato existe para preservar).
  const cancelada = produccion.estado === 'cancelada'

  // Punto 1.5: badge de estado de consumo -- consumidoInfo llega del padre (cargarHistorial), ya
  // agregado por produccion_origen_id a partir de consumo_produccion + consumo_produccion_pf.
  const consumido = consumidoInfo?.consumido || 0
  const { color, texto } = cancelada
    ? { color: 'gray', texto: t('produccion_comun:cancelada_badge') }
    : estadoConsumo(produccion.cantidad_producida, consumido, t)
  const detalleConsumidoPor = consumidoInfo?.detalle || []
  const detalleAjustes = consumidoInfo?.ajustesDetalle || []

  function iniciarEdicion() {
    setEditando(true)
    if (!expandido) onToggleExpandir()
  }

  return (
    <Fragment>
      <tr className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer" onClick={onToggleExpandir}>
        <td className="px-3 py-3">
          <button type="button" className="text-gray-400 hover:text-gray-600">
            {abierto ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </button>
        </td>
        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(produccion.fecha)}</td>
        <td className="px-3 py-3 font-medium text-ink">
          {produccion.semielaborados?.nombre}
          {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
        </td>
        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{produccion.cantidad_producida} {produccion.semielaborados?.unidad}</td>
        <td className="px-3 py-3 text-gray-500 italic max-w-[16rem] truncate" title={produccion.notas || undefined}>{produccion.notas || '—'}</td>
        <td className="px-3 py-3"><Badge color={color}>{texto}</Badge></td>
        <td className="px-3 py-3">
          {!cancelada && (
            <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
              <LinkAction tone="blue" onClick={iniciarEdicion} className="text-xs">{t('produccion_comun:editar')}</LinkAction>
              <LinkAction tone="red" onClick={onBorrar} className="text-xs">{t('produccion_comun:borrar')}</LinkAction>
            </div>
          )}
        </td>
      </tr>
      <tr>
        <td colSpan={7} className="p-0">
          {/* Mismo truco de altura animable (grid-template-rows 0fr<->1fr) que AlbaranesVenta.jsx
              BLOQUE 4 -- la fila de detalle queda siempre montada, solo colapsada. */}
          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${abierto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="bg-gray-50/60 px-3 py-3">
                {cancelada ? (
                  <div className="text-sm">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      {t('produccion_comun:motivo_cancelacion_titulo')}
                    </p>
                    <p className="text-gray-700 mb-2">{produccion.motivo_cancelacion}</p>
                    <p className="text-xs text-gray-400">
                      {t('produccion_comun:cancelada_el_por', {
                        fecha: produccion.cancelada_en ? formatFecha(produccion.cancelada_en) : '—',
                        email: produccion.cancelada_por_email || t('produccion_comun:usuario_desconocido'),
                      })}
                    </p>
                  </div>
                ) : editando ? (
                  <ProduccionCerradaEdicion
                    produccion={produccion}
                    onCancelar={() => setEditando(false)}
                    onGuardado={() => { setEditando(false); onCambio() }}
                  />
                ) : (
                  <>
                    {/* Punto 1.6.1: ingredientes consumidos por esta producción (aguas arriba) -- la
                        misma tabla que ya existía, sin cambios de fondo, solo movida aquí dentro. */}
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      {t('produccion_comun:ingredientes_consumidos_titulo')}
                    </p>
                    {produccion.consumo_produccion.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">{t('produccion_comun:sin_consumo_registrado')}</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody className="divide-y divide-gray-100">
                          {produccion.consumo_produccion.map((c) => {
                            const { nombre, unidad } = nombreIngredienteDeLinea(c)
                            return (
                              <tr key={c.id}>
                                <td className="py-1.5 text-gray-500">{nombre}</td>
                                <td className="py-1.5">{c.cantidad} {unidad}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}

                    {/* Punto 1.6.2: consumido por (aguas abajo) -- nuevo, a partir de consumidoInfo. */}
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('producciones:consumido_por_titulo')}</p>
                    {detalleConsumidoPor.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">{t('producciones:sin_consumo_registrado_todavia')}</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody className="divide-y divide-gray-100">
                          {detalleConsumidoPor.map((d, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-gray-500">
                                {d.nombre ?? '(sin nombre)'}{' '}
                                <span className="text-gray-400">({d.tipo === 'semielaborado' ? t('producciones:tipo_semielaborado') : t('producciones:tipo_producto_final')})</span>
                              </td>
                              <td className="py-1.5 text-gray-500">{d.fecha ? formatFecha(d.fecha) : '—'}</td>
                              <td className="py-1.5">{d.cantidad} {produccion.semielaborados?.unidad}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Punto 1.6.3 (corrección post-implementación, caso real WIP-MIXKZ-260060): ajustes
                        de stock -- sin este bloque, un lote corregido manualmente aparece "Completo" sin
                        explicar por qué el consumo por producción no llega al 100%. */}
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('produccion_comun:ajustes_stock_titulo')}</p>
                    {detalleAjustes.length === 0 ? (
                      <p className="text-sm text-gray-400">{t('produccion_comun:sin_ajustes_registrados')}</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-100">
                          {detalleAjustes.map((a, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-gray-500">{a.motivo || '(sin motivo)'}</td>
                              <td className="py-1.5 text-gray-500">{a.fecha ? formatFecha(a.fecha) : '—'}</td>
                              <td className={`py-1.5 ${Number(a.cantidad) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                {Number(a.cantidad) > 0 ? '+' : ''}{a.cantidad} {produccion.semielaborados?.unidad}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </td>
      </tr>
    </Fragment>
  )
}

function ProduccionCerradaEdicion({ produccion, onCancelar, onGuardado }) {
  const { t } = useTranslation(['common', 'produccion_comun'])
  const [fecha, setFecha] = useState(produccion.fecha)
  const [cantidadProducida, setCantidadProducida] = useState(String(produccion.cantidad_producida))
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [fechaCaducidad, setFechaCaducidad] = useState(produccion.fecha_caducidad ?? '')
  const [lineas, setLineas] = useState(() =>
    produccion.consumo_produccion.map((c) => {
      const { nombre, unidad } = nombreIngredienteDeLinea(c)
      return {
        id: c.id,
        entrada_material_id: c.entrada_material_id,
        produccion_origen_id: c.produccion_origen_id,
        cantidad: String(c.cantidad),
        _deleted: false,
        _nombre: nombre,
        _unidad: unidad,
      }
    })
  )
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [filasNuevas, setFilasNuevas] = useState({})

  useEffect(() => {
    cargarIngredientesConLotes(produccion.semielaborado_id).then((ings) => {
      setIngredientes(ings)
      setCargandoIngredientes(false)
    })
  }, [])

  function cambiarCantidadLinea(index, valor) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, cantidad: valor } : l)))
  }

  function quitarLinea(index) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, _deleted: true } : l)))
  }

  function filaNuevaDe(ing) {
    return filasNuevas[claveIngrediente(ing)] ?? { loteId: '', cantidad: '' }
  }

  function actualizarFilaNueva(ing, valor) {
    setFilasNuevas((prev) => ({ ...prev, [claveIngrediente(ing)]: valor }))
  }

  function filasNuevasCompletas() {
    return ingredientes
      .map((ing) => ({ ing, fila: filaNuevaDe(ing) }))
      .filter(({ fila }) => fila.loteId && parseFloat(fila.cantidad) > 0)
  }

  function anadirLineasRellenas() {
    const completas = filasNuevasCompletas()
    if (completas.length === 0) {
      alert(t('produccion_comun:rellena_lote_cantidad'))
      return
    }

    setLineas((prev) => [
      ...prev,
      ...completas.map(({ ing, fila }) => {
        const loteId = parseInt(fila.loteId)
        const lote = ing.lotes.find((l) => (ing.esArticulo ? l.entrada_material_id : l.produccion_id) === loteId)
        const esSustitucion = !!lote && !lote.esDeReceta
        return {
          id: null,
          entrada_material_id: ing.esArticulo ? loteId : null,
          produccion_origen_id: ing.esArticulo ? null : loteId,
          cantidad: String(parseFloat(fila.cantidad)),
          motivo: esSustitucion ? 'sustitucion_excepcional' : null,
          nota: esSustitucion ? (fila.nota || null) : null,
          _deleted: false,
          _nombre: ing.nombre,
          _unidad: ing.unidad,
        }
      }),
    ])
    setFilasNuevas({})
  }

  async function guardar() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert(t('produccion_comun:alertas.indica_cantidad_valida'))
      return
    }

    setGuardando(true)

    const p_lineas = lineas.map((l) => ({
      id: l.id,
      entrada_material_id: l.entrada_material_id,
      produccion_origen_id: l.produccion_origen_id,
      cantidad: parseFloat(l.cantidad),
      motivo: l.motivo ?? null,
      nota: l.nota ?? null,
      _deleted: l._deleted,
    }))

    const { error } = await supabase.rpc('rpc_editar_produccion_semielaborado', {
      p_id: produccion.id,
      p_fecha: fecha,
      p_cantidad_producida: parseFloat(cantidadProducida),
      p_notas: notas || null,
      p_lineas,
      p_fecha_caducidad: fechaCaducidad || null,
    })

    setGuardando(false)

    if (error) {
      alert(t('produccion_comun:alertas.edicion_invalida', { mensaje: error.message }))
      return
    }

    onGuardado()
  }

  return (
    <Card className="p-4 border-l-4 border-l-primary-600!">
      <p className="font-semibold text-ink mb-3">
        {t('produccion_comun:editando_produccion_de', { nombre: produccion.semielaborados?.nombre })}
        {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label={t('produccion_comun:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={t('produccion_comun:cantidad_producida', { unidad: produccion.semielaborados?.unidad })}>
          <Input type="number" step="0.001" value={cantidadProducida}
            onChange={(e) => setCantidadProducida(e.target.value)} title={t('common:redondea_3_decimales')} />
        </Field>
        <Field label={t('produccion_comun:notas_label')}>
          <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
        <Field label={t('produccion_comun:fecha_caducidad_opcional')}>
          <DateInput value={fechaCaducidad} onChange={setFechaCaducidad} />
        </Field>
      </div>

      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">{t('produccion_comun:lineas_consumo_titulo')}</p>
      <div className="flex flex-col gap-2">
        {lineas.filter((l) => !l._deleted).map((linea) => {
          const index = lineas.indexOf(linea)
          return (
            <div key={index} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-center border border-gray-200 rounded-md p-2">
              <span className="text-sm text-gray-600">{linea._nombre}</span>
              <Input type="number" step="0.001" value={linea.cantidad}
                onChange={(e) => cambiarCantidadLinea(index, e.target.value)}
                className="text-sm" title={t('common:redondea_3_decimales')} />
              <button type="button" onClick={() => quitarLinea(index)} className="text-gray-400 hover:text-red-600 justify-self-center">
                <IconTrash size={16} />
              </button>
            </div>
          )
        })}
        {lineas.every((l) => l._deleted) && <p className="text-sm text-gray-400">{t('produccion_comun:sin_lineas_consumo')}</p>}
      </div>

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{t('produccion_comun:anadir_mas_consumo')}</p>
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={claveIngrediente(ing)}
              ingrediente={ing}
              fechaDestino={fecha}
              value={filaNuevaDe(ing)}
              onChange={(valor) => actualizarFilaNueva(ing, valor)} />
          ))}
          <Button variant="secondary" size="sm" onClick={anadirLineasRellenas}>
            {`${t('produccion_comun:anadir_lineas')}${filasNuevasCompletas().length > 0 ? ` (${filasNuevasCompletas().length})` : ''}`}
          </Button>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <Button onClick={guardar} disabled={guardando}>{guardando ? t('common:actions.saving') : t('produccion_comun:guardar_cambios')}</Button>
        <Button variant="secondary" onClick={onCancelar} disabled={guardando}>{t('common:actions.cancel')}</Button>
      </div>
    </Card>
  )
}

export default Producciones
