import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { IconTrash, IconLock, IconAlertTriangle, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { id: null, articulo_id: '', cantidad: '', precio: '', fecha_caducidad: '', notas: '', temperatura: '', locked: false, linea_pedido_compra_id: null }

function AlbaranesCompra() {
  const [searchParams] = useSearchParams()
  const [albaranes, setAlbaranes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulosDelProveedor, setArticulosDelProveedor] = useState([])
  const [pedidosCompraPendientes, setPedidosCompraPendientes] = useState([])
  const [cargando, setCargando] = useState(true)

  const [tipoOrigen, setTipoOrigen] = useState(searchParams.get('pedido_compra_id') ? 'pedido' : 'compra_directa')
  const [pedidoCompraId, setPedidoCompraId] = useState(searchParams.get('pedido_compra_id') ?? '')
  const [proveedorId, setProveedorId] = useState('')
  const [numeroAlbaran, setNumeroAlbaran] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [lineas, setLineas] = useState([{ ...lineaVacia }])

  const [editandoId, setEditandoId] = useState(null)
  const [lineasABorrar, setLineasABorrar] = useState([])

  async function cargarDatos() {
    setCargando(true)

    const [resAlbaranes, resProveedores, resPedidosCompra] = await Promise.all([
      supabase
        .from('albaranes_compra')
        .select('*, proveedores(nombre_comercial), entrada_material(id, cantidad, precio, fecha_caducidad, notas, codigo_lote, temperatura_recepcion, temperatura_fuera_rango, articulo_id, linea_pedido_compra_id, articulos_compra(nombre, unidad))')
        .order('fecha', { ascending: false }),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
      supabase
        .from('pedidos_compra')
        .select('id, codigo_pedido, proveedor_id, proveedores(nombre_comercial), lineas_pedido_compra(id, articulo_id, cantidad, precio_unitario, articulos_compra(nombre, unidad))')
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: false }),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else setAlbaranes(resAlbaranes.data)

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data)

    if (resPedidosCompra.error) console.error(resPedidosCompra.error)
    else setPedidosCompraPendientes(resPedidosCompra.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  useEffect(() => {
    if (tipoOrigen !== 'pedido' || !pedidoCompraId || pedidosCompraPendientes.length === 0) return

    const pedido = pedidosCompraPendientes.find((p) => p.id === parseInt(pedidoCompraId))
    if (!pedido) return

    setProveedorId(String(pedido.proveedor_id))
    setLineas(
      pedido.lineas_pedido_compra.map((l) => ({
        ...lineaVacia,
        articulo_id: String(l.articulo_id),
        cantidad: String(l.cantidad),
        precio: l.precio_unitario != null ? String(l.precio_unitario) : '',
        linea_pedido_compra_id: l.id,
      }))
    )
  }, [tipoOrigen, pedidoCompraId, pedidosCompraPendientes])

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
    setTipoOrigen('compra_directa')
    setPedidoCompraId('')
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
        linea_pedido_compra_id: l.linea_pedido_compra_id ?? null,
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
        linea_pedido_compra_id: l.linea_pedido_compra_id || null,
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

      for (const l of lineasValidas.filter((l) => l.id && l.locked)) {
        const { error } = await supabase
          .from('entrada_material')
          .update({ fecha_caducidad: l.fecha_caducidad || null, notas: l.notas || null })
          .eq('id', l.id)
        if (error) {
          alert('Error al actualizar caducidad/notas de una línea bloqueada: ' + error.message)
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
        tipo_origen: tipoOrigen,
        pedido_compra_id: tipoOrigen === 'pedido' ? parseInt(pedidoCompraId) : null,
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
    <div>
      <PageHeader title="Albaranes de compra" />

      <Card className="mb-6">
        <CardHeader title={editandoId ? 'Editar albarán' : 'Nuevo albarán'} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {!editandoId && (
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={tipoOrigen === 'compra_directa'}
                    onChange={() => { setTipoOrigen('compra_directa'); setPedidoCompraId(''); setProveedorId(''); setLineas([{ ...lineaVacia }]) }} />
                  Compra directa
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={tipoOrigen === 'pedido'}
                    onChange={() => setTipoOrigen('pedido')} />
                  Desde pedido existente
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {tipoOrigen === 'pedido' && !editandoId ? (
                <Field label="Pedido de compra">
                  <Select value={pedidoCompraId} onChange={(e) => setPedidoCompraId(e.target.value)} required>
                    <option value="">Selecciona pedido</option>
                    {pedidosCompraPendientes.map((p) => (
                      <option key={p.id} value={p.id}>{p.codigo_pedido} · {p.proveedores?.nombre_comercial}</option>
                    ))}
                  </Select>
                  {proveedorId && (
                    <p className="text-xs text-gray-400 mt-1">
                      Proveedor: {proveedores.find((p) => p.id === parseInt(proveedorId))?.nombre_comercial}
                    </p>
                  )}
                </Field>
              ) : (
                <Field label="Proveedor">
                  <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
                    required disabled={!!editandoId}>
                    <option value="">Selecciona proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Nº albarán del proveedor">
                <Input type="text" value={numeroAlbaran} onChange={(e) => setNumeroAlbaran(e.target.value)} />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              </Field>
            </div>

            {proveedorId && articulosDelProveedor.length === 0 && (
              <p className="text-sm text-amber-600 flex items-center gap-1.5">
                <IconAlertTriangle size={15} />
                Este proveedor no tiene ningún artículo asignado todavía — ve a Artículos para vincularlo.
              </p>
            )}

            <div>
              <SectionLabel>Líneas</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => {
                  if (linea.locked) {
                    const art = articulosDelProveedor.find((a) => a.id === parseInt(linea.articulo_id))
                    return (
                      <div key={index} className="border border-gray-200 rounded-md p-3 bg-gray-50 text-sm text-gray-500 flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <IconLock size={15} className="mt-0.5 shrink-0" />
                          <div>
                            {art?.nombre ?? 'Artículo'} · {linea.cantidad} · {linea.precio || '-'}
                            <span className="block text-xs mt-1">Artículo, cantidad y precio ya consumidos/ajustados — no se pueden modificar. Fecha de caducidad y notas sí.</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-6">
                          <Input type="date" placeholder="Caducidad" value={linea.fecha_caducidad}
                            onChange={(e) => handleLineaChange(index, 'fecha_caducidad', e.target.value)}
                            title="Fecha de caducidad (opcional)" />
                          <Input type="text" placeholder="Notas" value={linea.notas}
                            onChange={(e) => handleLineaChange(index, 'notas', e.target.value)} />
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={index} className="border border-gray-200 rounded-md p-3 flex flex-col gap-2">
                      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
                        <Select value={linea.articulo_id}
                          onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                          required disabled={!proveedorId}>
                          <option value="">
                            {!proveedorId ? 'Elige primero un proveedor' : 'Selecciona artículo'}
                          </option>
                          {articulosDelProveedor.map((a) => (
                            <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                          ))}
                        </Select>
                        <Input type="number" step="0.001" placeholder="Cantidad" value={linea.cantidad}
                          onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                          required title="Se redondeará a 3 decimales" />
                        <Input type="number" step="0.01" placeholder="Precio" value={linea.precio}
                          onChange={(e) => handleLineaChange(index, 'precio', e.target.value)} />
                        <Input type="date" placeholder="Caducidad" value={linea.fecha_caducidad}
                          onChange={(e) => handleLineaChange(index, 'fecha_caducidad', e.target.value)}
                          title="Fecha de caducidad (opcional)" />
                        <button type="button" onClick={() => removeLinea(index)}
                          className="text-gray-400 hover:text-red-600 justify-self-center">
                          <IconTrash size={16} />
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
                              className={`border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 ${fueraDeRango ? 'border-red-300 bg-red-50 focus:ring-red-100' : 'border-blue-200 focus:ring-blue-100'}`} />
                            {fueraDeRango && (
                              <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                                <IconAlertTriangle size={13} /> Fuera del rango aceptable ({art.temperaturaMin}°C a {art.temperaturaMax}°C)
                              </p>
                            )}
                          </div>
                        )
                      })()}

                      <Input type="text" placeholder="Notas (temperatura de recepción, incidencias...)"
                        value={linea.notas}
                        onChange={(e) => handleLineaChange(index, 'notas', e.target.value)} />
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-[#0854A0] font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> Añadir línea
              </button>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar albarán'}</Button>
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
      ) : albaranes.length === 0 ? (
        <Card><EmptyState>Todavía no hay albaranes registrados.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {albaranes.map((alb) => (
            <Card key={alb.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-[#1C2938]">{alb.proveedores?.nombre_comercial ?? 'Sin proveedor'}</p>
                  <p className="text-sm text-gray-500">
                    Albarán {alb.numero_albaran || '(sin número)'} · {alb.fecha}
                    {alb.codigo_interno && <span className="ml-2 text-xs font-mono text-gray-400">{alb.codigo_interno}</span>}
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(alb)}>Editar</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(alb)}>Borrar</LinkAction>
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">Artículo</th>
                    <th className="py-1.5 font-medium">Cantidad</th>
                    <th className="py-1.5 font-medium">Precio</th>
                    <th className="py-1.5 font-medium">Caducidad</th>
                    <th className="py-1.5 font-medium">Notas</th>
                    <th className="py-1.5 font-medium">Temp.</th>
                    <th className="py-1.5 font-medium">Lote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {alb.entrada_material.map((linea) => (
                    <tr key={linea.id}>
                      <td className="py-1.5">{linea.articulos_compra?.nombre}</td>
                      <td className="py-1.5">{linea.cantidad} {linea.articulos_compra?.unidad}</td>
                      <td className="py-1.5">{linea.precio ?? '-'}</td>
                      <td className="py-1.5">{linea.fecha_caducidad ?? '-'}</td>
                      <td className="py-1.5 text-gray-500">{linea.notas ?? '-'}</td>
                      <td className={`py-1.5 ${linea.temperatura_fuera_rango ? 'text-red-600 font-semibold' : ''}`}>
                        {linea.temperatura_recepcion != null ? `${linea.temperatura_recepcion}°C` : '-'}
                        {linea.temperatura_fuera_rango && ' ⚠️'}
                      </td>
                      <td className="py-1.5 text-gray-400 font-mono text-xs">{linea.codigo_lote ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default AlbaranesCompra
