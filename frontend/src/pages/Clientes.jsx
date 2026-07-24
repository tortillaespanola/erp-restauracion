import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const vacio = { tipo: 'particular', nombre: '', razon_fiscal: '', cif: '', direccion: '', email: '', telefono: '' }

function Clientes() {
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarClientes() {
    setCargando(true)
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) console.error('Error cargando clientes:', error)
    else setClientes(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarClientes()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Si es particular, no guardamos datos fiscales aunque queden restos en el formulario
    const payload = {
      ...form,
      razon_fiscal: form.tipo === 'empresa' ? form.razon_fiscal : null,
      cif: form.tipo === 'empresa' ? form.cif : null,
    }

    if (editandoId) {
      const { error } = await supabase
        .from('clientes')
        .update(payload)
        .eq('id', editandoId)

      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('clientes')
        .insert(payload)

      if (error) {
        alert('Error al guardar: ' + error.message)
        return
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarClientes()
  }

  function handleEditar(c) {
    setForm({
      tipo: c.tipo ?? 'particular',
      nombre: c.nombre ?? '',
      razon_fiscal: c.razon_fiscal ?? '',
      cif: c.cif ?? '',
      direccion: c.direccion ?? '',
      email: c.email ?? '',
      telefono: c.telefono ?? '',
    })
    setEditandoId(c.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este cliente?')) return

    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarClientes()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Clientes</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <h2 className="font-semibold text-slate-700">
          {editandoId ? 'Editar cliente' : 'Nuevo cliente'}
        </h2>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name="tipo" checked={form.tipo === 'particular'}
              onChange={() => handleChange('tipo', 'particular')} />
            Particular
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="tipo" checked={form.tipo === 'empresa'}
              onChange={() => handleChange('tipo', 'empresa')} />
            Empresa
          </label>
        </div>

        <input type="text" placeholder={form.tipo === 'empresa' ? 'Nombre comercial' : 'Nombre y apellidos'}
          value={form.nombre}
          onChange={(e) => handleChange('nombre', e.target.value)}
          required className="border rounded px-3 py-2" />

        {form.tipo === 'empresa' && (
          <>
            <input type="text" placeholder="Razón fiscal" value={form.razon_fiscal}
              onChange={(e) => handleChange('razon_fiscal', e.target.value)}
              className="border rounded px-3 py-2" />
            <input type="text" placeholder="CIF" value={form.cif}
              onChange={(e) => handleChange('cif', e.target.value)}
              className="border rounded px-3 py-2" />
          </>
        )}

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
            {editandoId ? 'Guardar cambios' : 'Guardar cliente'}
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
        ) : clientes.length === 0 ? (
          <p className="text-slate-500">Todavía no hay clientes dados de alta.</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-3">Tipo</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">CIF</th>
                <th className="p-3">Email</th>
                <th className="p-3">Teléfono</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 capitalize">{c.tipo}</td>
                  <td className="p-3">{c.nombre}</td>
                  <td className="p-3">{c.cif ?? '-'}</td>
                  <td className="p-3">{c.email ?? '-'}</td>
                  <td className="p-3">{c.telefono ?? '-'}</td>
                  <td className="p-3 flex gap-3">
                    <button onClick={() => handleEditar(c)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => handleBorrar(c.id)} className="text-red-600 hover:underline">
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

export default Clientes