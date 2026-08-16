import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconTrash, IconWand, IconCircleCheck } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

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
  const [productos, setProductos] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [cerradas, setCerradas] = useState([])
  const [stockTotal, setStockTotal] = useState([])
  const [cargando, setCargando] = useState(true)

  const pedidoId = searchParams.get('pedido_id')
  const tandaId = searchParams.get('tanda_id')
  const [productoId, setProductoId] = useState(searchParams.get('producto_final_id') ?? '')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))
  // Addenda "traslado del patrón de estimación a Producto final": mismo campo `cantidadPlan` de
  // Producciones.jsx -- valor inicial opcional que se persiste como cantidad_objetivo al iniciar, sin
  // el cual la tarjeta de "Producción en curso" no tendría con qué calcular la estimación por línea.
  const [cantidadPlan, setCantidadPlan] = useState(searchParams.get('cantidad') || '')

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

    const [resProd, resAbiertas, resCerradas, resStock] = await Promise.all([
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('producciones_producto_final').select(selectCompleto).eq('estado', 'abierta').order('fecha', { ascending: false }),
      supabase.from('producciones_producto_final').select(selectCompleto).eq('estado', 'cerrada').order('fecha', { ascending: false }),
      supabase.from('stock_productos_finales').select('*'),
    ])

    if (resProd.error) console.error(resProd.error)
    else setProductos(resProd.data)

    if (resAbiertas.error) console.error(resAbiertas.error)
    else setAbiertas(resAbiertas.data)

    if (resCerradas.error) console.error(resCerradas.error)
    else setCerradas(resCerradas.data)

    if (resStock.error) console.error(resStock.error)
    else setStockTotal(resStock.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

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
      alert('Error al iniciar la producción: ' + error.message)
      return
    }

    setProductoId('')
    setCantidadPlan('')
    setFechaInicio(new Date().toISOString().slice(0, 10))
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar esta producción abierta? Se revertirán los consumos ya registrados.')) return
    const { error } = await supabase.from('producciones_producto_final').delete().eq('id', id)
    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function handleBorrarCerrada(id) {
    if (!confirm('¿Seguro que quieres borrar esta producción? Se revertirán sus consumos y su stock.')) return
    const { error } = await supabase.from('producciones_producto_final').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader
        title="Producción de productos finales"
        subtitle={
          tandaId
            ? 'Iniciando producción para una tanda de "Pedidos del día" — el lote de Mezcla recién cerrado se sugiere según los pedidos de esa tanda.'
            : 'Inicia una producción, registra de qué lotes consumes cada ingrediente, y ciérrala con la cantidad neta obtenida.'
        }
      />

      <Card className="mb-6">
        <CardBody>
          {pedidoId && (
            <p className="text-sm text-[#0854A0] mb-3">Esta producción quedará enlazada al pedido seleccionado.</p>
          )}
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
            <Field label="Iniciar nueva producción">
              <Select value={productoId} onChange={(e) => setProductoId(e.target.value)} required>
                <option value="">Selecciona qué vas a producir</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <DateInput value={fechaInicio} onChange={setFechaInicio} required />
            </Field>
            <Field label="Cantidad a producir (opcional)">
              <Input type="number" step="0.001" value={cantidadPlan} onChange={(e) => setCantidadPlan(e.target.value)}
                placeholder="Sin definir" title="Se redondeará a 3 decimales" />
            </Field>
            <Button type="submit">Iniciar</Button>
          </form>
        </CardBody>
      </Card>

      {abiertas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Producciones en curso</h2>
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

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Stock actual de productos finales</h2>
      {cargando ? (
        <LoadingState />
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th>Producto</Th>
              <Th>Stock</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {stockTotal.map((s) => (
                <tr key={s.producto_final_id} className="hover:bg-blue-50/40">
                  <Td className="font-medium">{s.nombre}</Td>
                  <Td>{Number(s.stock).toFixed(3)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Historial de producciones cerradas</h2>
      {cerradas.length === 0 ? (
        <Card><EmptyState>Todavía no hay producciones cerradas.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {cerradas.map((p) => (
            <ProduccionCerrada
              key={p.id}
              produccion={p}
              onCambio={cargarDatos}
              onBorrar={() => handleBorrarCerrada(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProduccionAbierta({ produccion, onCambio, onCancelar }) {
  const navigate = useNavigate()
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
      alert('Error al guardar la cantidad objetivo: ' + error.message)
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
      alert('Rellena lote y cantidad de al menos una línea')
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
      alert('Ninguna línea se ha guardado — revisa el error y vuelve a confirmar:\n\n' + error.message)
      return
    }

    setFilasConsumo({})
    await cargarIngredientes()
    onCambio()
  }

  async function quitarConsumo(consumoId) {
    const { error } = await supabase.from('consumo_produccion_pf').delete().eq('id', consumoId)
    if (error) {
      alert('Error al quitar el consumo: ' + error.message)
      return
    }
    await cargarIngredientes()
    onCambio()
  }

  async function cerrarProduccion() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert('Indica la cantidad neta producida')
      return
    }

    const pendientes = filasCompletas().length
    if (pendientes > 0) {
      const continuar = confirm(
        `Tienes ${pendientes} línea(s) de consumo rellenas pero sin confirmar — se perderán si cierras ahora sin confirmarlas antes. ¿Cerrar de todas formas?`
      )
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
      alert('Error al cerrar la producción: ' + error.message)
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
          <p className="font-semibold text-[#1C2938]">{produccion.productos_finales?.nombre} <span className="text-amber-600 text-sm font-normal">— en curso</span></p>
          <p className="text-sm text-gray-500">
            Iniciada el {formatFecha(produccion.fecha)}
            {produccion.pedidos_venta && <span className="ml-2 text-xs font-mono text-gray-400">Pedido {produccion.pedidos_venta.codigo_pedido}</span>}
          </p>
        </div>
        <LinkAction tone="red" onClick={onCancelar}>Cancelar producción</LinkAction>
      </div>

      <div className="mt-3 flex items-end gap-3 flex-wrap">
        <Field label="Cantidad objetivo (unidades)" className="w-56">
          <Input
            type="number"
            step="0.001"
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            onBlur={guardarObjetivo}
            placeholder="Sin definir"
            title="Ajuste de referencia -- no modifica el consumo ya registrado ni cierra la producción"
          />
        </Field>
        {guardandoObjetivo && <span className="text-xs text-gray-400">Guardando...</span>}
      </div>

      {/* Addenda "reorganización del bloque de registro de consumo — Producto final": botones de
          acción movidos aquí, por encima de "Consumo ya registrado" y "Registrar consumo" -- visibles
          sin scroll aunque la lista de ingredientes sea larga (mismo criterio que Producciones.jsx). */}
      <div className="border-t border-gray-100 mt-4 pt-4 flex items-center gap-3 flex-wrap">
        {!cargandoIngredientes && (
          <Button variant="success" size="sm" onClick={confirmarConsumo} disabled={confirmando}>
            {confirmando ? 'Confirmando...' : `Confirmar consumo${filasCompletas().length > 0 ? ` (${filasCompletas().length})` : ''}`}
          </Button>
        )}
        {!cerrando && (
          <Button variant="success" size="sm" onClick={() => setCerrando(true)}>
            Cerrar producción (indicar cantidad neta)
          </Button>
        )}
        {listoParaCerrar && (
          <span className="text-xs text-green-700 font-medium inline-flex items-center gap-1">
            <IconCircleCheck size={14} /> Consumo suficiente para cerrar
          </span>
        )}
      </div>

      {cerrando && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Input type="number" step="0.001" placeholder="Cantidad producida (unidades)"
            value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
            autoFocus title="Se redondeará a 3 decimales" />
          <Input type="text" placeholder="Notas (mermas, incidencias...)"
            value={notas} onChange={(e) => setNotas(e.target.value)} />
          <Button variant="success" onClick={cerrarProduccion}>Confirmar cierre</Button>
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
                    <LinkAction tone="red" onClick={() => quitarConsumo(c.id)} className="text-xs">Quitar</LinkAction>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-600">Registrar consumo</h3>
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

function labelLote(ingrediente, l, fechaDestino, fechaPosterior) {
  const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
  return ingrediente.esArticulo
    ? `${l.nombre} · ${l.proveedor ? `${l.proveedor} · ` : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${formatFecha(l.fecha_recepcion)}${l.fecha_caducidad ? ` · cad. ${formatFecha(l.fecha_caducidad)}` : ''} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
    : `${l.nombre} · ${l.codigo_lote ? l.codigo_lote + ' · ' : ''}Producción ${formatFecha(l.fecha)} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${fechaPosterior ? ' — ⚠ fecha posterior, no se podrá consumir' : caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
}

// Fila controlada (lote + cantidad): el padre decide qué hacer con las
// líneas rellenas (confirmar en bloque, añadir a una edición, etc.) —
// este componente no tiene acción ni estado propios. `estimacion`/`cargandoEstimacion`/`onPrecargar`
// (addenda "traslado del patrón de estimación a Producto final", opcionales -- ProduccionCerradaEdicion
// sigue llamando a este componente sin ellos) fusionan estimación/disponible/registrado junto a
// "orientativo", mismo patrón que Producciones.jsx.
function IngredienteConsumo({ ingrediente, fechaDestino, value, onChange, estimacion, cargandoEstimacion, onPrecargar }) {
  const [mostrarSustituto, setMostrarSustituto] = useState(false)
  const idDeLote = (l) => (ingrediente.esArticulo ? l.entrada_material_id : l.produccion_id)
  const deReceta = ingrediente.lotes.filter((l) => l.esDeReceta)
  const otros = ingrediente.lotes.filter((l) => !l.esDeReceta)
  const loteSeleccionado = ingrediente.lotes.find((l) => value.loteId && idDeLote(l) === parseInt(value.loteId))
  const esSustitucion = !!loteSeleccionado && !loteSeleccionado.esDeReceta
  const panelSustitutoVisible = mostrarSustituto || esSustitucion

  function opcion(l) {
    const fechaPosterior = !ingrediente.esArticulo && fechaDestino && l.fecha > fechaDestino
    return <option key={idDeLote(l)} value={idDeLote(l)} disabled={fechaPosterior}>{labelLote(ingrediente, l, fechaDestino, fechaPosterior)}</option>
  }

  return (
    <div className={`border rounded-md p-3 ${estimacion?.cubierto ? 'opacity-70' : ''} ${esSustitucion ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
      <p className="text-sm font-medium text-gray-700 flex items-center gap-2 flex-wrap">
        <span>
          {ingrediente.nombre}
          <span className="text-gray-400 font-normal"> — orientativo: {ingrediente.cantidadOrientativa} {ingrediente.unidad} por unidad</span>
          {cargandoEstimacion && <span className="text-gray-400 font-normal"> · calculando estimación...</span>}
          {estimacion && (
            <span className={`font-normal ${estimacion.insuficiente ? 'text-red-600' : 'text-gray-400'}`}>
              {' '}· estimación: {estimacion.necesario.toFixed(3)} {ingrediente.unidad} · disponible: {estimacion.disponible.toFixed(3)} {ingrediente.unidad}
              {estimacion.insuficiente ? ' — insuficiente' : ''}
              {estimacion.registrado > 0 && ` · registrado: ${estimacion.registrado.toFixed(3)} ${ingrediente.unidad}${estimacion.cubierto ? ' (cubre estimación)' : ''}`}
            </span>
          )}
        </span>
        {onPrecargar && (
          <button type="button" onClick={onPrecargar}
            className="text-[#0854A0] hover:text-[#0A3D62] inline-flex items-center gap-1 text-xs shrink-0"
            title="Precargar la cantidad con la estimación">
            <IconWand size={14} /> Usar estimación
          </button>
        )}
        {esSustitucion && <span className="text-xs font-semibold text-amber-600">SUSTITUCIÓN EXCEPCIONAL</span>}
      </p>

      {deReceta.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 mt-2 items-center">
          <Select value={esSustitucion ? '' : value.loteId}
            onChange={(e) => onChange({ ...value, loteId: e.target.value, nota: '' })} className="text-sm">
            <option value="">Selecciona lote</option>
            {deReceta.map(opcion)}
          </Select>
          <Input type="number" step="0.001" placeholder="Cantidad" value={value.cantidad}
            onChange={(e) => onChange({ ...value, cantidad: e.target.value })}
            className="text-sm" title="Se redondeará a 3 decimales" />
        </div>
      )}

      {deReceta.length === 0 && !panelSustitutoVisible && (
        <p className="text-sm text-red-500 mt-1">Sin stock disponible de este ingrediente.</p>
      )}

      {otros.length > 0 && !panelSustitutoVisible && (
        <LinkAction tone="blue" onClick={() => setMostrarSustituto(true)} className="text-xs mt-2 inline-block">
          ¿No hay lote de receta disponible? Buscar sustituto
        </LinkAction>
      )}

      {otros.length > 0 && panelSustitutoVisible && (
        <div className="mt-2 pt-2 border-t border-amber-200">
          <p className="text-xs font-semibold text-amber-700 mb-1.5 uppercase tracking-wide">Sustitución excepcional — misma categoría</p>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 items-center">
            <Select value={esSustitucion ? value.loteId : ''}
              onChange={(e) => onChange({ ...value, loteId: e.target.value })} className="text-sm">
              <option value="">Selecciona lote sustituto</option>
              {otros.map(opcion)}
            </Select>
            {deReceta.length === 0 && (
              <Input type="number" step="0.001" placeholder="Cantidad" value={value.cantidad}
                onChange={(e) => onChange({ ...value, cantidad: e.target.value })}
                className="text-sm" title="Se redondeará a 3 decimales" />
            )}
          </div>
          <Input type="text" placeholder="Motivo de la sustitución (opcional)" value={value.nota ?? ''}
            onChange={(e) => onChange({ ...value, nota: e.target.value })}
            className="text-sm mt-2 w-full" />
        </div>
      )}
    </div>
  )
}

function ProduccionCerrada({ produccion, onCambio, onBorrar }) {
  const [editando, setEditando] = useState(false)

  if (!editando) {
    return (
      <Card className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-semibold text-[#1C2938]">
              {produccion.cantidad_producida} uds. de {produccion.productos_finales?.nombre}
              {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
            </p>
            <p className="text-sm text-gray-500">
              {formatFecha(produccion.fecha)}
              {produccion.pedidos_venta && <span className="ml-2 text-xs font-mono text-gray-400">Pedido {produccion.pedidos_venta.codigo_pedido}</span>}
            </p>
            {produccion.notas && <p className="text-sm text-gray-400 italic">{produccion.notas}</p>}
          </div>
          <div className="flex gap-3 shrink-0">
            <LinkAction tone="blue" onClick={() => setEditando(true)}>Editar</LinkAction>
            <LinkAction tone="red" onClick={onBorrar}>Borrar</LinkAction>
          </div>
        </div>
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion_pf.map((c) => {
              const { nombre, unidad } = nombreIngredienteDeLinea(c)
              return (
                <tr key={c.id}>
                  <td className="py-1.5 text-gray-500">Consumido: {nombre}</td>
                  <td className="py-1.5">{c.cantidad} {unidad}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    )
  }

  return (
    <ProduccionCerradaEdicion
      produccion={produccion}
      onCancelar={() => setEditando(false)}
      onGuardado={() => { setEditando(false); onCambio() }}
    />
  )
}

function ProduccionCerradaEdicion({ produccion, onCancelar, onGuardado }) {
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
      alert('Rellena lote y cantidad de al menos una línea')
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
      alert('Indica una cantidad producida válida')
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
      alert('Edición inválida: ' + error.message)
      return
    }

    onGuardado()
  }

  return (
    <Card className="p-4 border-l-4 border-l-[#0854A0]!">
      <p className="font-semibold text-[#1C2938] mb-3">
        Editando producción de {produccion.productos_finales?.nombre}
        {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Fecha">
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label="Cantidad producida (unidades)">
          <Input type="number" step="0.001" value={cantidadProducida}
            onChange={(e) => setCantidadProducida(e.target.value)} title="Se redondeará a 3 decimales" />
        </Field>
        <Field label="Notas">
          <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
        <Field label="Fecha de caducidad (opcional)">
          <DateInput value={fechaCaducidad} onChange={setFechaCaducidad} />
        </Field>
      </div>

      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">Líneas de consumo</p>
      <div className="flex flex-col gap-2">
        {lineas.filter((l) => !l._deleted).map((linea) => {
          const index = lineas.indexOf(linea)
          return (
            <div key={index} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-center border border-gray-200 rounded-md p-2">
              <span className="text-sm text-gray-600">{linea._nombre}</span>
              <Input type="number" step="0.001" value={linea.cantidad}
                onChange={(e) => cambiarCantidadLinea(index, e.target.value)}
                className="text-sm" title="Se redondeará a 3 decimales" />
              <button type="button" onClick={() => quitarLinea(index)} className="text-gray-400 hover:text-red-600 justify-self-center">
                <IconTrash size={16} />
              </button>
            </div>
          )
        })}
        {lineas.every((l) => l._deleted) && <p className="text-sm text-gray-400">Sin líneas de consumo.</p>}
      </div>

      {!cargandoIngredientes && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Añadir más consumo</p>
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={claveIngrediente(ing)}
              ingrediente={ing}
              fechaDestino={fecha}
              value={filaNuevaDe(ing)}
              onChange={(valor) => actualizarFilaNueva(ing, valor)} />
          ))}
          <Button variant="secondary" size="sm" onClick={anadirLineasRellenas}>
            {`+ Añadir líneas${filasNuevasCompletas().length > 0 ? ` (${filasNuevasCompletas().length})` : ''}`}
          </Button>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <Button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cambios'}</Button>
        <Button variant="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </Card>
  )
}

export default ProduccionProductosFinales
