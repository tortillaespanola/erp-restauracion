import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { Badge } from './ui'

// CONTRATO_AJUSTES_RECHAZO_CLIENTE.md, Fase 2: distingue, junto al lote o al producto, un stock
// negativo por un rechazo de cliente TODAVÍA sin resolver (abono/reenvío/descarte) de un stock
// negativo por cualquier otra causa (posible error de datos real, a revisar aparte) -- mismo
// patrón de consulta que BadgeScrap.jsx (origenId = lote concreto, itemId = producto agregado,
// nunca ambos), acotado a origen_rechazo='cliente' y tipo_resolucion IS NULL. Solo tipo
// 'producto_final': es la única tabla con estas columnas (CONTRATO_PROPAGACION_RECHAZOS.md, §7 --
// ajustes_semielaborado nunca tiene linea_pedido_origen_id/tipo_resolucion), así que a diferencia
// de BadgeScrap no hace falta parámetro `tipo`.
export default function BadgeRechazoPendiente({ origenId = null, itemId = null }) {
  const { t } = useTranslation('common')
  const [pendientes, setPendientes] = useState(null)

  useEffect(() => {
    let cancelado = false
    if (origenId == null && itemId == null) {
      setPendientes([])
      return
    }
    async function cargar() {
      let query = supabase
        .from('historial_ajustes_stock')
        .select('cantidad')
        .eq('tipo', 'producto_final')
        .eq('origen_rechazo', 'cliente')
        .is('tipo_resolucion', null)
      query = origenId != null ? query.eq('origen_id', origenId) : query.eq('item_id', itemId)
      const { data, error } = await query
      if (!cancelado) setPendientes(error ? [] : data || [])
    }
    cargar()
    return () => { cancelado = true }
  }, [origenId, itemId])

  if (!pendientes || pendientes.length === 0) return null

  return (
    <span title={t('badge_rechazo_pendiente.tooltip', { count: pendientes.length })}>
      <Badge color="amber">{t('badge_rechazo_pendiente.etiqueta')}</Badge>
    </span>
  )
}
