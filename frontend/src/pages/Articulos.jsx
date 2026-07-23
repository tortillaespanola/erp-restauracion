import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function Articulos() {
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState('')
  const [unidad, setUnidad] = useState('')
  const [precio, setPrecio] = useState('')
  const [proveedor, setProveedor] = useState('')

  async function cargarArticulos() {
    setCargando(true)
    const { data, error } = await supabase
      .from('articulos_compra')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error cargando artículos:', error)
    } else {
      setArticulos(data)
    }
    setCargando(false)
  }

  useEffect(() => {
    cargarArticulos()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()

    const { error } = await supabase
      .from('articulos_compra')
      .insert({
        nombre,
        unidad,
        precio_referencia: precio ? parseFloat(precio) : null,
        proveedor,
      })

    if (error) {
      console.error('Error creando artículo:', error)
      alert('Error al guardar: ' + error.message)
      return
    }

    setNombre('')
    setUnidad('')
    setPrecio('')
    setProveedor('')
    cargarArticulos()
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Artículos de compra</h1>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <h2 className="font-semibold text-slate-700">Nuevo artículo</h2>

        <input
          type="text"
          placeholder="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="border rounded px-3 py-2"
        />
        <input
          type="text"
          placeholder="Unidad (kg, l, ud...)"
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          required
          className="border rounded px-3 py-2"
        />
        <input
          type="number"
          step="0.01"
          placeholder="Precio de referencia"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <input
          type="text"
          placeholder="Proveedor"
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}
          className="border rounded px-3 py-2"
        />

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 mt-2 hover:bg-slate-700">
          Guardar artículo
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 mb-3">Listado</h2>

        {cargando ? (
          <p className="text-slate-500">Cargando...</p>
        ) : articulos.length === 0 ? (
          <p className="text-slate-500">Todavía no hay artículos dados de alta.</p>
        ) : (
          <table className="w-full bg-white rounded-lg shadow overflow-hidden">
            <thead className="bg-slate-100 text-left text-sm text-slate-600">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Unidad</th>
                <th className="p-3">Precio ref.</th>
                <th className="p-3">Proveedor</th>
              </tr>
            </thead>
            <tbody>
              {articulos.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-3">{a.nombre}</td>
                  <td className="p-3">{a.unidad}</td>
                  <td className="p-3">{a.precio_referencia ?? '-'}</td>
                  <td className="p-3">{a.proveedor ?? '-'}</td>
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