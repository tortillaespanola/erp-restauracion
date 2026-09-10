import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { Field, Input, Button } from './ui'

const vacio = { tipo: 'particular', nombre: '', razon_fiscal: '', cif: '', direccion: '', email: '', telefono: '' }

function estadoInicial(cliente) {
  if (!cliente) return vacio
  return {
    tipo: cliente.tipo ?? 'particular',
    nombre: cliente.nombre ?? '',
    razon_fiscal: cliente.razon_fiscal ?? '',
    cif: cliente.cif ?? '',
    direccion: cliente.direccion ?? '',
    email: cliente.email ?? '',
    telefono: cliente.telefono ?? '',
  }
}

// CONTRATO_HARDENING_A5_A11.md (A10): formulario de alta/edición extraído del layout inline de
// Clientes.jsx a este componente, para vivir dentro del Drawer -- mismo patrón que
// AjusteStockForm.jsx/PedidoForm.jsx. El componente se desmonta al cerrar el drawer, así que no
// hace falta resetForm(): la próxima apertura es un montaje nuevo con estado fresco.
function ClienteForm({ cliente, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'enums', 'contactos_comun', 'clientes'])
  const [form, setForm] = useState(estadoInicial(cliente))
  const [guardando, setGuardando] = useState(false)

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setGuardando(true)

    // Si es particular, no guardamos datos fiscales aunque queden restos en el formulario
    const payload = {
      ...form,
      razon_fiscal: form.tipo === 'empresa' ? form.razon_fiscal : null,
      cif: form.tipo === 'empresa' ? form.cif : null,
    }

    const { error } = cliente
      ? await supabase.from('clientes').update(payload).eq('id', cliente.id)
      : await supabase.from('clientes').insert(payload)

    setGuardando(false)
    if (error) {
      alert(t(cliente ? 'clientes:alertas.error_actualizar' : 'clientes:alertas.error_guardar', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    onGuardado()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="tipo" checked={form.tipo === 'particular'}
            onChange={() => handleChange('tipo', 'particular')} />
          {t('enums:tipo_cliente.particular')}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="tipo" checked={form.tipo === 'empresa'}
            onChange={() => handleChange('tipo', 'empresa')} />
          {t('enums:tipo_cliente.empresa')}
        </label>
      </div>

      <Field label={form.tipo === 'empresa' ? t('clientes:campos.nombre_comercial') : t('clientes:campos.nombre_y_apellidos')}>
        <Input type="text" value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)} required />
      </Field>

      {form.tipo === 'empresa' && (
        <>
          <Field label={t('contactos_comun:razon_fiscal')}>
            <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
          </Field>
          <Field label={t('contactos_comun:cif')}>
            <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
          </Field>
        </>
      )}

      <Field label={t('contactos_comun:direccion')}>
        <Input type="text" value={form.direccion} onChange={(e) => handleChange('direccion', e.target.value)} />
      </Field>
      <Field label={t('contactos_comun:email')}>
        <Input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} />
      </Field>
      <Field label={t('contactos_comun:telefono')}>
        <Input type="text" value={form.telefono} onChange={(e) => handleChange('telefono', e.target.value)} />
      </Field>

      <div className="flex gap-2 mt-1">
        <Button type="submit" className="flex-1" disabled={guardando}>
          {guardando ? t('common:actions.saving') : cliente ? t('clientes:guardar_cambios') : <><IconPlus size={15} /> {t('clientes:guardar_cliente')}</>}
        </Button>
        {onCancelar && <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>}
      </div>
    </form>
  )
}

export default ClienteForm
