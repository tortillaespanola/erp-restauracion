import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, Badge, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { id: null, tipo: 'producto', producto_final_id: '', articulo_id: '', cantidad: '', precio_unitario: '' }

const GRUPO_ESTADO = { pendiente: 0, en_produccion: 0, servido: 1, cancelado: 1 }

function compararPedidos(a, b) {
  const grupoA = GRUPO_ESTADO[a.estado] ?? 0
  const grupoB = GRUPO_ESTADO[b.estado] ?? 0
  if (grupoA !== grupoB) return grupoA - grupoB

  if (!a.fecha_entrega_prevista && !b.fecha_entrega_prevista) return 0
  if (!a.fecha_entrega_prevista) return 1
  if (!b.fecha_entrega_prevista) return -1
  return a.fecha_entrega_prevista.localeCompare(b.fecha_entrega_prevista)
}

const ESTADO_BADGE = {
  pendiente: 'gray',
  en_produccion: 'amber',
  servido: 'green',
  cancelado: 'red',
}

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  en_produccion: 'En producción',
  servido: 'Servido',
  cancelado: 'Cancelado',
}

function Pedidos() {
  const navigate = useNavigate()
  const [pedidos, setPedidos] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [articulosMercaderia, setArticulosMercaderia] = useState([])
  const [cargando, setCargando] = useState(true)

  const [clienteId, setClienteId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])

  const [editandoId, setEditandoId] = useState(null)
  const [lineasABorrar, setLineasABorrar] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resPedidos, resClientes, resProductos, resArticulos] = await Promise.all([
      supabase
        .from('pedidos_venta')
        .select(`
          *,
          clientes(nombre),
          lineas_pedido_venta(
            id, producto_final_id, articulo_id, cantidad, precio_unitario,
            productos_finales(nombre),
            articulos_compra(nombre, unidad),
            lineas_albaran_venta(cantidad)
          )
        `)
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('articulos_compra').select('id, nombre, unidad').eq('tipo_material', 'TRD').order('nombre'),
    ])

    if (resPedidos.error) console.error(resPedidos.error)
    else setPedidos((resPedidos.data ?? []).sort(compararPedidos))

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulosMercaderia(resArticulos.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'tipo') {
        copia[index].producto_final_id = ''
        copia[index].articulo_id = ''
      }
      return copia
    })
  }

  function addLinea() {
    setLineas((prev) => [...prev, { ...lineaVacia }])
  }

  function removeLinea(index) {
    const linea = lineas[index]
    if (linea.id) {
      setLineasABorrar((prev) => [...prev, linea.id])
    }
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setClienteId('')
    setFecha(new Date().toISOString().slice(0, 10))
    setFechaEntrega('')
    setNotas('')
    setLineas([{ ...lineaVacia }])
    setEditandoId(null)
    setLineasABorrar([])
  }

  async function handleEditar(pedido) {
    const lineaIds = pedido.lineas_pedido_venta.map((l) => l.id)

    const [resProduccion, resAlbaran] = await Promise.all([
      supabase.from('producciones_producto_final').select('id', { count: 'exact', head: true }).eq('pedido_id', pedido.id),
      lineaIds.length > 0
        ? supabase.from('lineas_albaran_venta').select('id', { count: 'exact', head: true }).in('linea_pedido_id', lineaIds)
        : Promise.resolve({ count: 0, error: null }),
    ])

    if (resProduccion.error || resAlbaran.error) {
      alert('Error al comprobar si el pedido se puede editar: ' + (resProduccion.error || resAlbaran.error).message)
      return
    }

    if ((resProduccion.count || 0) > 0 || (resAlbaran.count || 0) > 0) {
      alert('Este pedido ya tiene producción o entregas registradas; no se puede editar todavía — cancélalo y crea uno nuevo, o contacta con soporte.')
      return
    }

    setClienteId(String(pedido.cliente_id))
    setFecha(pedido.fecha)
    setFechaEntrega(pedido.fecha_entrega_prevista ?? '')
    setNotas(pedido.notas ?? '')
    setLineas(
      pedido.lineas_pedido_venta.map((l) => ({
        id: l.id,
        tipo: l.producto_final_id ? 'producto' : 'mercaderia',
        producto_final_id: l.producto_final_id ? String(l.producto_final_id) : '',
        articulo_id: l.articulo_id ? String(l.articulo_id) : '',
        cantidad: String(l.cantidad),
        precio_unitario: l.precio_unitario != null ? String(l.precio_unitario) : '',
      }))
    )
    setLineasABorrar([])
    setEditandoId(pedido.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter(
      (l) => l.cantidad && (l.producto_final_id || l.articulo_id)
    )
    if (lineasValidas.length === 0) {
      alert('Añade al menos una línea con producto/mercadería y cantidad')
      return
    }

    function calcularCamposLinea(l) {
      return {
        producto_final_id: l.tipo === 'producto' ? parseInt(l.producto_final_id) : null,
        articulo_id: l.tipo === 'mercaderia' ? parseInt(l.articulo_id) : null,
        cantidad: parseFloat(l.cantidad),
        precio_unitario: l.precio_unitario ? parseFloat(l.precio_unitario) : null,
      }
    }

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('pedidos_venta')
        .update({
          cliente_id: parseInt(clienteId),
          fecha,
          fecha_entrega_prevista: fechaEntrega || null,
          notas: notas || null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert('Error al actualizar el pedido: ' + errorUpdate.message)
        return
      }

      if (lineasABorrar.length > 0) {
        const { error: errorBorrar } = await supabase
          .from('lineas_pedido_venta')
          .delete()
          .in('id', lineasABorrar)
        if (errorBorrar) {
          alert('Error al borrar líneas: ' + errorBorrar.message)
          return
        }
      }

      for (const l of lineasValidas.filter((l) => l.id)) {
        const { error } = await supabase
          .from('lineas_pedido_venta')
          .update(calcularCamposLinea(l))
          .eq('id', l.id)
        if (error) {
          alert('Error al actualizar una línea: ' + error.message)
          return
        }
      }

      const nuevas = lineasValidas.filter((l) => !l.id)
      if (nuevas.length > 0) {
        const { error } = await supabase
          .from('lineas_pedido_venta')
          .insert(nuevas.map((l) => ({ pedido_id: editandoId, ...calcularCamposLinea(l) })))
        if (error) {
          alert('Error al añadir nuevas líneas: ' + error.message)
          return
        }
      }

      resetForm()
      cargarDatos()
      return
    }

    const { data: pedidoCreado, error: errorPedido } = await supabase
      .from('pedidos_venta')
      .insert({
        cliente_id: parseInt(clienteId),
        fecha,
        fecha_entrega_prevista: fechaEntrega || null,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorPedido) {
      alert('Error al crear el pedido: ' + errorPedido.message)
      return
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      pedido_id: pedidoCreado.id,
      ...calcularCamposLinea(l),
    }))

    const { error: errorLineas } = await supabase
      .from('lineas_pedido_venta')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      await supabase.from('pedidos_venta').delete().eq('id', pedidoCreado.id)
      alert('Error al guardar las líneas: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar este pedido?')) return
    const { error } = await supabase.from('pedidos_venta').update({ estado: 'cancelado' }).eq('id', id)
    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Pedidos" subtitle="Registra lo que pide un cliente, lanza la producción que haga falta, y créalo como albarán de venta cuando esté listo." />

      <Card className="mb-6">
        <CardHeader title={editandoId ? 'Editar pedido' : 'Nuevo pedido'} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Cliente">
                <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
                  <option value="">Selecciona cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha">
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              </Field>
              <Field label="Fecha de entrega prevista (opcional)">
                <Input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
              </Field>
            </div>
            <Field label="Notas (opcional)">
              <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Field>

            <div>
              <SectionLabel>Líneas del pedido</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-3 flex flex-col gap-2">
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'producto'}
                          onChange={() => handleLineaChange(index, 'tipo', 'producto')} />
                        Producto final
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'mercaderia'}
                          onChange={() => handleLineaChange(index, 'tipo', 'mercaderia')} />
                        Mercadería
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
                      {linea.tipo === 'producto' ? (
                        <Select value={linea.producto_final_id}
                          onChange={(e) => handleLineaChange(index, 'producto_final_id', e.target.value)}
                          required>
                          <option value="">Selecciona producto final</option>
                          {productos.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </Select>
                      ) : (
                        <Select value={linea.articulo_id}
                          onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                          required>
                          <option value="">Selecciona artículo de mercadería</option>
                          {articulosMercaderia.map((a) => (
                            <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                          ))}
                        </Select>
                      )}
                      <Input type="number" step="0.001" placeholder="Cantidad" value={linea.cantidad}
                        onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                        required title="Se redondeará a 3 decimales" />
                      <Input type="number" step="0.01" placeholder="Precio" value={linea.precio_unitario}
                        onChange={(e) => handleLineaChange(index, 'precio_unitario', e.target.value)} />
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-gray-400 hover:text-red-600 justify-self-center">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-[#0854A0] font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> Añadir línea
              </button>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar pedido'}</Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={resetForm}>Cancelar edición</Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Listado</h2>

      {cargando ? (
        <LoadingState />
      ) : pedidos.length === 0 ? (
        <Card><EmptyState>Todavía no hay pedidos registrados.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pedidos.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938] flex items-center gap-2 flex-wrap">
                    {p.clientes?.nombre ?? 'Sin cliente'}
                    {p.codigo_pedido && <span className="text-xs font-mono text-gray-400">{p.codigo_pedido}</span>}
                    <Badge color={ESTADO_BADGE[p.estado] ?? 'gray'}>{ESTADO_LABEL[p.estado] ?? p.estado}</Badge>
                  </p>
                  <p className="text-sm text-gray-500">
                    {p.fecha}{p.fecha_entrega_prevista && ` · entrega prevista ${p.fecha_entrega_prevista}`}
                  </p>
                  {p.notas && <p className="text-sm text-gray-400 italic">{p.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0 items-start">
                  {p.estado !== 'servido' && p.estado !== 'cancelado' && (
                    <LinkAction tone="blue" onClick={() => handleEditar(p)}>Editar</LinkAction>
                  )}
                  {p.estado !== 'servido' && p.estado !== 'cancelado' && (
                    <LinkAction tone="blue" onClick={() => navigate(`/albaranes-venta?pedido_id=${p.id}`)}>
                      Crear albarán de venta
                    </LinkAction>
                  )}
                  {p.estado !== 'servido' && p.estado !== 'cancelado' && (
                    <LinkAction tone="red" onClick={() => handleCancelar(p.id)}>Cancelar</LinkAction>
                  )}
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">Línea</th>
                    <th className="py-1.5 font-medium">Pedido</th>
                    <th className="py-1.5 font-medium">Servido</th>
                    <th className="py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.lineas_pedido_venta.map((linea) => {
                    const esProducto = !!linea.producto_final_id
                    const nombre = esProducto ? linea.productos_finales?.nombre : linea.articulos_compra?.nombre
                    const unidad = esProducto ? '' : linea.articulos_compra?.unidad
                    const servido = (linea.lineas_albaran_venta || []).reduce((sum, l) => sum + Number(l.cantidad), 0)
                    const completa = servido >= linea.cantidad
                    return (
                      <tr key={linea.id}>
                        <td className="py-1.5">{nombre} {!esProducto && <span className="text-gray-400 text-xs">(mercadería)</span>}</td>
                        <td className="py-1.5">{linea.cantidad} {unidad}</td>
                        <td className={`py-1.5 ${completa ? 'text-green-600' : 'text-gray-500'}`}>{servido} {unidad}</td>
                        <td className="py-1.5 text-right">
                          {esProducto && !completa && p.estado !== 'servido' && p.estado !== 'cancelado' && (
                            <LinkAction
                              tone="blue"
                              className="text-xs"
                              onClick={() => navigate(`/produccion-productos?pedido_id=${p.id}&producto_final_id=${linea.producto_final_id}`)}
                            >
                              Iniciar producción
                            </LinkAction>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default Pedidos
