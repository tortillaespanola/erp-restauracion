import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatCantidad } from '../lib/formatCantidad'
import { Button } from './ui'

// CONTRATO_PROPAGACION_RECHAZOS.md, Parte A (Paso 4.4): paso de resolución para un rechazo de
// cliente (origen_rechazo = 'cliente') aún sin resolver (tipo_resolucion is null) -- abono/reenvío/
// descarte, vía la RPC resolver_rechazo_cliente (única mutación no directa de este módulo: crea la
// línea de pedido de reenvío y recalcula pedidos_venta.estado en una sola transacción).
//
// `ajuste`: fila de historial_ajustes_stock (tipo='producto_final') o el registro insertado por
// AjusteStockForm -- solo necesita id, item_nombre, cantidad, unidad, linea_pedido_origen_id.
export default function ResolverRechazoForm({ ajuste, onResuelto, onOmitir }) {
  const { t } = useTranslation(['common', 'ajustes_stock'])
  const [resolviendo, setResolviendo] = useState(false)

  async function resolver(tipoResolucion) {
    setResolviendo(true)
    const { error } = await supabase.rpc('resolver_rechazo_cliente', {
      p_ajuste_id: ajuste.id,
      p_tipo_resolucion: tipoResolucion,
    })
    setResolviendo(false)
    if (error) {
      alert(t('ajustes_stock:rechazo.error_resolver', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.guardado'))
    onResuelto()
  }

  const puedeReenviar = !!ajuste.linea_pedido_origen_id

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-gray-600">
        {t('ajustes_stock:rechazo.pregunta', {
          item: ajuste.item_nombre,
          cantidad: formatCantidad(Math.abs(ajuste.cantidad), ajuste.unidad || ajuste.item_unidad),
          unidad: ajuste.unidad || ajuste.item_unidad || '',
        })}
      </p>
      <div className="flex flex-col gap-2">
        <Button disabled={resolviendo || !puedeReenviar} onClick={() => resolver('reenvio')} title={puedeReenviar ? '' : t('ajustes_stock:rechazo.reenvio_no_disponible')}>
          {t('ajustes_stock:rechazo.reenvio')}
        </Button>
        <Button variant="secondary" disabled={resolviendo} onClick={() => resolver('abono')}>
          {t('ajustes_stock:rechazo.abono')}
        </Button>
        <Button variant="secondary" disabled={resolviendo} onClick={() => resolver('descarte')}>
          {t('ajustes_stock:rechazo.descarte')}
        </Button>
      </div>
      {onOmitir && (
        <button type="button" className="text-xs text-gray-400 hover:text-gray-600 text-left" onClick={onOmitir}>
          {t('ajustes_stock:rechazo.resolver_mas_tarde')}
        </button>
      )}
    </div>
  )
}
