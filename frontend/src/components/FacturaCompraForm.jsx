import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { Field, Input, Select, DateInput, SectionLabel, Button } from './ui'

// CONTRATO_DRAWERS_COMPRAS.md, paso 3: formulario de alta/edición extraído del layout inline de
// FacturasCompra.jsx a este componente, mismo patrón que PedidoCompraForm.jsx/AlbaranCompraForm.jsx.
// Sin líneas propias -- el "contenido" de la factura es la lista de albaranes que agrupa, vía la
// tabla puente factura_compra_albaran. El campo `total` sigue siendo un <Input type="number">
// manual, tal cual (sección 3 del contrato: decisión de negocio deliberada, no se toca).
//
// Edición: no existía en el formulario original (alcance añadido en este paso, sección 9 del
// contrato) -- sin ningún criterio de bloqueo porque hoy no hay ninguna dependencia real que
// comprobar (no hay concepto de factura "anulada" ni de pago asociado todavía, ver
// AUDITORIA_PAGOS_VENTA_PARA_COMPRAS.md). El proveedor queda deshabilitado al editar, mismo
// criterio que AlbaranCompraForm.jsx.
function estadoInicial(factura) {
  if (!factura) {
    return {
      proveedorId: '',
      numeroFactura: '',
      fecha: new Date().toISOString().slice(0, 10),
      total: '',
      albaranesSeleccionados: [],
      editandoId: null,
    }
  }
  return {
    proveedorId: String(factura.proveedor_id),
    numeroFactura: factura.numero_factura ?? '',
    fecha: factura.fecha,
    total: factura.total != null ? String(factura.total) : '',
    albaranesSeleccionados: (factura.factura_compra_albaran || [])
      .map((rel) => rel.albaranes_compra?.id)
      .filter(Boolean),
    editandoId: factura.id,
  }
}

