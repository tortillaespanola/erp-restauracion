// CONTRATO_ESTADO_PARCIAL_PEDIDOS.md: extraído de Pedidos.jsx/PedidosCompra.jsx para poder cubrir
// con un test de regresión (Vitest) que cada valor del enum tenga badge -- mismo patrón que
// progresoPedido.js (CONTRATO_HARDENING_A1_A4.md, A2).
//
// CONTRATO_I18N.md, Fase 0: solo las claves del enum (estables, en español porque así están en la
// BD) viven aquí -- la etiqueta visible se resuelve con t('enums:estado_pedido(_compra).<clave>').

export const ESTADOS_PEDIDO_VENTA = ['pendiente', 'en_produccion', 'parcial', 'servido', 'cancelado']

export const ESTADO_BADGE_VENTA = {
  pendiente: 'gray',
  en_produccion: 'amber',
  parcial: 'blue',
  servido: 'green',
  cancelado: 'red',
}

export const ESTADOS_PEDIDO_COMPRA = ['pendiente', 'parcial', 'recibido', 'cancelado']

export const ESTADO_BADGE_COMPRA = {
  pendiente: 'gray',
  parcial: 'blue',
  recibido: 'green',
  cancelado: 'red',
}
