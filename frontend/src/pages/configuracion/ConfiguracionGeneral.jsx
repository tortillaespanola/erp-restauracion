import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { Card, CardBody, Button, Field, Input } from '../../components/ui'

// CONTRATO_CONFIGURACION_SUBMENUS.md, sección 5: extraído tal cual de Configuracion.jsx,
// sin cambios funcionales -- solo pasa a ser la pestaña "General".
function ConfiguracionGeneral() {
  const { t } = useTranslation(['configuracion'])
  const [form, setForm] = useState({
    nombre: '', razon_fiscal: '', cif: '', direccion: '', telefono: '', email: '', logo_url: '',
  })
  const [cargando, setCargando] = useState(true)
  const [subiendoLogo, setSubiendoLogo] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase.from('empresa_config').select('*').single()
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
    const { error } = await supabase.from('empresa_config').update(form).eq('negocio_id', form.negocio_id)
    if (error) {
      alert(t('configuracion:alertas.error_guardar', { mensaje: error.message }))
      return
    }
    toast.success(t('configuracion:alertas.guardado_correctamente'))
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
      alert(t('configuracion:alertas.error_subir_logo', { mensaje: errorUpload.message }))
      setSubiendoLogo(false)
      return
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(nombreArchivo)
    setForm((prev) => ({ ...prev, logo_url: data.publicUrl }))
    setSubiendoLogo(false)
  }

  if (cargando) return <div className="text-sm text-ink-faint">{t('configuracion:cargando')}</div>

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label={t('configuracion:campos.logo')}>
            {form.logo_url && (
              <img src={form.logo_url} alt="Logo" className="h-16 object-contain mb-2 border border-border rounded p-1" />
            )}
            <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
            {subiendoLogo && <p className="text-sm text-ink-faint mt-1">{t('configuracion:subiendo')}</p>}
          </Field>

          <Field label={t('configuracion:campos.nombre_comercial')}>
            <Input type="text" value={form.nombre ?? ''} onChange={(e) => handleChange('nombre', e.target.value)} />
          </Field>
          <Field label={t('configuracion:campos.razon_fiscal')}>
            <Input type="text" value={form.razon_fiscal ?? ''} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
          </Field>
          <Field label={t('configuracion:campos.cif')}>
            <Input type="text" value={form.cif ?? ''} onChange={(e) => handleChange('cif', e.target.value)} />
          </Field>
          <Field label={t('configuracion:campos.direccion')}>
            <Input type="text" value={form.direccion ?? ''} onChange={(e) => handleChange('direccion', e.target.value)} />
          </Field>
          <Field label={t('configuracion:campos.telefono')}>
            <Input type="text" value={form.telefono ?? ''} onChange={(e) => handleChange('telefono', e.target.value)} />
          </Field>
          <Field label={t('configuracion:campos.email')}>
            <Input type="email" value={form.email ?? ''} onChange={(e) => handleChange('email', e.target.value)} />
          </Field>

          <Button type="submit" className="self-start mt-1">{t('configuracion:guardar')}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

export default ConfiguracionGeneral
