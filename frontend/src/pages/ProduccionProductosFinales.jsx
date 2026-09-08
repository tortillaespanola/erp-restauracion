import { useState, useEffect, useMemo, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconTrash, IconWand, IconCircleCheck, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Badge, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

// CONTRATO_MEJORAS_MES.md, punto 2: mismos criterios que Producciones.jsx (punto 1) -- 20 por
// página, y el mismo umbral de tolerancia para el badge de estado.
const PAGINA_TAMANO = 20
const EPS = 0.0005

// Punto 2.4: estado de despacho de una tanda de producto final -- basado en
// previsiones_distribucion_pf (previsto/repartido a pedido), NO en lineas_albaran_venta (facturado
// real), decisión ya cerrada en el contrato. Mismos 3 colores/umbrales que estadoConsumo en
// Producciones.jsx, con etiquetas propias de despacho -- se mantiene como copia aparte (no una
// función compartida) porque son dos conceptos de negocio distintos que hoy comparten forma por
// coincidencia, no por relación. Corrección preventiva (mismo hueco detectado en Semielaborados,
// punto 1.5): `previsto` ya llega con ajustes_producto_final restados (ver cargarHistorial) -- puede
// superar `cantidadProducida` o quedar por debajo de 0, por eso el % se acota explícitamente entre 0
// y 100 antes de decidir el badge, mismo criterio que estadoConsumo.
//
// CONTRATO_I18N.md, Fase 1: `t` como parámetro (función pura) -- etiquetas en estados_calculados.json,
// nunca en enums.json (estado calculado en cliente, no un valor crudo de un CHECK de BD).
function estadoDespacho(cantidadProducida, previsto, t) {
  const cantidad = Number(cantidadProducida) || 0
  const prev = Number(previsto) || 0
  if (prev <= EPS) return { color: 'gray', texto: t('estados_calculados:despacho.no_despachado') }
  const pctBruto = cantidad > 0 ? (prev / cantidad) * 100 : 100
  const pct = Math.max(0, Math.min(100, pctBruto))
  if (pct >= 100 - EPS) return { color: 'green', texto: t('estados_calculados:despacho.despachado') }
  return { color: 'amber', texto: t('estados_calculados:despacho.parcial', { pct: pct.toFixed(0) }) }
}

// Trae TODOS los lotes disponibles de cada tipo (artículo/semielaborado),
// sin filtrar por receta — entrada #9: se permite elegir cualquiera,
// marcando cada lote como esDeReceta o no, para poder destacar el normal
// y detectar una sustitución excepcional al confirmar.
async function cargarIngredientesConLotes(productoFinalId) {
  const [{ data: receta }, { data: todosLotesArticulo }, { data: todosLotesSemi }, { data: todosArticulos }] = await Promise.all([
    supabase
      .from('receta_producto_final')
      .select('id, cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id, articulos_compra(nombre, unidad, categoria_id), semielaborados(nombre, unidad), ingredientes(nombre, unidad)')
      .eq('producto_final_id', productoFinalId),
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
        // Addenda "traslado del patrón de estimación a Producto final": TODOS los articulo_id que
        // resuelven esta línea de receta -- mismo campo que Producciones.jsx (addenda "consumo
        // registrado por ingrediente"), necesario para reconstruir cuánto se ha consumido YA de esta
        // línea cruzando por articulo_id real, no por nombre (un ingrediente genérico puede resolver a
        // un artículo comprado con nombre comercial distinto).
        articuloIdsDeReceta,
        nombre: esArticuloDirecto ? linea.articulos_compra?.nombre : esIngrediente ? linea.ingredientes?.nombre : linea.semielaborados?.nombre,
        unidad: esArticuloDirecto ? linea.articulos_compra?.unidad : esIngrediente ? linea.ingredientes?.unidad : linea.semielaborados?.unidad,
        cantidadOrientativa: linea.cantidad,
        lotes,
      }
    })
  )
}

