import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { descargarPdf, imprimirPdf } from '../lib/generarPdf'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Select, DateInput, SectionLabel, Badge, EmptyState, LoadingState } from '../components/ui'

function FacturasVenta() {
  const [facturas, setFacturas] = useState([])
  const [clientes, setClientes] = useState([])
  const [albaranesDisponibles, setAlbaranesDisponibles] = useState([])
  const [cargando, setCargando] = useState(true)

  const [clienteId, setClienteId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [albaranesSeleccionados, setAlbaranesSeleccionados] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resFacturas, resClientes] = await Promise.all([
      supabase
        .from('facturas_venta')
        .select('*, clientes(nombre, direccion, cif), factura_venta_albaran(albaranes_venta(id, numero_albaran, fecha))')
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre, direccion, cif').order('nombre'),
    ])

    if (resFacturas.error) console.error(resFacturas.error)
    else setFacturas(resFacturas.data)

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

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

  function resetForm() {
    setClienteId('')
    setFecha(new Date().toISOString().slice(0, 10))
    setAlbaranesSeleccionados([])
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

    const { total: totalCalculado, error: errorTotal } = await calcularTotalDeAlbaranes(albaranesSeleccionados)
    if (errorTotal) {
      alert('Error al calcular el total de la factura: ' + errorTotal.message)
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
      return
    }

    resetForm()
    cargarDatos()
  }

  // BLOQUE 4: anulación en vez de borrado físico -- nunca DELETE, así el numero_factura queda
  // "quemado" para siempre y factura_venta_albaran conserva sus filas (los albaranes vuelven a
  // estar disponibles, ver el filtro de cargarAlbaranesDelCliente más arriba). Sin reactivar.
  async function handleAnular(id) {
    if (!confirm('Esta acción anula la factura de forma permanente, no se puede deshacer. ¿Continuar?')) return

    const { error } = await supabase.from('facturas_venta').update({ anulada: true }).eq('id', id)
    if (error) {
      alert('Error al anular: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function prepararDocumento(f) {
    const albaranIds = f.factura_venta_albaran.map((rel) => rel.albaranes_venta?.id).filter(Boolean)

    const { data: lineasAlbaranes, error } = await supabase
      .from('lineas_albaran_venta')
      .select('cantidad, precio_unitario, productos_finales(nombre), articulos_compra(nombre), descripcion, albaran_venta_id')
      .in('albaran_venta_id', albaranIds)

    if (error) {
      console.error(error)
    }

    const lineas = (lineasAlbaranes || []).map((l) => ({
      concepto: l.productos_finales?.nombre ?? l.articulos_compra?.nombre ?? l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precio_unitario,
    }))

    return {
      numero: f.numero_factura || `#${f.id}`,
      fecha: f.fecha,
      tercero: {
        nombre: f.clientes?.nombre,
        direccion: f.clientes?.direccion,
        cif: f.clientes?.cif,
      },
      lineas,
      // BLOQUE 3: f.total ya viene persistido y fiable desde el INSERT (calcularTotalDeAlbaranes),
      // nunca null para una factura nueva -- ya no hace falta recalcularlo ni un `?? totalCalculado`
      // de respaldo, eso es justo lo que permitía la divergencia listado/PDF que cerramos aquí.
      total: f.total,
    }
  }

  return (
    <div>
      <PageHeader title="Facturas de venta" />

      <Card className="mb-6">
        <CardHeader title="Nueva factura" />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* BLOQUE 3: sin campo de Nº de factura (lo genera el trigger BEFORE INSERT, sección 1
                del contrato -- se ve recién en el listado tras guardar) ni de Total manual (se
                calcula siempre de las líneas reales, sección 2 del contrato). */}
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

            <Button type="submit" className="self-start">Guardar factura</Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Listado</h2>

      {cargando ? (
        <LoadingState />
      ) : facturas.length === 0 ? (
        <Card><EmptyState>Todavía no hay facturas registradas.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {facturas.map((f) => (
            <Card key={f.id} className={`p-4 ${f.anulada ? 'opacity-60 bg-gray-50' : ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938] flex items-center gap-2 flex-wrap">
                    {f.clientes?.nombre ?? 'Sin cliente'}
                    {f.anulada && <Badge color="red">Anulada</Badge>}
                  </p>
                  <p className={`text-sm text-gray-500 ${f.anulada ? 'line-through' : ''}`}>
                    Factura {f.numero_factura || '(sin número)'} · {formatFecha(f.fecha)}
                    {f.total != null && ` · ${f.total} €`}
                  </p>
                </div>
                <div className="flex gap-3 items-start shrink-0">
                  <LinkAction tone="gray" onClick={async () => imprimirPdf('Factura', await prepararDocumento(f))}>Imprimir</LinkAction>
                  <LinkAction tone="blue" onClick={async () => descargarPdf('Factura', await prepararDocumento(f))}>Descargar PDF</LinkAction>
                  {!f.anulada && (
                    <LinkAction tone="red" onClick={() => handleAnular(f.id)}>Anular</LinkAction>
                  )}
                </div>
              </div>

              <div className="mt-2 text-sm text-gray-600">
                <span className="font-medium">Albaranes incluidos: </span>
                {f.factura_venta_albaran.length === 0
                  ? '—'
                  : f.factura_venta_albaran
                      .map((rel) => `${rel.albaranes_venta?.numero_albaran || '(sin número)'} (${formatFecha(rel.albaranes_venta?.fecha)})`)
                      .join(', ')}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default FacturasVenta
