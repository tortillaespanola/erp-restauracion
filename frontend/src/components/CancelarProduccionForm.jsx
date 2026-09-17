import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { RPC_CANCELAR_PRODUCCION, motivoCancelacionValido } from '../lib/cancelarProduccion'
import { Field, Input, Button } from './ui'

// CONTRATO_AUDITORIA_CANCELACION_PRODUCCION.md: formulario compartido entre Producciones.jsx
// (semielaborado) y ProduccionProductosFinales.jsx (producto final) -- mismo patrón de "formulario
// inline antes de una mutación" que AjusteStockForm.jsx, con un único campo obligatorio (motivo).
// Llama a rpc_cancelar_produccion_semielaborado/_producto_final (20261020), que hace el soft-cancel
// (estado='cancelada' + motivo/usuario/fecha) y revierte el consumo propio de la producción -- ya no
// se llama a .delete() desde aquí.
export default function CancelarProduccionForm({ tipo, produccionId, onCancelado, onCerrar }) {
  const { t } = useTranslation(['common', 'produccion_comun'])
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!motivoCancelacionValido(motivo)) {
      alert(t('produccion_comun:cancelar_form.motivo_obligatorio'))
      return
    }

    setGuardando(true)
    const { error } = await supabase.rpc(RPC_CANCELAR_PRODUCCION[tipo], { p_id: produccionId, p_motivo: motivo.trim() })
    setGuardando(false)

    if (error) {
      alert(t('produccion_comun:alertas.error_cancelar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.cancelado'))
    onCancelado()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">{t('produccion_comun:cancelar_form.aviso')}</p>
      <Field label={t('produccion_comun:cancelar_form.motivo_label')}>
        <Input
          type="text"
          placeholder={t('produccion_comun:cancelar_form.motivo_placeholder')}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={guardando}>
          {guardando ? t('common:actions.saving') : t('produccion_comun:cancelar_form.confirmar')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCerrar} disabled={guardando}>
          {t('common:actions.cancel')}
        </Button>
      </div>
    </form>
  )
}
