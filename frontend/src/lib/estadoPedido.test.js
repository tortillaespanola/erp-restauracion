import { describe, it, expect } from 'vitest'
import { ESTADOS_PEDIDO_VENTA, ESTADO_BADGE_VENTA, ESTADOS_PEDIDO_COMPRA, ESTADO_BADGE_COMPRA } from './estadoPedido'

// CONTRATO_ESTADO_PARCIAL_PEDIDOS.md: cada estado del enum debe tener badge, y 'parcial' debe
// mostrarse con un color distinto de 'pendiente'/'servido'/'recibido'/'cancelado' -- si no, la UI
// repite el mismo bug que motivó el contrato (parcial indistinguible de pendiente a simple vista).
describe('estadoPedido (venta)', () => {
  it('incluye parcial en el enum', () => {
    expect(ESTADOS_PEDIDO_VENTA).toContain('parcial')
  })

  it('todos los estados tienen badge', () => {
    for (const estado of ESTADOS_PEDIDO_VENTA) expect(ESTADO_BADGE_VENTA[estado]).toBeTruthy()
  })

  it('parcial tiene un color distinto de pendiente, en_produccion, servido y cancelado', () => {
    const otros = ['pendiente', 'en_produccion', 'servido', 'cancelado'].map((e) => ESTADO_BADGE_VENTA[e])
    expect(otros).not.toContain(ESTADO_BADGE_VENTA.parcial)
  })
})

describe('estadoPedido (compra)', () => {
  it('incluye parcial en el enum', () => {
    expect(ESTADOS_PEDIDO_COMPRA).toContain('parcial')
  })

  it('todos los estados tienen badge', () => {
    for (const estado of ESTADOS_PEDIDO_COMPRA) expect(ESTADO_BADGE_COMPRA[estado]).toBeTruthy()
  })

  it('parcial tiene un color distinto de pendiente, recibido y cancelado', () => {
    const otros = ['pendiente', 'recibido', 'cancelado'].map((e) => ESTADO_BADGE_COMPRA[e])
    expect(otros).not.toContain(ESTADO_BADGE_COMPRA.parcial)
  })
})
