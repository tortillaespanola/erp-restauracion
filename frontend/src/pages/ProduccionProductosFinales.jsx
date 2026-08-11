import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconTrash } from '@tabler/icons-react'
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
  const [productoId, setProductoId] = useState(searchParams.get('producto_final_id') ?? '')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))

  async function cargarDatos() {
    setCargando(true)

    const selectCompleto = `
      *,
      productos_finales(nombre),
      pedidos_venta(codigo_pedido),
      consumo_produccion_pf!consumo_produccion_pf_produccion_pf_id_fkey(
        id, cantidad,
        entrada_material_id, produccion_origen_id,
        entrada_material(articulos_compra(nombre, unidad)),
        producciones_semielaborado!consumo_produccion_pf_produccion_origen_id_fkey(semielaborados(nombre, unidad))
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

    const { error } = await supabase
      .from('producciones_producto_final')
      .insert({
        producto_final_id: parseInt(productoId),
        estado: 'abierta',
        fecha: fechaInicio,
        pedido_id: pedidoId ? parseInt(pedidoId) : null,
      })

    if (error) {
      alert('Error al iniciar la producción: ' + error.message)
      return
    }

    setProductoId('')
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
      <PageHeader title="Producción de productos finales" subtitle="Inicia una producción, registra de qué lotes consumes cada ingrediente, y ciérrala con la cantidad neta obtenida." />

      <Card className="mb-6">
        <CardBody>
          {pedidoId && (
            <p className="text-sm text-[#0854A0] mb-3">Esta producción quedará enlazada al pedido seleccionado.</p>
          )}
          <form onSubmit={iniciarProduccion} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
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
  const [ingredientes, setIngredientes] = useState([])
  const [cargandoIngredientes, setCargandoIngredientes] = useState(true)
  const [filasConsumo, setFilasConsumo] = useState({})
  const [confirmando, setConfirmando] = useState(false)

  const [cantidadProducida, setCantidadProducida] = useState('')
  const [notas, setNotas] = useState(produccion.notas ?? '')
  const [cerrando, setCerrando] = useState(false)

  async function cargarIngredientes() {
    setCargandoIngredientes(true)
    setIngredientes(await cargarIngredientesConLotes(produccion.producto_final_id))
    setCargandoIngredientes(false)
  }

  useEffect(() => {
    cargarIngredientes()
  }, [])

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

    onCambio()
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
            <Input type="number" step="0.001" placeholder="Cantidad producida (unidades)"
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

function labelLote(ingrediente, l, fechaDestino, fechaPosterior) {
  const caducado = l.fecha_caducidad && fechaDestino && l.fecha_caducidad < fechaDestino
  return ingrediente.esArticulo
    ? `${l.nombre} · ${l.proveedor ? `${l.proveedor} · ` : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${formatFecha(l.fecha_recepcion)}${l.fecha_caducidad ? ` · cad. ${formatFecha(l.fecha_caducidad)}` : ''} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
    : `${l.nombre} · ${l.codigo_lote ? l.codigo_lote + ' · ' : ''}Producción ${formatFecha(l.fecha)} · ${l.stock_disponible.toFixed(3)} ${l.unidad} disp.${fechaPosterior ? ' — ⚠ fecha posterior, no se podrá consumir' : caducado ? ' — ⚠ caducado, revisar antes de usar' : ''}`
}

// Fila controlada (lote + cantidad): el padre decide qué hacer con las
// líneas rellenas (confirmar en bloque, añadir a una edición, etc.) —
// este componente no tiene acción ni estado propios.
function IngredienteConsumo({ ingrediente, fechaDestino, value, onChange }) {
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
