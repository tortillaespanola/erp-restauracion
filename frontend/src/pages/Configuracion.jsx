import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardBody, Button, Field, Input } from '../components/ui'

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

  if (cargando) return <div className="text-sm text-gray-400">Cargando...</div>

  return (
    <div className="max-w-2xl">
      <PageHeader title="Configuración de empresa" subtitle="Estos datos aparecerán en el membrete de albaranes y facturas." />

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field label="Logo">
              {form.logo_url && (
                <img src={form.logo_url} alt="Logo" className="h-16 object-contain mb-2 border border-gray-200 rounded p-1" />
              )}
              <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
              {subiendoLogo && <p className="text-sm text-gray-400 mt-1">Subiendo...</p>}
            </Field>

            <Field label="Nombre comercial">
              <Input type="text" value={form.nombre ?? ''} onChange={(e) => handleChange('nombre', e.target.value)} />
            </Field>
            <Field label="Razón fiscal">
              <Input type="text" value={form.razon_fiscal ?? ''} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
            </Field>
            <Field label="CIF">
              <Input type="text" value={form.cif ?? ''} onChange={(e) => handleChange('cif', e.target.value)} />
            </Field>
            <Field label="Dirección">
              <Input type="text" value={form.direccion ?? ''} onChange={(e) => handleChange('direccion', e.target.value)} />
            </Field>
            <Field label="Teléfono">
              <Input type="text" value={form.telefono ?? ''} onChange={(e) => handleChange('telefono', e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email ?? ''} onChange={(e) => handleChange('email', e.target.value)} />
            </Field>

            <Button type="submit" className="self-start mt-1">Guardar</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

export default Configuracion
