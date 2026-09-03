import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { Field, Input, Select, DateInput, SectionLabel, Button } from './ui'

const lineaVacia = { id: null, tipo: 'producto', producto_final_id: '', articulo_id: '', descripcion: '', cantidad: '', precio_unitario: '' }

// BLOQUE 6 (CONTRATO_UX_PEDIDOS_VENTA.md): formulario de alta/edición extraído del layout inline de
// Pedidos.jsx a este componente, para vivir dentro del Drawer (mismo patrón que AjusteStockForm.jsx
// dentro de Inventario.jsx). Misma lógica de validación/guardado de siempre, solo cambia el
// contenedor -- el componente se desmonta al cerrar el drawer, así que no hace falta un resetForm:
// la próxima apertura es un montaje nuevo con estado fresco a partir de `pedido`.
function estadoInicial(pedido) {
  if (!pedido) {
    return {
      clienteId: '',
      fecha: new Date().toISOString().slice(0, 10),
      fechaEntrega: '',
      notas: '',
      lineas: [{ ...lineaVacia }],
      editandoId: null,
    }
  }
  return {
    clienteId: String(pedido.cliente_id),
    fecha: pedido.fecha,
    fechaEntrega: pedido.fecha_entrega_prevista ?? '',
    notas: pedido.notas ?? '',
    lineas: pedido.lineas_pedido_venta.map((l) => ({
      id: l.id,
      tipo: l.producto_final_id ? 'producto' : l.articulo_id ? 'mercaderia' : 'libre',
      producto_final_id: l.producto_final_id ? String(l.producto_final_id) : '',
      articulo_id: l.articulo_id ? String(l.articulo_id) : '',
      descripcion: l.descripcion ?? '',
      cantidad: String(l.cantidad),
      precio_unitario: l.precio_unitario != null ? String(l.precio_unitario) : '',
    })),
    editandoId: pedido.id,
  }
}

export default function PedidoForm({ pedido, clientes, productos, articulosMercaderia, onGuardado, onCancelar }) {
  const [inicial] = useState(() => estadoInicial(pedido))
  const [clienteId, setClienteId] = useState(inicial.clienteId)
  const [fecha, setFecha] = useState(inicial.fecha)
  const [fechaEntrega, setFechaEntrega] = useState(inicial.fechaEntrega)
  const [notas, setNotas] = useState(inicial.notas)
  const [lineas, setLineas] = useState(inicial.lineas)
  const [lineasABorrar, setLineasABorrar] = useState([])
  const [editandoId] = useState(inicial.editandoId)

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'tipo') {
        copia[index].producto_final_id = ''
        copia[index].articulo_id = ''
        copia[index].descripcion = ''
        if (valor === 'libre' && !copia[index].cantidad) {
          copia[index].cantidad = '1'
        }
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

  async function handleSubmit(e) {
    e.preventDefault()

    if (fechaEntrega && fechaEntrega < fecha) {
      alert('La fecha de entrega prevista no puede ser anterior a la fecha del pedido')
      return
    }

    const lineasValidas = lineas.filter(
      (l) => l.cantidad && (l.producto_final_id || l.articulo_id || l.descripcion)
    )
    if (lineasValidas.length === 0) {
      alert('Añade al menos una línea con producto/mercadería/descripción y cantidad')
      return
    }

    function calcularCamposLinea(l) {
      return {
        producto_final_id: l.tipo === 'producto' ? parseInt(l.producto_final_id) : null,
        articulo_id: l.tipo === 'mercaderia' ? parseInt(l.articulo_id) : null,
        descripcion: l.tipo === 'libre' ? l.descripcion : null,
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

      onGuardado(editandoId)
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

    onGuardado(pedidoCreado.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3">
        <Field label="Cliente">
          <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
            <option value="">Selecciona cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha">
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label="Fecha de entrega prevista (opcional)">
          <DateInput value={fechaEntrega} onChange={setFechaEntrega} />
          {fechaEntrega && fechaEntrega < fecha && (
            <p className="text-red-600 text-xs mt-1">No puede ser anterior a la fecha del pedido</p>
          )}
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
              <div className="flex gap-4 text-sm flex-wrap">
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
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={linea.tipo === 'libre'}
                    onChange={() => handleLineaChange(index, 'tipo', 'libre')} />
                  Otro / servicio
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2 items-center">
                {linea.tipo === 'producto' ? (
                  <Select value={linea.producto_final_id}
                    onChange={(e) => handleLineaChange(index, 'producto_final_id', e.target.value)}
                    required>
                    <option value="">Selecciona producto final</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </Select>
                ) : linea.tipo === 'mercaderia' ? (
                  <Select value={linea.articulo_id}
                    onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                    required>
                    <option value="">Selecciona artículo de mercadería</option>
                    {articulosMercaderia.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                    ))}
                  </Select>
                ) : (
                  <Input type="text" placeholder="Descripción (ej. Pan, Horas de showcooking extra...)"
                    value={linea.descripcion}
                    onChange={(e) => handleLineaChange(index, 'descripcion', e.target.value)}
                    required />
                )}
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
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
        <Button type="button" variant="secondary" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  )
}
