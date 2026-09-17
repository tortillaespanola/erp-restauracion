// CONTRATO_AUDITORIA_CANCELACION_PRODUCCION.md: extraído de CancelarProduccionForm.jsx para poder
// testear sin renderizar el formulario (mismo patrón que lib/progresoPedido.js / lib/estadoPedido.js
// en este proyecto) -- las dos reglas de negocio del formulario, aisladas de React/Supabase/i18n.
export const RPC_CANCELAR_PRODUCCION = {
  semielaborado: 'rpc_cancelar_produccion_semielaborado',
  producto_final: 'rpc_cancelar_produccion_producto_final',
}

export function motivoCancelacionValido(motivo) {
  return typeof motivo === 'string' && motivo.trim().length > 0
}
