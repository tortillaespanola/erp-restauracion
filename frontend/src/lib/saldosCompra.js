// CONTRATO_PAGOS_COMPRA.md, sección 3 y 4.1: espejo exacto de saldosVenta.js -- misma fórmula
// ("mirar hacia abajo", total menos lo realmente aplicado, pago anulado nunca cuenta), mismas
// funciones exportadas, solo cambian los nombres de tabla/columna (factura_compra_id/
// albaran_compra_id en vez de factura_venta_id/albaran_venta_id). Sin lógica de negocio nueva.
//
// Ningún saldo se persiste (CONTRATO_PAGOS_COMPRA.md sección 2.2, mismo criterio que Venta):
// siempre total menos lo realmente aplicado, calculado al vuelo contra pago_aplicacion. Un pago
// anulado nunca cuenta -- se filtra aquí mismo, en el único sitio donde se suma "lo aplicado",
// para que ningún llamador tenga que acordarse de excluirlo por su cuenta.
import { supabase } from './supabase'

// Tolerancia de redondeo en CHF para comparaciones de monto -- misma constante que saldosVenta.js
// (no se importa de allí a propósito: este módulo es un espejo autocontenido, sin lógica de venta
// mezclada).
export const EPSILON = 0.005

// Badge de estado de pago. A diferencia de estadoPago() en saldosVenta.js (que solo conoce
// pagada/parcial/pendiente porque facturas_venta.total nunca es NULL), esta versión distingue
// también 'sin_total': facturas_compra.total SÍ es nullable (campo manual, ver
// CONTRATO_DRAWERS_COMPRAS.md sección 3) -- sin este guard, una factura sin total informado daba
// `saldo <= EPSILON` con saldo=0 (Number(null)=0 menos lo aplicado) y se devolvía 'pagada' por
// error, indistinguible de una factura genuinamente saldada. El valor 'sin_total' coincide
// literalmente con el que ya calcula la columna estado_pago de facturas_compra_con_saldo (misma
// clasificación, no una nueva) -- para albaranes de compra (total siempre calculado desde líneas,
// nunca NULL) este caso no se da nunca, la función se comporta igual que antes.
//
// 'anulada' NO se resuelve aquí -- mismo criterio que saldosVenta.js: el llamador comprueba
// `anulada` por su cuenta antes de llamar a esta función (o, para facturas de compra, lee
// `estado_pago` directamente de facturas_compra_con_saldo, que ya resuelve las 5 clasificaciones
// sin pasar por esta función en absoluto).
export function estadoPago(saldo, total) {
  if (total == null) return 'sin_total'
  if (saldo <= EPSILON) return 'pagada'
  if (saldo >= Number(total) - EPSILON) return 'pendiente'
  return 'parcial'
}

// Total de un albarán de compra a partir de sus líneas (entrada_material, no lineas_albaran_venta
// -- Compra no tiene una tabla de líneas separada, entrada_material ES la línea). Misma fórmula
// que totalesPorAlbaran() de saldosVenta.js, en batch para un conjunto de albaranes.
async function totalesPorAlbaran(albaranIds) {
  const totales = new Map()
  if (albaranIds.length === 0) return totales

  const { data, error } = await supabase
    .from('entrada_material')
    .select('albaran_compra_id, cantidad, precio')
    .in('albaran_compra_id', albaranIds)
  if (error) throw error

  for (const l of data || []) {
    const importe = l.precio ? l.cantidad * l.precio : 0
    totales.set(l.albaran_compra_id, (totales.get(l.albaran_compra_id) || 0) + importe)
  }
  return totales
}

