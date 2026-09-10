import { describe, it, expect, vi } from 'vitest'
import { seleccionarAlEnfocar, evitarColapsoDeSeleccion } from './seleccionAlEnfocar'

// CONTRATO_HARDENING_A5_A11.md (A7): verificado contra Chromium real (no jsdom) que .select() no
// lanza en <input type="number"> y sí reemplaza el valor al escribir tras un click en medio del
// texto, aunque selectionStart/selectionEnd reporten null para ese tipo de input (comportamiento
// de spec). Estos tests cubren la lógica de justFocused vía funciones planas, sin montar React.
function crearInputNumerico(valor) {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = valor
  document.body.appendChild(input)
  return input
}

describe('seleccionarAlEnfocar / evitarColapsoDeSeleccion', () => {
  it('selecciona todo el contenido al enfocar (no lanza en type=number)', () => {
    const input = crearInputNumerico('3.2320')
    const selectSpy = vi.spyOn(input, 'select')
    expect(() => seleccionarAlEnfocar({ target: input })).not.toThrow()
    expect(selectSpy).toHaveBeenCalledTimes(1)
  })

  it('evita que el mouseup que dio el foco colapse la selección', () => {
    const input = crearInputNumerico('3.2320')
    seleccionarAlEnfocar({ target: input })
    const preventDefault = vi.fn()
    evitarColapsoDeSeleccion({ target: input, preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('un segundo click con el campo ya enfocado NO bloquea el mouseup (permite corregir un dígito)', () => {
    const input = crearInputNumerico('3.2320')
    seleccionarAlEnfocar({ target: input })
    evitarColapsoDeSeleccion({ target: input, preventDefault: vi.fn() })

    const preventDefault2 = vi.fn()
    evitarColapsoDeSeleccion({ target: input, preventDefault: preventDefault2 })
    expect(preventDefault2).not.toHaveBeenCalled()
  })

  it('no interfiere con un input que nunca pasó por seleccionarAlEnfocar', () => {
    const input = crearInputNumerico('1')
    const preventDefault = vi.fn()
    evitarColapsoDeSeleccion({ target: input, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
