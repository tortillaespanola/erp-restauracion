import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import '../i18n' // inicializa el singleton global de i18next (mismo patrón que EtiquetaCaducidad.test.jsx)

// Ver mismo comentario en ResolverRechazoForm.test.jsx: no hay cleanup automático configurado
// globalmente en este proyecto.
afterEach(cleanup)

// CONTRATO_PROPAGACION_RECHAZOS.md, Parte C (plan de testing §6.2): "no debe pintar nada si no hay
// ajustes asociados". Se mockea supabase con un query builder encadenable mínimo -- no hay
// precedente de mock de supabase en este repo (el resto de tests son de lógica pura o componentes
// sync), así que se construye aquí el más simple posible: cada método de filtro devuelve el propio
// builder, y `then` lo hace thenable (igual que el PostgrestBuilder real de supabase-js).
function builderQueResuelve(resultado) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    lt: () => builder,
    then: (resolve) => resolve(resultado),
  }
  return builder
}

const fromMock = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}))

const { default: BadgeScrap } = await import('./BadgeScrap')

describe('BadgeScrap', () => {
  it('no pinta nada mientras no hay origenId ni itemId', () => {
    const { container } = render(<BadgeScrap tipo="producto_final" />)
    expect(fromMock).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('no pinta nada si la consulta no devuelve ajustes', async () => {
    fromMock.mockReturnValue(builderQueResuelve({ data: [], error: null }))
    const { container } = render(<BadgeScrap tipo="producto_final" origenId={459} />)
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith('historial_ajustes_stock'))
    expect(container).toBeEmptyDOMElement()
  })

  it('pinta el badge "Scrap declarado" si hay al menos un ajuste asociado', async () => {
    fromMock.mockReturnValue(builderQueResuelve({ data: [{ cantidad: -2, unidad: 'ud' }], error: null }))
    render(<BadgeScrap tipo="producto_final" origenId={459} />)
    expect(await screen.findByText('Scrap declarado')).toBeInTheDocument()
  })

  it('no pinta nada si la consulta devuelve error (no lo disfraza de "sin ajustes" visualmente distinto, pero tampoco rompe)', async () => {
    fromMock.mockReturnValue(builderQueResuelve({ data: null, error: { message: 'boom' } }))
    const { container } = render(<BadgeScrap tipo="producto_final" itemId={196} />)
    await waitFor(() => expect(fromMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