export default function FacturaCompraForm({ factura, proveedores, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'compras_comun', 'facturas_compra'])
  const [inicial] = useState(() => estadoInicial(factura))
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId)
  const [numeroFactura, setNumeroFactura] = useState(inicial.numeroFactura)
  const [fecha, setFecha] = useState(inicial.fecha)
  const [total, setTotal] = useState(inicial.total)
  const [albaranesSeleccionados, setAlbaranesSeleccionados] = useState(inicial.albaranesSeleccionados)
  const [editandoId] = useState(inicial.editandoId)

  const [albaranesDisponibles, setAlbaranesDisponibles] = useState([])
  // Evita que el primer disparo del efecto (carga inicial, con proveedorId ya fijado al editar)
  // vacíe la selección precargada -- solo un cambio de proveedor hecho por el usuario después del
  // montaje debe resetear la selección, igual que en alta.
  // Compara VALOR contra el proveedor anterior (no "es la primera vez que corre el efecto") --
  // React.StrictMode invoca los efectos dos veces en desarrollo; un contador de invocaciones se
  // desincroniza con eso y borraría la selección precargada al editar en la segunda invocación
  // fantasma. Comparando valores, ambas invocaciones ven "sin cambios" y no tocan la selección.
  const proveedorAnteriorRef = useRef(inicial.proveedorId)

  useEffect(() => {
    async function cargarAlbaranesDelProveedor() {
      if (!proveedorId) {
        setAlbaranesDisponibles([])
        return
      }

      const [resAlbaranes, resYaFacturados] = await Promise.all([
        supabase
          .from('albaranes_compra')
          .select('id, numero_albaran, fecha')
          .eq('proveedor_id', proveedorId)
          .order('fecha', { ascending: false }),
        supabase
          .from('factura_compra_albaran')
          .select('albaran_compra_id, factura_compra_id'),
      ])

      if (resAlbaranes.error) {
        console.error(resAlbaranes.error)
        setAlbaranesDisponibles([])
      } else {
        // Un albarán ya facturado por OTRA factura no está disponible -- pero si está facturado
        // precisamente por la factura que se está editando, sigue disponible (para poder
        // desmarcarlo o dejarlo tal cual), no se excluye a sí misma.
        const idsYaFacturadosPorOtra = new Set(
          (resYaFacturados.data || [])
            .filter((r) => r.factura_compra_id !== editandoId)
            .map((r) => r.albaran_compra_id)
        )
        const disponibles = resAlbaranes.data.filter((a) => !idsYaFacturadosPorOtra.has(a.id))
        setAlbaranesDisponibles(disponibles)
      }

      if (proveedorAnteriorRef.current !== proveedorId) {
        setAlbaranesSeleccionados([])
      }
      proveedorAnteriorRef.current = proveedorId
    }

    cargarAlbaranesDelProveedor()
    // editandoId es estable durante toda la vida del componente (useState inicializado una sola
    // vez, nunca actualizado) -- incluirlo no cambiaría cuándo se re-ejecuta el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId])

  function toggleAlbaran(id) {
    setAlbaranesSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (albaranesSeleccionados.length === 0) {
      alert(t('facturas_compra:alertas.sin_albaranes_seleccionados'))
      return
    }

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('facturas_compra')
        .update({
          proveedor_id: parseInt(proveedorId),
          numero_factura: numeroFactura || null,
          fecha,
          total: total ? parseFloat(total) : null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert(t('facturas_compra:alertas.error_actualizar_factura', { mensaje: errorUpdate.message }))
        return
      }

      // factura_compra_albaran no admite update (mismo criterio que factura_venta_albaran/
      // pago_aplicacion) -- se borran las relaciones quitadas y se insertan las nuevas.
      const idsActuales = new Set(inicial.albaranesSeleccionados)
      const idsNuevos = new Set(albaranesSeleccionados)
      const aQuitar = [...idsActuales].filter((id) => !idsNuevos.has(id))
      const aAnadir = [...idsNuevos].filter((id) => !idsActuales.has(id))

      if (aQuitar.length > 0) {
        const { error: errorQuitar } = await supabase
          .from('factura_compra_albaran')
          .delete()
          .eq('factura_compra_id', editandoId)
          .in('albaran_compra_id', aQuitar)
        if (errorQuitar) {
          alert(t('facturas_compra:alertas.error_actualizar_albaranes', { mensaje: errorQuitar.message }))
          return
        }
      }

      if (aAnadir.length > 0) {
        const { error: errorAnadir } = await supabase
          .from('factura_compra_albaran')
          .insert(aAnadir.map((albaranId) => ({ factura_compra_id: editandoId, albaran_compra_id: albaranId })))
        if (errorAnadir) {
          alert(t('facturas_compra:alertas.error_actualizar_albaranes', { mensaje: errorAnadir.message }))
          return
        }
      }

      toast.success(t('common:feedback.guardado'))
      onGuardado(editandoId)
      return
    }

    const { data: facturaCreada, error: errorFactura } = await supabase
      .from('facturas_compra')
      .insert({
        proveedor_id: parseInt(proveedorId),
        numero_factura: numeroFactura || null,
        fecha,
        total: total ? parseFloat(total) : null,
      })
      .select()
      .single()

    if (errorFactura) {
      alert(t('facturas_compra:alertas.error_crear_factura', { mensaje: errorFactura.message }))
      return
    }

    const relaciones = albaranesSeleccionados.map((albaranId) => ({
      factura_compra_id: facturaCreada.id,
      albaran_compra_id: albaranId,
    }))

    const { error: errorRelaciones } = await supabase
      .from('factura_compra_albaran')
      .insert(relaciones)

    if (errorRelaciones) {
      await supabase.from('facturas_compra').delete().eq('id', facturaCreada.id)
      alert(t('facturas_compra:alertas.error_asociar_albaranes', { mensaje: errorRelaciones.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    onGuardado(facturaCreada.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('facturas_compra:campos.proveedor')}>
          <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            required disabled={!!editandoId}>
            <option value="">{t('compras_comun:selecciona_proveedor')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('facturas_compra:campos.numero_factura')}>
          <Input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} />
        </Field>
        <Field label={t('facturas_compra:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
      </div>

      <Field label={t('facturas_compra:campos.total_con_iva')} className="md:w-1/3">
        <Input type="number" step="0.01" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} />
      </Field>

      <div>
        <SectionLabel>{t('facturas_compra:albaranes_a_incluir_titulo')}</SectionLabel>

        {!proveedorId ? (
          <p className="text-sm text-ink-faint">{t('facturas_compra:elige_proveedor_para_albaranes')}</p>
        ) : albaranesDisponibles.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('facturas_compra:sin_albaranes_pendientes')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {albaranesDisponibles.map((alb) => (
              <label key={alb.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={albaranesSeleccionados.includes(alb.id)}
                  onChange={() => toggleAlbaran(alb.id)}
                />
                {t('facturas_compra:albaran_checkbox_label', { numero: alb.numero_albaran || t('common:sin_numero'), fecha: formatFecha(alb.fecha) })}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit">{editandoId ? t('facturas_compra:guardar_cambios') : t('facturas_compra:guardar_factura')}</Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  )
}
