import { describe, it, expect } from 'vitest'
import { estadoCaducidad, DIAS_PROXIMO_CADUCAR, BADGE_COLOR_CADUCIDAD } from './caducidadLote'

// CONTRATO_BADGE_CADUCIDAD_LOTES.md: los tres estados que debe distinguir el badge en cualquier
// selector de lote (caducado / próximo a caducar / normal), sobre una fecha de referencia fija
// para que el test no dependa de "hoy".
describe('estadoCaducidad', () => {
  const hoy = '2026-09-17'

  it('sin fecha_caducidad no hay badge', () => {
    expect(estadoCaducidad(null, hoy)).toBe(null)
    expect(estadoCaducidad(undefined, hoy)).toBe(null)
  })

  it('fecha anterior a la referencia -> caducado', () => {
    expect(estadoCaducidad('2026-09-16', hoy)).toBe('caducado')
    expect(estadoCaducidad('2026-01-01', hoy)).toBe('caducado')
  })

  it('fecha dentro del umbral (incluido el propio día) -> proximo', () => {
    expect(estadoCaducidad(hoy, hoy)).toBe('proximo')
    expect(estadoCaducidad('2026-09-24', hoy)).toBe('proximo') // hoy + DIAS_PROXIMO_CADUCAR
    expect(DIAS_PROXIMO_CADUCAR).toBe(7)
  })

  it('fecha por delante del umbral -> normal (sin badge)', () => {
    expect(estadoCaducidad('2026-09-25', hoy)).toBe('normal')
    expect(estadoCaducidad('2027-01-01', hoy)).toBe('normal')
  })

  it('caducado y proximo tienen colores de badge distintos', () => {
    expect(BADGE_COLOR_CADUCIDAD.caducado).toBe('red')
    expect(BADGE_COLOR_CADUCIDAD.proximo).toBe('amber')
    expect(BADGE_COLOR_CADUCIDAD.caducado).not.toBe(BADGE_COLOR_CADUCIDAD.proximo)
  })
})
