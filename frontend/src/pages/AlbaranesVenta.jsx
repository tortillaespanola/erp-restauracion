import { useState, useEffect, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { descargarAlbaranVentaPdf, imprimirAlbaranVentaPdf, nombreLineaVenta, prepararDocumentoAlbaranVenta } from '../lib/generarAlbaranVentaPdf'
import {
  IconTrash, IconChevronRight, IconChevronDown, IconPrinter, IconDownload, IconPlus,
  IconArrowUp, IconArrowDown, IconArrowsSort,
} from '@tabler/icons-react'
import { PageHeader, Card, Button, Badge, EmptyState, LoadingState, Drawer } from '../components/ui'
import AlbaranVentaForm from '../components/AlbaranVentaForm'

// BLOQUE 3 (CONTRATO_UX_ALBARANES_VENTA.md): códigos de pedido distintos entre las líneas del
// albarán -- 0 códigos = ninguna línea tiene origen, 1 = todas comparten pedido, 2+ = "Varios".
function codigosPedidoOrigen(alb) {
  const codigos = new Set()
  for (const l of alb.lineas_albaran_venta) {
    const codigo = l.lineas_pedido_venta?.pedidos_venta?.codigo_pedido
    if (codigo) codigos.add(codigo)
  }
  return [...codigos]
}

// BLOQUE 2 (CONTRATO_UX_ALBARANES_VENTA.md): factura_venta_albaran embebido para saber si el
// albarán está facturado sin una query aparte por fila -- basta con mirar si el array llega vacío.
// factura_venta_albaran es una tabla puente sin columna `id` propia (solo factura_venta_id +
// albaran_venta_id, ver FacturasVenta.jsx) -- se pide factura_venta_id explícitamente.
// BLOQUE 3: linea_pedido_id + lineas_pedido_venta(pedido_id, pedidos_venta(codigo_pedido))
// embebido para resolver el/los pedido(s) de origen de cada línea sin una query aparte -- misma
// query principal, un solo viaje de ida y vuelta.
const SELECT_ALBARAN_CON_RELACIONES =
  '*, clientes(nombre, direccion, cif), lineas_albaran_venta(id, cantidad, precio_unitario, descripcion, productos_finales(nombre, unidades_medida(codigo)), articulos_compra(nombre, unidad), linea_pedido_id, lineas_pedido_venta(pedido_id, pedidos_venta(codigo_pedido))), factura_venta_albaran(factura_venta_id)'

// BLOQUE 5 (CONTRATO_UX_ALBARANES_VENTA.md): 20 por página, igual que Pedidos -- volumen similar
// (~92 albaranes hoy), da ~5 páginas, cómodo para números de página sin elipsis.
const PAGINA_TAMANO = 20

function AlbaranesVenta() {
  const [searchParams] = useSearchParams()
  const pedidoIdParam = searchParams.get('pedido_id')

  const [albaranes, setAlbaranes] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [articulosMercaderia, setArticulosMercaderia] = useState([])
  const [cargando, setCargando] = useState(true)

  // BLOQUE 6 (CONTRATO_UX_ALBARANES_VENTA.md): un único booleano para el drawer -- a diferencia de
  // Pedidos, aquí no hay modo edición, así que no hace falta guardar "qué" se está editando, solo
  // si el drawer está abierto o no. Se abre solo o por el botón "Nuevo albarán".
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  // Refs de la fila principal de cada albarán, indexadas por id -- para el scrollIntoView tras
  // guardar desde el drawer, mismo patrón que Pedidos.
  const filaRefs = useRef(new Map())

  useEffect(() => {
    if (pedidoIdParam) setDrawerAbierto(true)
  }, [pedidoIdParam])

  // BLOQUE 4 (CONTRATO_UX_ALBARANES_VENTA.md): un único id expandido a nivel de pantalla (no un
  // Set por fila) para forzar comportamiento acordeón -- expandir un albarán colapsa cualquier otro.
  const [filaExpandidaId, setFilaExpandidaId] = useState(null)

  function toggleExpandido(id) {
    setFilaExpandidaId((prev) => (prev === id ? null : id))
  }

  // BLOQUE 5: única columna ordenable (Fecha) -- null = orden por defecto (fecha descendente, sin
  // agrupamiento porque aquí no hay estados que preservar, a diferencia de Pedidos).
  const [orden, setOrden] = useState({ columna: null, direccion: 'desc' })
  const [pagina, setPagina] = useState(1)
  const [totalAlbaranes, setTotalAlbaranes] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(totalAlbaranes / PAGINA_TAMANO))

  function cambiarOrden(columna) {
    setOrden((prev) => {
      if (prev.columna !== columna) return { columna, direccion: 'desc' }
      if (prev.direccion === 'desc') return { columna, direccion: 'asc' }
      return { columna: null, direccion: 'desc' }
    })
    setPagina(1) // cambiar de orden con otra página abierta dejaría una página vacía o repetida
  }

  function iconoOrden(columna) {
    if (orden.columna !== columna) return <IconArrowsSort size={12} className="text-gray-300" />
    return orden.direccion === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
  }

  async function cargarDatos() {
    setCargando(true)

    let albaranesQuery = supabase
      .from('albaranes_venta')
      .select(SELECT_ALBARAN_CON_RELACIONES, { count: 'exact' })

    // BLOQUE 5: a diferencia de Pedidos, aquí no hay columna de agrupamiento por estado -- el
    // orden por defecto es simplemente fecha descendente, sin paso intermedio de migración.
    albaranesQuery = orden.columna
      ? albaranesQuery.order(orden.columna, { ascending: orden.direccion === 'asc' })
      : albaranesQuery.order('fecha', { ascending: false })
    // Tiebreaker final por id, mismo motivo que en Pedidos: sin él, dos albaranes con la misma
    // fecha no tienen un orden garantizado entre sí, lo que podría repetir o saltarse filas al
    // paginar con .range() entre una página y la siguiente.
    albaranesQuery = albaranesQuery.order('id', { ascending: true })

    const desde = (pagina - 1) * PAGINA_TAMANO
    albaranesQuery = albaranesQuery.range(desde, desde + PAGINA_TAMANO - 1)

    const [resAlbaranes, resClientes, resProductos, resArticulos] = await Promise.all([
      albaranesQuery,
      supabase.from('clientes').select('id, nombre').order('nombre'),
      supabase.from('productos_finales').select('id, nombre, precio_venta').order('nombre'),
      supabase.from('articulos_compra').select('id, nombre, unidad').eq('tipo_material', 'TRD').order('nombre'),
    ])

    if (resAlbaranes.error) console.error(resAlbaranes.error)
    else {
      setAlbaranes(resAlbaranes.data)
      setTotalAlbaranes(resAlbaranes.count ?? 0)
    }

    if (resClientes.error) console.error(resClientes.error)
    else setClientes(resClientes.data)

    if (resProductos.error) console.error(resProductos.error)
    else setProductos(resProductos.data)

    if (resArticulos.error) console.error(resArticulos.error)
    else setArticulosMercaderia(resArticulos.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [orden, pagina])


  async function handleBorrar(id) {
    const { count } = await supabase
      .from('factura_venta_albaran')
      .select('*', { count: 'exact', head: true })
      .eq('albaran_venta_id', id)

    const mensaje = count > 0
      ? `⚠️ Este albarán está incluido en ${count} factura(s). Al borrarlo, se quitará de esa factura, pero la factura en sí NO se borrará (podría quedar con un total que ya no cuadra con sus líneas). ¿Seguro que quieres continuar?`
      : '¿Seguro que quieres borrar este albarán? Se revertirá el stock vendido.'

    if (!confirm(mensaje)) return

    const { error } = await supabase.from('albaranes_venta').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarDatos()
  }

  // BLOQUE 6: tras guardar desde el drawer, cierra, refresca y -- si el albarán guardado sigue
  // presente en la página actual -- hace scroll hasta su fila. requestAnimationFrame da tiempo a
  // que React confirme en el DOM las filas de cargarDatos() antes de buscar la ref (necesario para
  // un alta nueva, cuya fila no existía en el DOM hasta este refresco). Mismo patrón y misma
  // limitación conocida que Pedidos: si el albarán cae en otra página, no hay scroll cruzando
  // páginas.
  async function alGuardarAlbaran(idAlbaran) {
    setDrawerAbierto(false)
    await cargarDatos()
    requestAnimationFrame(() => {
      filaRefs.current.get(idAlbaran)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  return (
    <div>
      <PageHeader title="Albaranes de venta" />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#1C2938]">Listado</h2>
        <Button onClick={() => setDrawerAbierto(true)}>
          <IconPlus size={15} /> Nuevo albarán
        </Button>
      </div>

      {cargando ? (
        <LoadingState />
      ) : albaranes.length === 0 ? (
        <Card><EmptyState>Todavía no hay albaranes de venta registrados.</EmptyState></Card>
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
                  <th className="px-3 py-2.5 font-medium">Nº Albarán</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Pedido origen</th>
                  <th className="px-3 py-2.5 font-medium">Facturado</th>
                  <th className="px-3 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {albaranes.map((alb) => {
                  const expandido = filaExpandidaId === alb.id
                  // Bug encontrado probando con datos reales: factura_venta_albaran tiene un UNIQUE
                  // sobre albaran_venta_id (un albarán solo puede estar en una factura), así que
                  // PostgREST lo embebe como objeto único (o null), NUNCA como array -- asumir array
                  // aquí hacía que `facturado` diera siempre false, tuviese o no factura de verdad.
                  const relFactura = alb.factura_venta_albaran
                  const facturado = Array.isArray(relFactura) ? relFactura.length > 0 : relFactura != null
                  const codigosPedido = codigosPedidoOrigen(alb)
                  return (
                    <Fragment key={alb.id}>
                      <tr
                        ref={(el) => { if (el) filaRefs.current.set(alb.id, el); else filaRefs.current.delete(alb.id) }}
                        className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => toggleExpandido(alb.id)}
                      >
                        <td className="px-3 py-3">
                          <button type="button" className="text-gray-400 hover:text-gray-600">
                            {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatFecha(alb.fecha)}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{alb.numero_albaran || '(sin número)'}</td>
                        <td className="px-3 py-3 font-medium text-[#1C2938]">{alb.clientes?.nombre ?? 'Sin cliente'}</td>
                        <td className="px-3 py-3">
                          {codigosPedido.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : codigosPedido.length === 1 ? (
                            <Badge color="blue">{codigosPedido[0]}</Badge>
                          ) : (
                            <span title={codigosPedido.join(', ')}>
                              <Badge color="blue">Varios</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge color={facturado ? 'green' : 'gray'}>
                            {facturado ? 'Facturado' : 'Pendiente de facturar'}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <button type="button" title="Imprimir" onClick={() => imprimirAlbaranVentaPdf(prepararDocumentoAlbaranVenta(alb))} className="text-gray-400 hover:text-[#0854A0]">
                              <IconPrinter size={16} />
                            </button>
                            <button type="button" title="Descargar PDF" onClick={() => descargarAlbaranVentaPdf(prepararDocumentoAlbaranVenta(alb))} className="text-gray-400 hover:text-[#0854A0]">
                              <IconDownload size={16} />
                            </button>
                            <button type="button" title="Borrar" onClick={() => handleBorrar(alb.id)} className="text-gray-400 hover:text-red-600">
                              <IconTrash size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} className="p-0">
                          {/* BLOQUE 4: grid con altura animable (0fr <-> 1fr) en vez de montar/desmontar
                              la fila -- así el expandir/colapsar tiene una transición CSS suave. */}
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="bg-gray-50/60 px-3 py-3">
                                {alb.notas && <p className="text-sm text-gray-500 italic mb-2">{alb.notas}</p>}
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                      <th className="py-1.5 font-medium">Producto</th>
                                      <th className="py-1.5 font-medium">Cantidad</th>
                                      <th className="py-1.5 font-medium">Precio</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {alb.lineas_albaran_venta.map((linea) => (
                                      <tr key={linea.id}>
                                        <td className="py-1.5">{nombreLineaVenta(linea)}</td>
                                        <td className="py-1.5">{linea.cantidad}</td>
                                        <td className="py-1.5">{linea.precio_unitario ?? '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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

      {!cargando && totalAlbaranes > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-400">
            {totalAlbaranes} {totalAlbaranes === 1 ? 'albarán' : 'albaranes'} · página {pagina} de {totalPaginas}
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

      <Drawer
        open={drawerAbierto}
        onClose={() => setDrawerAbierto(false)}
        title="Nuevo albarán"
        anchoClase="max-w-2xl"
      >
        {drawerAbierto && (
          <AlbaranVentaForm
            pedidoIdParam={pedidoIdParam}
            clientes={clientes}
            productos={productos}
            articulosMercaderia={articulosMercaderia}
            onGuardado={alGuardarAlbaran}
            onCancelar={() => setDrawerAbierto(false)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default AlbaranesVenta
