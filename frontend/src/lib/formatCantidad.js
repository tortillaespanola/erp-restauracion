// Formato numérico centralizado para el ERP -- mismo criterio que formatFecha.js (único punto de
// formato, ningún llamador debe formatear un número a mano). Notación europea: punto de miles,
// coma decimal.

// Cantidades/stock/necesidad -- recorta decimales sobrantes en vez de fijarlos siempre a 3: 1.8
// se muestra "1,8" (no "1,800"), 0.005 se muestra "0,005" (mantiene precisión cuando hace falta).
// `unidad === 'ud'` (conteo entero) nunca lleva decimales, cualquier otra unidad (kg, l...)
// admite hasta 3.
export function formatCantidad(valor, unidad) {
  if (valor == null || Number.isNaN(Number(valor))) return ''
  const maximumFractionDigits = unidad === 'ud' ? 0 : 3
  // useGrouping explícito a true: el default 'auto' de es-ES no agrupa números de 4 cifras
  // (da "1234,5" en vez de "1.234,5", solo agrupa desde 5 cifras) -- forzado para que el
  // separador de miles aparezca siempre, no según el número de dígitos.
  return Number(valor).toLocaleString('es-ES', { maximumFractionDigits, useGrouping: true })
}

// Precios (€) -- semántica opuesta a formatCantidad: SIEMPRE 2 decimales fijos (0,85 €, nunca
// "0,8" ni "0,8500 €"), por eso es una función aparte y no un parámetro de tipo en la anterior.
// No incluye el símbolo €, el llamador lo añade según el contexto (€, €/kg, etc.), igual que
// formatCantidad no incluye la unidad.
export function formatPrecio(valor) {
  if (valor == null || Number.isNaN(Number(valor))) return ''
  return Number(valor).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
}
