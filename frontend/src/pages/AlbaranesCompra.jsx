import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const lineaVacia = { id: null, articulo_id: '', cantidad: '', precio: '', fecha_caducidad: '', notas: '', temperatura: '', locked: false }

function AlbaranesCompra() {
  const [albaranes, setAlbaranes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulosDelProveedor, setArticulosDelProveedor] = useState([])
  const [cargando, setCargando] = useState(true)

  const [proveedorId, setProveedorId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [lineas, setLineas] = useState([{ ...lineaVacia }])

  const [editandoId, setEditandoId] = useState(null)
  const [lineasABorrar, setLineasABorrar] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resAlbaranes, resProveedores] = await Promise.all([
      supabase
        .from('albaranes_compra')
        .select('*, proveedores(nombre_comercial), entrada_material(id, cantidad, precio, fecha_caducidad, notas, codigo_lote, temperatura_recepcion, temperatura_fuera_rango, articulo_id, articulos_compra(nombre, unidad))')
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
        .select('precio, articulos_compra(id, nombre, unidad, requiere_control_temperatura, temperatura_min, temperatura_max)')
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
            requiereTemperatura: ap.articulos_compra.requiere_control_temperatura,
            temperaturaMin: ap.articulos_compra.temperatura_min,
            temperaturaMax: ap.articulos_compra.temperatura_max,
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
    const linea = lineas[index]
    if (linea.id) {
      setLineasABorrar((prev) => [...prev, linea.id])
    }
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setProveedorId('')
    setNumeroAlbaran('')
    setFecha(new Date().toISOString().slice(0, 10))
    setLineas([{ ...lineaVacia }])
    setEditandoId(null)
    setLineasABorrar([])
  }

  async function handleEditar(alb) {
    const entradaIds = alb.entrada_material.map((l) => l.id)
    let idsBloqueados = new Set()

    if (entradaIds.length > 0) {
      const [c1, c2, c3] = await Promise.all([
        supabase.from('consumo_produccion').select('entrada_material_id').in('entrada_material_id', entradaIds),
        supabase.from('consumo_produccion_pf').select('entrada_material_id').in('entrada_material_id', entradaIds),
        supabase.from('ajustes_articulo').select('entrada_material_id').in('entrada_material_id', entradaIds),
      ])
      ;[c1, c2, c3].forEach((res) => {
        (res.data || []).forEach((r) => idsBloqueados.add(r.entrada_material_id))
      })
    }

    setProveedorId(String(alb.proveedor_id))
    setNumeroAlbaran(alb.numero_albaran ?? '')
    setFecha(alb.fecha)
    setLineas(
      alb.entrada_material.map((l) => ({
        id: l.id,
        articulo_id: String(l.articulo_id),
        cantidad: String(l.cantidad),
        precio: l.precio != null ? String(l.precio) : '',
        fecha_caducidad: l.fecha_caducidad ?? '',
        notas: l.notas ?? '',
        temperatura: l.temperatura_recepcion != null ? String(l.temperatura_recepcion) : '',
        locked: idsBloqueados.has(l.id),
      }))
    )
    setLineasABorrar([])
    setEditandoId(alb.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter((l) => l.articulo_id && l.cantidad)
    if (lineasValidas.length === 0) {
      alert('Añade al menos una línea con artículo y cantidad')
      return
    }

    function calcularCamposLinea(l) {
      const art = articulosDelProveedor.find((a) => a.id === parseInt(l.articulo_id))
      const temp = l.temperatura ? parseFloat(l.temperatura) : null
      const fueraDeRango = temp != null && art &&
        ((art.temperaturaMin != null && temp < art.temperaturaMin) ||
         (art.temperaturaMax != null && temp > art.temperaturaMax))
      return {
        articulo_id: parseInt(l.articulo_id),
        cantidad: parseFloat(l.cantidad),
        precio: l.precio ? parseFloat(l.precio) : null,
        fecha_caducidad: l.fecha_caducidad || null,
        notas: l.notas || null,
        temperatura_recepcion: temp,
        temperatura_fuera_rango: fueraDeRango || false,
      }
    }

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('albaranes_compra')
        .update({ numero_albaran: numeroAlbaran || null, fecha })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert('Error al actualizar el albarán: ' + errorUpdate.message)
        return
      }

      if (lineasABorrar.length > 0) {
        const { error: errorBorrar } = await supabase
          .from('entrada_material')
          .delete()
          .in('id', lineasABorrar)
        if (errorBorrar) {
          alert('Error al borrar líneas: ' + errorBorrar.message)
          return
        }
      }

      for (const l of lineasValidas.filter((l) => l.id && !l.locked)) {
        const { error } = await supabase
          .from('entrada_material')
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
          .from('entrada_material')
          .insert(nuevas.map((l) => ({ albaran_compra_id: editandoId, ...calcularCamposLinea(l) })))
        if (error) {
          alert('Error al añadir nuevas líneas: ' + error.message)
          return
        }
      }

      resetForm()
      cargarDatos()
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
      ...calcularCamposLinea(l),
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
    if (editandoId === alb.id) resetForm()
    cargarDatos()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Albaranes de compra</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-4">
        <h2 className="font-semibold text-slate-700">
          {editandoId ? 'Editar albarán' : 'Nuevo albarán'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            required disabled={!!editandoId}
            className="border rounded px-3 py-2 disabled:bg-slate-100">
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
            {lineas.map((linea, index) => {
              if (linea.locked) {
                const art = articulosDelProveedor.find((a) => a.id === parseInt(linea.articulo_id))
                return (
                  <div key={index} className="border rounded-lg p-3 bg-slate-50 text-sm text-slate-500">
                    🔒 {art?.nombre ?? 'Artículo'} · {linea.cantidad} · {linea.precio || '-'}
                    <span className="block text-xs mt-1">Esta línea ya está consumida/ajustada y no se puede modificar.</span>
                  </div>
                )
              }

              return (
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
                    <input type="number" step="0.001" placeholder="Cantidad" value={linea.cantidad}
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

                  {(() => {
                    const art = articulosDelProveedor.find((a) => a.id === parseInt(linea.articulo_id))
                    if (!art?.requiereTemperatura) return null

                    const temp = parseFloat(linea.temperatura)
                    const fueraDeRango = linea.temperatura !== '' &&
                      ((art.temperaturaMin != null && temp < art.temperaturaMin) ||
                       (art.temperaturaMax != null && temp > art.temperaturaMax))

                    return (
                      <div>
                        <input type="number" step="0.1"
                          placeholder={`Temperatura de recepción (°C)${art.temperaturaMin != null && art.temperaturaMax != null ? ` — rango: ${art.temperaturaMin} a ${art.temperaturaMax}` : ''}`}
                          value={linea.temperatura}
                          onChange={(e) => handleLineaChange(index, 'temperatura', e.target.value)}
                          className={`border-2 rounded px-3 py-2 text-sm w-full ${fueraDeRango ? 'border-red-400 bg-red-50' : 'border-blue-200'}`} />
                        {fueraDeRango && (
                          <p className="text-red-600 text-xs mt-1">
                            ⚠️ Fuera del rango aceptable ({art.temperaturaMin}°C a {art.temperaturaMax}°C)
                          </p>
                        )}
                      </div>
                    )
                  })()}

                  <input type="text" placeholder="Notas (temperatura de recepción, incidencias...)"
                    value={linea.notas}
                    onChange={(e) => handleLineaChange(index, 'notas', e.target.value)}
                    className="border rounded px-3 py-2 text-sm" />
                </div>
              )
            })}
          </div>
          <button type="button" onClick={addLinea}
            className="mt-2 text-sm text-blue-600 hover:underline">
            + Añadir línea
          </button>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
            {editandoId ? 'Guardar cambios' : 'Guardar albarán'}
          </button>
          {editandoId && (
            <button type="button" onClick={resetForm}
              className="bg-slate-200 text-slate-700 rounded px-4 py-2 hover:bg-slate-300 self-start">
              Cancelar edición
            </button>
          )}
        </div>
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
                  <div className="flex gap-3">
                    <button onClick={() => handleEditar(alb)} className="text-blue-600 hover:underline text-sm">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(alb)} className="text-red-600 hover:underline text-sm">
                      Borrar
                    </button>
                  </div>
                </div>

                <table className="w-full mt-3 text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">Artículo</th>
                      <th className="py-1">Cantidad</th>
                      <th className="py-1">Precio</th>
                      <th className="py-1">Caducidad</th>
                      <th className="py-1">Notas</th>
                      <th className="py-1">Temp.</th>
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
                        <td className={`py-1 ${linea.temperatura_fuera_rango ? 'text-red-600 font-semibold' : ''}`}>
                          {linea.temperatura_recepcion != null ? `${linea.temperatura_recepcion}°C` : '-'}
                          {linea.temperatura_fuera_rango && ' ⚠️'}
                        </td>
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