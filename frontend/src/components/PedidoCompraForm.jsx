import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconTrash, IconPlus, IconAlertTriangle } from '@tabler/icons-react'
import { Field, Input, Select, DateInput, SectionLabel, Button } from './ui'
import { useOpcionesDependientes } from '../hooks/useOpcionesDependientes'

const lineaVacia = { id: null, articulo_id: '', cantidad: '', precio_unitario: '' }

// CONTRATO_DRAWERS_COMPRAS.md, paso 1: formulario de alta/edición extraído del layout inline de
// PedidosCompra.jsx a este componente, para vivir dentro del Drawer -- mismo patrón que
// PedidoForm.jsx (venta), la plantilla de referencia del contrato (líneas en lista simple, no la
// selección FIFO de AlbaranVentaForm.jsx, que no aplica aquí). El componente se desmonta al cerrar
// el drawer, así que no hace falta ningún resetForm(): la próxima apertura es un montaje nuevo con
// estado fresco a partir de `pedido`.
//
// A diferencia de PedidoForm.jsx, el catálogo de artículos depende del proveedor elegido (tabla
// puente articulo_proveedor) -- ese useEffect de recarga vive aquí dentro (el hijo es dueño de su
// estado derivado), no se pasa filtrado desde el padre.
function estadoInicial(pedido) {
  if (!pedido) {
    return {
      proveedorId: '',
      fecha: new Date().toISOString().slice(0, 10),
      fechaEntrega: '',
      referenciaProveedor: '',
      notas: '',
      lineas: [{ ...lineaVacia }],
      editandoId: null,
    }
  }
  return {
    proveedorId: String(pedido.proveedor_id),
    fecha: pedido.fecha,
    fechaEntrega: pedido.fecha_entrega_prevista ?? '',
    referenciaProveedor: pedido.referencia_proveedor ?? '',
    notas: pedido.notas ?? '',
    lineas: pedido.lineas_pedido_compra.map((l) => ({
      id: l.id,
      articulo_id: String(l.articulo_id),
      cantidad: String(l.cantidad),
      precio_unitario: l.precio_unitario != null ? String(l.precio_unitario) : '',
    })),
    editandoId: pedido.id,
  }
}

