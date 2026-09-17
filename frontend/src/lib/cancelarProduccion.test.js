import { describe, it, expect } from 'vitest'
import { RPC_CANCELAR_PRODUCCION, motivoCancelacionValido } from './cancelarProduccion'

describe('motivoCancelacionValido', () => {
  it('acepta un motivo con texto', () => {
    expect(motivoCancelacionValido('cliente canceló el pedido')).toBe(true)
  })

  it('rechaza un motivo vacío', () => {
    expect(motivoCancelacionValido('')).toBe(false)
  })

  it('rechaza un motivo solo con espacios', () => {
    expect(motivoCancelacionValido('   ')).toBe(false)
  })

  it('rechaza null y undefined', () => {
    expect(motivoCancelacionValido(null)).toBe(false)
    expect(motivoCancelacionValido(undefined)).toBe(false)
  })
})

describe('RPC_CANCELAR_PRODUCCION', () => {
  it('define un RPC para semielaborado y otro para producto_final', () => {
    expect(RPC_CANCELAR_PRODUCCION.semielaborado).toBe('rpc_cancelar_produccion_semielaborado')
    expect(RPC_CANCELAR_PRODUCCION.producto_final).toBe('rpc_cancelar_produccion_producto_final')
  })

  it('apunta a RPCs distintos para cada tipo -- una producción no debe poder cancelar la del otro tipo', () => {
    expect(RPC_CANCELAR_PRODUCCION.semielaborado).not.toBe(RPC_CANCELAR_PRODUCCION.producto_final)
  })
})
