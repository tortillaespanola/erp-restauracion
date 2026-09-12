import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { Card, CardBody, Button, Field, Input, Textarea } from '../../components/ui'

// CONTRATO_CONFIGURACION_SUBMENUS.md, sección 7: formulario simple tipo ConfiguracionGeneral,
// una única fila por negocio (datos_bancarios.negocio_id UNIQUE) -- se guarda con upsert sobre
// negocio_id, no hay id que rastrear en el frontend (negocio_id ya identifica la fila).
const formVacio = {
  beneficiario: '',
  direccion_beneficiario: '',
  iban: '',
  bic: '',
  referencia_pago: '',
  banco: '',
  condiciones_pago: '',
  observaciones: '',
  enlace_pago_online: '',
}

function ConfiguracionBancaria() {
  const { t } = useTranslation(['configuracion'])
  const [form, setForm] = useState(formVacio)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      const { data, error } = await supabase.from('datos_bancarios').select(Object.keys(formVacio).join(',')).maybeSingle()
      if (error) console.error(error)
      else if (data) setForm({ ...formVacio, ...data })
      setCargando(false)
    }
    cargar()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const { error } = await supabase
      .from('datos_bancarios')
      .upsert(form, { onConflict: 'negocio_id' })
    if (error) {
      alert(t('configuracion:bancario.alertas.error_guardar', { mensaje: error.message }))
      return
    }
    toast.success(t('configuracion:bancario.alertas.guardado_correctamente'))
  }

  if (cargando) return <div className="text-sm text-ink-faint">{t('configuracion:cargando')}</div>

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label={t('configuracion:bancario.campos.beneficiario')}>
            <Input type="text" value={form.beneficiario ?? ''} onChange={(e) => handleChange('beneficiario', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.direccion_beneficiario')}>
            <Input type="text" value={form.direccion_beneficiario ?? ''} onChange={(e) => handleChange('direccion_beneficiario', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.iban')}>
            <Input type="text" value={form.iban ?? ''} onChange={(e) => handleChange('iban', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.bic')}>
            <Input type="text" value={form.bic ?? ''} onChange={(e) => handleChange('bic', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.referencia_pago')}>
            <Input type="text" value={form.referencia_pago ?? ''} onChange={(e) => handleChange('referencia_pago', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.banco')}>
            <Input type="text" value={form.banco ?? ''} onChange={(e) => handleChange('banco', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.condiciones_pago')}>
            <Textarea rows={3} value={form.condiciones_pago ?? ''} onChange={(e) => handleChange('condiciones_pago', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.observaciones')}>
            <Textarea rows={3} value={form.observaciones ?? ''} onChange={(e) => handleChange('observaciones', e.target.value)} />
          </Field>
          <Field label={t('configuracion:bancario.campos.enlace_pago_online')}>
            <Input type="text" value={form.enlace_pago_online ?? ''} onChange={(e) => handleChange('enlace_pago_online', e.target.value)} />
          </Field>

          <Button type="submit" className="self-start mt-1">{t('configuracion:bancario.guardar')}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

export default ConfiguracionBancaria
