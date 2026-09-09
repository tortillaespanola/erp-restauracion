import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import { IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconArrowsSort, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, Badge, EmptyState, LoadingState, Button, Drawer, LinkAction } from '../components/ui'
import RegistrarPagoProveedorForm from '../components/RegistrarPagoProveedorForm'
import { useNegocio } from '../context/useNegocio'

// CONTRATO_PAGOS_COMPRA.md sección 8 (hueco de alcance): espejo de Pagos.jsx (venta) -- mismo
// tamaño de página, mismo patrón de tabla con cabeceras clicables (Pagos.jsx de venta usa tabla,
// no tarjetas, así que se copia tal cual).
const PAGINA_TAMANO = 20

// Mismo enum que Pagos.jsx (metodo_pago es compartido entre cobro y pago).
const METODO_BADGE = {
  efectivo: 'green',
  twint: 'blue',
  tarjeta: 'gray',
  transferencia: 'amber',
}

// Espejo de documentoDeAplicacion() en Pagos.jsx: resuelve a qué documento apunta una aplicación
// -- factura o albarán de compra, nunca ambos (mismo CHECK de BD) -- sin query aparte, ya viene
// embebido.
function documentoDeAplicacion(pa, t) {
  if (pa.factura_compra_id != null) {
    return { tipo: t('pagos_compra:tipo_factura'), codigo: pa.facturas_compra?.numero_factura || `#${pa.factura_compra_id}` }
  }
  return { tipo: t('pagos_compra:tipo_albaran'), codigo: pa.albaranes_compra?.numero_albaran || `#${pa.albaran_compra_id}` }
}

function PagosCompra() {
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'pagos_compra'])
  const { negocio } = useNegocio()
  const [pagos, setPagos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)

  const [drawerAbierto, setDrawerAbierto] = useState(false)

  // Un único id expandido a nivel de pantalla, mismo patrón acordeón que Pagos.jsx.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

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

  // Mismo patrón que Pagos.jsx: nunca DELETE, nunca edición. Las filas de pago_aplicacion se
  // mantienen intactas (rastro de auditoría); dejan de contar en cualquier cálculo de saldo
  // porque aplicadoPorDocumento()/saldosDeFacturas() en saldosCompra.js ya excluyen
  // pago_aplicacion cuyo pago.anulada sea true.
  async function handleAnular(id) {
    if (!confirm(t('pagos_compra:alertas.confirmar_anular'))) return

    const { error } = await supabase.from('pagos').update({ anulada: true }).eq('id', id)
    if (error) {
      alert(t('pagos_compra:alertas.error_anular', { mensaje: error.message }))
      return
    }
    cargarDatos()
  }

  async function cargarDatos() {
    setCargando(true)

    let pagosQuery = supabase
      .from('pagos')
      .select(
        '*, proveedores(nombre_comercial), pago_aplicacion(id, monto_aplicado, factura_compra_id, albaran_compra_id, facturas_compra(numero_factura), albaranes_compra(numero_albaran))',
        { count: 'exact' }
      )
      // Inversa exacta del .not('cliente_id', 'is', null) de Pagos.jsx -- esta pantalla es solo de
      // pagos a proveedor.
      .not('proveedor_id', 'is', null)

    pagosQuery = orden.columna
      ? pagosQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : pagosQuery.order('fecha', { ascending: false })
    pagosQuery = pagosQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    pagosQuery = pagosQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resPagos, resProveedores] = await Promise.all([
      pagosQuery,
      // Mismo criterio que FacturasCompra.jsx/AlbaranesCompra.jsx: sin filtro de activo (a
      // diferencia del `.eq('activo', true)` de clientes en Pagos.jsx), ya establecido para el
      // resto de pantallas de Compras.
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resPagos.error) console.error(resPagos.error)
    else {
      setPagos(resPagos.data || [])
      setTotalPagos(resPagos.count ?? 0)
    }

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data || [])

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
      <PageHeader title={t('pagos_compra:titulo')} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setDrawerAbierto(true)}>
          <IconPlus size={15} /> {t('compras_comun:registrar_pago_proveedor')}
        </Button>
      </div>

      {cargando ? (
        <LoadingState />
      ) : pagos.length === 0 ? (
        <Card><EmptyState>{t('pagos_compra:sin_pagos')}</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => cambiarOrden('fecha')} className="flex items-center gap-1 hover:text-gray-600">
                      {t('pagos_compra:tabla.fecha')} {iconoOrden('fecha')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t('pagos_compra:tabla.proveedor')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pagos_compra:tabla.monto_pagado')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pagos_compra:tabla.metodo')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pagos_compra:tabla.aplicado')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('pagos_compra:tabla.sin_aplicar')}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t('pagos_compra:tabla.acciones')}</th>
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
                        <td className="px-3 py-3 font-medium text-ink">
                          <div className="flex items-center gap-2 flex-wrap">
                            {p.proveedores?.nombre_comercial ?? t('compras_comun:sin_proveedor')}
                            {p.anulada && <Badge color="red">{t('enums:estado_pago.anulada')}</Badge>}
                          </div>
                        </td>
                        <td className={`px-3 py-3 whitespace-nowrap text-gray-600 ${p.anulada ? 'line-through' : ''}`}>{formatMoneda(p.monto, negocio?.moneda)}</td>
                        <td className="px-3 py-3">
                          <Badge color={METODO_BADGE[p.metodo] ?? 'gray'}>{t(`enums:metodo_pago.${p.metodo}`, { defaultValue: p.metodo })}</Badge>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatMoneda(aplicado, negocio?.moneda)}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {sinAplicar > 0 ? (
                            <span className="text-amber-600 font-medium">{formatMoneda(sinAplicar, negocio?.moneda)}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {!p.anulada && (
                            <LinkAction tone="red" onClick={() => handleAnular(p.id)}>{t('pagos_compra:anular')}</LinkAction>
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
                                  <p className="text-sm text-gray-400">{t('pagos_compra:sin_aplicaciones')}</p>
                                ) : (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                        <th className="py-1.5 font-medium">{t('pagos_compra:tabla_aplicaciones.tipo')}</th>
                                        <th className="py-1.5 font-medium">{t('pagos_compra:tabla_aplicaciones.documento')}</th>
                                        <th className="py-1.5 font-medium">{t('pagos_compra:tabla_aplicaciones.monto_aplicado')}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {aplicaciones.map((pa) => {
                                        const { tipo, codigo } = documentoDeAplicacion(pa, t)
                                        return (
                                          <tr key={pa.id}>
                                            <td className="py-1.5">{tipo}</td>
                                            <td className="py-1.5">{codigo}</td>
                                            <td className="py-1.5">{formatMoneda(pa.monto_aplicado, negocio?.moneda)}</td>
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
            {t('pagos_compra:pago_pagina_count', { count: totalPagos, pagina, total: totalPaginas })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              {t('common:actions.previous')}
            </Button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPagina(n)}
                className={`w-7 h-7 text-xs rounded-md ${n === pagina ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {n}
              </button>
            ))}
            <Button
              type="button" variant="secondary" size="sm"
              disabled={pagina === totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              {t('common:actions.next')}
            </Button>
          </div>
        </div>
      )}

      <Drawer open={drawerAbierto} onClose={() => setDrawerAbierto(false)} title={t('compras_comun:registrar_pago_proveedor')}>
        {drawerAbierto && (
          <RegistrarPagoProveedorForm
            proveedores={proveedores}
            onGuardado={alGuardarPago}
            onCancelar={() => setDrawerAbierto(false)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default PagosCompra
