import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, DateInput, SectionLabel, EmptyState, LoadingState } from '../components/ui'
import { useNegocio } from '../context/useNegocio'

function FacturasCompra() {
  const { negocio } = useNegocio()
  const [facturas, setFacturas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [albaranesDisponibles, setAlbaranesDisponibles] = useState([])
  const [cargando, setCargando] = useState(true)

  const [proveedorId, setProveedorId] = useState('')
  const [numeroFactura, setNumeroFactura] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [total, setTotal] = useState('')
  const [albaranesSeleccionados, setAlbaranesSeleccionados] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resFacturas, resProveedores] = await Promise.all([
      supabase
        .from('facturas_compra')
        .select('*, proveedores(nombre_comercial), factura_compra_albaran(albaranes_compra(id, numero_albaran, fecha))')
        .order('fecha', { ascending: false }),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resFacturas.error) console.error(resFacturas.error)
    else setFacturas(resFacturas.data)

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

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
          .select('albaran_compra_id'),
      ])

      if (resAlbaranes.error) {
        console.error(resAlbaranes.error)
        setAlbaranesDisponibles([])
      } else {
        const idsYaFacturados = new Set(
          (resYaFacturados.data || []).map((r) => r.albaran_compra_id)
        )
        const disponibles = resAlbaranes.data.filter((a) => !idsYaFacturados.has(a.id))
        setAlbaranesDisponibles(disponibles)
      }

      setAlbaranesSeleccionados([])
    }

    cargarAlbaranesDelProveedor()
  }, [proveedorId])

  function toggleAlbaran(id) {
    setAlbaranesSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  function resetForm() {
    setProveedorId('')
    setNumeroFactura('')
    setFecha(new Date().toISOString().slice(0, 10))
    setTotal('')
    setAlbaranesSeleccionados([])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (albaranesSeleccionados.length === 0) {
      alert('Selecciona al menos un albarán para asociar a la factura')
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
      alert('Error al crear la factura: ' + errorFactura.message)
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
      alert('Error al asociar los albaranes: ' + errorRelaciones.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar esta factura?')) return

    const { error } = await supabase.from('facturas_compra').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Facturas de compra" />

      <Card className="mb-6">
        <CardHeader title="Nueva factura" />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Proveedor">
                <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
                  <option value="">Selecciona proveedor</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Nº de factura">
                <Input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} />
              </Field>
              <Field label="Fecha">
                <DateInput value={fecha} onChange={setFecha} required />
              </Field>
            </div>

            <Field label="Total factura (con IVA)" className="md:w-1/3">
              <Input type="number" step="0.01" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} />
            </Field>

            <div>
              <SectionLabel>Albaranes a incluir</SectionLabel>

              {!proveedorId ? (
                <p className="text-sm text-gray-400">Elige primero un proveedor para ver sus albaranes.</p>
              ) : albaranesDisponibles.length === 0 ? (
                <p className="text-sm text-gray-400">Este proveedor no tiene albaranes pendientes de facturar.</p>
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
            <Card key={f.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938]">{f.proveedores?.nombre_comercial ?? 'Sin proveedor'}</p>
                  <p className="text-sm text-gray-500">
                    Factura {f.numero_factura || '(sin número)'} · {formatFecha(f.fecha)}
                    {f.total != null && ` · ${formatMoneda(f.total, negocio?.moneda)}`}
                    {f.codigo_interno && <span className="ml-2 text-xs font-mono text-gray-400">{f.codigo_interno}</span>}
                  </p>
                </div>
                <LinkAction tone="red" onClick={() => handleBorrar(f.id)}>Borrar</LinkAction>
              </div>

              <div className="mt-2 text-sm text-gray-600">
                <span className="font-medium">Albaranes incluidos: </span>
                {f.factura_compra_albaran.length === 0
                  ? '—'
                  : f.factura_compra_albaran
                      .map((rel) => `${rel.albaranes_compra?.numero_albaran || '(sin número)'} (${formatFecha(rel.albaranes_compra?.fecha)})`)
                      .join(', ')}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default FacturasCompra
