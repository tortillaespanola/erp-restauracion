// Único punto centralizado de formato de fecha para toda la app. CONTRATO_I18N.md, Fase 0:
// sustituye el split manual de la fecha ISO por Intl.DateTimeFormat, para que el orden
// día/mes/año siga el idioma de interfaz elegido -- ver locale-por-idioma en formatCantidad.js
// (mismo criterio: en-GB, no en-US, para no introducir la ambigüedad mm/dd propia de EEUU en un
// negocio europeo).
import { localeActual } from './formatCantidad'

export function formatFecha(fechaIso) {
  if (!fechaIso) return ''
  // new Date('aaaa-mm-dd') se interpreta en UTC medianoche -- formatearla con timeZone: 'UTC'
  // evita que un huso horario negativo (América) la muestre como el día anterior.
  const fecha = new Date(fechaIso)
  return new Intl.DateTimeFormat(localeActual(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(fecha)
}
