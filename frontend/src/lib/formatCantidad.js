import i18n from '../i18n'

// Formato numérico centralizado para el ERP -- mismo criterio que formatFecha.js (único punto de
// formato, ningún llamador debe formatear un número a mano).
//
// CONTRATO_I18N.md, Fase 0: el locale de FORMATO (separador decimal/miles, orden) sigue el idioma
// de interfaz de quien mira la pantalla -- no es lo mismo que la moneda real del negocio (ver
// formatMoneda más abajo), que es un dato de empresa_config.moneda independiente del idioma.
// de-CH (no de-DE) a propósito: el negocio opera en Suiza y de-CH agrupa con apóstrofo
// (1'234.56), la convención que ven realmente los usuarios suizos -- de-DE daría 1.234,56, una
// coma decimal que no usan aquí. en-GB (no en-US) por el mismo motivo que se fijó dd/mm/aaaa para
// fechas en inglés: coherencia con un negocio europeo.
const LOCALE_POR_IDIOMA = { es: 'es-ES', en: 'en-GB', de: 'de-CH' }

export function localeActual() {
  return LOCALE_POR_IDIOMA[i18n.language] || LOCALE_POR_IDIOMA.es
}

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
  return Number(valor).toLocaleString(localeActual(), { maximumFractionDigits, useGrouping: true })
}

// Moneda -- consolida todos los sitios que antes concatenaban " €" o " CHF" a mano (bug real:
// varios mezclaban € heredado de una plantilla inicial con CHF, la moneda correcta del negocio).
// `moneda` es un hecho de negocio (empresa_config.moneda), no depende del idioma de interfaz --
// solo el formato (posición del código, separador) sigue el locale de quien mira la pantalla.
export function formatMoneda(valor, moneda = 'CHF') {
  if (valor == null || Number.isNaN(Number(valor))) return ''
  return new Intl.NumberFormat(localeActual(), { style: 'currency', currency: moneda }).format(Number(valor))
}
