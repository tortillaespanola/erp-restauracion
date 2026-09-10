import { describe, it, expect, beforeEach } from 'vitest'
import i18n from '../i18n'
import { formatCantidad, parseCantidad } from './formatCantidad'

// CONTRATO_HARDENING_A1_A4.md (A3): matriz de test exacta pedida en el contrato -- ES/EN/DE x
// {1, 1.5, 10, 1000, 10000, 1000.5, 12345.67} -- más el caso literal del bug descrito
// (parseFloat("50.000") daba 50 en vez de 50000, factor 1000 por leer el punto de miles de es-ES
// como decimal).
const VALORES = [1, 1.5, 10, 1000, 10000, 1000.5, 12345.67]
const IDIOMAS = ['es', 'en', 'de']

describe('formatCantidad / parseCantidad', () => {
  for (const idioma of IDIOMAS) {
    describe(`locale ${idioma}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(idioma)
      })

      for (const valor of VALORES) {
        it(`round-trip de ${valor}`, () => {
          const formateado = formatCantidad(valor)
          const vueltaAtras = parseCantidad(formateado)
          expect(vueltaAtras).toBeCloseTo(valor, 9)
        })
      }
    })
  }

  it('caso literal del contrato: "50.000" - "1.000" en es-ES da 49000, no 49', async () => {
    await i18n.changeLanguage('es')
    const cincuentaMil = parseCantidad('50.000')
    const mil = parseCantidad('1.000')
    expect(cincuentaMil).toBe(50000)
    expect(mil).toBe(1000)
    expect(cincuentaMil - mil).toBe(49000)
  })

  it('parseCantidad de texto vacío o null da null, no NaN', async () => {
    await i18n.changeLanguage('es')
    expect(parseCantidad('')).toBeNull()
    expect(parseCantidad('   ')).toBeNull()
    expect(parseCantidad(null)).toBeNull()
    expect(parseCantidad(undefined)).toBeNull()
  })

  it('parseCantidad de texto no numérico da null', async () => {
    await i18n.changeLanguage('es')
    expect(parseCantidad('abc')).toBeNull()
  })
})
