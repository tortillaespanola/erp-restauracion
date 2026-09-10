import { describe, it, expect } from 'vitest'
import { calcularProgresoPedido } from './progresoPedido'

// CONTRATO_HARDENING_A1_A4.md (A2): tests de regresión mínimos pedidos en el contrato -- 0%
// servido, parcialmente servido, 100% servido, pedido cancelado, pedido nuevo, pedido sin líneas.
function lineaConCobertura(cantidad, cantidadServida) {
  return {
    cantidad,
    lineas_albaran_venta: cantidadServida > 0 ? [{ cantidad: cantidadServida }] : [],
    previsiones_distribucion_pf: [],
  }
}

describe('calcularProgresoPedido', () => {
  it('0% servido (pendiente, ninguna línea cubierta)', () => {
    const pedido = { estado: 'pendiente', lineas_pedido_venta: [lineaConCobertura(4, 0), lineaConCobertura(3, 0)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 2, lineasServidas: 0, algunaConAvisoStock: false })
  })

  it('parcialmente servido (en_produccion, una línea cubierta de dos)', () => {
    const pedido = { estado: 'en_produccion', lineas_pedido_venta: [lineaConCobertura(4, 4), lineaConCobertura(3, 0)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 2, lineasServidas: 1, algunaConAvisoStock: false })
  })

  it('100% servido con cobertura real completa (estado ya reflejaría esto igualmente)', () => {
    const pedido = { estado: 'servido', lineas_pedido_venta: [lineaConCobertura(4, 4), lineaConCobertura(3, 3)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 2, lineasServidas: 2, algunaConAvisoStock: false })
  })

  // El caso que motivó A2: histórico demo con estado='servido' pero sin lineas_albaran_venta real
  // (linea_pedido_id nunca vinculado, ver scripts/demo-catering/poblar.mjs). Antes del fix, esto
  // daba lineasServidas=0 junto a una badge "Servido" -- contradicción visual sin corrupción de
  // datos real detrás. El fix hace que el estado de cabecera mande para pedidos servidos.
  it('servido sin lineas_albaran_venta real (histórico demo) -- no debe mostrar 0/N', () => {
    const pedido = { estado: 'servido', lineas_pedido_venta: [lineaConCobertura(4, 0), lineaConCobertura(3, 0)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 2, lineasServidas: 2, algunaConAvisoStock: false })
  })

  it('pedido cancelado a medio servir -- SÍ debe reflejar la cobertura real, no es una contradicción', () => {
    const pedido = { estado: 'cancelado', lineas_pedido_venta: [lineaConCobertura(4, 4), lineaConCobertura(3, 0)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 2, lineasServidas: 1, algunaConAvisoStock: false })
  })

  it('pedido nuevo (pendiente, recién creado, cobertura 0 en todas las líneas)', () => {
    const pedido = { estado: 'pendiente', lineas_pedido_venta: [lineaConCobertura(1, 0)] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 1, lineasServidas: 0, algunaConAvisoStock: false })
  })

  it('pedido sin líneas', () => {
    const pedido = { estado: 'pendiente', lineas_pedido_venta: [] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 0, lineasServidas: 0, algunaConAvisoStock: false })
  })

  it('pedido servido sin líneas (caso límite, no debería crashear)', () => {
    const pedido = { estado: 'servido', lineas_pedido_venta: [] }
    expect(calcularProgresoPedido(pedido)).toEqual({ totalLineas: 0, lineasServidas: 0, algunaConAvisoStock: false })
  })

  it('aviso de stock insuficiente cuando una previsión supera el disponible neto de su tanda', () => {
    const pedido = {
      estado: 'pendiente',
      lineas_pedido_venta: [{
        cantidad: 5,
        lineas_albaran_venta: [],
        previsiones_distribucion_pf: [{ produccion_pf_id: 'tanda-1', cantidad_prevista: 5 }],
      }],
    }
    const stockPorProduccionId = new Map([['tanda-1', 2]])
    const sumaPrevistoPorProduccionId = new Map([['tanda-1', 5]])
    expect(calcularProgresoPedido(pedido, stockPorProduccionId, sumaPrevistoPorProduccionId).algunaConAvisoStock).toBe(true)
  })

  it('sin aviso de stock si el disponible neto de la tanda cubre lo previsto', () => {
    const pedido = {
      estado: 'pendiente',
      lineas_pedido_venta: [{
        cantidad: 5,
        lineas_albaran_venta: [],
        previsiones_distribucion_pf: [{ produccion_pf_id: 'tanda-1', cantidad_prevista: 5 }],
      }],
    }
    const stockPorProduccionId = new Map([['tanda-1', 10]])
    const sumaPrevistoPorProduccionId = new Map([['tanda-1', 5]])
    expect(calcularProgresoPedido(pedido, stockPorProduccionId, sumaPrevistoPorProduccionId).algunaConAvisoStock).toBe(false)
  })
})
