import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { validarStockReceta } from '../lib/validarStockReceta'
import { IconTrash } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Select, Input, DateInput, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

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

      if (esArticulo) {
        let articuloIdsDeReceta = [linea.articulo_id]
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
        nombre: esArticuloDirecto ? linea.articulos_compra?.nombre : esIngrediente ? linea.ingredientes?.nombre : linea.semielaborados?.nombre,
        unidad: esArticuloDirecto ? linea.articulos_compra?.unidad : esIngrediente ? linea.ingredientes?.unidad : linea.semielaborados?.unidad,
        cantidadOrientativa: linea.cantidad,
        lotes,
      }
    })
  )
}

// CONTRATO_VISTA_DINAMICA_PRODUCCION.md, addenda "Rediseño de tablas informativas — Vista 2
// semielaborado": cadena transitiva COMPLETA de un semielaborado (semielaborados intermedios +
// ingredientes/artículos hoja), a diferencia de calcularOrdenJerarquico() en PedidosDelDia.jsx que
// solo resuelve relaciones semielaborado->semielaborado dentro de un conjunto ya conocido de
// antemano. Aquí el conjunto no se conoce hasta explorarlo, así que se recorre nivel a nivel (BFS)
// hasta agotar la cadena -- el propio Set de semielaborados visitados evita releer un nodo dos veces
// y protege de un ciclo indirecto no cubierto por el CHECK no_auto_referencia de la base de datos.
async function cargarCadenaCompleta(semielaboradoId) {
  const semisVisitados = new Set()
  const articulosVisitados = new Map() // articulo_id -> {nombre, unidad}
  const ingredientesVisitados = new Map() // ingrediente_id -> {nombre, unidad}
  let frontera = [semielaboradoId]

  while (frontera.length > 0) {
    const { data } = await supabase
      .from('receta_semielaborado')
      .select('semielaborado_id, articulo_id, ingrediente_id, ingrediente_semielaborado_id, articulos_compra(nombre, unidad), semielaborados!receta_semielaborado_ingrediente_semielaborado_id_fkey(nombre, unidad), ingredientes(nombre, unidad)')
      .in('semielaborado_id', frontera)

    const siguienteFrontera = []
    for (const fila of data || []) {
      if (fila.ingrediente_semielaborado_id) {
        if (!semisVisitados.has(fila.ingrediente_semielaborado_id)) {
          semisVisitados.add(fila.ingrediente_semielaborado_id)
          siguienteFrontera.push(fila.ingrediente_semielaborado_id)
        }
      } else if (fila.articulo_id) {
        articulosVisitados.set(fila.articulo_id, { nombre: fila.articulos_compra?.nombre, unidad: fila.articulos_compra?.unidad })
      } else if (fila.ingrediente_id) {
        ingredientesVisitados.set(fila.ingrediente_id, { nombre: fila.ingredientes?.nombre, unidad: fila.ingredientes?.unidad })
      }
    }
    frontera = siguienteFrontera
  }

  const idsSemis = [...semisVisitados]
  const idsIngredientes = [...ingredientesVisitados.keys()]

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

  const articuloIdsPorIngrediente = new Map()
  for (const v of resVinculos.data || []) {
    const lista = articuloIdsPorIngrediente.get(v.ingrediente_id) || []
    lista.push(v.articulo_id)
    articuloIdsPorIngrediente.set(v.ingrediente_id, lista)
  }

  // Dos líneas de receta distintas pueden acabar tirando del MISMO artículo -- una referenciándolo
  // directo (articulo_id) y otra vía un ingrediente genérico (ingrediente_id) que solo mapea a ese
  // artículo. Es el mismo stock físico, así que deben fundirse en una sola fila hoja, no duplicarse
  // (verificado con datos reales: un artículo aparecía dos veces con el mismo stock disponible cada
  // vez). Se agrupa por el conjunto (ordenado) de articulo_id que resuelve cada línea -- si coincide
  // exactamente, es la misma fila.
  const gruposHoja = new Map() // clave canónica "a:id1,id2" -> {nombre, unidad, articuloIds}
  for (const [id, info] of articulosVisitados) {
    gruposHoja.set(`a:${id}`, { nombre: info.nombre, unidad: info.unidad, articuloIds: [id] })
  }
  for (const [id, info] of ingredientesVisitados) {
    const articuloIds = [...(articuloIdsPorIngrediente.get(id) || [])].sort((a, b) => a - b)
    const clave = articuloIds.length > 0 ? `a:${articuloIds.join(',')}` : `i:${id}`
    if (!gruposHoja.has(clave)) gruposHoja.set(clave, { nombre: info.nombre, unidad: info.unidad, articuloIds })
  }

  const idsArticulosRelevantes = [...new Set([...gruposHoja.values()].flatMap((g) => g.articuloIds))]
  const resStockArticulos = idsArticulosRelevantes.length > 0
    ? await supabase.from('stock_lotes_articulo').select('articulo_id, stock_disponible').in('articulo_id', idsArticulosRelevantes)
    : { data: [] }

  const stockPorArticulo = new Map()
  for (const l of resStockArticulos.data || []) {
    stockPorArticulo.set(l.articulo_id, (stockPorArticulo.get(l.articulo_id) || 0) + Number(l.stock_disponible))
  }

  const filasSemis = (resStockSemis.data || []).map((s) => ({
    tipo: 'semielaborado',
    nombre: s.nombre,
    unidad: s.unidad,
    stock: Number(s.stock),
  }))

  const filasHoja = [...gruposHoja.values()].map((g) => ({
    tipo: 'ingrediente',
    nombre: g.nombre,
    unidad: g.unidad,
    stock: g.articuloIds.reduce((s, aId) => s + (stockPorArticulo.get(aId) || 0), 0),
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

  const [semielaborados, setSemielaborados] = useState([])
  const [abiertas, setAbiertas] = useState([])
  const [cerradas, setCerradas] = useState([])
  const [cargando, setCargando] = useState(true)

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

    const selectCompleto = `
      *,
      semielaborados(nombre, unidad),
      consumo_produccion!consumo_produccion_produccion_id_fkey(
        id, cantidad,
        entrada_material_id, produccion_origen_id,
        entrada_material(articulos_compra(nombre, unidad)),
        producciones_semielaborado!consumo_produccion_produccion_origen_id_fkey(semielaborados(nombre, unidad))
      )
    `

    const [resSemi, resAbiertas, resCerradas] = await Promise.all([
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('producciones_semielaborado').select(selectCompleto).eq('estado', 'abierta').order('fecha', { ascending: false }),
      supabase.from('producciones_semielaborado').select(selectCompleto).eq('estado', 'cerrada').order('fecha', { ascending: false }),
    ])

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resAbiertas.error) console.error(resAbiertas.error)
    else setAbiertas(resAbiertas.data)

    if (resCerradas.error) console.error(resCerradas.error)
    else setCerradas(resCerradas.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  async function iniciarProduccion(e) {
    e.preventDefault()
    if (!semielaboradoId) return

    const { error } = await supabase
      .from('producciones_semielaborado')
      .insert({
        semielaborado_id: parseInt(semielaboradoId),
        estado: 'abierta',
        fecha: fechaInicio,
        tanda_id: tandaId || null,
      })

    if (error) {
      alert('Error al iniciar la producción: ' + error.message)
      return
    }

    setSemielaboradoId('')
    setCantidadPlan('')
    setFechaInicio(new Date().toISOString().slice(0, 10))
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar esta producción abierta? Se revertirán los consumos ya registrados.')) return
    const { error } = await supabase.from('producciones_semielaborado').delete().eq('id', id)
    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function handleBorrarCerrada(id) {
    const [c1, c2, c3] = await Promise.all([
      supabase.from('consumo_produccion').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('consumo_produccion_pf').select('*', { count: 'exact', head: true }).eq('produccion_origen_id', id),
      supabase.from('ajustes_semielaborado').select('*', { count: 'exact', head: true }).eq('produccion_id', id),
    ])

    let avisos = []
    if (c1.count > 0) avisos.push(`${c1.count} consumo(s) en otras producciones de semielaborados`)
    if (c2.count > 0) avisos.push(`${c2.count} consumo(s) en producciones de productos finales`)
    if (c3.count > 0) avisos.push(`${c3.count} ajuste(s) de stock`)

    const mensaje = avisos.length > 0
      ? `⚠️ Este lote se usó en:\n\n${avisos.map((a) => '• ' + a).join('\n')}\n\nAl borrarlo, esos consumos/ajustes también se eliminarán. ¿Seguro que quieres continuar?`
      : '¿Seguro que quieres borrar esta producción?'

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('producciones_semielaborado').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  const semielaboradoSeleccionado = semielaborados.find((s) => String(s.id) === semielaboradoId)

  // Historial acotado al semielaborado seleccionado (punto 2 del contrato) -- derivado sin consulta
  // adicional, `cerradas` ya trae `semielaborado_id` de la carga inicial.
  const cerradasDelSeleccionado = useMemo(() => {
    if (!semielaboradoId) return []
    return cerradas.filter((p) => p.semielaborado_id === parseInt(semielaboradoId))
  }, [cerradas, semielaboradoId])

  return (
    <div>
      <PageHeader
        title="Producciones"
        subtitle={
          tandaId
            ? 'Iniciando producción para una tanda de "Pedidos del día" — la cantidad y los consumos se sugieren según los pedidos de esa tanda.'
            : 'Inicia una producción, ve registrando consumos de los lotes que uses, y ciérrala cuando tengas el peso neto final.'
        }
      />

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
            <Field label="Iniciar nueva producción">
              <Select
                value={semielaboradoId}
                onChange={(e) => { setSemielaboradoId(e.target.value); setCantidadPlan('') }}
                required
              >
                <option value="">Selecciona qué vas a producir</option>
                {semielaborados.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <DateInput value={fechaInicio} onChange={setFechaInicio} required />
            </Field>
            <Field label="Cantidad a producir (opcional, valida stock)">
              <Input type="number" step="0.001" value={cantidadPlan} onChange={(e) => setCantidadPlan(e.target.value)}
                placeholder="Sin validar" title="Se redondeará a 3 decimales" />
            </Field>
            <Button type="submit">Iniciar</Button>
          </form>

          {validandoStock && <p className="text-xs text-gray-400 mt-2">Comprobando stock disponible…</p>}

          {!validandoStock && faltantes.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-sm font-semibold text-amber-700 mb-1">
                Aviso: stock insuficiente en receta — puedes iniciar igualmente:
              </p>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {faltantes.map((f, i) => (
                  <li key={i}>
                    Falta {(f.necesario - f.disponible).toFixed(3)} {f.unidad} de {f.nombre}
                    {' '}(disponible: {f.disponible.toFixed(3)} {f.unidad})
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">
        {semielaboradoSeleccionado ? `Stock disponible para ${semielaboradoSeleccionado.nombre}` : 'Stock disponible'}
      </h2>
      {cargando || (semielaboradoId && cadenaCargando) ? (
        <LoadingState />
      ) : !semielaboradoId ? (
        <Card className="mb-8"><EmptyState>Selecciona un semielaborado para ver su stock e historial.</EmptyState></Card>
      ) : cadenaStock.length === 0 ? (
        <Card className="mb-8"><EmptyState>Este semielaborado no tiene semielaborados ni ingredientes en su receta.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden mb-8">
          <Table>
            <Thead>
              <Th>Nombre</Th>
              <Th>Tipo</Th>
              <Th>Stock disponible</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {cadenaStock.map((f) => (
                <tr key={`${f.tipo}-${f.nombre}`} className="hover:bg-blue-50/40">
                  <Td className="font-medium">{f.nombre}</Td>
                  <Td className="text-gray-500">{f.tipo === 'semielaborado' ? 'Semielaborado' : 'Ingrediente'}</Td>
                  <Td>{f.stock.toFixed(3)} {f.unidad}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">
        {semielaboradoSeleccionado ? `Historial de producciones cerradas de ${semielaboradoSeleccionado.nombre}` : 'Historial de producciones cerradas'}
      </h2>
      {cargando ? (
        <LoadingState />
      ) : !semielaboradoId ? (
        <Card><EmptyState>Selecciona un semielaborado para ver su stock e historial.</EmptyState></Card>
      ) : cerradasDelSeleccionado.length === 0 ? (
        <Card><EmptyState>Todavía no hay producciones cerradas de este semielaborado.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {cerradasDelSeleccionado.map((p) => (
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
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [filasConsumo, setFilasConsumo] = useState({})
  const [confirmando, setConfirmando] = useState(false)

  const [cantidadProducida, setCantidadProducida] = useState('')
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [cerrando, setCerrando] = useState(false)

  const [cantidadObjetivo, setCantidadObjetivo] = useState('')
  const [cantidadSugerida, setCantidadSugerida] = useState(null)

  async function cargarIngredientes() {
    setCargandoIngredientes(true)
    setIngredientes(await cargarIngredientesConLotes(produccion.semielaborado_id))
    setCargandoIngredientes(false)
  }

  useEffect(() => {
    cargarIngredientes()
  }, [])

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
      alert('Ninguna línea se ha guardado — revisa el error y vuelve a confirmar:\n\n' + error.message)
      return
    }

    setFilasConsumo({})
    await cargarIngredientes()
    onCambio()
  }

  async function quitarConsumo(consumoId) {
    const { error } = await supabase.from('consumo_produccion').delete().eq('id', consumoId)
    if (error) {
      alert('Error al quitar el consumo: ' + error.message)
      return
    }
    await cargarIngredientes()
    onCambio()
  }

  async function cerrarProduccion() {
    if (!cantidadProducida || parseFloat(cantidadProducida) <= 0) {
      alert('Indica el peso/cantidad neta producida')
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
      .from('producciones_semielaborado')
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

    onCambio()
  }

  return (
    <Card className="p-4 border-l-4 border-l-amber-400!">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold text-[#1C2938]">{produccion.semielaborados?.nombre} <span className="text-amber-600 text-sm font-normal">— en curso</span></p>
          <p className="text-sm text-gray-500">Iniciada el {formatFecha(produccion.fecha)}</p>
        </div>
        <LinkAction tone="red" onClick={onCancelar}>Cancelar producción</LinkAction>
      </div>

      {produccion.tanda_id && (
        <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-md p-3 flex items-end gap-3 flex-wrap">
          <Field label={`Cantidad a producir (${produccion.semielaborados?.unidad}) — sugerida por la tanda`} className="w-64">
            <Input
              type="number"
              step="0.001"
              value={cantidadObjetivo}
              onChange={(e) => setCantidadObjetivo(e.target.value)}
              placeholder={cantidadSugerida != null ? String(cantidadSugerida) : 'Calculando...'}
            />
          </Field>
          <LinkAction tone="blue" onClick={recalcularConsumosSugeridos} className="text-xs">
            Recalcular consumos sugeridos
          </LinkAction>
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
          {ingredientes.map((ing) => (
            <IngredienteConsumo key={claveIngrediente(ing)}
              ingrediente={ing}
              fechaDestino={produccion.fecha}
              value={filaDe(ing)}
              onChange={(valor) => actualizarFila(ing, valor)} />
          ))}
          <Button variant="success" size="sm" onClick={confirmarConsumo} disabled={confirmando}>
            {confirmando ? 'Confirmando...' : `Confirmar consumo${filasCompletas().length > 0 ? ` (${filasCompletas().length})` : ''}`}
          </Button>
        </div>
      )}

      <div className="border-t border-gray-100 mt-4 pt-4">
        {!cerrando ? (
          <Button variant="success" size="sm" onClick={() => setCerrando(true)}>
            Cerrar producción (indicar cantidad neta)
          </Button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input type="number" step="0.001" placeholder={`Cantidad producida (${produccion.semielaborados?.unidad})`}
              value={cantidadProducida} onChange={(e) => setCantidadProducida(e.target.value)}
              autoFocus title="Se redondeará a 3 decimales" />
            <Input type="text" placeholder="Notas (mermas, incidencias...)"
              value={notas} onChange={(e) => setNotas(e.target.value)} />
            <Button variant="success" onClick={cerrarProduccion}>Confirmar cierre</Button>
          </div>
        )}
      </div>
    </Card>
  )
}

// Fila controlada (lote + cantidad): el padre decide qué hacer con las
// líneas rellenas (confirmar en bloque, añadir a una edición, etc.) —
// este componente no tiene acción ni estado propios.
function labelLote(ingrediente, l, fechaDestino) {
  const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
  return ingrediente.esArticulo
    ? `${l.nombre} · ${l.proveedor ? `${l.proveedor} · ` : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${formatFecha(l.fecha_recepcion)}${l.fecha_caducidad ? ` · cad. ${formatFecha(l.fecha_caducidad)}` : ''} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
    : `${l.nombre} · ${l.codigo_lote ? l.codigo_lote + ' · ' : ''}Producción ${formatFecha(l.fecha)} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
}

function IngredienteConsumo({ ingrediente, fechaDestino, value, onChange }) {
  const [mostrarSustituto, setMostrarSustituto] = useState(false)
  const idDeLote = (l) => (ingrediente.esArticulo ? l.entrada_material_id : l.produccion_id)
  const deReceta = ingrediente.lotes.filter((l) => l.esDeReceta)
  const otros = ingrediente.lotes.filter((l) => !l.esDeReceta)
  const loteSeleccionado = ingrediente.lotes.find((l) => value.loteId && idDeLote(l) === parseInt(value.loteId))
  const esSustitucion = !!loteSeleccionado && !loteSeleccionado.esDeReceta
  const panelSustitutoVisible = mostrarSustituto || esSustitucion

  function opcion(l) {
    return <option key={idDeLote(l)} value={idDeLote(l)}>{labelLote(ingrediente, l, fechaDestino)}</option>
  }

  return (
    <div className={`border rounded-md p-3 ${esSustitucion ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
      <p className="text-sm font-medium text-gray-700">
        {ingrediente.nombre}
        <span className="text-gray-400 font-normal"> — orientativo: {ingrediente.cantidadOrientativa} {ingrediente.unidad} por unidad</span>
        {esSustitucion && <span className="ml-2 text-xs font-semibold text-amber-600">SUSTITUCIÓN EXCEPCIONAL</span>}
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
              {produccion.cantidad_producida} {produccion.semielaborados?.unidad} de {produccion.semielaborados?.nombre}
              {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
            </p>
            <p className="text-sm text-gray-500">{formatFecha(produccion.fecha)}</p>
            {produccion.notas && <p className="text-sm text-gray-400 italic">{produccion.notas}</p>}
          </div>
          <div className="flex gap-3 shrink-0">
            <LinkAction tone="blue" onClick={() => setEditando(true)}>Editar</LinkAction>
            <LinkAction tone="red" onClick={onBorrar}>Borrar</LinkAction>
          </div>
        </div>
        <table className="w-full mt-3 text-sm">
          <tbody className="divide-y divide-gray-100">
            {produccion.consumo_produccion.map((c) => {
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
      alert('Edición inválida: ' + error.message)
      return
    }

    onGuardado()
  }

  return (
    <Card className="p-4 border-l-4 border-l-[#0854A0]!">
      <p className="font-semibold text-[#1C2938] mb-3">
        Editando producción de {produccion.semielaborados?.nombre}
        {produccion.codigo_lote && <span className="ml-2 text-xs font-mono text-gray-400">{produccion.codigo_lote}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Fecha">
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={`Cantidad producida (${produccion.semielaborados?.unidad})`}>
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

export default Producciones