// Suma de pago_aplicacion.monto_aplicado agrupada por documento destino, excluyendo aplicaciones
// de pagos anulados (embed pagos(anulada), un solo viaje de ida y vuelta -- sin N+1 por fila).
// Idéntica a aplicadoPorDocumento() de saldosVenta.js, contra las columnas de compra.
async function aplicadoPorDocumento(facturaIds, albaranIds) {
  const aplicadoFactura = new Map()
  const aplicadoAlbaran = new Map()
  if (facturaIds.length === 0 && albaranIds.length === 0) return { aplicadoFactura, aplicadoAlbaran }

  const filtros = [
    facturaIds.length > 0 ? `factura_compra_id.in.(${facturaIds.join(',')})` : null,
    albaranIds.length > 0 ? `albaran_compra_id.in.(${albaranIds.join(',')})` : null,
  ].filter(Boolean).join(',')

  const { data, error } = await supabase
    .from('pago_aplicacion')
    .select('factura_compra_id, albaran_compra_id, monto_aplicado, pagos(anulada)')
    .or(filtros)
  if (error) throw error

  for (const a of data || []) {
    if (a.pagos?.anulada) continue
    if (a.factura_compra_id != null) {
      aplicadoFactura.set(a.factura_compra_id, (aplicadoFactura.get(a.factura_compra_id) || 0) + Number(a.monto_aplicado))
    } else if (a.albaran_compra_id != null) {
      aplicadoAlbaran.set(a.albaran_compra_id, (aplicadoAlbaran.get(a.albaran_compra_id) || 0) + Number(a.monto_aplicado))
    }
  }
  return { aplicadoFactura, aplicadoAlbaran }
}

// Para un conjunto de albaranes de compra (ya sabidos "sueltos" por el llamador, es decir no
// agrupados en ninguna factura de compra viva), su saldo pendiente = total de líneas menos lo
// aplicado directo a cada uno. Idéntica a saldosDeAlbaranesSueltos() de saldosVenta.js.
export async function saldosDeAlbaranesSueltos(albaranIds) {
  if (albaranIds.length === 0) return new Map()
  const [totales, { aplicadoAlbaran }] = await Promise.all([
    totalesPorAlbaran(albaranIds),
    aplicadoPorDocumento([], albaranIds),
  ])
  const saldos = new Map()
  for (const id of albaranIds) {
    saldos.set(id, (totales.get(id) || 0) - (aplicadoAlbaran.get(id) || 0))
  }
  return saldos
}

// Mismo saldo que saldosDeAlbaranesSueltos, pero devolviendo el estado de pago ya resuelto
// (pagada/parcial/pendiente) por albarán -- para un futuro filtro de "Pago" en AlbaranesCompra.jsx
// análogo al de "Cobro" en Venta, sin recalcular la fórmula de saldo una tercera vez. Idéntica a
// estadosPagoDeAlbaranesSueltos() de saldosVenta.js.
export async function estadosPagoDeAlbaranesSueltos(albaranIds) {
  if (albaranIds.length === 0) return new Map()
  const [totales, { aplicadoAlbaran }] = await Promise.all([
    totalesPorAlbaran(albaranIds),
    aplicadoPorDocumento([], albaranIds),
  ])
  const estados = new Map()
  for (const id of albaranIds) {
    const total = totales.get(id) || 0
    const saldo = total - (aplicadoAlbaran.get(id) || 0)
    estados.set(id, estadoPago(saldo, total))
  }
  return estados
}

// Para un conjunto de facturas de compra no anuladas, su saldo pendiente = total − aplicado
// directo a la factura − aplicado a los albaranes que agrupa ("mirar hacia abajo" a través de
// factura_compra_albaran, misma técnica que "Pedido origen" en Albaranes de compra). `facturas` =
// [{ id, total }]; `albaranesPorFactura` = Map factura_compra_id -> [albaran_compra_id], ya
// resuelta por el llamador porque depende de qué relaciones cuentan como "agrupación válida"
// (solo las de facturas no anuladas). Idéntica a saldosDeFacturas() de saldosVenta.js.
//
// Nota: facturas_compra.total es nullable (a diferencia de facturas_venta.total, siempre
// calculado) -- una factura sin total informado da Number(null) = 0, así que su "saldo" sale
// negativo o cero y documentosPendientesProveedor() la descarta (saldo > 0), en vez de reventar.
// Comportamiento emergente de la fórmula, no un caso especial añadido a propósito.
export async function saldosDeFacturas(facturas, albaranesPorFactura) {
  const saldos = new Map()
  if (facturas.length === 0) return saldos

  const facturaIds = facturas.map((f) => f.id)
  const albaranIdsAgrupados = [...new Set([...albaranesPorFactura.values()].flat())]
  const { aplicadoFactura, aplicadoAlbaran } = await aplicadoPorDocumento(facturaIds, albaranIdsAgrupados)

  for (const f of facturas) {
    const idsAgrupados = albaranesPorFactura.get(f.id) || []
    const aplicadoAlbaranes = idsAgrupados.reduce((sum, id) => sum + (aplicadoAlbaran.get(id) || 0), 0)
    const aplicadoDirecto = aplicadoFactura.get(f.id) || 0
    saldos.set(f.id, Number(f.total) - aplicadoDirecto - aplicadoAlbaranes)
  }
  return saldos
}

