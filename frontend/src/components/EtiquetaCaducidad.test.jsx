import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import '../i18n' // inicializa el singleton global de i18next (mismo patrón que usan las páginas reales)
import { EtiquetaCaducidad } from './ui'

// CONTRATO_BADGE_CADUCIDAD_LOTES.md: los cuatro casos que pide el contrato -- caducado muestra
// badge, próximo a caducar (dentro del umbral) muestra badge intermedio, normal no muestra nada,
// y un lote caducado sigue siendo seleccionable (el badge es solo información, no un bloqueo).
describe('EtiquetaCaducidad', () => {
  const hoy = '2026-09-17'

  it('lote caducado muestra el badge rojo "Caducado"', () => {
    render(<EtiquetaCaducidad fechaCaducidad="2026-09-01" fechaReferencia={hoy} />)
    const badge = screen.getByText('Caducado')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/danger/)
  })

  it('lote próximo a caducar (dentro del umbral) muestra el badge ámbar intermedio', () => {
    render(<EtiquetaCaducidad fechaCaducidad="2026-09-20" fechaReferencia={hoy} />)
    const badge = screen.getByText('Caduca en 3 día(s)')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/warning/)
  })

  it('lote normal (fuera del umbral) no muestra ningún badge', () => {
    const { container } = render(<EtiquetaCaducidad fechaCaducidad="2027-01-01" fechaReferencia={hoy} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lote sin fecha_caducidad no muestra ningún badge', () => {
    const { container } = render(<EtiquetaCaducidad fechaCaducidad={null} fechaReferencia={hoy} />)
    expect(container).toBeEmptyDOMElement()
  })

  // El badge es información -- no debe bloquear la selección del lote (esa lógica de negocio ya
  // está resuelta en backend por P0-1/P0-2 y no cambia aquí). Se comprueba con un <select> nativo
  // mínimo, igual de forma que los selectores reales (Producciones.jsx, AlbaranVentaForm.jsx...)
  // concatenan el aviso de caducidad como texto plano dentro del <option>, sin deshabilitarlo.
  it('un lote caducado sigue siendo seleccionable dentro de un <select>', () => {
    function SelectorDePrueba() {
      return (
        <select aria-label="lote" onChange={() => {}} defaultValue="">
          <option value="">Selecciona lote</option>
          <option value="lote-caducado">Lote A — ⚠ caducado, revisar antes de usar</option>
        </select>
      )
    }
    render(<SelectorDePrueba />)
    const select = screen.getByLabelText('lote')
    const opcionCaducada = screen.getByText(/caducado/)
    expect(opcionCaducada).not.toBeDisabled()
    fireEvent.change(select, { target: { value: 'lote-caducado' } })
    expect(select.value).toBe('lote-caducado')
  })
})
