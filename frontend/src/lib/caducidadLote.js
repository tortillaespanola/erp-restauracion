// CONTRATO_BADGE_CADUCIDAD_LOTES.md (P1-5, Fase 06): no existe ningún umbral de "próximo a
// caducar" en backend -- registrar_incidencia_caducidad_consumo() (20260826) solo compara
// "ya caducado en el momento del consumo/venta" (fecha_caducidad < fecha_destino), sin ninguna
// rama de aviso previo. Se define aquí, como constante única reutilizable en todos los
// selectores de lote de la UI, tal como pide el contrato.
export const DIAS_PROXIMO_CADUCAR = 7

// `fechaCaducidad`/`fechaReferencia`: string ISO 'yyyy-mm-dd' (igual que las columnas fecha_caducidad
// de entrada_material/producciones_*). `fechaReferencia` por defecto es hoy -- páginas con fecha de
// destino propia (venta, consumo) pueden pasarla explícita, igual que ya hace labelLote() en
// Producciones.jsx con fechaDestino.
export function estadoCaducidad(fechaCaducidad, fechaReferencia = new Date().toISOString().slice(0, 10)) {
  if (!fechaCaducidad) return null
  if (fechaCaducidad < fechaReferencia) return 'caducado'
  const limite = new Date(fechaReferencia)
  limite.setDate(limite.getDate() + DIAS_PROXIMO_CADUCAR)
  const limiteIso = limite.toISOString().slice(0, 10)
  if (fechaCaducidad <= limiteIso) return 'proximo'
  return 'normal'
}

export const BADGE_COLOR_CADUCIDAD = {
  caducado: 'red',
  proximo: 'amber',
}

// Días de diferencia entre fechaCaducidad y fechaReferencia (>= 0 solo tiene sentido para 'proximo';
// se expone aparte de estadoCaducidad para no repetir el cálculo de fecha en cada consumidor).
export function diasParaCaducar(fechaCaducidad, fechaReferencia = new Date().toISOString().slice(0, 10)) {
  if (!fechaCaducidad) return null
  const msPorDia = 24 * 60 * 60 * 1000
  const diff = Math.round((new Date(fechaCaducidad) - new Date(fechaReferencia)) / msPorDia)
  return diff
}
