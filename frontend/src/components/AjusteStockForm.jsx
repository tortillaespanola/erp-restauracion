import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad } from '../lib/formatCantidad'
import { Field, Input, Select, Button, EtiquetaCaducidad } from './ui'
import { estadoCaducidad, diasParaCaducar } from '../lib/caducidadLote'

// CONTRATO_I18N.md, Fase 0: claves del enum motivo_categoria (fijas en BD) -- la etiqueta
// visible se resuelve con t('enums:motivo_categoria.<clave>'), ver enums.json. Antes
// MOTIVO_CATEGORIA_LABEL tenía el texto español fijo, y estaba duplicado en la vista SQL
// historial_ajustes_stock (ver migración 20260907_i18n_idioma_moneda.sql).
const MOTIVOS_CATEGORIA = ['caducado', 'roto', 'evento_no_consumido', 'otro']

// CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte B (Paso 4.5): desglose de origen del rechazo, solo
// sobre semielaborado/producto final -- un artículo base (materia prima comprada) no tiene una
// "producción de origen" de la que algo pueda ser rechazado por un cliente o una inspección.
// Opcional a propósito, igual que MOTIVOS_CATEGORIA: la mayoría de ajustes siguen siendo
// correcciones rutinarias sin un origen de rechazo real que declarar.
const ORIGENES_RECHAZO = ['cliente', 'inspeccion_calidad', 'produccion_aguas_abajo', 'otro']

const hoyIso = () => new Date().toISOString().slice(0, 10)