// Documentos con saldo pendiente > 0 de un proveedor: facturas no anuladas + albaranes sueltos.
// Análoga a documentosPendientesCliente() de saldosVenta.js -- renombrada a "Proveedor" (no
// "Cliente") porque así es el concepto en Compras, mismo criterio ya usado en toda la migración a
// drawer (CONTRATO_DRAWERS_COMPRAS.md). Es la función que alimentará el futuro drawer "Registrar
// pago a proveedor" (paso 3), devolviendo la misma forma uniforme, ordenada por fecha ascendente
// (FIFO, lista para la misma auto-aplicación que ya tiene RegistrarPagoForm.jsx).
export async function documentosPendientesProveedor(proveedorId) {
  const [resFacturas, resAlbaranes, resRelaciones] = await Promise.all([
    supabase.from('facturas_compra').select('id, numero_factura, fecha, total').eq('proveedor_id', proveedorId).eq('anulada', false),
    supabase.from('albaranes_compra').select('id, numero_albaran, fecha').eq('proveedor_id', proveedorId),
    // Mismo embed que usa FacturaCompraForm.jsx (cargarAlbaranesDelProveedor) para saber qué
    // albaranes están agrupados en una factura NO anulada -- un albarán así nunca es candidato a
    // pago directo, su saldo se gestiona a través de la factura.
    supabase.from('factura_compra_albaran').select('factura_compra_id, albaran_compra_id, facturas_compra(anulada)'),
  ])
  if (resFacturas.error) throw resFacturas.error
  if (resAlbaranes.error) throw resAlbaranes.error
  if (resRelaciones.error) throw resRelaciones.error

  const facturas = resFacturas.data || []
  const albaranes = resAlbaranes.data || []
  const relacionesVigentes = (resRelaciones.data || []).filter((r) => !r.facturas_compra?.anulada)

  const albaranIdsAgrupados = new Set(relacionesVigentes.map((r) => r.albaran_compra_id))
  const albaranesPorFactura = new Map()
  for (const r of relacionesVigentes) {
    if (!albaranesPorFactura.has(r.factura_compra_id)) albaranesPorFactura.set(r.factura_compra_id, [])
    albaranesPorFactura.get(r.factura_compra_id).push(r.albaran_compra_id)
  }

  const albaranesSueltos = albaranes.filter((a) => !albaranIdsAgrupados.has(a.id))

  const [saldosFacturas, saldosAlbaranes] = await Promise.all([
    saldosDeFacturas(facturas, albaranesPorFactura),
    saldosDeAlbaranesSueltos(albaranesSueltos.map((a) => a.id)),
  ])

  const documentos = []
  for (const f of facturas) {
    const saldo = saldosFacturas.get(f.id) || 0
    if (saldo > 0) {
      documentos.push({ tipo: 'factura', id: f.id, codigo: f.numero_factura || `#${f.id}`, fecha: f.fecha, saldo })
    }
  }
  for (const a of albaranesSueltos) {
    const saldo = saldosAlbaranes.get(a.id) || 0
    if (saldo > 0) {
      documentos.push({ tipo: 'albaran', id: a.id, codigo: a.numero_albaran || '(sin número)', fecha: a.fecha, saldo })
    }
  }

  documentos.sort((x, y) => new Date(x.fecha) - new Date(y.fecha))
  return documentos
}

// NOTA (no portado): saldosVenta.js exporta también clientesParaDrawer(), un parche para cuando
// el cliente de un documento preseleccionado está inactivo y no aparece en la lista de clientes
// activos del <Select>. No tiene equivalente aquí: proveedores NO tiene columna `activo` (a
// diferencia de clientes) -- no existe la noción de "proveedor inactivo" que reconciliar, así que
// no hay ningún problema que este helper resuelva en Compras. Si en el paso 3 (pagoDrawer) resulta
// que sí hace falta algo parecido, será un caso nuevo a evaluar, no un espejo de este.
