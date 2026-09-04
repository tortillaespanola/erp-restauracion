import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconArrowsSort, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, Badge, EmptyState, LoadingState, Button, Drawer, LinkAction } from '../components/ui'
import RegistrarPagoForm from '../components/RegistrarPagoForm'

// BLOQUE 4 (CONTRATO_PAGOS_VENTA.md): mismo tamaño de página que Pedidos/Albaranes -- volumen
// bajo hoy (módulo nuevo), pero consistente con el resto del proyecto.
const PAGINA_TAMANO = 20

const METODO_LABEL = {
  efectivo: 'Efectivo',
  twint: 'Twint',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

const METODO_BADGE = {
  efectivo: 'green',
  twint: 'blue',
  tarjeta: 'gray',
  transferencia: 'amber',
}

// Detalle de una aplicación (fila expandida): resuelve a qué documento apunta -- factura o
// albarán, nunca ambos (CHECK de BD, Bloque 2) -- sin query aparte, ya viene embebido.
function documentoDeAplicacion(pa) {
  if (pa.factura_venta_id != null) {
    return { tipo: 'Factura', codigo: pa.facturas_venta?.numero_factura || `#${pa.factura_venta_id}` }
  }
  return { tipo: 'Albarán', codigo: pa.albaranes_venta?.numero_albaran || `#${pa.albaran_venta_id}` }
}

function Pagos() {
  const [pagos, setPagos] = useState([])
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)

  // BLOQUE 5: mismo booleano simple que AlbaranesVenta.jsx -- solo alta, no hay modo edición.
  const [drawerAbierto, setDrawerAbierto] = useState(false)

  // BLOQUE 4: un único id expandido a nivel de pantalla, mismo patrón acordeón que
  // Pedidos/Albaranes -- expandir un pago colapsa cualquier otro.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  // Única columna ordenable (Fecha) -- null = orden por defecto (descendente), sin agrupamiento
  // por estado (un pago no tiene ciclo de vida propio, igual que un albarán).
  const [orden, setOrden] = useState({ columna: null, direccion: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [totalPagos, setTotalPagos] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalPagos / PAGINA_TAMANO))

  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: 'desc' }
      if (prev.direccion === 'desc') return { columna, direccion: 'asc' }
      return { columna: null, direccion: 'desc' }
    })
    setPagina(1)
  }

  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // BLOQUE 7 (CONTRATO_PAGOS_VENTA.md): mismo patrón que facturas -- nunca DELETE, nunca edición.
  // Las filas de pago_aplicacion se mantienen intactas (rastro de auditoría, sección 7 del
  // contrato); dejan de contar en cualquier cálculo de saldo porque aplicadoPorDocumento() en
  // saldosVenta.js ya excluye pago_aplicacion cuyo pago.anulada sea true -- ningún cambio de
  // lógica de saldo hace falta aquí, ya estaba cubierto desde el Bloque 3.
  async function handleAnular(id) {
    if (!confirm('Esta acción anula el pago de forma permanente, no se puede deshacer. ¿Continuar?')) return

    const { error } = await supabase.from('pagos').update({ anulada: true }).eq('id', id)
    if (error) {
      alert('Error al anular: ' + error.message)
      return
    }
    cargarDatos()
  }

  async function cargarDatos() {
    setCargando(true)

    let pagosQuery = supabase
      .from('pagos')
      .select(
        '*, clientes(nombre), pago_aplicacion(id, monto_aplicado, factura_venta_id, albaran_venta_id, facturas_venta(numero_factura), albaranes_venta(numero_albaran))',
        { count: 'exact' }
      )

    pagosQuery = orden.columna
      ? pagosQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : pagosQuery.order('fecha', { ascending: false })
    pagosQuery = pagosQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    pagosQuery = pagosQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resPagos, resClientes] = await Promise.all([
      pagosQuery,
      // Bloque 5: mismo filtro activo=true que Pedidos.jsx, pedido explícitamente por el
      // contrato para el selector de cliente del drawer.
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
    ])

    if (resPagos.error) console.error(resPagos.error)
    else {
      setPagos(resPagos.data || [])
      setTotalPagos(resPagos.count ?? 0)
    }

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data || [])

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina])

  function alGuardarPago() {
    setDrawerAbierto(false)
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title="Pagos de venta" />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#1C2938]">Listado</h2>
        <Button onClick={() => setDrawerAbierto(true)}>
          <IconPlus size={15} /> Registrar pago
        </Button>
      </div>

      {cargando ? (
        <LoadingState />
      ) : pagos.length === 0 ? (
        <Card><EmptyState>Todavía no hay pagos registrados.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha')} className="flex items-center gap-1 hover:text-gray-600">
                      Fecha {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Monto recibido</th>
                  <th className="px-3 py-2.5 font-medium">Método</th>
                  <th className="px-3 py-2.5 font-medium">Aplicado</th>
                  <th className="px-3 py-2.5 font-medium">Sin aplicar</th>
                  <th className="px-3 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((p) => {
                  const expandido = filaExpandidaId === p.id
                  const aplicaciones = p.pago_aplicacion || []
                  const aplicado = aplicaciones.reduce((sum, pa) => sum + Number(pa.monto_aplicado), 0)
                  const sinAplicar = Number(p.monto) - aplicado
                  return (
                    <Fragment key={p.id}>
                      <tr
                        className={`border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer ${p.anulada ? 'opacity-60 bg-gray-50' : ''}`}
                        onClick={() => toggleExpandido(p.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(p.fecha)}</td>
                        <td className="px-3 py-3 font-medium text-[#1C2938]">
                          <div className="flex items-center gap-2 flex-wrap">
                            {p.clientes?.nombre ?? 'Sin cliente'}
                            {p.anulada && <Badge color="red">Anulada</Badge>}
                          </div>
                        </td>
                        <td className={`px-3 py-3 whitespace-nowrap text-gray-600 ${p.anulada ? 'line-through' : ''}`}>{Number(p.monto).toFixed(2)} CHF</td>
                        <td className="px-3 py-3">
                          <Badge color={METODO_BADGE[p.metodo] ?? 'gray'}>{METODO_LABEL[p.metodo] ?? p.metodo}</Badge>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{aplicado.toFixed(2)} CHF</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {sinAplicar > 0 ? (
                            <span className="text-amber-600 font-medium">{sinAplicar.toFixed(2)} CHF</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {!p.anulada && (
                            <LinkAction tone="red" onClick={() => handleAnular(p.id)}>Anular</LinkAction>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3">
                                {p.notas && <p className="text-sm text-gray-500 italic mb-2">{p.notas}</p>}
                                {aplicaciones.length === 0 ? (
                                  <p className="text-sm text-gray-400">Este pago no tiene ninguna aplicación registrada.</p>
                                ) : (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                        <th className="py-1.5 font-medium">Tipo</th>
                                        <th className="py-1.5 font-medium">Documento</th>
                                        <th className="py-1.5 font-medium">Monto aplicado</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {aplicaciones.map((pa) => {
                                        const { tipo, codigo } = documentoDeAplicacion(pa)
                                        return (
                                          <tr key={pa.id}>
                                            <td className="py-1.5">{tipo}</td>
                                            <td className="py-1.5">{codigo}</td>
                                            <td className="py-1.5">{Number(pa.monto_aplicado).toFixed(2)} CHF</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!cargando && totalPagos > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-400">
            {totalPagos} pago{totalPagos === 1 ? '' : 's'} · página {pagina} de {totalPaginas}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPagina(n)}
                className={`w-7 h-7 text-xs rounded-md ${n === pagina ? 'bg-[#0854A0] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {n}
              </button>
            ))}
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      <Drawer open={drawerAbierto} onClose={() => setDrawerAbierto(false)} title="Registrar pago">
        {drawerAbierto && (
          <RegistrarPagoForm
            clientes={clientes}
            onGuardado={alGuardarPago}
            onCancelar={() => setDrawerAbierto(false)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default Pagos