// Formulario de alta de ajuste de stock, único componente para los 2 puntos de entrada
// (CONTRATO_AJUSTE_RAPIDO_INVENTARIO.md: drawer contextual de Inventario.jsx + "+ Nuevo ajuste"
// de AjustesStock.jsx) -- misma lógica de escritura (inserts directos, sin RPC, igual que el
// formulario original), solo cambia si tipo/ítem/lote vienen fijados por el contexto de la fila
// o los elige el usuario.
//
// `fijo`: { tipo, itemId, itemNombre, itemUnidad, loteId, loteLabel, stockActual, origenRechazo,
//           lineaPedidoOrigenId } | null
//   Cuando viene informado, tipo/ítem/lote se muestran como contexto de solo lectura (no hay
//   selectores) -- caso Inventario.jsx, siempre tipo 'articulo' hoy porque es el único nivel que
//   esa pantalla expone. `null` = modo manual, igual que el formulario original de AjustesStock.jsx.
//   `lineaPedidoOrigenId` (CONTRATO_PROPAGACION_RECHAZOS.md, Parte A): solo lo pasa
//   AlbaranesVenta.jsx al declarar un rechazo de cliente -- la línea de pedido concreta que se está
//   rechazando, necesaria más tarde para que resolver_rechazo_cliente() sepa dónde crear la línea de
//   reenvío.
export default function AjusteStockForm({ fijo = null, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'enums', 'ajuste_stock_form'])
  const [tipo, setTipo] = useState(fijo?.tipo || 'articulo')
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [productosFinales, setProductosFinales] = useState([])
  const [itemId, setItemId] = useState(fijo?.itemId ?? '')
  const [lotes, setLotes] = useState([])
  const [loteId, setLoteId] = useState(fijo?.loteId ?? '')
  const [stockActualLote, setStockActualLote] = useState(fijo?.stockActual ?? null)
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [motivoCategoria, setMotivoCategoria] = useState('')
  const [motivoDetalle, setMotivoDetalle] = useState('')
  const [origenRechazo, setOrigenRechazo] = useState(fijo?.origenRechazo ?? '')
  const [guardando, setGuardando] = useState(false)

  // CONTRATO_AJUSTES_RECHAZO_CLIENTE.md, Fase 1: en modo manual (fijo=null, "+ Nuevo ajuste" de
  // AjustesStock.jsx) origen_rechazo='cliente' no traía ninguna línea de pedido de origen -- así
  // se creó el ajuste #11 (ver migración 20261026). En modo fijo (AlbaranesVenta.jsx) esto no hace
  // falta: fijo.lineaPedidoOrigenId ya viene resuelto desde la línea de albarán concreta.
  const [lineasPedidoCandidatas, setLineasPedidoCandidatas] = useState([])
  const [lineaPedidoOrigenIdManual, setLineaPedidoOrigenIdManual] = useState('')

  useEffect(() => {
    if (fijo) return // modo contextual: no hace falta cargar catálogos, el ítem ya viene fijado
    async function cargarCatalogos() {
      const [resArt, resSemi, resPF] = await Promise.all([
        supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
        supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
        supabase.from('productos_finales').select('id, nombre').order('nombre'),
      ])
      setArticulos(resArt.data || [])
      setSemielaborados(resSemi.data || [])
      setProductosFinales(resPF.data || [])
    }
    cargarCatalogos()
  }, [fijo])

  useEffect(() => {
    if (fijo) return
    async function cargarLotes() {
      setLoteId('')
      setStockActualLote(null)
      if (!itemId) {
        setLotes([])
        return
      }
      if (tipo === 'articulo') {
        const { data } = await supabase
          .from('stock_lotes_articulo').select('*')
          .eq('articulo_id', itemId).order('fecha_recepcion', { ascending: true })
        setLotes(data || [])
      } else if (tipo === 'semielaborado') {
        const { data } = await supabase
          .from('stock_lotes_semielaborado').select('*')
          .eq('semielaborado_id', itemId).order('fecha', { ascending: true })
        setLotes(data || [])
      } else {
        const { data } = await supabase
          .from('stock_lotes_producto_final').select('*')
          .eq('producto_final_id', itemId).order('fecha', { ascending: true })
        setLotes(data || [])
      }
    }
    cargarLotes()
  }, [fijo, tipo, itemId])

  useEffect(() => {
    if (fijo || tipo !== 'producto_final' || !loteId) {
      setLineasPedidoCandidatas([])
      setLineaPedidoOrigenIdManual('')
      return
    }
    async function cargarCandidatas() {
      // Un lote puede haberse repartido entre varios albaranes/pedidos (ver #10 en la migración
      // 20261026) -- se listan TODAS las líneas de pedido a las que se envió este lote concreto,
      // el usuario elige cuál es la que se está rechazando. Sin línea de pedido (venta directa sin
      // pedido, linea_pedido_id null) no hay nada que ofrecer: 'cliente' queda deshabilitado.
      const { data } = await supabase
        .from('lineas_albaran_venta')
        .select('linea_pedido_id, cantidad, albaranes_venta(fecha, clientes(nombre)), lineas_pedido_venta(pedidos_venta(codigo_pedido))')
        .eq('produccion_pf_id', loteId)
        .not('linea_pedido_id', 'is', null)

      const vistas = new Set()
      const candidatas = []
      for (const l of data || []) {
        if (vistas.has(l.linea_pedido_id)) continue
        vistas.add(l.linea_pedido_id)
        candidatas.push(l)
      }
      setLineasPedidoCandidatas(candidatas)
      setLineaPedidoOrigenIdManual('')
    }
    cargarCandidatas()
  }, [fijo, tipo, loteId])

  function seleccionarLote(id) {
    setLoteId(id)
    const idNum = id ? parseInt(id) : null
    const lote = lotes.find((l) => (tipo === 'articulo' ? l.entrada_material_id : l.produccion_id) === idNum)
    setStockActualLote(lote ? Number(lote.stock_disponible) : null)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (tipo === 'producto_final') {
      if (!itemId || !loteId || !cantidad || !motivoCategoria) {
        alert(t('ajuste_stock_form:alertas.faltan_campos_producto_final'))
        return
      }
      if (origenRechazo === 'cliente' && !fijo && !lineaPedidoOrigenIdManual) {
        alert(t('ajuste_stock_form:alertas.falta_linea_pedido_origen'))
        return
      }
    } else if (!itemId || !loteId || !cantidad || !motivo) {
      alert(t('ajuste_stock_form:alertas.faltan_campos'))
      return
    }

    const cant = parseFloat(cantidad)
    const fecha = hoyIso()
    setGuardando(true)

    let error, data
    if (tipo === 'articulo') {
      ;({ error } = await supabase.from('ajustes_articulo').insert({
        articulo_id: parseInt(itemId), entrada_material_id: parseInt(loteId), cantidad: cant, motivo, fecha,
      }))
    } else if (tipo === 'semielaborado') {
      ;({ error } = await supabase.from('ajustes_semielaborado').insert({
        semielaborado_id: parseInt(itemId), produccion_id: parseInt(loteId), cantidad: cant, motivo, fecha,
        origen_rechazo: origenRechazo || null,
      }))
    } else {
      ;({ error, data } = await supabase.from('ajustes_producto_final').insert({
        produccion_pf_id: parseInt(loteId), cantidad: cant, motivo_categoria: motivoCategoria, motivo_detalle: motivoDetalle || null, fecha,
        origen_rechazo: origenRechazo || null,
        linea_pedido_origen_id: fijo?.lineaPedidoOrigenId ?? (origenRechazo === 'cliente' ? parseInt(lineaPedidoOrigenIdManual) : null),
      }).select().single())
    }

    setGuardando(false)
    if (error) {
      alert(t('ajuste_stock_form:alertas.error_guardar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.guardado'))
    // CONTRATO_PROPAGACION_RECHAZOS.md, Parte A: se devuelve el ajuste insertado (solo lo hay para
    // producto_final, único tipo con resolución de rechazo) para que el llamador pueda encadenar el
    // paso de resolución (abono/reenvío/descarte) sin otra consulta.
    onGuardado(data ?? null)
  }

  const items = tipo === 'articulo' ? articulos : tipo === 'semielaborado' ? semielaborados : productosFinales
  const unidad = fijo ? fijo.itemUnidad : tipo === 'producto_final' ? 'ud' : items.find((i) => i.id === parseInt(itemId))?.unidad

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fijo ? (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm">
          <p className="font-medium text-ink">{fijo.itemNombre}</p>
          <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1.5">
            {fijo.loteLabel}
            {fijo.fechaCaducidad && <EtiquetaCaducidad fechaCaducidad={fijo.fechaCaducidad} />}
          </p>
          {stockActualLote != null && (
            <p className="text-gray-500 text-xs mt-1">{t('ajuste_stock_form:stock_actual_del_lote', { cantidad: formatCantidad(stockActualLote, unidad), unidad })}</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={tipo === 'articulo'} onChange={() => { setTipo('articulo'); setItemId('') }} />
              {t('ajuste_stock_form:tipo.articulo')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={tipo === 'semielaborado'} onChange={() => { setTipo('semielaborado'); setItemId('') }} />
              {t('ajuste_stock_form:tipo.semielaborado')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={tipo === 'producto_final'} onChange={() => { setTipo('producto_final'); setItemId('') }} />
              {t('ajuste_stock_form:tipo.producto_final')}
            </label>
          </div>

          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            <option value="">{t('ajuste_stock_form:selecciona_item', { tipo: tipo === 'articulo' ? t('ajuste_stock_form:selecciona_tipo.articulo') : tipo === 'semielaborado' ? t('ajuste_stock_form:selecciona_tipo.semielaborado') : t('ajuste_stock_form:selecciona_tipo.producto_final') })}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.nombre} ({tipo === 'producto_final' ? 'ud' : i.unidad})</option>
            ))}
          </Select>

          {itemId && (
            <Select value={loteId} onChange={(e) => seleccionarLote(e.target.value)} required>
              <option value="">{lotes.length === 0 ? t('ajuste_stock_form:sin_lotes_con_stock') : t('ajuste_stock_form:selecciona_lote')}</option>
              {lotes.map((l, index) => {
                const id = tipo === 'articulo' ? l.entrada_material_id : l.produccion_id
                const esMasAntiguo = index === 0
                const masAntiguoPrefijo = esMasAntiguo ? t('ajuste_stock_form:mas_antiguo_badge') : ''
                const stockActualSufijo = t('ajuste_stock_form:lote_stock_actual', { stock: Number(l.stock_disponible).toFixed(3) })
                // CONTRATO_BADGE_CADUCIDAD_LOTES.md: este selector no mostraba fecha_caducidad ni
                // aviso de caducado en absoluto salvo en producto_final (auditoría) -- se unifica
                // aquí para los 3 tipos, reutilizando la misma lógica que Producciones.jsx.
                const estado = estadoCaducidad(l.fecha_caducidad)
                const cad = l.fecha_caducidad ? t('ajuste_stock_form:lote_caduca', { fecha: formatFecha(l.fecha_caducidad) }) : ''
                const aviso = estado === 'caducado'
                  ? t('ajuste_stock_form:lote_caducado_aviso')
                  : estado === 'proximo'
                    ? t('ajuste_stock_form:lote_proximo_caducar_aviso', { dias: diasParaCaducar(l.fecha_caducidad) })
                    : ''
                const label = tipo === 'articulo'
                  ? `${masAntiguoPrefijo}${t('ajuste_stock_form:lote_albaran', { numero: l.numero_albaran || t('ajuste_stock_form:lote_sin_numero') })} · ${formatFecha(l.fecha_recepcion)}${cad} · ${stockActualSufijo}${aviso}`
                  : `${masAntiguoPrefijo}${l.codigo_lote ? l.codigo_lote + ' · ' : ''}${t('ajuste_stock_form:lote_produccion', { fecha: formatFecha(l.fecha) })}${cad} · ${stockActualSufijo}${aviso}`
                return <option key={id} value={id}>{label}</option>
              })}
            </Select>
          )}
        </>
      )}

      <Field label={t('ajuste_stock_form:campos.cantidad')}>
        <Input type="number" step="0.001" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          required title={t('common:redondea_3_decimales')} autoFocus={!!fijo} />
      </Field>

      {tipo === 'producto_final' ? (
        <Field label={t('ajuste_stock_form:campos.motivo')}>
          <Select value={motivoCategoria} onChange={(e) => setMotivoCategoria(e.target.value)} required>
            <option value="">{t('ajuste_stock_form:selecciona_motivo')}</option>
            {MOTIVOS_CATEGORIA.map((valor) => (
              <option key={valor} value={valor}>{t(`enums:motivo_categoria.${valor}`)}</option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label={t('ajuste_stock_form:campos.motivo')}>
          <Input type="text" placeholder={t('ajuste_stock_form:motivo_placeholder')} value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        </Field>
      )}

      {tipo === 'producto_final' && (
        <Field label={t('ajuste_stock_form:campos.detalle_motivo_opcional')}>
          <Input type="text" placeholder={t('ajuste_stock_form:detalle_motivo_placeholder')} value={motivoDetalle} onChange={(e) => setMotivoDetalle(e.target.value)} />
        </Field>
      )}

      {(tipo === 'semielaborado' || tipo === 'producto_final') && (
        <Field label={t('ajuste_stock_form:campos.origen_rechazo_opcional')}>
          <Select value={origenRechazo} onChange={(e) => setOrigenRechazo(e.target.value)}>
            <option value="">{t('ajuste_stock_form:sin_origen_rechazo')}</option>
            {(tipo === 'producto_final' && !fijo
              ? ORIGENES_RECHAZO.filter((valor) => valor !== 'cliente' || lineasPedidoCandidatas.length > 0)
              : ORIGENES_RECHAZO
            ).map((valor) => (
              <option key={valor} value={valor}>{t(`enums:origen_rechazo.${valor}`)}</option>
            ))}
          </Select>
        </Field>
      )}

      {tipo === 'producto_final' && !fijo && origenRechazo === 'cliente' && (
        <Field label={t('ajuste_stock_form:campos.linea_pedido_origen')}>
          <Select value={lineaPedidoOrigenIdManual} onChange={(e) => setLineaPedidoOrigenIdManual(e.target.value)} required>
            <option value="">{t('ajuste_stock_form:selecciona_linea_pedido_origen')}</option>
            {lineasPedidoCandidatas.map((l) => (
              <option key={l.linea_pedido_id} value={l.linea_pedido_id}>
                {t('ajuste_stock_form:linea_pedido_origen_opcion', {
                  codigo: l.lineas_pedido_venta?.pedidos_venta?.codigo_pedido || t('common:sin_numero'),
                  cliente: l.albaranes_venta?.clientes?.nombre || t('common:sin_cliente'),
                  cantidad: l.cantidad,
                  fecha: formatFecha(l.albaranes_venta?.fecha),
                })}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="flex gap-2 mt-1">
        <Button type="submit" disabled={guardando}>{guardando ? t('common:actions.saving') : t('ajuste_stock_form:registrar_ajuste')}</Button>
        {onCancelar && <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>}
      </div>
    </form>
  )
}
