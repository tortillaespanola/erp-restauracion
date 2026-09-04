import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { Field, Select, DateInput, SectionLabel, Button } from './ui'

// BLOQUE 6 (CONTRATO_UX_FACTURAS_VENTA.md): formulario de alta extraído del layout inline de
// FacturasVenta.jsx a este componente, para vivir dentro del Drawer (mismo patrón que
// PedidoForm.jsx/AlbaranVentaForm.jsx). Misma lógica de validación/guardado de siempre, solo
// cambia el contenedor -- sin modo edición, nunca existió (sección 4 del contrato).
export default function FacturaVentaForm({ clientes, onGuardado, onCancelar }) {
  const [clienteId, setClienteId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [albaranesDisponibles, setAlbaranesDisponibles] = useState([])
  const [albaranesSeleccionados, setAlbaranesSeleccionados] = useState([])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    async function cargarAlbaranesDelCliente() {
      if (!clienteId) {
        setAlbaranesDisponibles([])
        return
      }

      const [resAlbaranes, resYaFacturados] = await Promise.all([
        supabase
          .from('albaranes_venta')
          .select('id, numero_albaran, fecha')
          .eq('cliente_id', clienteId)
          .order('fecha', { ascending: false }),
        // BLOQUE 4 (CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md): se embebe facturas_venta.anulada
        // para poder excluir del filtro las relaciones de una factura ya anulada -- sus albaranes
        // deben volver a estar disponibles para una factura nueva, como si nunca se hubieran
        // facturado.
        supabase.from('factura_venta_albaran').select('albaran_venta_id, facturas_venta(anulada)'),
      ])

      if (resAlbaranes.error) {
        console.error(resAlbaranes.error)
        setAlbaranesDisponibles([])
      } else {
        const idsYaFacturados = new Set(
          (resYaFacturados.data || [])
            .filter((r) => !r.facturas_venta?.anulada)
            .map((r) => r.albaran_venta_id)
        )
        const disponibles = resAlbaranes.data.filter((a) => !idsYaFacturados.has(a.id))
        setAlbaranesDisponibles(disponibles)
      }

      setAlbaranesSeleccionados([])
    }

    cargarAlbaranesDelCliente()
  }, [clienteId])

  function toggleAlbaran(id) {
    setAlbaranesSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  // BLOQUE 3 (CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md): misma fórmula que ya usaba
  // prepararDocumento para el PDF (cantidad × precio_unitario de las líneas de los albaranes
  // incluidos), pero ahora se corre ANTES del INSERT para persistir el total real en
  // facturas_venta.total, en vez de calcularlo solo al vuelo para mostrarlo en el PDF.
  async function calcularTotalDeAlbaranes(albaranIds) {
    const { data: lineas, error } = await supabase
      .from('lineas_albaran_venta')
      .select('cantidad, precio_unitario')
      .in('albaran_venta_id', albaranIds)

    const total = (lineas || []).reduce(
      (sum, l) => sum + (l.precio_unitario ? l.cantidad * l.precio_unitario : 0), 0
    )
    return { total, error }
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (albaranesSeleccionados.length === 0) {
      alert('Selecciona al menos un albarán para asociar a la factura')
      return
    }

    setGuardando(true)

    const { total: totalCalculado, error: errorTotal } = await calcularTotalDeAlbaranes(albaranesSeleccionados)
    if (errorTotal) {
      alert('Error al calcular el total de la factura: ' + errorTotal.message)
      setGuardando(false)
      return
    }

    // numero_factura ya no se manda -- lo genera siempre el trigger BEFORE INSERT (Bloque 1),
    // que además lo sobreescribiría igual aunque se mandara algo.
    const { data: facturaCreada, error: errorFactura } = await supabase
      .from('facturas_venta')
      .insert({
        cliente_id: parseInt(clienteId),
        fecha,
        total: totalCalculado,
      })
      .select()
      .single()

    if (errorFactura) {
      alert('Error al crear la factura: ' + errorFactura.message)
      setGuardando(false)
      return
    }

    const relaciones = albaranesSeleccionados.map((albaranId) => ({
      factura_venta_id: facturaCreada.id,
      albaran_venta_id: albaranId,
    }))

    const { error: errorRelaciones } = await supabase
      .from('factura_venta_albaran')
      .insert(relaciones)

    if (errorRelaciones) {
      await supabase.from('facturas_venta').delete().eq('id', facturaCreada.id)
      alert('Error al asociar los albaranes: ' + errorRelaciones.message)
      setGuardando(false)
      return
    }

    setGuardando(false)
    onGuardado(facturaCreada.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* BLOQUE 3 (CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md): sin campo de Nº de factura (lo
          genera el trigger BEFORE INSERT) ni de Total manual (se calcula siempre de las líneas
          reales de los albaranes incluidos). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
      </div>

      <div>
        <SectionLabel>Albaranes a incluir</SectionLabel>

        {!clienteId ? (
          <p className="text-sm text-gray-400">Elige primero un cliente para ver sus albaranes.</p>
        ) : albaranesDisponibles.length === 0 ? (
          <p className="text-sm text-gray-400">Este cliente no tiene albaranes pendientes de facturar.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {albaranesDisponibles.map((alb) => (
              <label key={alb.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={albaranesSeleccionados.includes(alb.id)}
                  onChange={() => toggleAlbaran(alb.id)}
                />
                Albarán {alb.numero_albaran || '(sin número)'} · {formatFecha(alb.fecha)}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar factura'}</Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  )
}
