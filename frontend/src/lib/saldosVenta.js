// CONTRATO_PAGOS_VENTA.md, Bloque 3: cálculo de saldo pendiente, sin ninguna pantalla propia --
// se reutiliza tal cual desde el drawer de Pagos (Bloque 5), el listado de Pagos (Bloque 4) y el
// icono de acceso rápido en Facturas/Albaranes (Bloque 6).
//
// Ningún saldo se persiste (sección 2 del contrato): siempre total menos lo realmente aplicado,
// calculado al vuelo contra pago_aplicacion. Un pago anulado (Bloque 7) nunca cuenta -- se filtra
// aquí mismo, en el único sitio donde se suma "lo aplicado", para que ningún llamador tenga que
// acordarse de excluirlo por su cuenta.
import { supabase } from './supabase'

// Tolerancia de redondeo en CHF para comparaciones de monto -- compartida entre el cálculo de
// saldo (aquí) y el drawer de registro (RegistrarPagoForm.jsx), para no tener dos nociones
// distintas de "es cero" en el mismo módulo.
export const EPSILON = 0.005

// Bloque 6 (CONTRATO_PAGOS_VENTA.md): badge de estado de pago, misma fórmula que el saldo del
// Bloque 3 -- sin columna nueva que mantener, solo lectura del cálculo ya existente.
export function estadoPago(saldo, total) {
  if (saldo <= EPSILON) return 'pagada'
  if (saldo >= Number(total) - EPSILON) return 'pendiente'
  return 'parcial'
}

// Total de un albarán a partir de sus líneas -- misma fórmula que calcularTotalDeAlbaranes de
// FacturasVenta.jsx, pero en batch para un conjunto de albaranes en vez de uno solo.
async function totalesPorAlbaran(albaranIds) {
  const totales = new Map()
  if (albaranIds.length === 0) return totales

  const { data, error } = await supabase
    .from('lineas_albaran_venta')
    .select('albaran_venta_id, cantidad, precio_unitario')
    .in('albaran_venta_id', albaranIds)
  if (error) throw error

  for (const l of data || []) {
    const importe = l.precio_unitario ? l.cantidad * l.precio_unitario : 0
    totales.set(l.albaran_venta_id, (totales.get(l.albaran_venta_id) || 0) + importe)
  }
  return totales
}

// Suma de pago_aplicacion.monto_aplicado agrupada por documento destino, excluyendo aplicaciones
// de pagos anulados (embed pagos(anulada), un solo viaje de ida y vuelta -- sin N+1 por fila).
async function aplicadoPorDocumento(facturaIds, albaranIds) {
  const aplicadoFactura = new Map()
  const aplicadoAlbaran = new Map()
  if (facturaIds.length === 0 && albaranIds.length === 0) return { aplicadoFactura, aplicadoAlbaran }

  const filtros = [
    facturaIds.length > 0 ? `factura_venta_id.in.(${facturaIds.join(',')})` : null,
    albaranIds.length > 0 ? `albaran_venta_id.in.(${albaranIds.join(',')})` : null,
  ].filter(Boolean).join(',')

  const { data, error } = await supabase
    .from('pago_aplicacion')
    .select('factura_venta_id, albaran_venta_id, monto_aplicado, pagos(anulada)')
    .or(filtros)
  if (error) throw error

  for (const a of data || []) {
    if (a.pagos?.anulada) continue
    if (a.factura_venta_id != null) {
      aplicadoFactura.set(a.factura_venta_id, (aplicadoFactura.get(a.factura_venta_id) || 0) + Number(a.monto_aplicado))
    } else if (a.albaran_venta_id != null) {
      aplicadoAlbaran.set(a.albaran_venta_id, (aplicadoAlbaran.get(a.albaran_venta_id) || 0) + Number(a.monto_aplicado))
    }
  }
  return { aplicadoFactura, aplicadoAlbaran }
}

// Para un conjunto de albaranes (ya sabidos "sueltos" por el llamador -- ver
// albaranEstaAgrupadoEnFacturaNoAnulada más abajo), su saldo pendiente = total de líneas menos lo
// aplicado directo a cada uno. Usado por AlbaranesVenta.jsx (Bloque 6) y por
// documentosPendientesCliente (Bloque 5).
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

