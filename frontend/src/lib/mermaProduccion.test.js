import { describe, it, expect } from 'vitest'
import { motivoRechazoValido } from './mermaProduccion'

describe('motivoRechazoValido', () => {
  it('sin rechazo (0 o vacío) no exige motivo', () => {
    expect(motivoRechazoValido(0, '')).toBe(true)
    expect(motivoRechazoValido('', '')).toBe(true)
    expect(motivoRechazoValido(null, null)).toBe(true)
  })

  it('con rechazo > 0 exige motivo con texto', () => {
    expect(motivoRechazoValido(2, 'pieza defectuosa')).toBe(true)
  })

  it('con rechazo > 0 y motivo vacío o solo espacios, falla', () => {
    expect(motivoRechazoValido(2, '')).toBe(false)
    expect(motivoRechazoValido(2, '   ')).toBe(false)
    expect(motivoRechazoValido(2, null)).toBe(false)
    expect(motivoRechazoValido(2, undefined)).toBe(false)
  })

  it('rechazo negativo no exige motivo aquí -- lo bloquea el CHECK >= 0 de la base de datos, no esta regla', () => {
    expect(motivoRechazoValido(-1, '')).toBe(true)
  })
})
