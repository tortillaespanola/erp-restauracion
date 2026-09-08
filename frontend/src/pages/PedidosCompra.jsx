import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, DateInput, Badge, SectionLabel, EmptyState, LoadingState } from '../components/ui'

const lineaVacia = { articulo_id: '', cantidad: '', precio_unitario: '' }

const ESTADO_BADGE = {
  pendiente: 'gray',
  recibido: 'green',
  cancelado: 'red',
}

function PedidosCompra() {
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'pedidos_compra'])
  const [pedidos, setPedidos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulosDelProveedor, setArticulosDelProveedor] = useState([])
  const [cargando, setCargando] = useState(true)

  const [proveedorId, setProveedorId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [referenciaProveedor, setReferenciaProveedor] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])

  async function cargarDatos() {
    setCargando(true)

    const [resPedidos, resProveedores] = await Promise.all([
      supabase
        .from('pedidos_compra')
        .select(`
          *,
          proveedores(nombre_comercial),
          lineas_pedido_compra(
            id, articulo_id, cantidad, precio_unitario,
            articulos_compra(nombre, unidad),
            entrada_material(cantidad)
          )
        `)
        .order('fecha', { ascending: false }),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
    ])

    if (resPedidos.error) console.error(resPedidos.error)
    else setPedidos(resPedidos.data)

    if (resProveedores.error) console.error(resProveedores.error)
    else setProveedores(resProveedores.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  useEffect(() => {
    async function cargarArticulosDelProveedor() {
      if (!proveedorId) {
        setArticulosDelProveedor([])
        return
      }
      const { data, error } = await supabase
        .from('articulo_proveedor')
        .select('precio, referencia_proveedor, articulos_compra(id, nombre, unidad)')
        .eq('proveedor_id', proveedorId)

      if (error) {
        console.error(error)
        setArticulosDelProveedor([])
      } else {
        setArticulosDelProveedor(
          (data || []).map((ap) => ({
            id: ap.articulos_compra.id,
            nombre: ap.articulos_compra.nombre,
            unidad: ap.articulos_compra.unidad,
            precioPactado: ap.precio,
            referenciaProveedor: ap.referencia_proveedor,
          }))
        )
      }
    }
    cargarArticulosDelProveedor()
  }, [proveedorId])

  function handleProveedorChange(nuevoProveedorId) {
    const hayLineasRellenas = lineas.some((l) => l.articulo_id || l.cantidad || l.precio_unitario)
    if (proveedorId && nuevoProveedorId !== proveedorId && hayLineasRellenas) {
      if (!confirm(t('pedidos_compra:alertas.cambiar_proveedor_confirmacion'))) {
        return
      }
      setLineas([{ ...lineaVacia }])
    }
    setProveedorId(nuevoProveedorId)
  }

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'articulo_id') {
        const art = articulosDelProveedor.find((a) => a.id === parseInt(valor))
        if (art?.precioPactado != null && !copia[index].precio_unitario) {
          copia[index].precio_unitario = String(art.precioPactado)
        }
      }
      return copia
    })
  }

  function addLinea() {
    setLineas((prev) => [...prev, { ...lineaVacia }])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setProveedorId('')
    setFecha(new Date().toISOString().slice(0, 10))
    setFechaEntrega('')
    setReferenciaProveedor('')
    setNotas('')
    setLineas([{ ...lineaVacia }])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (fechaEntrega && fechaEntrega < fecha) {
      alert(t('pedidos_compra:alertas.fecha_entrega_invalida'))
      return
    }

    const lineasValidas = lineas.filter((l) => l.articulo_id && l.cantidad)
    if (lineasValidas.length === 0) {
      alert(t('pedidos_compra:alertas.sin_lineas_validas'))
      return
    }

    const { data: pedidoCreado, error: errorPedido } = await supabase
      .from('pedidos_compra')
      .insert({
        proveedor_id: parseInt(proveedorId),
        fecha,
        fecha_entrega_prevista: fechaEntrega || null,
        referencia_proveedor: referenciaProveedor || null,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorPedido) {
      alert(t('pedidos_compra:alertas.error_crear_pedido', { mensaje: errorPedido.message }))
      return
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      pedido_compra_id: pedidoCreado.id,
      articulo_id: parseInt(l.articulo_id),
      cantidad: parseFloat(l.cantidad),
      precio_unitario: l.precio_unitario ? parseFloat(l.precio_unitario) : null,
    }))

    const { error: errorLineas } = await supabase
      .from('lineas_pedido_compra')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      await supabase.from('pedidos_compra').delete().eq('id', pedidoCreado.id)
      alert(t('pedidos_compra:alertas.error_guardar_lineas', { mensaje: errorLineas.message }))
      return
    }

    resetForm()
    cargarDatos()
  }

  async function handleCancelar(id) {
    if (!confirm(t('pedidos_compra:alertas.confirmar_cancelar'))) return
    const { error } = await supabase.from('pedidos_compra').update({ estado: 'cancelado' }).eq('id', id)
    if (error) {
      alert(t('pedidos_compra:alertas.error_cancelar', { mensaje: error.message }))
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('pedidos_compra:titulo')} subtitle={t('pedidos_compra:subtitulo')} />

      <Card className="mb-6">
        <CardHeader title={t('pedidos_compra:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={t('pedidos_compra:campos.proveedor')}>
                <Select value={proveedorId} onChange={(e) => handleProveedorChange(e.target.value)} required>
                  <option value="">{t('compras_comun:selecciona_proveedor')}</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('pedidos_compra:campos.fecha')}>
                <DateInput value={fecha} onChange={setFecha} required />
              </Field>
              <Field label={t('pedidos_compra:campos.fecha_entrega_opcional')}>
                <DateInput value={fechaEntrega} onChange={setFechaEntrega} />
                {fechaEntrega && fechaEntrega < fecha && (
                  <p className="text-red-600 text-xs mt-1">{t('pedidos_compra:fecha_entrega_anterior')}</p>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t('pedidos_compra:campos.referencia_proveedor_opcional')}>
                <Input type="text" value={referenciaProveedor} onChange={(e) => setReferenciaProveedor(e.target.value)}
                  placeholder={t('pedidos_compra:referencia_proveedor_placeholder')} />
              </Field>
              <Field label={t('pedidos_compra:campos.notas_opcional')}>
                <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
              </Field>
            </div>

            {proveedorId && articulosDelProveedor.length === 0 && (
              <p className="text-sm text-amber-600">
                {t('compras_comun:articulo_no_asignado_aviso')}
              </p>
            )}

            <div>
              <SectionLabel>{t('pedidos_compra:lineas_titulo')}</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-3">
                    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
                      <Select value={linea.articulo_id}
                        onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                        required disabled={!proveedorId}>
                        <option value="">
                          {!proveedorId ? t('compras_comun:elige_proveedor_primero') : t('compras_comun:selecciona_articulo')}
                        </option>
                        {articulosDelProveedor.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nombre} ({a.unidad}){a.referenciaProveedor ? ` — ref. ${a.referenciaProveedor}` : ''}
                          </option>
                        ))}
                      </Select>
                      <Input type="number" step="0.001" placeholder={t('pedidos_compra:placeholders.cantidad')} value={linea.cantidad}
                        onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                        required title={t('common:redondea_3_decimales')} />
                      <Input type="number" step="0.01" placeholder={t('pedidos_compra:placeholders.precio')} value={linea.precio_unitario}
                        onChange={(e) => handleLineaChange(index, 'precio_unitario', e.target.value)} />
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-gray-400 hover:text-red-600 justify-self-center">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-primary-600 font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> {t('compras_comun:anadir_linea')}
              </button>
            </div>

            <Button type="submit" className="self-start">{t('pedidos_compra:guardar_pedido')}</Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('common:listado_titulo')}</h2>

      {cargando ? (
        <LoadingState />
      ) : pedidos.length === 0 ? (
        <Card><EmptyState>{t('pedidos_compra:sin_pedidos')}</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pedidos.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-ink flex items-center gap-2 flex-wrap">
                    {p.proveedores?.nombre_comercial ?? t('compras_comun:sin_proveedor')}
                    {p.codigo_pedido && <span className="text-xs font-mono text-gray-400">{p.codigo_pedido}</span>}
                    <Badge color={ESTADO_BADGE[p.estado] ?? 'gray'}>{t(`enums:estado_pedido_compra.${p.estado}`, { defaultValue: p.estado })}</Badge>
                  </p>
                  <p className="text-sm text-gray-500">
                    {formatFecha(p.fecha)}{p.fecha_entrega_prevista && ` · entrega prevista ${formatFecha(p.fecha_entrega_prevista)}`}
                    {p.referencia_proveedor && ` · ref. proveedor: ${p.referencia_proveedor}`}
                  </p>
                  {p.notas && <p className="text-sm text-gray-400 italic">{p.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0 items-start">
                  {p.estado !== 'recibido' && p.estado !== 'cancelado' && (
                    <LinkAction tone="blue" onClick={() => navigate(`/albaranes-compra?pedido_compra_id=${p.id}`)}>
                      {t('pedidos_compra:recibir_como_albaran')}
                    </LinkAction>
                  )}
                  {p.estado !== 'recibido' && p.estado !== 'cancelado' && (
                    <LinkAction tone="red" onClick={() => handleCancelar(p.id)}>{t('common:actions.cancel')}</LinkAction>
                  )}
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.articulo')}</th>
                    <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.pedido')}</th>
                    <th className="py-1.5 font-medium">{t('pedidos_compra:tabla.recibido')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.lineas_pedido_compra.map((linea) => {
                    const recibido = (linea.entrada_material || []).reduce((sum, e) => sum + Number(e.cantidad), 0)
                    const completa = recibido >= linea.cantidad
                    return (
                      <tr key={linea.id}>
                        <td className="py-1.5">{linea.articulos_compra?.nombre}</td>
                        <td className="py-1.5">{linea.cantidad} {linea.articulos_compra?.unidad}</td>
                        <td className={`py-1.5 ${completa ? 'text-green-600' : 'text-gray-500'}`}>{recibido} {linea.articulos_compra?.unidad}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default PedidosCompra
