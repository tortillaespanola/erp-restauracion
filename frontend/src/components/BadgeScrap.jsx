import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatCantidad } from '../lib/formatCantidad'
import { Badge } from './ui'

// CONTRATO_PROPAGACION_RECHAZOS.md, Parte C: badge reutilizable de "scrap declarado" -- consulta
// historial_ajustes_stock filtrando por lote/tanda (`origenId`, la producción o entrada de material
// concreta -- Producciones.jsx, ProduccionProductosFinales.jsx, AlbaranesVenta.jsx) o por ítem
// (`itemId`, el producto en conjunto -- PedidosDelDia.jsx, donde la necesidad se neta a nivel de
// producto entre todos sus lotes, no de un lote concreto). Solo uno de los dos, nunca ambos.
//
// Solo cuenta ajustes negativos (cantidad < 0): una fila con cantidad positiva es una corrección al
// alza (ej. stock encontrado), no "scrap". No filtra por origen_rechazo -- una merma interna
// (caducidad, rotura) es scrap igual que un rechazo de cliente, y así lo pedía el contrato ("Scrap
// declarado", no "Rechazo de cliente declarado").
export default function BadgeScrap({ tipo, origenId = null, itemId = null }) {
  const { t } = useTranslation('common')
  const [ajustes, setAjustes] = useState(null)

  useEffect(() => {
    let cancelado = false
    if (origenId == null && itemId == null) {
      setAjustes([])
      return
    }
    async function cargar() {
      let query = supabase
        .from('historial_ajustes_stock')
        .select('cantidad, unidad')
        .eq('tipo', tipo)
        .lt('cantidad', 0)
      query = origenId != null ? query.eq('origen_id', origenId) : query.eq('item_id', itemId)
      const { data, error } = await query
      if (!cancelado) setAjustes(error ? [] : data || [])
    }
    cargar()
    return () => { cancelado = true }
  }, [tipo, origenId, itemId])

  if (!ajustes || ajustes.length === 0) return null

  const totalCantidad = ajustes.reduce((acc, a) => acc + Math.abs(Number(a.cantidad)), 0)
  const unidad = ajustes[0]?.unidad || ''

  return (
    <span title={t('badge_scrap.tooltip', { count: ajustes.length, cantidad: formatCantidad(totalCantidad, unidad), unidad })}>
      <Badge color="red">{t('badge_scrap.etiqueta')}</Badge>
    </span>
  )
}
