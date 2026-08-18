import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { descargarPdf, imprimirPdf } from '../lib/generarPdf'
import { IconTrash } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, DateInput, SectionLabel, EmptyState, LoadingState } from '../components/ui'

function nombreLineaVenta(linea) {
  return linea.productos_finales?.nombre ?? linea.articulos_compra?.nombre ?? linea.descripcion
}

function AlbaranesVenta() {
  const [searchParams] = useSearchParams()
  const pedidoIdParam = searchParams.get('pedido_id')

  const [albaranes, setAlbaranes] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [articulosMercaderia, setArticulosMercaderia] = useState([])
  const [cargando, setCargando] = useState(true)
  const [refrescoStock, setRefrescoStock] = useState(0)
  const [pedidoLineas, setPedidoLineas] = useState([])

  const [clienteId, setClienteId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resAlbaranes, resClientes, resProductos, resArticulos] = await Promise.all([
      supabase
        .from('albaranes_venta')
        .select('*, clientes(nombre, direccion, cif), lineas_albaran_venta(id, cantidad, precio_unitario, descripcion, productos_finales(nombre), articulos_compra(nombre))')
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').order('nombre'),
      supabase.from('productos_finales').select('id, nombre, precio_venta').order('nombre'),
      supabase.from('articulos_compra').select('id, nombre, unidad').eq('tipo_material', 'TRD').order('nombre'),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else setAlbaranes(resAlbaranes.data)

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulosMercaderia(resArticulos.data)

    setCargando(false)
    setRefrescoStock((n) => n + 1)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

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
        const lineasConEntregado = (data.lineas_pedido_venta || []).map((l) => ({
          ...l,
          entregado_previo: (l.lineas_albaran_venta || []).reduce((sum, e) => sum + e.cantidad, 0),
          // Capa C, Paso 2: si Producciones del día ya fijó una tanda para esta línea (vía FIFO o a
          // mano), se precarga y se bloquea el selector de lote -- "se puede tocar cantidad, no lote".
          // previsiones_distribucion_pf tiene UNIQUE(linea_pedido_id) -> PostgREST la embebe como
          // relación a-uno (objeto único o null, no array) -- mismo bug ya corregido en Pedidos.jsx.
          produccion_pf_id_previsto: l.previsiones_distribucion_pf?.produccion_pf_id ?? null,
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

  function resetForm() {
    setClienteId('')
    setNumeroAlbaran('')
    setFecha(new Date().toISOString().slice(0, 10))
    setNotas('')
    setLineas([])
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
      alert(`Solo quedan ${restante.toFixed(3)} unidades disponibles en ese lote de producción`)
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
      alert(`Solo quedan ${restante.toFixed(3)} unidades disponibles en ese lote`)
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
      alert('Error al guardar las líneas: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    const { count } = await supabase
      .from('factura_venta_albaran')
      .select('*', { count: 'exact', head: true })
      .eq('albaran_venta_id', id)

    const mensaje = count > 0
      ? `⚠️ Este albarán está incluido en ${count} factura(s). Al borrarlo, se quitará de esa factura, pero la factura en sí NO se borrará (podría quedar con un total que ya no cuadra con sus líneas). ¿Seguro que quieres continuar?`
      : '¿Seguro que quieres borrar este albarán? Se revertirá el stock vendido.'

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('albaranes_venta').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
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

  function prepararDocumento(alb) {
    return {
      numero: alb.numero_albaran || `#${alb.id}`,
      fecha: alb.fecha,
      tercero: {
        nombre: alb.clientes?.nombre,
        direccion: alb.clientes?.direccion,
        cif: alb.clientes?.cif,
      },
      lineas: alb.lineas_albaran_venta.map((l) => ({
        concepto: nombreLineaVenta(l),
        cantidad: l.cantidad,
        precioUnitario: l.precio_unitario,
      })),
      total: alb.lineas_albaran_venta.reduce(
        (sum, l) => sum + (l.precio_unitario ? l.cantidad * l.precio_unitario : 0), 0
      ),
    }
  }

  return (
    <div>
      <PageHeader title="Albaranes de venta" />

      <Card className="mb-6">
        <CardHeader title="Nuevo albarán" />
        <CardBody>
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

            <Button type="submit" className="self-start">Guardar albarán</Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Listado</h2>

      {cargando ? (
        <LoadingState />
      ) : albaranes.length === 0 ? (
        <Card><EmptyState>Todavía no hay albaranes de venta registrados.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {albaranes.map((alb) => (
            <Card key={alb.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938]">{alb.clientes?.nombre ?? 'Sin cliente'}</p>
                  <p className="text-sm text-gray-500">
                    Albarán {alb.numero_albaran || '(sin número)'} · {formatFecha(alb.fecha)}
                  </p>
                  {alb.notas && <p className="text-sm text-gray-400 italic">{alb.notas}</p>}
                </div>
                <div className="flex gap-3 items-start shrink-0">
                  <LinkAction tone="gray" onClick={() => imprimirPdf('Albarán', prepararDocumento(alb))}>Imprimir</LinkAction>
                  <LinkAction tone="blue" onClick={() => descargarPdf('Albarán', prepararDocumento(alb))}>Descargar PDF</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(alb.id)}>Borrar</LinkAction>
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">Producto</th>
                    <th className="py-1.5 font-medium">Cantidad</th>
                    <th className="py-1.5 font-medium">Precio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {alb.lineas_albaran_venta.map((linea) => (
                    <tr key={linea.id}>
                      <td className="py-1.5">{nombreLineaVenta(linea)}</td>
                      <td className="py-1.5">{linea.cantidad}</td>
                      <td className="py-1.5">{linea.precio_unitario ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductoParaVender({ producto, onAdd, refrescoStock, cantidadYaEnLineas, fechaAlbaran, lineaPedido }) {
  const [lotes, setLotes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState(lineaPedido?.restante > 0 ? String(lineaPedido.restante) : '')
  const [precio, setPrecio] = useState(lineaPedido?.restante > 0 ? lineaPedido.precio_unitario : (producto.precio_venta ?? ''))

  // Precarga la próxima línea de pedido pendiente (precio/cantidad pactados),
  // editable. Resincroniza tras cada "+ Añadir" — si el pedido tenía más de
  // una línea del mismo producto (ej. una a precio normal y otra de muestra),
  // pasa a precargar la siguiente pendiente en vez de quedarse con la ya cubierta.
  //
  // Capa C, Paso 2: también precarga loteId con la tanda que Producciones del día ya fijó para esta
  // línea (produccion_pf_id_previsto), si la hay -- coherente con "se puede tocar cantidad, no lote".
  useEffect(() => {
    if (lineaPedido && lineaPedido.restante > 0) {
      setCantidad(String(lineaPedido.restante))
      setPrecio(lineaPedido.precio_unitario ?? '')
      setLoteId(lineaPedido.produccion_pf_id_previsto ? String(lineaPedido.produccion_pf_id_previsto) : '')
    }
  }, [lineaPedido?.id, lineaPedido?.restante])

  // Sin filtro de stock_disponible > 0 en la consulta: el lote bloqueado por una previsión debe poder
  // mostrarse aunque su stock_disponible actual sea 0 (caso raro pero posible). El filtro de "solo
  // ofrecer para elegir a mano los que sí tienen stock" se aplica después, en JS, vía
  // lotesConDisponibleReal -- que es la única lista que alimenta el <Select> manual.
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
    const lote = lotes.find((l) => l.produccion_id === parseInt(loteId))
    onAdd(producto, loteId, cantidad, precio, lote?.stock_disponible ?? 0)
    setLoteId('')
    setCantidad('')
  }

  if (cargando) return null

  const lotesConDisponibleReal = lotes
    .map((l) => ({ ...l, disponibleReal: l.stock_disponible - cantidadYaEnLineas(l.produccion_id) }))
    .filter((l) => l.disponibleReal > 0)

  const loteBloqueado = lineaPedido?.produccion_pf_id_previsto
    ? lotes.find((l) => Number(l.produccion_id) === Number(lineaPedido.produccion_pf_id_previsto))
    : null

  // Si no hay lote bloqueado y tampoco hay stock disponible para elegir a mano, no hay nada que
  // ofrecer para este producto -- mismo criterio de antes. Con lote bloqueado, se muestra igual aunque
  // el resto de tandas esté a 0, para que el operador vea la asignación ya decidida.
  if (lotesConDisponibleReal.length === 0 && !loteBloqueado) return null

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <p className="text-sm font-medium text-gray-700">{producto.nombre}</p>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 mt-2 items-center">
        {loteBloqueado ? (
          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5">
            {loteBloqueado.codigo_lote ? `${loteBloqueado.codigo_lote} · ` : ''}Producción {formatFecha(loteBloqueado.fecha)}
            <span className="text-gray-400 text-xs"> — asignado desde Producciones del día</span>
          </div>
        ) : (
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
        )}
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

export default AlbaranesVenta
