// CONTRATO_HARDENING_A1_A4.md (A2): extraído de Pedidos.jsx para poder cubrirlo con tests de
// regresión reales (Vitest) sin montar el componente entero -- antes vivía como función local
// cerrando sobre el estado de React (stockPorProduccionId/sumaPrevistoPorProduccionId), ahora los
// recibe como parámetros (Map, igual que antes; ausentes por defecto para las llamadas que no los
// necesitan). Misma lógica, sin cambio de comportamiento.
//
// Un pedido 'servido' es siempre el resultado del trigger actualizar_estado_pedido_por_servicio(),
// que solo pone ese estado cuando TODAS las líneas están cubiertas por lineas_albaran_venta reales
// -- para datos generados por el flujo normal, este cálculo por línea y el estado de cabecera nunca
// pueden discrepar. La única fuente de discrepancia encontrada en la auditoría fue el histórico del
// negocio demo (scripts/demo-catering/poblar.mjs), que fuerza estado='servido' a mano sin generar
// lineas_albaran_venta (decisión deliberada y documentada ahí) -- eso hacía que este cálculo diera
// "0/N servidas" junto a una badge "Servido", una contradicción visual sin ningún dato realmente
// corrupto detrás. Cabecera y detalle no deben tener dos fuentes de verdad independientes: para un
// pedido servido, el estado de cabecera manda y el resumen se da por completo sin recontar líneas.
// 'cancelado' no entra en este atajo: un pedido cancelado a medio servir sí puede tener menos líneas
// servidas que el total, y eso es información real, no una contradicción.
export function calcularProgresoPedido(p, stockPorProduccionId = new Map(), sumaPrevistoPorProduccionId = new Map()) {
  if (p.estado === 'servido') {
    return { totalLineas: p.lineas_pedido_venta.length, lineasServidas: p.lineas_pedido_venta.length, algunaConAvisoStock: false }
  }

  let lineasServidas = 0
  let algunaConAvisoStock = false
  for (const linea of p.lineas_pedido_venta) {
    const servido = (linea.lineas_albaran_venta || []).reduce((sum, l) => sum + Number(l.cantidad), 0)
    if (servido >= linea.cantidad) lineasServidas++

    const previsiones = linea.previsiones_distribucion_pf || []
    const tieneAvisoStock = previsiones
      .filter((pd) => pd.produccion_pf_id != null && Number(pd.cantidad_prevista) > 0)
      .some((pd) => {
        const cantidadPd = Number(pd.cantidad_prevista)
        const stockTanda = stockPorProduccionId.get(pd.produccion_pf_id)
        const sumaOtras = (sumaPrevistoPorProduccionId.get(pd.produccion_pf_id) || 0) - cantidadPd
        const disponibleNeto = stockTanda != null ? stockTanda - sumaOtras : null
        return disponibleNeto != null && disponibleNeto < cantidadPd
      })
    if (tieneAvisoStock) algunaConAvisoStock = true
  }

  return { totalLineas: p.lineas_pedido_venta.length, lineasServidas, algunaConAvisoStock }
}
