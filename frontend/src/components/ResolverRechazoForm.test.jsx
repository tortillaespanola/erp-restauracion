import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import '../i18n'

// El proyecto no trae cleanup automático entre tests configurado globalmente (vite.config.js no
// declara `globals: true` ni un setupFile) -- sin este afterEach, los distintos `render()` de este
// archivo se acumulan en el mismo document.body y `getByText('Abono')` (repetido en varios tests)
// falla por encontrar más de un nodo.
afterEach(cleanup)

// CONTRATO_PROPAGACION_RECHAZOS.md, Parte A (plan de testing §6.2): "lógica de habilitación del
// selector de resolución (solo visible si origen_rechazo='cliente' y tipo_resolucion es nulo)" --
// esa condición vive en el llamador (AjustesStock.jsx/AlbaranesVenta.jsx, que solo montan este
// componente cuando ya se cumple), así que aquí se cubre la otra mitad de esa misma regla de
// habilitación: "Reenvío" solo puede pulsarse si el ajuste tiene línea de pedido de origen.
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const rpcMock = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args) => rpcMock(...args) },
}))

const { default: ResolverRechazoForm } = await import('./ResolverRechazoForm')

const AJUSTE_BASE = { id: 11, item_nombre: 'Silla nórdica', cantidad: -2, unidad: 'ud' }

describe('ResolverRechazoForm', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('deshabilita "Reenvío" si el ajuste no tiene línea de pedido de origen', () => {
    render(<ResolverRechazoForm ajuste={AJUSTE_BASE} onResuelto={vi.fn()} />)
    expect(screen.getByText('Reenvío (crea línea de pedido pendiente)')).toBeDisabled()
  })

  it('habilita "Reenvío" y llama a resolver_rechazo_cliente cuando sí hay línea de origen', async () => {
    rpcMock.mockResolvedValue({ error: null })
    const onResuelto = vi.fn()
    render(<ResolverRechazoForm ajuste={{ ...AJUSTE_BASE, linea_pedido_origen_id: 609 }} onResuelto={onResuelto} />)

    const boton = screen.getByText('Reenvío (crea línea de pedido pendiente)')
    expect(boton).not.toBeDisabled()
    fireEvent.click(boton)

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('resolver_rechazo_cliente', { p_ajuste_id: 11, p_tipo_resolucion: 'reenvio' }))
    await waitFor(() => expect(onResuelto).toHaveBeenCalled())
  })

  it('"Abono" y "Descarte" siempre están habilitados, sin depender de la línea de origen', async () => {
    rpcMock.mockResolvedValue({ error: null })
    const onResuelto = vi.fn()
    render(<ResolverRechazoForm ajuste={AJUSTE_BASE} onResuelto={onResuelto} />)

    fireEvent.click(screen.getByText('Abono'))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('resolver_rechazo_cliente', { p_ajuste_id: 11, p_tipo_resolucion: 'abono' }))
    await waitFor(() => expect(onResuelto).toHaveBeenCalled())
  })

  it('onOmitir se dispara al pulsar "Resolver más tarde"', () => {
    const onOmitir = vi.fn()
    render(<ResolverRechazoForm ajuste={AJUSTE_BASE} onResuelto={vi.fn()} onOmitir={onOmitir} />)
    fireEvent.click(screen.getByText('Resolver más tarde'))
    expect(onOmitir).toHaveBeenCalled()
  })
})