// Traslado de cargarCadenaCompleta (Producciones.jsx, addenda "nivel directo de receta en Vista 2"):
// nivel DIRECTO de `receta_producto_final` del producto final indicado, mismo criterio de resolución
// y mismo alcance de una sola consulta que validarStockReceta() -- usado aquí para la estimación
// reactiva de "Producción en curso" (`ratioPorUnidad` × cantidad objetivo, sin volver a consultar en
// cada tecleo). Solo cambia la tabla/columna padre y el nombre de la FK (ver CONFIG_RECETA en
// validarStockReceta.js) respecto al original de Semielaborados.
async function cargarEstimacionPF(productoFinalId) {
  const { data: receta } = await supabase
    .from('receta_producto_final')
    .select('cantidad, articulo_id, ingrediente_id, ingrediente_semielaborado_id, articulos_compra(nombre, unidad), semielaborados!receta_producto_final_ingrediente_semielaborado_id_fkey(nombre, unidad), ingredientes(nombre, unidad)')
    .eq('producto_final_id', productoFinalId)

  const lineasSemi = (receta || []).filter((l) => l.ingrediente_semielaborado_id)
  const idsSemis = lineasSemi.map((l) => l.ingrediente_semielaborado_id)
  const idsIngredientes = (receta || []).filter((l) => l.ingrediente_id).map((l) => l.ingrediente_id)

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

  const gruposHoja = new Map()
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

// Nivel `nivel` de necesidades_pedidos() sobre los pedidos de una tanda — recalculado en vivo contra
// el conjunto ACTUAL de pedidos de la tanda (no memorizado desde la Pantalla 1), mismo patrón ya
// usado en Producciones.jsx.
async function necesidadesDeTanda(tandaId, nivel) {
  const { data: pedidos } = await supabase.from('pedidos_venta').select('id').eq('tanda_id', tandaId)
  const pedidoIds = (pedidos || []).map((p) => p.id)
  if (pedidoIds.length === 0) return []

  const { data: necesidades, error } = await supabase.rpc('necesidades_pedidos', { p_pedido_ids: pedidoIds })
  if (error) {
    console.error('Error calculando necesidades de la tanda:', error)
    return []
  }
  return (necesidades || []).filter((n) => n.nivel === nivel)
}

function nombreIngredienteDeLinea(c) {
  const ing = c.entrada_material?.articulos_compra ?? c.producciones_semielaborado?.semielaborados
  return { nombre: ing?.nombre, unidad: ing?.unidad }
}

function claveIngrediente(ing) {
  return `${ing.esArticulo ? 'art' : 'semi'}-${ing.articulo_id ?? ing.ingrediente_id ?? ing.ingrediente_semielaborado_id}`
}

function ProduccionProductosFinales() {
  const [searchParams] = useSearchParams()
  const { t } = useTranslation(['common', 'produccion_comun', 'produccion_productos_finales'])
  const [productos, setProductos] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [stockTotal, setStockTotal] = useState([])
  const [cargando, setCargando] = useState(true)

  const pedidoId = searchParams.get('pedido_id')
  const tandaId = searchParams.get('tanda_id')
  // CONTRATO_MEJORAS_MES.md, punto 2.1: mismo desplegable de siempre ("Iniciar nueva producción"),
  // reutilizado también como filtro de Stock actual (2.2) e Historial (2.3) -- mismo patrón de un
  // único desplegable con doble propósito que semielaboradoId en Producciones.jsx, no uno nuevo.
  const [productoId, setProductoId] = useState(searchParams.get('producto_final_id') ?? '')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))
  // Addenda "traslado del patrón de estimación a Producto final": mismo campo `cantidadPlan` de
  // Producciones.jsx -- valor inicial opcional que se persiste como cantidad_objetivo al iniciar, sin
  // el cual la tarjeta de "Producción en curso" no tendría con qué calcular la estimación por línea.
  const [cantidadPlan, setCantidadPlan] = useState(searchParams.get('cantidad') || '')

  // Punto 2.3: historial general de producciones cerradas, paginado server-side, filtrado por
  // productoId solo si hay uno seleccionado -- mismo tratamiento que el punto 1 de Producciones.jsx.
  const [historial, setHistorial] = useState([])
  const [cargandoHistorial, setCargandoHistorial] = useState(true)
  const [historialPagina, setHistorialPagina] = useState(1)
  const [totalHistorial, setTotalHistorial] = useState(0)
  const totalPaginasHistorial = Math.max(1, Math.ceil(totalHistorial / PAGINA_TAMANO))
  // Punto 2.4/2.5: previsto (para el badge) + detalle de reparto a pedidos de cada tanda VISIBLE en
  // la página actual -- Map id -> { previsto, detalle: [{linea_pedido_id, cantidad_prevista, cliente,
  // codigoPedido, fechaEntrega}] }, recalculado en cada carga de página.
  const [despachoPorTanda, setDespachoPorTanda] = useState(new Map())
  // Punto 2.3 (mismo criterio que 1.3): un único id expandido a la vez.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // Si solo hace falta un producto final para esta tanda, se preselecciona — igual que en
  // Producciones.jsx con el semielaborado.
  useEffect(() => {
    if (!tandaId) return
    necesidadesDeTanda(tandaId, 'producto_final').then((pfs) => {
      if (pfs.length === 1) setProductoId(String(pfs[0].item_id))
    })
  }, [tandaId])

  async function cargarDatos() {
    setCargando(true)

    const selectCompleto = `
      *,
      productos_finales(nombre),
      pedidos_venta(codigo_pedido),
      consumo_produccion_pf!consumo_produccion_pf_produccion_pf_id_fkey(
        id, cantidad,
        entrada_material_id, produccion_origen_id,
        entrada_material(articulo_id, articulos_compra(nombre, unidad)),
        producciones_semielaborado!consumo_produccion_pf_produccion_origen_id_fkey(semielaborado_id, semielaborados(nombre, unidad))
      )
    `

    const [resProd, resAbiertas, resStock] = await Promise.all([
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('producciones_producto_final').select(selectCompleto).eq('estado', 'abierta').order('fecha', { ascending: false }),
      supabase.from('stock_productos_finales').select('*'),
    ])

    if (resProd.error) console.error(resProd.error)
    else setProductos(resProd.data)

    if (resAbiertas.error) console.error(resAbiertas.error)
    else setAbiertas(resAbiertas.data)

    if (resStock.error) console.error(resStock.error)
    else setStockTotal(resStock.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // Punto 2.2: stock actual filtrado por productoId -- "Todos" (vacío) se comporta como hoy, sin
  // filtro. Cálculo en cliente sobre stockTotal ya cargado (tabla pequeña), sin una consulta aparte.
  const stockFiltrado = useMemo(() => {
    if (!productoId) return stockTotal
    return stockTotal.filter((s) => s.producto_final_id === parseInt(productoId))
  }, [stockTotal, productoId])

  // Punto 2.3: historial paginado server-side (mismo patrón .range() + { count: 'exact' } que
  // Producciones.jsx/FacturasVenta.jsx), filtrado por productoId solo si hay uno seleccionado. El
  // select de cada fila reutiliza el mismo embed de consumo_produccion_pf que antes traía
  // cargarDatos() para `cerradas` -- el bloque de ingredientes consumidos no cambia de fondo, solo de
  // sitio (detalle expandible).
  async function cargarHistorial() {
    setCargandoHistorial(true)

    let historialQuery = supabase
      .from('producciones_producto_final')
      .select(
        `
        *,
        productos_finales(nombre),
        pedidos_venta(codigo_pedido),
        consumo_produccion_pf!consumo_produccion_pf_produccion_pf_id_fkey(
          id, cantidad,
          entrada_material_id, produccion_origen_id,
          entrada_material(articulo_id, articulos_compra(nombre, unidad)),
          producciones_semielaborado!consumo_produccion_pf_produccion_origen_id_fkey(semielaborado_id, semielaborados(nombre, unidad))
        )
      `,
        { count: 'exact' }
      )
      .eq('estado', 'cerrada')

    if (productoId) historialQuery = historialQuery.eq('producto_final_id', parseInt(productoId))

    historialQuery = historialQuery.order('fecha', { ascending: false }).order('id', { ascending: true })
    const desde = (historialPagina - 1) * PAGINA_TAMANO
    historialQuery = historialQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const { data: dataHistorial, error: errorHistorial, count } = await historialQuery
    if (errorHistorial) {
      console.error('Error cargando el historial de producciones:', errorHistorial)
      setHistorial([])
      setTotalHistorial(0)
      setDespachoPorTanda(new Map())
      setCargandoHistorial(false)
      return
    }

    setHistorial(dataHistorial || [])
    setTotalHistorial(count ?? 0)

    // Punto 2.4/2.5: previsto + detalle de reparto de cada tanda VISIBLE en esta página, a partir de
    // previsiones_distribucion_pf -- mismo patrón que sumaPrevistoPorTanda en PedidosDelDia.jsx, pero
    // indexado por tanda cerrada en vez de por producto agregado. linea_pedido_id tiene una única FK
    // (sin ambigüedad, no hace falta hint `!fkey`), se embebe cliente/código/fecha de entrega para que
    // el detalle sea legible (no una lista de ids sueltos) -- mismo criterio que "Consumido por" en
    // Producciones.jsx. Corrección preventiva (mismo hueco detectado en Semielaborados, punto 1.5):
    // se resta también ajustes_producto_final -- hoy siempre 0 filas en el sistema, pero el cálculo
    // queda listo desde el diseño inicial, sin esperar a que se registre el primero con datos reales.
    const idsVisibles = (dataHistorial || []).map((p) => p.id)
    const mapaDespacho = new Map()
    if (idsVisibles.length > 0) {
      const [resPrevisiones, resAjustes] = await Promise.all([
        supabase
          .from('previsiones_distribucion_pf')
          .select(
            'produccion_pf_id, linea_pedido_id, cantidad_prevista, lineas_pedido_venta(pedidos_venta(codigo_pedido, fecha_entrega_prevista, clientes(nombre)))'
          )
          .in('produccion_pf_id', idsVisibles),
        supabase
          .from('ajustes_producto_final')
          .select('produccion_pf_id, cantidad, motivo_categoria, motivo_detalle, fecha')
          .in('produccion_pf_id', idsVisibles),
      ])

      if (resPrevisiones.error) console.error('Error cargando previsiones de distribución:', resPrevisiones.error)
      if (resAjustes.error) console.error('Error cargando ajustes de stock:', resAjustes.error)

      const obtener = (id) => {
        let entrada = mapaDespacho.get(id)
        if (!entrada) {
          entrada = { previsto: 0, detalle: [], ajustesTotal: 0, ajustesDetalle: [] }
          mapaDespacho.set(id, entrada)
        }
        return entrada
      }
      for (const p of resPrevisiones.data || []) {
        const entrada = obtener(p.produccion_pf_id)
        entrada.previsto += Number(p.cantidad_prevista)
        entrada.detalle.push({
          linea_pedido_id: p.linea_pedido_id,
          cantidad_prevista: Number(p.cantidad_prevista),
          cliente: p.lineas_pedido_venta?.pedidos_venta?.clientes?.nombre,
          codigoPedido: p.lineas_pedido_venta?.pedidos_venta?.codigo_pedido,
          fechaEntrega: p.lineas_pedido_venta?.pedidos_venta?.fecha_entrega_prevista,
        })
      }
      // Punto 2.4 (fórmula corregida): repartido neto = previsto - ajustes -- mismo criterio de signo
      // que Producciones.jsx: un ajuste negativo (unidades defectuosas dadas de baja) SUMA a
      // "repartido" (menos queda por despachar de lo que realmente existe); uno positivo resta.
      for (const a of resAjustes.data || []) {
        const entrada = obtener(a.produccion_pf_id)
        entrada.previsto -= Number(a.cantidad)
        entrada.ajustesTotal += Number(a.cantidad)
        entrada.ajustesDetalle.push({
          cantidad: Number(a.cantidad),
          motivo: [a.motivo_categoria, a.motivo_detalle].filter(Boolean).join(' — '),
          fecha: a.fecha,
        })
      }
    }
    setDespachoPorTanda(mapaDespacho)

    setCargandoHistorial(false)
  }

  useEffect(() => {
    cargarHistorial()
  }, [productoId, historialPagina])

  async function iniciarProduccion(e) {
    e.preventDefault()
    if (!productoId) return

    const cantidadInicial = parseFloat(cantidadPlan)
    const { error } = await supabase
      .from('producciones_producto_final')
      .insert({
        producto_final_id: parseInt(productoId),
        estado: 'abierta',
        fecha: fechaInicio,
        pedido_id: pedidoId ? parseInt(pedidoId) : null,
        tanda_id: tandaId || null,
        cantidad_objetivo: cantidadInicial > 0 ? cantidadInicial : null,
      })

    if (error) {
      alert(t('produccion_comun:alertas.error_iniciar_produccion', { mensaje: error.message }))
      return
    }

    setProductoId('')
    setCantidadPlan('')
    setFechaInicio(new Date().toISOString().slice(0, 10))
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm(t('produccion_productos_finales:confirmar_cancelar'))) return
    const { error } = await supabase.from('producciones_producto_final').delete().eq('id', id)
    if (error) {
      alert(t('produccion_comun:alertas.error_cancelar', { mensaje: error.message }))
      return
    }
    cargarDatos()
  }

  async function handleBorrarCerrada(id) {
    if (!confirm(t('produccion_productos_finales:confirmar_borrar'))) return
    const { error } = await supabase.from('producciones_producto_final').delete().eq('id', id)
    if (error) {
      alert(t('produccion_comun:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    cargarHistorial()
  }

  const productoSeleccionado = productos.find((p) => String(p.id) === productoId)

  return (
    <div>
      <PageHeader
        title={t('produccion_productos_finales:titulo')}
        subtitle={tandaId ? t('produccion_productos_finales:subtitulo_tanda') : t('produccion_productos_finales:subtitulo_normal')}
      />

      <Card className="mb-6">
        <CardBody>
          {pedidoId && (
            <p className="text-sm text-[#0854A0] mb-3">{t('produccion_productos_finales:produccion_enlazada_pedido')}</p>
          )}
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
            <Field label={t('produccion_comun:campos.iniciar_nueva_produccion')}>
              <Select
                value={productoId}
                onChange={(e) => { setProductoId(e.target.value); setHistorialPagina(1) }}
                required
              >
                <option value="">{t('produccion_comun:campos.selecciona_que_produces')}</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('produccion_comun:campos.fecha')}>
              <DateInput value={fechaInicio} onChange={setFechaInicio} required />
            </Field>
            <Field label={t('produccion_productos_finales:cantidad_a_producir_opcional')}>
              <Input type="number" step="0.001" value={cantidadPlan} onChange={(e) => setCantidadPlan(e.target.value)}
                placeholder={t('produccion_comun:sin_definir')} title={t('common:redondea_3_decimales')} />
            </Field>
            <Button type="submit">{t('produccion_comun:campos.iniciar')}</Button>
          </form>
        </CardBody>
      </Card>

      {abiertas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-[#1C2938] mb-3">{t('produccion_comun:producciones_en_curso')}</h2>
          <div className="flex flex-col gap-4">
            {abiertas.map((p) => (
              <ProduccionAbierta
                key={p.id}
                produccion={p}
                onCambio={cargarDatos}
                onCancelar={() => handleCancelar(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* CONTRATO_MEJORAS_MES.md, punto 2.2: la tabla se mantiene SIEMPRE visible (a diferencia del
          "Stock disponible" de Producciones.jsx) -- con "Todos" se comporta como hoy, mostrando todos
          los productos; con un producto seleccionado, filtra a ese único producto. */}
      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">
        {productoSeleccionado ? t('produccion_productos_finales:stock_actual_de', { nombre: productoSeleccionado.nombre }) : t('produccion_productos_finales:stock_actual_titulo')}
      </h2>
      {cargando ? (
        <LoadingState />
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th>{t('produccion_productos_finales:tabla.producto')}</Th>
              <Th>{t('produccion_productos_finales:tabla.stock')}</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {stockFiltrado.map((s) => (
                <tr key={s.producto_final_id} className="hover:bg-blue-50/40">
                  <Td className="font-medium">{s.nombre}</Td>
                  <Td>{Number(s.stock).toFixed(3)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Punto 2.3: historial siempre visible, paginado y con acordeón -- mismo tratamiento que el
          punto 1 de Producciones.jsx. */}
      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">
        {productoSeleccionado ? t('produccion_productos_finales:historial_titulo_de', { nombre: productoSeleccionado.nombre }) : t('produccion_productos_finales:historial_titulo')}
      </h2>
      {cargandoHistorial ? (
        <LoadingState />
      ) : historial.length === 0 ? (
        <Card className="mb-8">
          <EmptyState>
            {productoId ? t('produccion_productos_finales:sin_producciones_cerradas_de') : t('produccion_productos_finales:sin_producciones_cerradas')}
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
                  <th className="px-3 py-2.5 font-medium">{t('produccion_productos_finales:tabla_historial.producto')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_comun:tabla.cantidad_producida')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_comun:tabla.notas')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('produccion_productos_finales:tabla_historial.estado_despacho')}</th>
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
                    despachoInfo={despachoPorTanda.get(p.id)}
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
                className={`w-7 h-7 text-xs rounded-md ${n === historialPagina ? 'bg-[#0854A0] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
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

function ProduccionAbierta({ produccion, onCambio, onCancelar }) {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'produccion_comun', 'produccion_productos_finales'])
  const UNIDADES = t('produccion_productos_finales:unidad_larga')
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [filasConsumo, setFilasConsumo] = useState({})
  const [confirmando, setConfirmando] = useState(false)

  const [cantidadProducida, setCantidadProducida] = useState('')
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [cerrando, setCerrando] = useState(false)

  // Addenda "traslado del patrón de estimación a Producto final": valor PERSISTIDO (columna
  // cantidad_objetivo, la que se indicó al pulsar "Iniciar" o la que se ajuste aquí) -- mismo patrón
  // que Producciones.jsx (addenda "Cantidad objetivo y estimación en Producción en curso"), a
  // diferencia del vínculo al pedido de origen (tanda_id/pedido_id, sin tocar), que se conserva
  // completamente aparte.
  const [objetivo, setObjetivo] = useState(produccion.cantidad_objetivo != null ? String(produccion.cantidad_objetivo) : '')
  const [guardandoObjetivo, setGuardandoObjetivo] = useState(false)

  // Cadena de nivel directo (mismo cálculo que "Estimación para X" en Producciones.jsx) para la
  // estimación de esta tarjeta -- se carga una sola vez al montar, el objetivo solo multiplica
  // ratioPorUnidad en el render.
  const [cadenaEstimacion, setCadenaEstimacion] = useState([])
  const [cadenaEstimacionCargando, setCadenaEstimacionCargando] = useState(true)

  const [produccionesSemiCerradasDeTanda, setProduccionesSemiCerradasDeTanda] = useState(null)
  const [loteRecienCerradoPrecargado, setLoteRecienCerradoPrecargado] = useState(false)

  async function cargarIngredientes() {
    setCargandoIngredientes(true)
    setIngredientes(await cargarIngredientesConLotes(produccion.producto_final_id))
    setCargandoIngredientes(false)
  }

  useEffect(() => {
    cargarIngredientes()
  }, [])

  useEffect(() => {
    cargarEstimacionPF(produccion.producto_final_id).then((filas) => {
      setCadenaEstimacion(filas)
      setCadenaEstimacionCargando(false)
    })
  }, [])

  async function guardarObjetivo() {
    const valor = objetivo === '' ? null : parseFloat(objetivo)
    if (valor != null && (Number.isNaN(valor) || valor <= 0)) return
    if (valor === (produccion.cantidad_objetivo ?? null)) return
    setGuardandoObjetivo(true)
    const { error } = await supabase.from('producciones_producto_final').update({ cantidad_objetivo: valor }).eq('id', produccion.id)
    setGuardandoObjetivo(false)
    if (error) {
      alert(t('produccion_comun:alertas.error_guardar_objetivo', { mensaje: error.message }))
      return
    }
    onCambio()
  }

  // Addenda "traslado del patrón de estimación a Producto final": esto ya NO calcula ninguna cantidad
  // sugerida (ver el fix "eliminar Recalcular consumos sugeridos" en la addenda) -- solo resuelve qué
  // producciones_semielaborado ya están cerradas bajo la misma tanda, necesario para preseleccionar el
  // lote de Mezcla recién cerrado más abajo. tanda_id/pedido_id no se tocan -- el vínculo al pedido de
  // origen sigue existiendo independientemente de este cálculo.
  useEffect(() => {
    if (!produccion.tanda_id) return
    supabase
      .from('producciones_semielaborado')
      .select('id')
      .eq('tanda_id', produccion.tanda_id)
      .eq('estado', 'cerrada')
      .then(({ data }) => setProduccionesSemiCerradasDeTanda((data || []).map((p) => p.id)))
  }, [])

  // Preselección del lote de Mezcla recién cerrada bajo la misma tanda -- en un flujo POS lo normal es
  // consumir de inmediato lo que se acaba de producir, no solo ordenarlo por caducidad como el resto de
  // casos. Separado deliberadamente de la cantidad (addenda "eliminar Recalcular consumos sugeridos"):
  // solo rellena el lote, la cantidad de cada línea se registra a mano o vía "Usar estimación".
  // `loteRecienCerradoPrecargado` evita repetirlo en recargas posteriores de `ingredientes` (ej. tras
  // confirmar consumo).
  useEffect(() => {
    if (ingredientes.length === 0 || produccionesSemiCerradasDeTanda == null || loteRecienCerradoPrecargado) return
    setLoteRecienCerradoPrecargado(true)
    const precarga = {}
    for (const ing of ingredientes) {
      if (ing.esArticulo) continue
      const loteRecienCerrado = ing.lotes.find((l) => l.esDeReceta && produccionesSemiCerradasDeTanda.includes(l.produccion_id))
      if (loteRecienCerrado) precarga[claveIngrediente(ing)] = { loteId: String(loteRecienCerrado.produccion_id), cantidad: '' }
    }
    if (Object.keys(precarga).length > 0) setFilasConsumo((prev) => ({ ...prev, ...precarga }))
  }, [ingredientes, produccionesSemiCerradasDeTanda, loteRecienCerradoPrecargado])

  function filaDe(ing) {
    return filasConsumo[claveIngrediente(ing)] ?? { loteId: '', cantidad: '' }
  }

  function actualizarFila(ing, valor) {
    setFilasConsumo((prev) => ({ ...prev, [claveIngrediente(ing)]: valor }))
  }

  // Addenda "traslado del patrón de estimación a Producto final": Map nombre -> fila de
  // cadenaEstimacion, para fusionar estimación/disponible dentro de cada línea de "Registrar consumo"
  // -- mismo emparejamiento por nombre que Producciones.jsx (ambas fuentes vienen de una consulta de
  // un solo nivel sobre la misma receta_producto_final.producto_final_id).
  const estimacionPorNombre = useMemo(() => new Map(cadenaEstimacion.map((f) => [f.nombre, f])), [cadenaEstimacion])

  // Cuánto se ha CONFIRMADO ya (consumo_produccion_pf, no el borrador filasConsumo) de cada línea de
  // receta -- cruza cada consumo por su articulo_id/semielaborado_id real (ver selectCompleto y
  // cargarIngredientesConLotes), no por nombre.
  const consumoRegistradoPorIngrediente = useMemo(() => {
    const mapa = new Map()
    for (const c of produccion.consumo_produccion_pf) {
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
  }, [produccion.consumo_produccion_pf, ingredientes])

  const objetivoNum = parseFloat(objetivo)
  const hayObjetivo = objetivoNum > 0

  function precargarConEstimacion(ing, estimacion) {
    actualizarFila(ing, { ...filaDe(ing), cantidad: estimacion.necesario.toFixed(3) })
  }

  // Estimación completa de cada línea (necesario/disponible/insuficiente/registrado/cubierto) -- null
  // sin cantidad objetivo definida o si esa línea no tiene fila en cadenaEstimacion. Inline dentro del
  // useMemo (no una función aparte) para que exhaustive-deps liste sus dependencias reales sin que la
  // identidad de una función redefinida cada render invalide la memoización -- mismo motivo que en
  // Producciones.jsx.
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

  // Mismo criterio de reordenamiento que Producciones.jsx (Bloque 3b) -- lo pendiente arriba, lo ya
  // cubierto abajo. Sin objetivo definido no hay estimación contra la que comparar, así que no se
  // reordena.
  const filasOrdenadas = useMemo(() => {
    return [...filasConEstimacion].sort((a, b) => {
      const cubiertoA = a.estimacion?.cubierto ?? false
      const cubiertoB = b.estimacion?.cubierto ?? false
      if (cubiertoA !== cubiertoB) return cubiertoA ? 1 : -1
      return 0
    })
  }, [filasConEstimacion])

  // Indicador "listo para cerrar" -- puramente informativo, nunca deshabilita "Cerrar producción"
  // (mismo criterio que Producciones.jsx: cerrar con más o menos de lo estimado es decisión operativa
  // del operador).
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
        produccion_pf_id: produccion.id,
        entrada_material_id: ing.esArticulo ? loteId : null,
        produccion_origen_id: ing.esArticulo ? null : loteId,
        cantidad: parseFloat(fila.cantidad),
        motivo: esSustitucion ? 'sustitucion_excepcional' : null,
        nota: esSustitucion ? (fila.nota || null) : null,
      }
    })

    const { error } = await supabase.from('consumo_produccion_pf').insert(filas)

    setConfirmando(false)

    if (error) {
      alert(t('produccion_comun:alertas.ninguna_linea_guardada', { mensaje: error.message }))
      return
    }

    setFilasConsumo({})
    await cargarIngredientes()
    onCambio()
  }

  async function quitarConsumo(consumoId) {
    const { error } = await supabase.from('consumo_produccion_pf').delete().eq('id', consumoId)
    if (error) {
      alert(t('produccion_comun:alertas.error_quitar_consumo', { mensaje: error.message }))
      return
    }
    await cargarIngredientes()
    onCambio()
  }

  async function cerrarProduccion() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert(t('produccion_productos_finales:indica_cantidad_neta'))
      return
    }

    const pendientes = filasCompletas().length
    if (pendientes > 0) {
      const continuar = confirm(t('produccion_comun:pendientes_sin_confirmar', { count: pendientes }))
      if (!continuar) return
    }

    const { error } = await supabase
      .from('producciones_producto_final')
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

    // Addenda "navegación post-cierre — Producto final": mismo criterio que Semielaborados
    // (Producciones.jsx, addenda "Navegación tras cerrar producción") -- cerrar es el final natural
    // del flujo, el operador vuelve al panel de "qué producir hoy" en vez de quedarse en una tarjeta
    // que ya no tiene nada que registrar.
    navigate('/pedidos-del-dia')
  }

  return (
    <Card className="p-4 border-l-4 border-l-amber-400!">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold text-[#1C2938]">{produccion.productos_finales?.nombre} <span className="text-amber-600 text-sm font-normal">— {t('produccion_comun:en_curso_badge')}</span></p>
          <p className="text-sm text-gray-500">
            {t('produccion_comun:iniciada_el', { fecha: formatFecha(produccion.fecha) })}
            {produccion.pedidos_venta && <span className="ml-2 text-xs font-mono text-gray-400">{t('produccion_productos_finales:pedido_codigo', { codigo: produccion.pedidos_venta.codigo_pedido })}</span>}
          </p>
        </div>
        <LinkAction tone="red" onClick={onCancelar}>{t('produccion_comun:cancelar_produccion')}</LinkAction>
      </div>

      <div className="mt-3 flex items-end gap-3 flex-wrap">
        <Field label={t('produccion_comun:cantidad_objetivo', { unidad: UNIDADES })} className="w-56">
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

      {/* Addenda "reorganización del bloque de registro de consumo — Producto final": botones de
          acción movidos aquí, por encima de "Consumo ya registrado" y "Registrar consumo" -- visibles
          sin scroll aunque la lista de ingredientes sea larga (mismo criterio que Producciones.jsx). */}
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
        {listoParaCerrar && (
          <span className="text-xs text-green-700 font-medium inline-flex items-center gap-1">
            <IconCircleCheck size={14} /> {t('produccion_comun:consumo_suficiente_cerrar')}
          </span>
        )}
      </div>

      {cerrando && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Input type="number" step="0.001" placeholder={t('produccion_comun:cantidad_producida', { unidad: UNIDADES })}
            value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
            autoFocus title={t('common:redondea_3_decimales')} />
          <Input type="text" placeholder={t('produccion_comun:notas_placeholder')}
            value={notas} onChange={(e) => setNotas(e.target.value)} />
          <Button variant="success" onClick={cerrarProduccion}>{t('produccion_comun:confirmar_cierre')}</Button>
        </div>
      )}

      {produccion.consumo_produccion_pf.length > 0 && (
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion_pf.map((c) => {
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
              onPrecargar={estimacion && estimacion.registrado === 0 ? () => precargarConEstimacion(ing, estimacion) : null} />
          ))}
        </div>
      )}
    </Card>
  )
}

function labelLote(ingrediente, l, fechaDestino, fechaPosterior, t) {
  const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
  const stockDisp = t('produccion_comun:lote_stock_disp', { stock: l.stock_disponible.toFixed(3), unidad: l.unidad })
  if (ingrediente.esArticulo) {
    const proveedor = l.proveedor ? `${l.proveedor} · ` : ''
    const numero = l.numero_albaran || t('produccion_comun:lote_sin_numero')
    const cad = l.fecha_caducidad ? ` · ${t('produccion_comun:lote_caducidad_abrev', { fecha: formatFecha(l.fecha_caducidad) })}` : ''
    const aviso = caducado ? t('produccion_comun:lote_caducado_aviso') : ''
    return `${l.nombre} · ${proveedor}${t('produccion_comun:lote_albaran', { numero })} · ${formatFecha(l.fecha_recepcion)}${cad} · ${stockDisp}${aviso}`
  }
  const codigo = l.codigo_lote ? l.codigo_lote + ' · ' : ''
  const aviso = fechaPosterior ? t('produccion_comun:lote_fecha_posterior_aviso') : caducado ? t('produccion_comun:lote_caducado_aviso') : ''
  return `${l.nombre} · ${codigo}${t('produccion_comun:lote_produccion_label', { fecha: formatFecha(l.fecha) })} · ${stockDisp}${aviso}`
}

// Fila controlada (lote + cantidad): el padre decide qué hacer con las
// líneas rellenas (confirmar en bloque, añadir a una edición, etc.) —
// este componente no tiene acción ni estado propios. `estimacion`/`cargandoEstimacion`/`onPrecargar`
// (addenda "traslado del patrón de estimación a Producto final", opcionales -- ProduccionCerradaEdicion
// sigue llamando a este componente sin ellos) fusionan estimación/disponible/registrado junto a
// "orientativo", mismo patrón que Producciones.jsx.
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
    const fechaPosterior = !ingrediente.esArticulo && fechaDestino && l.fecha > fechaDestino
    return <option key={idDeLote(l)} value={idDeLote(l)} disabled={fechaPosterior}>{labelLote(ingrediente, l, fechaDestino, fechaPosterior, t)}</option>
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
            className="text-[#0854A0] hover:text-[#0A3D62] inline-flex items-center gap-1 text-xs shrink-0"
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

// CONTRATO_MEJORAS_MES.md, punto 2.3/2.5: fila de tabla con acordeón (mismo patrón que
// ProduccionCerrada en Producciones.jsx / AlbaranesVenta.jsx BLOQUE 4) en vez de la <Card> apilada
// anterior. `expandido`/`onToggleExpandir` vienen del padre; `editando` sigue siendo estado LOCAL de
// esta fila, igual que en Producciones.jsx.
function ProduccionCerrada({ produccion, expandido, onToggleExpandir, despachoInfo, onCambio, onBorrar }) {
  const { t } = useTranslation(['common', 'produccion_comun', 'produccion_productos_finales'])
  const [editando, setEditando] = useState(false)
  const abierto = expandido || editando

  // Punto 2.4: badge de estado de despacho -- despachoInfo llega del padre (cargarHistorial), ya
  // agregado por produccion_pf_id a partir de previsiones_distribucion_pf.
  const previsto = despachoInfo?.previsto || 0
  const { color, texto } = estadoDespacho(produccion.cantidad_producida, previsto, t)
  const detalleReparto = despachoInfo?.detalle || []
  const detalleAjustes = despachoInfo?.ajustesDetalle || []

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
        <td className="px-3 py-3 font-medium text-[#1C2938]">
          {produccion.productos_finales?.nombre}
          {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
          {produccion.pedidos_venta && <span className="ml-2 text-xs font-mono text-gray-400">{t('produccion_productos_finales:pedido_codigo', { codigo: produccion.pedidos_venta.codigo_pedido })}</span>}
        </td>
        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{produccion.cantidad_producida} {t('produccion_productos_finales:unidad_corta')}</td>
        <td className="px-3 py-3 text-gray-500 italic max-w-[16rem] truncate" title={produccion.notas || undefined}>{produccion.notas || '—'}</td>
        <td className="px-3 py-3"><Badge color={color}>{texto}</Badge></td>
        <td className="px-3 py-3">
          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
            <LinkAction tone="blue" onClick={iniciarEdicion} className="text-xs">{t('produccion_comun:editar')}</LinkAction>
            <LinkAction tone="red" onClick={onBorrar} className="text-xs">{t('produccion_comun:borrar')}</LinkAction>
          </div>
        </td>
      </tr>
      <tr>
        <td colSpan={7} className="p-0">
          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${abierto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="bg-gray-50/60 px-3 py-3">
                {editando ? (
                  <ProduccionCerradaEdicion
                    produccion={produccion}
                    onCancelar={() => setEditando(false)}
                    onGuardado={() => { setEditando(false); onCambio() }}
                  />
                ) : (
                  <>
                    {/* Ingredientes consumidos por esta producción -- misma tabla que ya existía, sin
                        cambios de fondo, solo movida aquí dentro. */}
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      {t('produccion_comun:ingredientes_consumidos_titulo')}
                    </p>
                    {produccion.consumo_produccion_pf.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">{t('produccion_comun:sin_consumo_registrado')}</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody className="divide-y divide-gray-100">
                          {produccion.consumo_produccion_pf.map((c) => {
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

                    {/* Punto 2.5: repartido a pedidos -- nuevo, a partir de despachoInfo. */}
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('produccion_productos_finales:repartido_pedidos_titulo')}</p>
                    {detalleReparto.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">{t('produccion_productos_finales:sin_reparto_previsto')}</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                            <th className="py-1.5 font-medium">{t('produccion_productos_finales:tabla_reparto.cliente')}</th>
                            <th className="py-1.5 font-medium">{t('produccion_productos_finales:tabla_reparto.pedido')}</th>
                            <th className="py-1.5 font-medium">{t('produccion_productos_finales:tabla_reparto.entrega_prevista')}</th>
                            <th className="py-1.5 font-medium">{t('produccion_productos_finales:tabla_reparto.previsto')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {detalleReparto.map((d, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-gray-500">{d.cliente ?? t('common:sin_cliente')}</td>
                              <td className="py-1.5 text-gray-500 font-mono text-xs">{d.codigoPedido ?? `#${d.linea_pedido_id}`}</td>
                              <td className="py-1.5 text-gray-500">{d.fechaEntrega ? formatFecha(d.fechaEntrega) : t('produccion_productos_finales:sin_fecha')}</td>
                              <td className="py-1.5">{d.cantidad_prevista.toFixed(3)} {t('produccion_productos_finales:unidad_corta')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Punto 2.5 (corrección preventiva, mismo criterio que Semielaborados 1.6.3):
                        ajustes de stock -- casi siempre vacío hoy (0 filas en el sistema a la fecha del
                        contrato), pero listo para cuando se registre el primero. */}
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
                                {Number(a.cantidad) > 0 ? '+' : ''}{a.cantidad} {t('produccion_productos_finales:unidad_corta')}
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
  const { t } = useTranslation(['common', 'produccion_comun', 'produccion_productos_finales'])
  const UNIDADES = t('produccion_productos_finales:unidad_larga')
  const [fecha, setFecha] = useState(produccion.fecha)
  const [cantidadProducida, setCantidadProducida] = useState(String(produccion.cantidad_producida))
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [fechaCaducidad, setFechaCaducidad] = useState(produccion.fecha_caducidad ?? '')
  const [lineas, setLineas] = useState(() =>
    produccion.consumo_produccion_pf.map((c) => {
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
    cargarIngredientesConLotes(produccion.producto_final_id).then((ings) => {
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

    const { error } = await supabase.rpc('rpc_editar_produccion_producto_final', {
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
    <Card className="p-4 border-l-4 border-l-[#0854A0]!">
      <p className="font-semibold text-[#1C2938] mb-3">
        {t('produccion_comun:editando_produccion_de', { nombre: produccion.productos_finales?.nombre })}
        {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label={t('produccion_comun:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={t('produccion_comun:cantidad_producida', { unidad: UNIDADES })}>
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

export default ProduccionProductosFinales
