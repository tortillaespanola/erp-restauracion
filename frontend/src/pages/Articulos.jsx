import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const vacio = { nombre: '', unidad: '', precio_referencia: '', proveedor_id: '', categoria: '', iva: '' }

function Articulos() {
  const [articulos, setArticulos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resArticulos, resProveedores] = await Promise.all([
      supabase
        .from('articulos_compra')
        .select('*, proveedores(id, nombre_comercial)')
        .order('created_at', { ascending: false }),
      supabase
        .from('proveedores')
        .select('id, nombre_comercial')
        .order('nombre_comercial', { ascending: true }),
    ])

    if (resArticulos.error) console.error('Error cargando artículos:', resArticulos.error)
    else setArticulos(resArticulos.data)

    if (resProveedores.error) console.error('Error cargando proveedores:', resProveedores.error)
    else setProveedores(resProveedores.data)

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
      precio_referencia: form.precio_referencia ? parseFloat(form.precio_referencia) : null,
      proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id) : null,
      categoria: form.categoria || null,
      iva: form.iva ? parseFloat(form.iva) : null,
    }

    if (editandoId) {
      const { error } = await supabase
        .from('articulos_compra')
        .update(payload)
        .eq('id', editandoId)

      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('articulos_compra')
        .insert(payload)

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
      precio_referencia: a.precio_referencia ?? '',
      proveedor_id: a.proveedor_id ?? '',
      categoria: a.categoria ?? '',
      iva: a.iva ?? '',
    })
    setEditandoId(a.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este artículo?')) return

    const { error } = await supabase
      .from('articulos_compra')
      .delete()
      .eq('id', id)

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
        <input type="text" placeholder="Unidad (kg, l, ud...)" value={form.unidad}
          onChange={(e) => handleChange('unidad', e.target.value)}
          required className="border rounded px-3 py-2" />
        <input type="number" step="0.01" placeholder="Precio de referencia" value={form.precio_referencia}
          onChange={(e) => handleChange('precio_referencia', e.target.value)}
          className="border rounded px-3 py-2" />
          <input type="text" placeholder="Categoría (ej. Carnes, Bebidas...)" value={form.categoria}
          onChange={(e) => handleChange('categoria', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="number" step="0.01" placeholder="IVA (%)" value={form.iva}
          onChange={(e) => handleChange('iva', e.target.value)}
          className="border rounded px-3 py-2" />

        <select value={form.proveedor_id}
          onChange={(e) => handleChange('proveedor_id', e.target.value)}
          className="border rounded px-3 py-2">
          <option value="">Sin proveedor asignado</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
          ))}
        </select>

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
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : articulos.length === 0 ? (
          <p className="text-slate-500">Todavía no hay artículos dados de alta.</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Unidad</th>
                <th className="p-3">Precio ref.</th>
                <th className="p-3">Proveedor</th>
                <th className="p-3"></th>
                <th className="p-3">Categoría</th>
                <th className="p-3">IVA</th>
              </tr>
            </thead>
            <tbody>
              {articulos.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-3">{a.nombre}</td>
                  <td className="p-3">{a.unidad}</td>
                  <td className="p-3">{a.precio_referencia ?? '-'}</td>
                  <td className="p-3">{a.proveedores?.nombre_comercial ?? '-'}</td>
                  <td className="p-3">{a.categoria ?? '-'}</td>
                  <td className="p-3">{a.iva != null ? `${a.iva}%` : '-'}</td>
                  <td className="p-3 flex gap-3">
                    <button onClick={() => handleEditar(a)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(a.id)} className="text-red-600 hover:underline">
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Articulos