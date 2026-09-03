import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { generarAlbaranVentaPdf, prepararDocumentoAlbaranVenta } from '../lib/generarAlbaranVentaPdf'
import { IconTrash } from '@tabler/icons-react'
import { Field, Input, Select, DateInput, SectionLabel, Button, LinkAction } from './ui'

// Fix: los avisos de stock mostraban "3.000" en vez de "3" para valores enteros -- redondea a 3
// decimales (mismo tope ya usado en toda la UI, step="0.001") y quita los ceros sobrantes.
function formatCantidad(n) {
  return Number(n.toFixed(3)).toString()
}

// BLOQUE 6 (CONTRATO_UX_ALBARANES_VENTA.md): formulario de alta extraído del layout inline de
// AlbaranesVenta.jsx a este componente, para vivir dentro del Drawer -- mismo patrón que
// PedidoForm.jsx, con la diferencia de que aquí SOLO hay modo alta (nunca existió edición). Misma
// lógica de selección de lote/tanda y de guardado de siempre en los 5 subcomponentes de más abajo
// (ProductoParaVender, ArticuloParaVender, FilaBloqueada, LineaPedidoLibrePendiente,
// LineaLibreParaVender) -- solo cambia dónde se montan. Al no haber edición, no hace falta
// resetForm: el componente se desmonta al cerrar el drawer, la próxima apertura es un montaje
// nuevo con estado fresco.
export default function AlbaranVentaForm({ pedidoIdParam, clientes, productos, articulosMercaderia, onGuardado, onCancelar }) {
  const navigate = useNavigate()

  const [clienteId, setClienteId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([])
  const [pedidoLineas, setPedidoLineas] = useState([])
  // Ya no hace falta incrementarlo para forzar un refetch de stock en los subcomponentes -- al
  // vivir en un drawer que se desmonta por completo entre aperturas, cada apertura nueva ya es un
  // montaje fresco que recarga stock por sí solo. Se deja el estado (nunca se incrementa) para no
  // tocar la firma/dependencias de efecto de ProductoParaVender/ArticuloParaVender, que no se
  // deben modificar en este bloque.
  const [refrescoStock] = useState(0)

  useEffect(() => {
    if (!pedidoIdParam) return

    async function cargarPedido() {
      const { data } = await supabase
        .from('pedidos_venta')
        .select('cliente_id, lineas_pedido_venta(id, producto_final_id, articulo_id, descripcion, cantidad, precio_unitario, lineas_albaran_venta(cantidad), previsiones_distribucion_pf(produccion_pf_id, cantidad_prevista))')
        .eq('id', pedidoIdParam)
        .single()

      if (data) {
        setClienteId(String(data.cliente_id))
        // Reparto multi-tanda: previsiones_distribucion_pf ya no tiene UNIQUE(linea_pedido_id) a
        // secas (ahora compuesto, linea_pedido_id + produccion_pf_id) -- PostgREST solo infiere
        // relación a-uno cuando el UNIQUE cubre EXACTAMENTE la columna del FK del embed, así que pasa
        // a embeberse como array (confirmado por ausencia de cualquier UNIQUE de una sola columna
        // sobre linea_pedido_id). Una línea puede tener varias previsiones (una por tanda) -- se
        // guardan tal cual, sin colapsar a un único produccion_pf_id_previsto.
        const lineasConEntregado = (data.lineas_pedido_venta || []).map((l) => ({
          ...l,
          entregado_previo: (l.lineas_albaran_venta || []).reduce((sum, e) => sum + e.cantidad, 0),
        }))
        setPedidoLineas(lineasConEntregado)
      }
    }

    cargarPedido()
  }, [pedidoIdParam])

  // Devuelve la línea de pedido completa (no solo el id), con .restante ya
  // calculado, para poder tanto atribuir la entrega (.id) como precargar
  // cantidad/precio pactados en el formulario.
  function lineaPedidoPara(tipo, id) {
    const candidatas = pedidoLineas.filter((l) =>
      tipo === 'producto' ? l.producto_final_id === id : l.articulo_id === id
    )
    if (candidatas.length === 0) return null

    // Reparte a la primera línea de pedido que todavía no esté cubierta
    // (lo ya entregado en albaranes previos + lo que se está añadiendo en
    // esta misma sesión antes de guardar) — no siempre a la primera que
    // coincida por producto, que atribuía mal cuando un pedido tenía más
    // de una línea del mismo producto (caso real: pedidos de Zum Kuss con
    // una línea a precio normal y otra de muestra a precio distinto).
    const conRestante = candidatas.map((l) => ({
      ...l,
      restante: l.cantidad - l.entregado_previo - cantidadYaEnLineasLibres(l.id),
    }))

    const noCubierta = conRestante.find((l) => l.restante > 0)

    return noCubierta ?? conRestante[0]
  }

  function cantidadYaEnLineas(produccionId) {
    return lineas
      .filter((l) => l.produccion_pf_id === produccionId)
      .reduce((sum, l) => sum + l.cantidad, 0)
  }

  function cantidadYaEnLineasArticulo(entradaMaterialId) {
    return lineas
      .filter((l) => l.entrada_material_id === entradaMaterialId)
      .reduce((sum, l) => sum + l.cantidad, 0)
  }

  function cantidadYaEnLineasLibres(lineaPedidoId) {
    return lineas
      .filter((l) => l.linea_pedido_id === lineaPedidoId)
      .reduce((sum, l) => sum + l.cantidad, 0)
  }

  function addLineaProducto(producto, produccionId, cantidad, precio, stockLoteOriginal) {
    const cant = parseFloat(cantidad)
    const idProduccion = parseInt(produccionId)

    if (!produccionId || !cant || cant <= 0) {
      alert('Selecciona un lote e introduce una cantidad válida')
      return
    }

    const yaUsado = cantidadYaEnLineas(idProduccion)
    const restante = stockLoteOriginal - yaUsado

    if (cant > restante) {
      alert(`Solo quedan ${formatCantidad(restante)} unidades disponibles en ese lote de producción`)
      return
    }

    setLineas((prev) => [
      ...prev,
      {
        tipo: 'producto',
        display: producto.nombre,
        producto_final_id: producto.id,
        produccion_pf_id: idProduccion,
        cantidad: cant,
        precio_unitario: precio ? parseFloat(precio) : null,
        linea_pedido_id: lineaPedidoPara('producto', producto.id)?.id ?? null,
      },
    ])
  }

  function addLineaMercaderia(articulo, entradaMaterialId, cantidad, precio, stockLoteOriginal) {
    const cant = parseFloat(cantidad)
    const idEntrada = parseInt(entradaMaterialId)

    if (!entradaMaterialId || !cant || cant <= 0) {
      alert('Selecciona un lote e introduce una cantidad válida')
      return
    }

    const yaUsado = cantidadYaEnLineasArticulo(idEntrada)
    const restante = stockLoteOriginal - yaUsado

    if (cant > restante) {
      alert(`Solo quedan ${formatCantidad(restante)} unidades disponibles en ese lote`)
      return
    }

    setLineas((prev) => [
      ...prev,
      {
        tipo: 'mercaderia',
        display: articulo.nombre,
        articulo_id: articulo.id,
        entrada_material_id: idEntrada,
        cantidad: cant,
        precio_unitario: precio ? parseFloat(precio) : null,
        linea_pedido_id: lineaPedidoPara('mercaderia', articulo.id)?.id ?? null,
      },
    ])
  }

  function addLineaLibre(descripcion, cantidad, precio, lineaPedidoId = null) {
    const cant = parseFloat(cantidad)

    if (!descripcion.trim() || !cant || cant <= 0) {
      alert('Escribe una descripción e introduce una cantidad válida')
      return
    }

    setLineas((prev) => [
      ...prev,
      {
        tipo: 'libre',
        display: descripcion.trim(),
        descripcion: descripcion.trim(),
        cantidad: cant,
        precio_unitario: precio ? parseFloat(precio) : null,
        linea_pedido_id: lineaPedidoId,
      },
    ])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (lineas.length === 0) {
      alert('Añade al menos una línea de producto')
      return
    }

    // Ventana placeholder abierta de forma síncrona con el clic (antes de
    // cualquier await) -- si se abriera después, el bloqueador de popups del
    // navegador la descartaría por no considerarla ya parte del gesto de
    // usuario. Se navega a la URL real del PDF más abajo, una vez generado.
    const pdfWindow = window.open('', '_blank')

    const { data: albaranCreado, error: errorAlbaran } = await supabase
      .from('albaranes_venta')
      .insert({
        cliente_id: parseInt(clienteId),
        numero_albaran: numeroAlbaran || null,
        fecha,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorAlbaran) {
      pdfWindow?.close()
      alert('Error al crear el albarán: ' + errorAlbaran.message)
      return
    }

    const lineasParaInsertar = lineas.map((l) => ({
      albaran_venta_id: albaranCreado.id,
      producto_final_id: l.tipo === 'producto' ? l.producto_final_id : null,
      produccion_pf_id: l.tipo === 'producto' ? l.produccion_pf_id : null,
      articulo_id: l.tipo === 'mercaderia' ? l.articulo_id : null,
      entrada_material_id: l.tipo === 'mercaderia' ? l.entrada_material_id : null,
      descripcion: l.tipo === 'libre' ? l.descripcion : null,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      linea_pedido_id: l.linea_pedido_id,
    }))

    const { error: errorLineas } = await supabase
      .from('lineas_albaran_venta')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      await supabase.from('albaranes_venta').delete().eq('id', albaranCreado.id)
      pdfWindow?.close()
      alert('Error al guardar las líneas: ' + errorLineas.message)
      return
    }

    onGuardado(albaranCreado.id)

    const { data: albaranCompleto, error: errorRecarga } = await supabase
      .from('albaranes_venta')
      .select('*, clientes(nombre, direccion, cif), lineas_albaran_venta(id, cantidad, precio_unitario, descripcion, productos_finales(nombre, unidades_medida(codigo)), articulos_compra(nombre, unidad))')
      .eq('id', albaranCreado.id)
      .single()

    if (errorRecarga) {
      pdfWindow?.close()
      toast.error('Albarán creado, pero no se pudo generar el PDF: ' + errorRecarga.message)
      return
    }

    try {
      const doc = await generarAlbaranVentaPdf(prepararDocumentoAlbaranVenta(albaranCompleto))
      doc.autoPrint()
      if (pdfWindow) pdfWindow.location.href = doc.output('bloburl')
    } catch (err) {
      pdfWindow?.close()
      toast.error('Albarán creado, pero no se pudo generar el PDF: ' + err.message)
      return
    }

    toast.success('Albarán generado correctamente')

    if (pedidoIdParam) navigate('/pedidos')
  }

  const productosMostrados = pedidoIdParam
    ? productos.filter((p) => pedidoLineas.some((l) => l.producto_final_id === p.id))
    : productos

  const articulosMostrados = pedidoIdParam
    ? articulosMercaderia.filter((a) => pedidoLineas.some((l) => l.articulo_id === a.id))
    : articulosMercaderia

  const lineasLibresPendientes = pedidoIdParam
    ? pedidoLineas
        .filter((l) => l.producto_final_id == null && l.articulo_id == null)
        .map((l) => ({ ...l, restante: l.cantidad - l.entregado_previo - cantidadYaEnLineasLibres(l.id) }))
        .filter((l) => l.restante > 0)
    : []

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {pedidoIdParam && (
        <p className="text-sm text-[#0854A0]">Este albarán se enlazará a las líneas pendientes del pedido seleccionado.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Cliente">
          <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
            <option value="">Selecciona cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <Field label="Nº albarán">
          <Input type="text" value={numeroAlbaran} onChange={(e) => setNumeroAlbaran(e.target.value)} />
        </Field>
        <Field label="Fecha">
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
      </div>
      <Field label="Notas (opcional)">
        <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Field>

      <div>
        <SectionLabel>Añadir productos finales</SectionLabel>
        <div className="flex flex-col gap-3">
          {productosMostrados.map((prod) => (
            <ProductoParaVender
              key={prod.id}
              producto={prod}
              onAdd={addLineaProducto}
              refrescoStock={refrescoStock}
              cantidadYaEnLineas={cantidadYaEnLineas}
              fechaAlbaran={fecha}
              lineaPedido={pedidoIdParam ? lineaPedidoPara('producto', prod.id) : null}
            />
          ))}
        </div>
      </div>

      {articulosMostrados.length > 0 && (
        <div>
          <SectionLabel>Añadir mercadería</SectionLabel>
          <div className="flex flex-col gap-3">
            {articulosMostrados.map((art) => (
              <ArticuloParaVender
                key={art.id}
                articulo={art}
                onAdd={addLineaMercaderia}
                refrescoStock={refrescoStock}
                cantidadYaEnLineas={cantidadYaEnLineasArticulo}
                fechaAlbaran={fecha}
                lineaPedido={pedidoIdParam ? lineaPedidoPara('mercaderia', art.id) : null}
              />
            ))}
          </div>
        </div>
      )}

      {lineasLibresPendientes.length > 0 && (
        <div>
          <SectionLabel>Líneas pendientes de este pedido (otro / servicio)</SectionLabel>
          <div className="flex flex-col gap-3">
            {lineasLibresPendientes.map((l) => (
              <LineaPedidoLibrePendiente key={l.id} linea={l} onAdd={addLineaLibre} />
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Añadir otro / servicio</SectionLabel>
        <LineaLibreParaVender onAdd={addLineaLibre} />
      </div>

      {lineas.length > 0 && (
        <div>
          <SectionLabel>Líneas del albarán</SectionLabel>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {lineas.map((l, index) => (
                <tr key={index}>
                  <td className="py-1.5">
                    {l.display}
                    {l.tipo === 'mercaderia' && <span className="text-gray-400 text-xs"> (mercadería)</span>}
                    {l.tipo === 'libre' && <span className="text-gray-400 text-xs"> (otro/servicio)</span>}
                  </td>
                  <td className="py-1.5">{l.cantidad} uds.</td>
                  <td className="py-1.5">{l.precio_unitario != null ? `${l.precio_unitario} €/ud` : '-'}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => removeLinea(index)}
                      className="text-gray-400 hover:text-red-600">
                      <IconTrash size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit">Guardar albarán</Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  )
}

// Reparto multi-tanda: una línea de pedido puede tener varias previsiones (una por tanda). Cada una
// con tanda asignada se renderiza como su propia sub-fila bloqueada, independiente -- cantidad
// precargada (neta de lo ya añadido en esta sesión para esa tanda concreta) y "+ Añadir" propio.
// Vuelve null en cuanto esa previsión concreta queda cubierta (restante <= 0), igual criterio que el
// resto del sistema ("nada pendiente, no mostrar nada").
function FilaBloqueada({ producto, prevision, tandaInfo, onAdd, cantidadYaEnLineas, lineaPedido }) {
  const yaUsado = cantidadYaEnLineas(prevision.produccion_pf_id)
  const restante = Number(prevision.cantidad_prevista) - yaUsado
  const [cantidad, setCantidad] = useState(restante > 0 ? String(restante) : '')
  const [precio, setPrecio] = useState(lineaPedido?.precio_unitario ?? producto.precio_venta ?? '')

  useEffect(() => {
    if (restante > 0) setCantidad(String(restante))
  }, [restante])

  function handleAdd() {
    onAdd(producto, prevision.produccion_pf_id, cantidad, precio, tandaInfo?.stock_disponible ?? 0)
    setCantidad('')
  }

  if (restante <= 0) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
      <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5">
        {tandaInfo?.codigo_lote ? `${tandaInfo.codigo_lote} · ` : ''}Producción {tandaInfo ? formatFecha(tandaInfo.fecha) : ''}
        <span className="text-gray-400 text-xs"> — asignado desde Producciones del día</span>
      </div>
      <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        className="text-sm" title="Se redondeará a 3 decimales" />
      <Input type="number" step="0.01" placeholder="Precio/ud" value={precio}
        onChange={(e) => setPrecio(e.target.value)}
        className="text-sm" />
      <LinkAction tone="blue" onClick={handleAdd}>+ Añadir</LinkAction>
    </div>
  )
}

function ProductoParaVender({ producto, onAdd, refrescoStock, cantidadYaEnLineas, fechaAlbaran, lineaPedido }) {
  const [lotes, setLotes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [loteId, setLoteId] = useState('')

  // Reparto multi-tanda: previsiones con tanda asignada de esta línea (cada una se renderiza como su
  // propia FilaBloqueada, más abajo). sumaBloqueadaPendiente es lo que TODAVÍA falta por añadir
  // específicamente a través de esas filas -- se usa para decidir cuánto queda para la fila manual
  // (ver más abajo) sin depender de recalcular nada al vuelo dentro del render de cada FilaBloqueada.
  const previsionesConTanda = (lineaPedido?.previsiones_distribucion_pf || []).filter((pd) => pd.produccion_pf_id != null)
  const totalPrevisto = (lineaPedido?.previsiones_distribucion_pf || []).reduce((sum, pd) => sum + Number(pd.cantidad_prevista), 0)
  const sumaBloqueadaPendiente = previsionesConTanda.reduce((sum, pd) => {
    const restanteDePrevision = Number(pd.cantidad_prevista) - cantidadYaEnLineas(pd.produccion_pf_id)
    return sum + Math.max(0, restanteDePrevision)
  }, 0)
  // Fila manual (selección libre de lote): solo tiene sentido lo que las filas bloqueadas NO cubren.
  // Sin lineaPedido (venta directa, sin pedido de origen) se comporta exactamente igual que antes --
  // siempre visible, sin nada previsto que descontar.
  const restanteManual = lineaPedido ? lineaPedido.restante - sumaBloqueadaPendiente : null
  const mostrarFilaManual = !lineaPedido || restanteManual > 0

  const [cantidad, setCantidad] = useState(restanteManual > 0 ? String(restanteManual) : (lineaPedido?.restante > 0 ? String(lineaPedido.restante) : ''))
  const [precio, setPrecio] = useState(lineaPedido?.restante > 0 ? lineaPedido.precio_unitario : (producto.precio_venta ?? ''))

  // Precarga la fila manual con lo que de verdad queda sin cubrir por previsión (restanteManual, no el
  // restante bruto de la línea) -- resincroniza también cuando avanza sumaBloqueadaPendiente (al añadir
  // una fila bloqueada), no solo al cambiar de línea.
  useEffect(() => {
    if (restanteManual > 0) {
      setCantidad(String(restanteManual))
      setPrecio(lineaPedido.precio_unitario ?? '')
    }
  }, [lineaPedido?.id, restanteManual])

  useEffect(() => {
    async function cargarLotes() {
      const { data } = await supabase
        .from('stock_lotes_producto_final')
        .select('*')
        .eq('producto_final_id', producto.id)
        .order('fecha', { ascending: true })
      setLotes(data || [])
      setCargando(false)
    }
    cargarLotes()
  }, [producto.id, refrescoStock])

  function handleAdd() {
    const lote = lotes.find((l) => Number(l.produccion_id) === Number(loteId))
    onAdd(producto, loteId, cantidad, precio, lote?.stock_disponible ?? 0)
    setLoteId('')
    setCantidad('')
  }

  if (cargando) return null

  const lotesConDisponibleReal = lotes
    .map((l) => ({ ...l, disponibleReal: l.stock_disponible - cantidadYaEnLineas(l.produccion_id) }))
    .filter((l) => l.disponibleReal > 0)

  // Nada que ofrecer: ninguna previsión con tanda que mostrar como fila bloqueada, y tampoco stock
  // disponible para elegir a mano -- mismo criterio que antes (con o sin lineaPedido, no cambia: sin
  // pedido nunca hubo bloqueada, así que este guard ya se comportaba exactamente así).
  if (previsionesConTanda.length === 0 && lotesConDisponibleReal.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{producto.nombre}</p>
        {totalPrevisto > 0 && (
          <p className="text-xs text-gray-400">Total previsto: {totalPrevisto.toFixed(3)}</p>
        )}
      </div>

      {previsionesConTanda.map((pd) => (
        <FilaBloqueada
          key={pd.produccion_pf_id}
          producto={producto}
          prevision={pd}
          tandaInfo={lotes.find((l) => Number(l.produccion_id) === Number(pd.produccion_pf_id))}
          onAdd={onAdd}
          cantidadYaEnLineas={cantidadYaEnLineas}
          lineaPedido={lineaPedido}
        />
      ))}

      {mostrarFilaManual && lotesConDisponibleReal.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
          <Select value={loteId} onChange={(e) => setLoteId(e.target.value)} className="text-sm">
            <option value="">Selecciona lote de producción</option>
            {lotesConDisponibleReal.map((l) => {
              const fechaPosterior = fechaAlbaran && l.fecha > fechaAlbaran
              const caducado = l.fecha_caducidad && fechaAlbaran && l.fecha_caducidad < fechaAlbaran
              return (
                <option key={l.produccion_id} value={l.produccion_id} disabled={fechaPosterior}>
                  {l.codigo_lote ? `${l.codigo_lote} · ` : ''}Producción {formatFecha(l.fecha)} · {l.disponibleReal.toFixed(3)} disp.{fechaPosterior ? ' — ⚠ fecha posterior, no se podrá vender' : caducado ? ' — ⚠ caducado, revisar antes de vender' : ''}
                </option>
              )
            })}
          </Select>
          <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="text-sm" title="Se redondeará a 3 decimales" />
          <Input type="number" step="0.01" placeholder="Precio/ud" value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="text-sm" />
          <LinkAction tone="blue" onClick={handleAdd}>+ Añadir</LinkAction>
        </div>
      )}
    </div>
  )
}

function ArticuloParaVender({ articulo, onAdd, refrescoStock, cantidadYaEnLineas, fechaAlbaran, lineaPedido }) {
  const [lotes, setLotes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState(lineaPedido?.restante > 0 ? String(lineaPedido.restante) : '')
  const [precio, setPrecio] = useState(lineaPedido?.restante > 0 ? lineaPedido.precio_unitario : '')

  useEffect(() => {
    if (lineaPedido && lineaPedido.restante > 0) {
      setCantidad(String(lineaPedido.restante))
      setPrecio(lineaPedido.precio_unitario ?? '')
    }
  }, [lineaPedido?.id, lineaPedido?.restante])

  useEffect(() => {
    async function cargarLotes() {
      const { data } = await supabase
        .from('stock_lotes_articulo')
        .select('*')
        .eq('articulo_id', articulo.id)
        .gt('stock_disponible', 0)
        .order('fecha_recepcion', { ascending: true })
      setLotes(data || [])
      setCargando(false)
    }
    cargarLotes()
  }, [articulo.id, refrescoStock])

  function handleAdd() {
    const lote = lotes.find((l) => l.entrada_material_id === parseInt(loteId))
    onAdd(articulo, loteId, cantidad, precio, lote?.stock_disponible ?? 0)
    setLoteId('')
    setCantidad('')
  }

  if (cargando) return null

  const lotesConDisponibleReal = lotes
    .map((l) => ({ ...l, disponibleReal: l.stock_disponible - cantidadYaEnLineas(l.entrada_material_id) }))
    .filter((l) => l.disponibleReal > 0)

  if (lotesConDisponibleReal.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <p className="text-sm font-medium text-gray-700">{articulo.nombre}</p>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
        <Select value={loteId} onChange={(e) => setLoteId(e.target.value)} className="text-sm">
          <option value="">Selecciona lote</option>
          {lotesConDisponibleReal.map((l) => {
            const fechaPosterior = fechaAlbaran && l.fecha_recepcion > fechaAlbaran
            const caducado = l.fecha_caducidad && fechaAlbaran && l.fecha_caducidad < fechaAlbaran
            return (
              <option key={l.entrada_material_id} value={l.entrada_material_id} disabled={fechaPosterior}>
                {l.proveedor ? `${l.proveedor} · ` : ''}Albarán {l.numero_albaran || '(s/n)'} · {formatFecha(l.fecha_recepcion)} · {l.disponibleReal.toFixed(3)} {articulo.unidad} disp.{fechaPosterior ? ' — ⚠ fecha posterior, no se podrá vender' : caducado ? ' — ⚠ caducado, revisar antes de vender' : ''}
              </option>
            )
          })}
        </Select>
        <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="text-sm" title="Se redondeará a 3 decimales" />
        <Input type="number" step="0.01" placeholder="Precio/ud" value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="text-sm" />
        <LinkAction tone="blue" onClick={handleAdd}>+ Añadir</LinkAction>
      </div>
    </div>
  )
}

// Línea 'otro/servicio' de un pedido, todavía sin servir del todo.
// Descripción/cantidad/precio precargados desde el pedido pero editables;
// linea_pedido_id se fija explícitamente (a diferencia de LineaLibreParaVender,
// que siempre lo deja en null) para que se compute como servida.
function LineaPedidoLibrePendiente({ linea, onAdd }) {
  const [descripcion, setDescripcion] = useState(linea.descripcion ?? '')
  const [cantidad, setCantidad] = useState(String(linea.restante))
  const [precio, setPrecio] = useState(linea.precio_unitario ?? '')

  useEffect(() => {
    setCantidad(String(linea.restante))
  }, [linea.restante])

  function handleAdd() {
    onAdd(descripcion, cantidad, precio, linea.id)
  }

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <p className="text-sm font-medium text-gray-700">
        {linea.descripcion} <span className="text-gray-400 text-xs">— {linea.restante} uds. pendientes del pedido</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
        <Input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="text-sm" />
        <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="text-sm" title="Se redondeará a 3 decimales" />
        <Input type="number" step="0.01" placeholder="Precio/ud" value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="text-sm" />
        <LinkAction tone="blue" onClick={handleAdd}>+ Añadir</LinkAction>
      </div>
    </div>
  )
}

// Sin selector de lote: no hay stock ni catálogo que comprobar — solo
// descripción de texto libre + cantidad + precio.
function LineaLibreParaVender({ onAdd }) {
  const [descripcion, setDescripcion] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [precio, setPrecio] = useState('')

  function handleAdd() {
    onAdd(descripcion, cantidad, precio)
    setDescripcion('')
    setCantidad('1')
    setPrecio('')
  }

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
        <Input type="text" placeholder="Descripción (ej. Pan, Horas de showcooking extra...)" value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="text-sm" />
        <Input type="number" step="0.001" placeholder="Cantidad" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="text-sm" title="Se redondeará a 3 decimales" />
        <Input type="number" step="0.01" placeholder="Precio/ud" value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="text-sm" />
        <LinkAction tone="blue" onClick={handleAdd}>+ Añadir</LinkAction>
      </div>
    </div>
  )
}
