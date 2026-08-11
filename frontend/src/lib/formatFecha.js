// Único punto centralizado de formato de fecha para toda la app — ver
// MEJORAS_UI_PENDIENTES.md entrada #7. Si algún día hace falta un formato
// distinto por negocio, el cambio se contiene aquí (ningún llamador debe
// formatear una fecha a mano).
export const FORMATO_FECHA = 'dd/mm/aaaa'

export function formatFecha(fechaIso) {
  if (!fechaIso) return ''
  const [y, m, d] = fechaIso.split('-')
  return `${d}/${m}/${y}`
}
