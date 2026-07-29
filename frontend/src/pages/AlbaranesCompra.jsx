import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const lineaVacia = { articulo_id: '', cantidad: '', precio: '', fecha_caducidad: '', notas: '' }

function AlbaranesCompra() {
  const [albaranes, setAlbaranes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulosDelProveedor, setArticulosDelProveedor] = useState([])
  const [cargando, setCargando] = useState(true)

  const [proveedorId, setProveedorId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [lineas, setLineas] = useState([{ ...lineaVacia }])

  async function cargarDatos() {
    setCargando(true)

    const [resAlbaranes, resProveedores] = await Promise.all([
      supabase
        .from('albaranes_compra')
        .select('*, proveedores(nombre_comercial), entrada_material(id, cantidad, precio, fecha_caducidad, notas, codigo_lote, articulos_compra(nombre, unidad))')
        .order('fecha', { ascending: false }),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else setAlbaranes(resAlbaranes.data)

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  useEffect(() => {
    async function cargarArticulosDelProveedor() {
      if (!proveedorId) {
        setArticulosDelProveedor([])
        return
      }

      const { data, error } = await supabase
        .from('articulo_proveedor')
        .select('precio, articulos_compra(id, nombre, unidad)')
        .eq('proveedor_id', proveedorId)

      if (error) {
        console.error(error)
        setArticulosDelProveedor([])
      } else {
        setArticulosDelProveedor(
          (data || []).map((ap) => ({
            id: ap.articulos_compra.id,
            nombre: ap.articulos_compra.nombre,
            unidad: ap.articulos_compra.unidad,
            precioPactado: ap.precio,
          }))
        )
      }
    }

    cargarArticulosDelProveedor()
  }, [proveedorId])

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }

      if (campo === 'articulo_id') {
        const art = articulosDelProveedor.find((a) => a.id === parseInt(valor))
        if (art?.precioPactado != null && !copia[index].precio) {
          copia[index].precio = String(art.precioPactado)
        }
      }

      return copia
    })
  }

  function addLinea() {
    setLineas((prev) => [...prev, { ...lineaVacia }])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setProveedorId('')
    setNumeroAlbaran('')
    setFecha(new Date().toISOString().slice(0, 10))
    setLineas([{ ...lineaVacia }])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter((l) => l.articulo_id && l.cantidad)
    if (lineasValidas.length === 0) {
      alert('Añade al menos una línea con artículo y cantidad')
      return
    }

    const { data: albaranCreado, error: errorAlbaran } = await supabase
      .from('albaranes_compra')
      .insert({
        proveedor_id: parseInt(proveedorId),
        numero_albaran: numeroAlbaran || null,
        fecha,
      })
      .select()
      .single()

    if (errorAlbaran) {
      alert('Error al crear el albarán: ' + errorAlbaran.message)
      return
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      albaran_compra_id: albaranCreado.id,
      articulo_id: parseInt(l.articulo_id),
      cantidad: parseFloat(l.cantidad),
      precio: l.precio ? parseFloat(l.precio) : null,
      fecha_caducidad: l.fecha_caducidad || null,
      notas: l.notas || null,
    }))

    const { error: errorLineas } = await supabase
      .from('entrada_material')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      alert('Error al guardar las líneas: ' + errorLineas.message)
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleBorrar(alb) {
    const entradaIds = alb.entrada_material.map((l) => l.id)

    let avisos = []
    if (entradaIds.length > 0) {
      const [c1, c2, c3] = await Promise.all([
        supabase.from('consumo_produccion').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
        supabase.from('consumo_produccion_pf').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
        supabase.from('ajustes_articulo').select('*', { count: 'exact', head: true }).in('entrada_material_id', entradaIds),
      ])
      if (c1.count > 0) avisos.push(`${c1.count} consumo(s) en producciones de semielaborados`)
      if (c2.count > 0) avisos.push(`${c2.count} consumo(s) en producciones de productos finales`)
      if (c3.count > 0) avisos.push(`${c3.count} ajuste(s) de stock`)
    }

    const mensaje = avisos.length > 0
      ? `⚠️ Este albarán tiene datos relacionados que se BORRARÁN también:\n\n${avisos.map((a) => '• ' + a).join('\n')}\n\n¿Seguro que quieres continuar?`
      : '¿Seguro que quieres borrar este albarán?'

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('albaranes_compra').delete().eq('id', alb.id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Albaranes de compra</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">Nuevo albarán</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            required className="border rounded px-3 py-2">
            <option value="">Selecciona proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </select>
          <input type="text" placeholder="Nº albarán del proveedor" value={numeroAlbaran}
            onChange={(e) => setNumeroAlbaran(e.target.value)}
            className="border rounded px-3 py-2" />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            required className="border rounded px-3 py-2" />
        </div>

        {proveedorId && articulosDelProveedor.length === 0 && (
          <p className="text-sm text-amber-600">
            Este proveedor no tiene ningún artículo asignado todavía — ve a Artículos para vincularlo.
          </p>
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Líneas</h3>
          <div className="flex flex-col gap-3">
            {lineas.map((linea, index) => (
              <div key={index} className="border rounded-lg p-3 flex flex-col gap-2">
                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
                  <select value={linea.articulo_id}
                    onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                    required disabled={!proveedorId}
                    className="border rounded px-3 py-2 disabled:bg-slate-100">
                    <option value="">
                      {!proveedorId ? 'Elige primero un proveedor' : 'Selecciona artículo'}
                    </option>
                    {articulosDelProveedor.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                    ))}
                  </select>
                  <input type="number" step="0.01" placeholder="Cantidad" value={linea.cantidad}
                    onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                    required className="border rounded px-3 py-2" />
                  <input type="number" step="0.01" placeholder="Precio" value={linea.precio}
                    onChange={(e) => handleLineaChange(index, 'precio', e.target.value)}
                    className="border rounded px-3 py-2" />
                  <input type="date" placeholder="Caducidad" value={linea.fecha_caducidad}
                    onChange={(e) => handleLineaChange(index, 'fecha_caducidad', e.target.value)}
                    className="border rounded px-3 py-2 text-sm" title="Fecha de caducidad (opcional)" />
                  <button type="button" onClick={() => removeLinea(index)}
                    className="text-red-600 hover:underline text-sm">
                    Quitar
                  </button>
                </div>
                <input type="text" placeholder="Notas (temperatura de recepción, incidencias...)"
                  value={linea.notas}
                  onChange={(e) => handleLineaChange(index, 'notas', e.target.value)}
                  className="border rounded px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
          <button type="button" onClick={addLinea}
            className="mt-2 text-sm text-blue-600 hover:underline">
            + Añadir línea
          </button>
        </div>

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
          Guardar albarán
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : albaranes.length === 0 ? (
          <p className="text-slate-500">Todavía no hay albaranes registrados.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {albaranes.map((alb) => (
              <div key={alb.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{alb.proveedores?.nombre_comercial ?? 'Sin proveedor'}</p>
                    <p className="text-sm text-slate-500">
                      Albarán {alb.numero_albaran || '(sin número)'} · {alb.fecha}
                      {alb.codigo_interno && <span className="ml-2 text-xs font-mono text-slate-400">{alb.codigo_interno}</span>}
                    </p>
                  </div>
                  <button onClick={() => handleBorrar(alb)} className="text-red-600 hover:underline text-sm">
                    Borrar
                  </button>
                </div>

                <table className="w-full mt-3 text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">Artículo</th>
                      <th className="py-1">Cantidad</th>
                      <th className="py-1">Precio</th>
                      <th className="py-1">Caducidad</th>
                      <th className="py-1">Notas</th>
                      <th className="py-1">Lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alb.entrada_material.map((linea) => (
                      <tr key={linea.id} className="border-t">
                        <td className="py-1">{linea.articulos_compra?.nombre}</td>
                        <td className="py-1">{linea.cantidad} {linea.articulos_compra?.unidad}</td>
                        <td className="py-1">{linea.precio ?? '-'}</td>
                        <td className="py-1">{linea.fecha_caducidad ?? '-'}</td>
                        <td className="py-1 text-slate-500">{linea.notas ?? '-'}</td>
                        <td className="py-1 text-slate-400 font-mono text-xs">{linea.codigo_lote ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AlbaranesCompra