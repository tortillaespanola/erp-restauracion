import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function FacturasCompra() {
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

  // Cada vez que cambia el proveedor elegido, buscamos sus albaranes pendientes de facturar
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
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Facturas de compra</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">Nueva factura</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            required className="border rounded px-3 py-2">
            <option value="">Selecciona proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </select>
          <input type="text" placeholder="Nº de factura" value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
            className="border rounded px-3 py-2" />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            required className="border rounded px-3 py-2" />
        </div>

        <input type="number" step="0.01" placeholder="Total factura (con IVA)" value={total}
          onChange={(e) => setTotal(e.target.value)}
          className="border rounded px-3 py-2 md:w-1/3" />

        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-2">
            Albaranes a incluir
          </h3>

          {!proveedorId ? (
            <p className="text-sm text-slate-400">Elige primero un proveedor para ver sus albaranes.</p>
          ) : albaranesDisponibles.length === 0 ? (
            <p className="text-sm text-slate-400">Este proveedor no tiene albaranes pendientes de facturar.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {albaranesDisponibles.map((alb) => (
                <label key={alb.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={albaranesSeleccionados.includes(alb.id)}
                    onChange={() => toggleAlbaran(alb.id)}
                  />
                  Albarán {alb.numero_albaran || '(sin número)'} · {alb.fecha}
                </label>
              ))}
            </div>
          )}
        </div>

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
          Guardar factura
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : facturas.length === 0 ? (
          <p className="text-slate-500">Todavía no hay facturas registradas.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {facturas.map((f) => (
              <div key={f.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{f.proveedores?.nombre_comercial ?? 'Sin proveedor'}</p>
                    <p className="text-sm text-slate-500">
                      Factura {f.numero_factura || '(sin número)'} · {f.fecha}
                      {f.total != null && ` · ${f.total} €`}
                    </p>
                  </div>
                  <button onClick={() => handleBorrar(f.id)} className="text-red-600 hover:underline text-sm">
                    Borrar
                  </button>
                </div>

                <div className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">Albaranes incluidos: </span>
                  {f.factura_compra_albaran.length === 0
                    ? '—'
                    : f.factura_compra_albaran
                        .map((rel) => `${rel.albaranes_compra?.numero_albaran || '(sin número)'} (${rel.albaranes_compra?.fecha})`)
                        .join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default FacturasCompra