// BLOQUE 2 (CONTRATO_FILTROS_VENTA.md): mismo saldo que saldosDeAlbaranesSueltos, pero devolviendo
// el estado de pago ya resuelto (pagada/parcial/pendiente) por albarán -- para poder filtrar por
// "Cobro" en AlbaranesVenta.jsx sin recalcular la fórmula de saldo una tercera vez (ya la tiene
// totalAlbaran() en AlbaranesVenta.jsx para el badge, y saldosDeAlbaranesSueltos() aquí mismo).
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

// Para un conjunto de facturas no anuladas, su saldo pendiente = total − aplicado directo a la
// factura − aplicado a los albaranes que agrupa (sección 4 del contrato: mirar hacia abajo a
// través de factura_venta_albaran, misma técnica que "Pedido origen" en Albaranes, aquí sumando
// en vez de solo listando códigos). `facturas` = [{ id, total }]; `albaranesPorFactura` = Map
// factura_venta_id -> [albaran_venta_id], ya resuelta por el llamador porque depende de qué
// relaciones cuentan como "agrupación válida" (solo las de facturas no anuladas).
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

// Documentos con saldo pendiente > 0 de un cliente: facturas no anuladas + albaranes sueltos
// (sección 4 del contrato). Es la función que usa el drawer "Registrar pago" (Bloque 5) para
// poblar la lista de documentos a cubrir -- devuelve forma uniforme, ordenada por fecha ascendente
// (FIFO, listo para la auto-aplicación del Bloque 5).
export async function documentosPendientesCliente(clienteId) {
  const [resFacturas, resAlbaranes, resRelaciones] = await Promise.all([
    supabase.from('facturas_venta').select('id, numero_factura, fecha, total').eq('cliente_id', clienteId).eq('anulada', false),
    supabase.from('albaranes_venta').select('id, numero_albaran, fecha').eq('cliente_id', clienteId),
    // Mismo embed que ya usa FacturasVenta.jsx (cargarAlbaranesDelCliente) para saber qué
    // albaranes están agrupados en una factura NO anulada -- un albarán así nunca es candidato a
    // cobro directo, su saldo se gestiona a través de la factura.
    supabase.from('factura_venta_albaran').select('factura_venta_id, albaran_venta_id, facturas_venta(anulada)'),
  ])
  if (resFacturas.error) throw resFacturas.error
  if (resAlbaranes.error) throw resAlbaranes.error
  if (resRelaciones.error) throw resRelaciones.error

  const facturas = resFacturas.data || []
  const albaranes = resAlbaranes.data || []
  const relacionesVigentes = (resRelaciones.data || []).filter((r) => !r.facturas_venta?.anulada)

  const albaranIdsAgrupados = new Set(relacionesVigentes.map((r) => r.albaran_venta_id))
  const albaranesPorFactura = new Map()
  for (const r of relacionesVigentes) {
    if (!albaranesPorFactura.has(r.factura_venta_id)) albaranesPorFactura.set(r.factura_venta_id, [])
    albaranesPorFactura.get(r.factura_venta_id).push(r.albaran_venta_id)
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

// Fix reportado tras probar el Bloque 6 en real: el cliente de un documento preseleccionado desde
// el icono de acceso rápido puede estar inactivo -- no aparece en la lista de clientes activos que
// alimenta el <Select> de RegistrarPagoForm, así que se veía vacío aunque clienteIdInicial fuera
// correcto por dentro. Se añade a la lista de opciones solo cuando hace falta, porque aquí no se
// está eligiendo un cliente libremente, se está confirmando uno ya fijado por el documento. Uso:
// en FacturasVenta.jsx y AlbaranesVenta.jsx, `clientes={clientesParaDrawer(clientesActivos, pagoDrawer)}`.
export function clientesParaDrawer(clientesActivos, pagoDrawer) {
  if (!pagoDrawer) return clientesActivos
  if (clientesActivos.some((c) => c.id === pagoDrawer.clienteId)) return clientesActivos
  return [...clientesActivos, { id: pagoDrawer.clienteId, nombre: pagoDrawer.clienteNombre ?? 'Cliente inactivo' }]
}
