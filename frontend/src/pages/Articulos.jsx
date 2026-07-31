import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const vacio = {
  nombre: '', unidad: '', categoria: '', iva: '', codigo: '', tipo_material: 'RM',
  requiere_control_temperatura: false, temperatura_min: '', temperatura_max: '',
}

function Articulos() {
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const { data, error } = await supabase
      .from('articulos_compra')
      .select('*, articulo_proveedor(id, precio, preferente, referencia_proveedor, proveedores(id, nombre_comercial))')
      .order('created_at', { ascending: false })

    if (error) console.error('Error cargando artículos:', error)
    else setArticulos(data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const payload = {
      nombre: form.nombre,
      unidad: form.unidad,
      categoria: form.categoria || null,
      iva: form.iva ? parseFloat(form.iva) : null,
      codigo: form.codigo || null,
      tipo_material: form.tipo_material,
      requiere_control_temperatura: form.requiere_control_temperatura,
      temperatura_min: form.requiere_control_temperatura && form.temperatura_min ? parseFloat(form.temperatura_min) : null,
      temperatura_max: form.requiere_control_temperatura && form.temperatura_max ? parseFloat(form.temperatura_max) : null,
    }

    if (editandoId) {
      const { error } = await supabase.from('articulos_compra').update(payload).eq('id', editandoId)
      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('articulos_compra').insert(payload)
      if (error) {
        alert('Error al guardar: ' + error.message)
        return
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarDatos()
  }

  function handleEditar(a) {
    setForm({
      nombre: a.nombre ?? '',
      unidad: a.unidad ?? '',
      categoria: a.categoria ?? '',
      iva: a.iva ?? '',
      codigo: a.codigo ?? '',
      tipo_material: a.tipo_material ?? 'RM',
      requiere_control_temperatura: a.requiere_control_temperatura ?? false,
      temperatura_min: a.temperatura_min ?? '',
      temperatura_max: a.temperatura_max ?? '',
    })
    setEditandoId(a.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este artículo?')) return
    const { error } = await supabase.from('articulos_compra').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Artículos de compra</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <h2 className="font-semibold text-slate-700">
          {editandoId ? 'Editar artículo' : 'Nuevo artículo'}
        </h2>

        <input type="text" placeholder="Nombre" value={form.nombre}
          onChange={(e) => handleChange('nombre', e.target.value)}
          required className="border rounded px-3 py-2" />

        <div className="grid grid-cols-2 gap-3">
          <input type="text" placeholder="Código corto (ej. KRT)" value={form.codigo}
            onChange={(e) => handleChange('codigo', e.target.value)}
            className="border rounded px-3 py-2" />
          <select value={form.tipo_material}
            onChange={(e) => handleChange('tipo_material', e.target.value)}
            className="border rounded px-3 py-2">
            <option value="RM">Materia prima (RM)</option>
            <option value="AUX">Material auxiliar (AUX)</option>
            <option value="TRD">Mercadería (TRD)</option>
          </select>
        </div>

        <input type="text" placeholder="Unidad (kg, l, ud...)" value={form.unidad}
          onChange={(e) => handleChange('unidad', e.target.value)}
          required className="border rounded px-3 py-2" />

        <div className="grid grid-cols-2 gap-3">
          <input type="text" placeholder="Categoría (ej. Carnes, Bebidas...)" value={form.categoria}
            onChange={(e) => handleChange('categoria', e.target.value)}
            className="border rounded px-3 py-2" />
          <input type="number" step="0.01" placeholder="IVA (%)" value={form.iva}
            onChange={(e) => handleChange('iva', e.target.value)}
            className="border rounded px-3 py-2" />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.requiere_control_temperatura}
            onChange={(e) => handleChange('requiere_control_temperatura', e.target.checked)} />
          Requiere control de temperatura en la recepción
        </label>

        {form.requiere_control_temperatura && (
          <div className="grid grid-cols-2 gap-3 pl-6">
            <input type="number" step="0.1" placeholder="Temperatura mín. aceptable (°C)"
              value={form.temperatura_min}
              onChange={(e) => handleChange('temperatura_min', e.target.value)}
              className="border rounded px-3 py-2 text-sm" />
            <input type="number" step="0.1" placeholder="Temperatura máx. aceptable (°C)"
              value={form.temperatura_max}
              onChange={(e) => handleChange('temperatura_max', e.target.value)}
              className="border rounded px-3 py-2 text-sm" />
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700">
            {editandoId ? 'Guardar cambios' : 'Guardar artículo'}
          </button>
          {editandoId && (
            <button type="button" onClick={handleCancelar}
              className="bg-slate-200 text-slate-700 rounded px-4 py-2 hover:bg-slate-300">
              Cancelar
            </button>
          )}
        </div>
        {!editandoId && (
          <p className="text-xs text-slate-400">
            Podrás asignar proveedores y precios después de guardar el artículo.
          </p>
        )}
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : articulos.length === 0 ? (
          <p className="text-slate-500">Todavía no hay artículos dados de alta.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {articulos.map((a) => (
              <div key={a.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">
                      {a.nombre} {a.codigo && <span className="text-slate-400 font-mono text-xs">({a.codigo})</span>}
                    </p>
                    <p className="text-sm text-slate-500">
                      {a.unidad} · {a.categoria ?? 'Sin categoría'} · IVA {a.iva != null ? `${a.iva}%` : '-'} · {a.tipo_material}
                      {a.requiere_control_temperatura && (
                        <span className="ml-2 text-blue-600">
                          🌡️ Control temperatura
                          {a.temperatura_min != null && a.temperatura_max != null && ` (${a.temperatura_min}°C a ${a.temperatura_max}°C)`}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => handleEditar(a)} className="text-blue-600 hover:underline text-sm">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(a.id)} className="text-red-600 hover:underline text-sm">
                      Borrar
                    </button>
                  </div>
                </div>

                <ProveedoresDelArticulo articulo={a} onCambio={cargarDatos} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProveedoresDelArticulo({ articulo, onCambio }) {
  const [proveedores, setProveedores] = useState([])
  const [proveedorId, setProveedorId] = useState('')
  const [precio, setPrecio] = useState('')
  const [referencia, setReferencia] = useState('')
  const [editandoRelacionId, setEditandoRelacionId] = useState(null)
  const [precioEdit, setPrecioEdit] = useState('')
  const [referenciaEdit, setReferenciaEdit] = useState('')

  useEffect(() => {
    async function cargarProveedores() {
      const { data } = await supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial')
      setProveedores(data || [])
    }
    cargarProveedores()
  }, [])

  const yaAsignados = new Set(articulo.articulo_proveedor.map((ap) => ap.proveedores?.id))
  const disponibles = proveedores.filter((p) => !yaAsignados.has(p.id))

  async function handleAdd() {
    if (!proveedorId) {
      alert('Selecciona un proveedor')
      return
    }

    const esPrimero = articulo.articulo_proveedor.length === 0

    const { error } = await supabase.from('articulo_proveedor').insert({
      articulo_id: articulo.id,
      proveedor_id: parseInt(proveedorId),
      precio: precio ? parseFloat(precio) : null,
      referencia_proveedor: referencia || null,
      preferente: esPrimero,
    })

    if (error) {
      alert('Error al asignar proveedor: ' + error.message)
      return
    }

    setProveedorId('')
    setPrecio('')
    setReferencia('')
    onCambio()
  }

  function handleEmpezarEdicion(ap) {
    setEditandoRelacionId(ap.id)
    setPrecioEdit(ap.precio ?? '')
    setReferenciaEdit(ap.referencia_proveedor ?? '')
  }

  function handleCancelarEdicion() {
    setEditandoRelacionId(null)
    setPrecioEdit('')
    setReferenciaEdit('')
  }

  async function handleGuardarEdicion(id) {
    const { error } = await supabase
      .from('articulo_proveedor')
      .update({
        precio: precioEdit ? parseFloat(precioEdit) : null,
        referencia_proveedor: referenciaEdit || null,
      })
      .eq('id', id)

    if (error) {
      alert('Error al actualizar: ' + error.message)
      return
    }

    handleCancelarEdicion()
    onCambio()
  }

  async function handleMarcarPreferente(id) {
    const { error } = await supabase.from('articulo_proveedor').update({ preferente: true }).eq('id', id)
    if (error) {
      alert('Error: ' + error.message)
      return
    }
    onCambio()
  }

  async function handleQuitar(id) {
    if (!confirm('¿Quitar este proveedor del artículo?')) return
    const { error } = await supabase.from('articulo_proveedor').delete().eq('id', id)
    if (error) {
      alert('Error al quitar: ' + error.message)
      return
    }
    onCambio()
  }

  return (
    <div className="mt-3 border-t pt-3">
      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Proveedores</p>

      {articulo.articulo_proveedor.length === 0 ? (
        <p className="text-sm text-slate-400 mb-2">Sin proveedores asignados todavía.</p>
      ) : (
        <table className="w-full text-sm mb-2">
          <tbody>
            {articulo.articulo_proveedor.map((ap) => {
              const enEdicion = editandoRelacionId === ap.id

              if (enEdicion) {
                return (
                  <tr key={ap.id} className="border-t bg-blue-50/50">
                    <td className="py-1">
                      {ap.preferente && <span className="text-amber-500 mr-1">★</span>}
                      {ap.proveedores?.nombre_comercial}
                    </td>
                    <td className="py-1">
                      <input type="number" step="0.01" value={precioEdit}
                        onChange={(e) => setPrecioEdit(e.target.value)}
                        placeholder="Precio"
                        className="border rounded px-2 py-1 text-sm w-24" />
                    </td>
                    <td className="py-1">
                      <input type="text" value={referenciaEdit}
                        onChange={(e) => setReferenciaEdit(e.target.value)}
                        placeholder="Ref."
                        className="border rounded px-2 py-1 text-sm w-full" />
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <button onClick={() => handleGuardarEdicion(ap.id)} className="text-green-700 hover:underline text-xs mr-3">
                        Guardar
                      </button>
                      <button onClick={handleCancelarEdicion} className="text-slate-500 hover:underline text-xs">
                        Cancelar
                      </button>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={ap.id} className="border-t">
                  <td className="py-1">
                    {ap.preferente && <span className="text-amber-500 mr-1">★</span>}
                    {ap.proveedores?.nombre_comercial}
                  </td>
                  <td className="py-1">{ap.precio != null ? `${ap.precio} €` : '-'}</td>
                  <td className="py-1 text-slate-400">{ap.referencia_proveedor ?? '-'}</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <button onClick={() => handleEmpezarEdicion(ap)} className="text-blue-600 hover:underline text-xs mr-3">
                      Editar
                    </button>
                    {!ap.preferente && (
                      <button onClick={() => handleMarcarPreferente(ap.id)} className="text-amber-600 hover:underline text-xs mr-3">
                        Marcar preferente
                      </button>
                    )}
                    <button onClick={() => handleQuitar(ap.id)} className="text-red-600 hover:underline text-xs">
                      Quitar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {disponibles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm">
            <option value="">Añadir proveedor...</option>
            {disponibles.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </select>
          <input type="number" step="0.01" placeholder="Precio" value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm" />
          <input type="text" placeholder="Ref. proveedor" value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm" />
          <button type="button" onClick={handleAdd} className="text-blue-600 hover:underline text-sm">
            + Añadir
          </button>
        </div>
      )}
    </div>
  )
}
export default Articulos