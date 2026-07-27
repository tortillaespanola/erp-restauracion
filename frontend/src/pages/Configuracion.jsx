import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function Configuracion() {
  const [form, setForm] = useState({
    nombre: '', razon_fiscal: '', cif: '', direccion: '', telefono: '', email: '', logo_url: '',
  })
  const [cargando, setCargando] = useState(true)
  const [subiendoLogo, setSubiendoLogo] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase.from('empresa_config').select('*').eq('id', 1).single()
    if (error) console.error(error)
    else setForm(data)
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const { error } = await supabase.from('empresa_config').update(form).eq('id', 1)
    if (error) {
      alert('Error al guardar: ' + error.message)
      return
    }
    alert('Datos guardados correctamente')
  }

  async function handleLogoChange(e) {
    const file = e.target.files[0]
    if (!file) return

    setSubiendoLogo(true)
    const nombreArchivo = `logo-${Date.now()}.${file.name.split('.').pop()}`

    const { error: errorUpload } = await supabase.storage
      .from('logos')
      .upload(nombreArchivo, file, { upsert: true })

    if (errorUpload) {
      alert('Error al subir el logo: ' + errorUpload.message)
      setSubiendoLogo(false)
      return
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(nombreArchivo)
    setForm((prev) => ({ ...prev, logo_url: data.publicUrl }))
    setSubiendoLogo(false)
  }

  if (cargando) return <div className="p-6">Cargando...</div>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Configuración de empresa</h1>
      <p className="text-slate-500 text-sm mt-1">
        Estos datos aparecerán en el membrete de albaranes y facturas.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 bg-white p-4 rounded-lg shadow flex flex-col gap-3">
        <div>
          <label className="text-sm font-semibold text-slate-600 block mb-1">Logo</label>
          {form.logo_url && (
            <img src={form.logo_url} alt="Logo" className="h-16 object-contain mb-2 border rounded p-1" />
          )}
          <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
          {subiendoLogo && <p className="text-sm text-slate-400">Subiendo...</p>}
        </div>

        <input type="text" placeholder="Nombre comercial" value={form.nombre ?? ''}
          onChange={(e) => handleChange('nombre', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="Razón fiscal" value={form.razon_fiscal ?? ''}
          onChange={(e) => handleChange('razon_fiscal', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="CIF" value={form.cif ?? ''}
          onChange={(e) => handleChange('cif', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="Dirección" value={form.direccion ?? ''}
          onChange={(e) => handleChange('direccion', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="text" placeholder="Teléfono" value={form.telefono ?? ''}
          onChange={(e) => handleChange('telefono', e.target.value)}
          className="border rounded px-3 py-2" />
        <input type="email" placeholder="Email" value={form.email ?? ''}
          onChange={(e) => handleChange('email', e.target.value)}
          className="border rounded px-3 py-2" />

        <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700 self-start">
          Guardar
        </button>
      </form>
    </div>
  )
}

export default Configuracion