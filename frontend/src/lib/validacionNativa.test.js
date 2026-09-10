import { describe, it, expect, beforeEach } from 'vitest'
import i18n from '../i18n'
import { mensajeValidacionNativa } from './validacionNativa'

// CONTRATO_HARDENING_A5_A11.md (A6): los popups de validación nativa (required, min/max, tipo
// numérico inválido) salían en inglés del navegador pese a que la interfaz soporta ES/EN/DE.
// `t` real de i18next (namespace common) para probar las tres traducciones, no solo la lógica de
// qué mensaje elegir.
function validezFalsa(campo, extra = {}) {
  return {
    validity: { valid: false, valueMissing: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, tooShort: false, tooLong: false, patternMismatch: false, typeMismatch: false, badInput: false, [campo]: true },
    validationMessage: 'fallback nativo',
    ...extra,
  }
}

describe('mensajeValidacionNativa', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es')
  })

  it('devuelve vacío si el campo es válido', () => {
    const target = { validity: { valid: true } }
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('')
  })

  it('campo obligatorio vacío', () => {
    const target = validezFalsa('valueMissing')
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('Este campo es obligatorio')
  })

  it('valor por debajo del mínimo interpola el min real del elemento', () => {
    const target = validezFalsa('rangeUnderflow', { min: '5' })
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('El valor debe ser mayor o igual a 5')
  })

  it('valor por encima del máximo interpola el max real del elemento', () => {
    const target = validezFalsa('rangeOverflow', { max: '100' })
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('El valor debe ser menor o igual a 100')
  })

  it('tipo numérico inválido (badInput)', () => {
    const target = validezFalsa('badInput')
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('El valor introducido no es válido')
  })

  it('en inglés (en-GB en el select del idioma) devuelve el mensaje en inglés', async () => {
    await i18n.changeLanguage('en')
    const target = validezFalsa('valueMissing')
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('This field is required')
  })

  it('en alemán devuelve el mensaje en alemán', async () => {
    await i18n.changeLanguage('de')
    const target = validezFalsa('valueMissing')
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('Dieses Feld ist erforderlich')
  })

  it('cae al validationMessage nativo si no reconoce ninguna bandera de validity', () => {
    const target = { validity: { valid: false }, validationMessage: 'mensaje nativo sin traducir' }
    expect(mensajeValidacionNativa(target, i18n.t)).toBe('mensaje nativo sin traducir')
  })
})
