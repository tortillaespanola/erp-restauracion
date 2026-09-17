// CONTRATO_MERMA_RECHAZO_PRODUCCION.md: aislado de React/Supabase para poder testear sin renderizar
// el formulario de cierre (mismo patrón que lib/cancelarProduccion.js) -- la única regla de negocio de
// la merma: motivo obligatorio solo si hay cantidad rechazada (espejo exacto del CHECK
// chk_produccion_semi_motivo_rechazo / chk_produccion_pf_motivo_rechazo, 20261021).
export function motivoRechazoValido(cantidadRechazada, motivoRechazo) {
  const cantidad = parseFloat(cantidadRechazada) || 0
  if (cantidad <= 0) return true
  return typeof motivoRechazo === 'string' && motivoRechazo.trim().length > 0
}
