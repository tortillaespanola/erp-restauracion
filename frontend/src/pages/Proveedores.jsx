import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const vacio = { razon_fiscal: '', nombre_comercial: '', cif: '', direccion: '', email: '', telefono: '' }

function Proveedores() {
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarProveedores() {
    setCargando(true)
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('nombre_comercial', { ascending: true })

    if (error) console.error('Error cargando proveedores:', error)
    else setProveedores(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarProveedores()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (editandoId) {
      const { error } = await supabase
        .from('proveedores')
        .update(form)
        .eq('id', editandoId)

      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('proveedores')
        .insert(form)

      if (error) {
        alert('Error al guardar: ' + error.message)
        return
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarProveedores()
  }

  function handleEditar(p) {
    setForm({
      razon_fiscal: p.razon_fiscal ?? '',
      nombre_comercial: p.nombre_comercial ?? '',
      cif: p.cif ?? '',
      direccion: p.direccion ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
    })
    setEditandoId(p.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este proveedor?')) return

    const { error } = await supabase
      .from('proveedores')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarProveedores()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Proveedores</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <h2 className="font-semibold text-slate-700">
          {editandoId ? 'Editar proveedor' : 'Nuevo proveedor'}
        </h2>

        <input type="text" placeholder="Razón fiscal" value={form.razon_fiscal}
          onChange={(e) => handleChange('razon_fiscal', e.target.value)}
          required className="border rounded px-3 py-2" />
        <input type="text" placeholder="Nombre comercial" value={form.nombre_comercial}
          onChange={(e) => handleChange('nombre_comercial', e.target.value)}
          required className="border rounded px-3 py-2" />
        <input type="text" placeholder="CIF" value={form.cif}
          onChange={(e) => handleChange('cif', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="Dirección" value={form.direccion}
          onChange={(e) => handleChange('direccion', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="email" placeholder="Email" value={form.email}
          onChange={(e) => handleChange('email', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="Teléfono" value={form.telefono}
          onChange={(e) => handleChange('telefono', e.target.value)}
          className="border rounded px-3 py-2" />

        <div className="flex gap-2 mt-2">
          <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700">
            {editandoId ? 'Guardar cambios' : 'Guardar proveedor'}
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
        ) : proveedores.length === 0 ? (
          <p className="text-slate-500">Todavía no hay proveedores dados de alta.</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-3">Razón fiscal</th>
                <th className="p-3">Nombre comercial</th>
                <th className="p-3">CIF</th>
                <th className="p-3">Email</th>
                <th className="p-3">Teléfono</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.razon_fiscal}</td>
                  <td className="p-3">{p.nombre_comercial}</td>
                  <td className="p-3">{p.cif ?? '-'}</td>
                  <td className="p-3">{p.email ?? '-'}</td>
                  <td className="p-3">{p.telefono ?? '-'}</td>
                  <td className="p-3 flex gap-3">
                    <button onClick={() => handleEditar(p)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(p.id)} className="text-red-600 hover:underline">
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

export default Proveedores