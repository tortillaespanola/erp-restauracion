import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useOpcionesDependientes } from './useOpcionesDependientes'

// CONTRATO_HARDENING_A1_A4.md (A4): el bug de fondo era de carrera -- dos cambios rápidos del
// padre podían dejar ganar la respuesta más vieja sobre la más nueva. Estos tests reproducen
// exactamente eso con promesas controlables a mano (deferred), en vez de confiar en timers.
function deferido() {
  let resolver
  const promesa = new Promise((resolve) => { resolver = resolve })
  return { promesa, resolver }
}

describe('useOpcionesDependientes', () => {
  it('no llama a cargar cuando la clave es vacía, y deja opciones en valorInicial', () => {
    const cargar = vi.fn()
    const { result } = renderHook(() => useOpcionesDependientes('', cargar, { valorInicial: [] }))
    expect(cargar).not.toHaveBeenCalled()
    expect(result.current.opciones).toEqual([])
    expect(result.current.cargando).toBe(false)
  })

  it('pone cargando=true mientras la petición está en vuelo y la resuelve al terminar', async () => {
    const d = deferido()
    const cargar = vi.fn().mockReturnValue(d.promesa)
    const { result } = renderHook(() => useOpcionesDependientes('proveedor-1', cargar))

    await waitFor(() => expect(result.current.cargando).toBe(true))
    expect(result.current.opciones).toEqual([])

    await act(async () => { d.resolver(['a', 'b']) })

    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.opciones).toEqual(['a', 'b'])
  })

  it('ignora la respuesta de una clave obsoleta si llega después que la de la clave nueva (anti-carrera)', async () => {
    const d1 = deferido()
    const d2 = deferido()
    const cargar = vi.fn((clave) => (clave === 'proveedor-1' ? d1.promesa : d2.promesa))

    const { result, rerender } = renderHook(
      ({ clave }) => useOpcionesDependientes(clave, cargar),
      { initialProps: { clave: 'proveedor-1' } }
    )

    rerender({ clave: 'proveedor-2' })

    // La petición vieja (proveedor-1) resuelve DESPUÉS que la nueva -- sin cancelación, esto
    // pisaría el resultado correcto de proveedor-2 con el catálogo obsoleto de proveedor-1.
    await act(async () => { d2.resolver(['articulo-de-proveedor-2']) })
    await waitFor(() => expect(result.current.opciones).toEqual(['articulo-de-proveedor-2']))

    await act(async () => { d1.resolver(['articulo-de-proveedor-1-obsoleto']) })

    expect(result.current.opciones).toEqual(['articulo-de-proveedor-2'])
  })

  it('resetea opciones a valorInicial en cuanto cambia la clave, antes de que llegue la nueva respuesta', async () => {
    const d1 = deferido()
    const cargar = vi.fn().mockReturnValue(d1.promesa)
    const { result, rerender } = renderHook(
      ({ clave }) => useOpcionesDependientes(clave, cargar, { valorInicial: [] }),
      { initialProps: { clave: 'proveedor-1' } }
    )
    await act(async () => { d1.resolver(['x']) })
    await waitFor(() => expect(result.current.opciones).toEqual(['x']))

    const d2 = deferido()
    cargar.mockReturnValue(d2.promesa)
    rerender({ clave: 'proveedor-2' })

    // Antes de que d2 resuelva, las opciones ya no deben mostrar el catálogo del proveedor anterior.
    expect(result.current.opciones).toEqual([])
  })

  it('onClaveCambia se invoca al cambiar la clave pero NUNCA en el montaje inicial', async () => {
    const onClaveCambia = vi.fn()
    const cargar = vi.fn().mockResolvedValue([])
    const { rerender } = renderHook(
      ({ clave }) => useOpcionesDependientes(clave, cargar, { onClaveCambia }),
      { initialProps: { clave: 'proveedor-1' } }
    )
    expect(onClaveCambia).not.toHaveBeenCalled()

    rerender({ clave: 'proveedor-2' })
    expect(onClaveCambia).toHaveBeenCalledWith('proveedor-2', 'proveedor-1')
  })

  it('un error en cargar deja opciones en valorInicial y expone el error, sin dejar cargando=true colgado', async () => {
    const error = new Error('fallo de red')
    const cargar = vi.fn().mockRejectedValue(error)
    const { result } = renderHook(() => useOpcionesDependientes('proveedor-1', cargar, { valorInicial: [] }))

    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.opciones).toEqual([])
    expect(result.current.error).toBe(error)
  })
})
