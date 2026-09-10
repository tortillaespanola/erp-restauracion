import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { Field, Input, Button } from './ui'

const vacio = { razon_fiscal: '', nombre_comercial: '', cif: '', direccion: '', email: '', telefono: '' }

function estadoInicial(proveedor) {
  if (!proveedor) return vacio
  return {
    razon_fiscal: proveedor.razon_fiscal ?? '',
    nombre_comercial: proveedor.nombre_comercial ?? '',
    cif: proveedor.cif ?? '',
    direccion: proveedor.direccion ?? '',
    email: proveedor.email ?? '',
    telefono: proveedor.telefono ?? '',
  }
}

// CONTRATO_HARDENING_A5_A11.md (A10): formulario de alta/edición extraído del layout inline de
// Proveedores.jsx a este componente, para vivir dentro del Drawer -- mismo patrón que
// ClienteForm.jsx/AjusteStockForm.jsx. El componente se desmonta al cerrar el drawer, así que no
// hace falta resetForm(): la próxima apertura es un montaje nuevo con estado fresco.
function ProveedorForm({ proveedor, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'contactos_comun', 'proveedores'])
  const [form, setForm] = useState(estadoInicial(proveedor))
  const [guardando, setGuardando] = useState(false)

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setGuardando(true)

    const { error } = proveedor
      ? await supabase.from('proveedores').update(form).eq('id', proveedor.id)
      : await supabase.from('proveedores').insert(form)

    setGuardando(false)
    if (error) {
      alert(t(proveedor ? 'proveedores:alertas.error_actualizar' : 'proveedores:alertas.error_guardar', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    onGuardado()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label={t('proveedores:tabla.razon_fiscal')}>
        <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} required />
      </Field>
      <Field label={t('proveedores:campos.nombre_comercial')}>
        <Input type="text" value={form.nombre_comercial} onChange={(e) => handleChange('nombre_comercial', e.target.value)} required />
      </Field>
      <Field label={t('contactos_comun:cif')}>
        <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
      </Field>
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
          {guardando ? t('common:actions.saving') : proveedor ? t('proveedores:guardar_cambios') : <><IconPlus size={15} /> {t('proveedores:guardar_proveedor')}</>}
        </Button>
        {onCancelar && <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>}
      </div>
    </form>
  )
}

export default ProveedorForm