export default function PedidoCompraForm({ pedido, proveedores, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'compras_comun', 'pedidos_compra'])
  const [inicial] = useState(() => estadoInicial(pedido))
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId)
  const [fecha, setFecha] = useState(inicial.fecha)
  const [fechaEntrega, setFechaEntrega] = useState(inicial.fechaEntrega)
  const [referenciaProveedor, setReferenciaProveedor] = useState(inicial.referenciaProveedor)
  const [notas, setNotas] = useState(inicial.notas)
  const [lineas, setLineas] = useState(inicial.lineas)
  const [lineasABorrar, setLineasABorrar] = useState([])
  const [editandoId] = useState(inicial.editandoId)

  const { opciones: articulosDelProveedor, cargando: cargandoArticulos } = useOpcionesDependientes(
    proveedorId,
    async (id) => {
      const { data, error } = await supabase
        .from('articulo_proveedor')
        .select('precio, referencia_proveedor, articulos_compra(id, nombre, unidad)')
        .eq('proveedor_id', id)
      if (error) throw error
      return (data || []).map((ap) => ({
        id: ap.articulos_compra.id,
        nombre: ap.articulos_compra.nombre,
        unidad: ap.articulos_compra.unidad,
        precioPactado: ap.precio,
        referenciaProveedor: ap.referencia_proveedor,
      }))
    }
  )

  function handleProveedorChange(nuevoProveedorId) {
    const hayLineasRellenas = lineas.some((l) => l.articulo_id || l.cantidad || l.precio_unitario)
    if (proveedorId && nuevoProveedorId !== proveedorId && hayLineasRellenas) {
      if (!confirm(t('pedidos_compra:alertas.cambiar_proveedor_confirmacion'))) {
        return
      }
      setLineas([{ ...lineaVacia }])
    }
    setProveedorId(nuevoProveedorId)
  }

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'articulo_id') {
        const art = articulosDelProveedor.find((a) => a.id === parseInt(valor))
        if (art?.precioPactado != null && !copia[index].precio_unitario) {
          copia[index].precio_unitario = String(art.precioPactado)
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
      alert(t('pedidos_compra:alertas.fecha_entrega_invalida'))
      return
    }

    const lineasValidas = lineas.filter((l) => l.articulo_id && l.cantidad)
    if (lineasValidas.length === 0) {
      alert(t('pedidos_compra:alertas.sin_lineas_validas'))
      return
    }

    function calcularCamposLinea(l) {
      return {
        articulo_id: parseInt(l.articulo_id),
        cantidad: parseFloat(l.cantidad),
        precio_unitario: l.precio_unitario ? parseFloat(l.precio_unitario) : null,
      }
    }

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('pedidos_compra')
        .update({
          proveedor_id: parseInt(proveedorId),
          fecha,
          fecha_entrega_prevista: fechaEntrega || null,
          referencia_proveedor: referenciaProveedor || null,
          notas: notas || null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert(t('pedidos_compra:alertas.error_actualizar_pedido', { mensaje: errorUpdate.message }))
        return
      }

      if (lineasABorrar.length > 0) {
        const { error: errorBorrar } = await supabase
          .from('lineas_pedido_compra')
          .delete()
          .in('id', lineasABorrar)
        if (errorBorrar) {
          alert(t('pedidos_compra:alertas.error_borrar_lineas', { mensaje: errorBorrar.message }))
          return
        }
      }

      for (const l of lineasValidas.filter((l) => l.id)) {
        const { error } = await supabase
          .from('lineas_pedido_compra')
          .update(calcularCamposLinea(l))
          .eq('id', l.id)
        if (error) {
          alert(t('pedidos_compra:alertas.error_actualizar_linea', { mensaje: error.message }))
          return
        }
      }

      const nuevas = lineasValidas.filter((l) => !l.id)
      if (nuevas.length > 0) {
        const { error } = await supabase
          .from('lineas_pedido_compra')
          .insert(nuevas.map((l) => ({ pedido_compra_id: editandoId, ...calcularCamposLinea(l) })))
        if (error) {
          alert(t('pedidos_compra:alertas.error_anadir_lineas', { mensaje: error.message }))
          return
        }
      }

      toast.success(t('common:feedback.guardado'))
      onGuardado(editandoId)
      return
    }

    const { data: pedidoCreado, error: errorPedido } = await supabase
      .from('pedidos_compra')
      .insert({
        proveedor_id: parseInt(proveedorId),
        fecha,
        fecha_entrega_prevista: fechaEntrega || null,
        referencia_proveedor: referenciaProveedor || null,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorPedido) {
      alert(t('pedidos_compra:alertas.error_crear_pedido', { mensaje: errorPedido.message }))
      return
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      pedido_compra_id: pedidoCreado.id,
      ...calcularCamposLinea(l),
    }))

    const { error: errorLineas } = await supabase
      .from('lineas_pedido_compra')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      await supabase.from('pedidos_compra').delete().eq('id', pedidoCreado.id)
      alert(t('pedidos_compra:alertas.error_guardar_lineas', { mensaje: errorLineas.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    onGuardado(pedidoCreado.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3">
        <Field label={t('pedidos_compra:campos.proveedor')}>
          <Select value={proveedorId} onChange={(e) => handleProveedorChange(e.target.value)} required>
            <option value="">{t('compras_comun:selecciona_proveedor')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('pedidos_compra:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={t('pedidos_compra:campos.fecha_entrega_opcional')}>
          <DateInput value={fechaEntrega} onChange={setFechaEntrega} />
          {fechaEntrega && fechaEntrega < fecha && (
            <p className="text-red-600 text-xs mt-1">{t('pedidos_compra:fecha_entrega_anterior')}</p>
          )}
        </Field>
        <Field label={t('pedidos_compra:campos.referencia_proveedor_opcional')}>
          <Input type="text" value={referenciaProveedor} onChange={(e) => setReferenciaProveedor(e.target.value)}
            placeholder={t('pedidos_compra:referencia_proveedor_placeholder')} />
        </Field>
        <Field label={t('pedidos_compra:campos.notas_opcional')}>
          <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
      </div>

      {proveedorId && !cargandoArticulos && articulosDelProveedor.length === 0 && (
        <p className="text-sm text-amber-600 flex items-center gap-1.5">
          <IconAlertTriangle size={15} />
          {t('compras_comun:articulo_no_asignado_aviso')}
        </p>
      )}

      <div>
        <SectionLabel>{t('pedidos_compra:lineas_titulo')}</SectionLabel>
        <div className="flex flex-col gap-3">
          {lineas.map((linea, index) => (
            <div key={index} className="border border-gray-200 rounded-md p-3">
              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
                <Select value={linea.articulo_id}
                  onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                  required disabled={!proveedorId || cargandoArticulos}>
                  <option value="">
                    {!proveedorId
                      ? t('compras_comun:elige_proveedor_primero')
                      : cargandoArticulos
                        ? t('compras_comun:cargando_articulos')
                        : t('compras_comun:selecciona_articulo')}
                  </option>
                  {articulosDelProveedor.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre} ({a.unidad}){a.referenciaProveedor ? ` — ref. ${a.referenciaProveedor}` : ''}
                    </option>
                  ))}
                </Select>
                <Input type="number" step="0.001" placeholder={t('pedidos_compra:placeholders.cantidad')} value={linea.cantidad}
                  onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                  required title={t('common:redondea_3_decimales')} />
                <Input type="number" step="0.01" placeholder={t('pedidos_compra:placeholders.precio')} value={linea.precio_unitario}
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
          className="mt-2 text-sm text-primary-600 font-medium flex items-center gap-1 hover:underline">
          <IconPlus size={15} /> {t('compras_comun:anadir_linea')}
        </button>
      </div>

      <div className="flex gap-2">
        <Button type="submit">{editandoId ? t('pedidos_compra:guardar_cambios') : t('pedidos_compra:guardar_pedido')}</Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  )
}
