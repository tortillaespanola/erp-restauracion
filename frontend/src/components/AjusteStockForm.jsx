import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad } from '../lib/formatCantidad'
import { Field, Input, Select, Button } from './ui'

// CONTRATO_I18N.md, Fase 0: claves del enum motivo_categoria (fijas en BD) -- la etiqueta
// visible se resuelve con t('enums:motivo_categoria.<clave>'), ver enums.json. Antes
// MOTIVO_CATEGORIA_LABEL tenía el texto español fijo, y estaba duplicado en la vista SQL
// historial_ajustes_stock (ver migración 20260907_i18n_idioma_moneda.sql).
const MOTIVOS_CATEGORIA = ['caducado', 'roto', 'evento_no_consumido', 'otro']

const hoyIso = () => new Date().toISOString().slice(0, 10)

// Formulario de alta de ajuste de stock, único componente para los 2 puntos de entrada
// (CONTRATO_AJUSTE_RAPIDO_INVENTARIO.md: drawer contextual de Inventario.jsx + "+ Nuevo ajuste"
// de AjustesStock.jsx) -- misma lógica de escritura (inserts directos, sin RPC, igual que el
// formulario original), solo cambia si tipo/ítem/lote vienen fijados por el contexto de la fila
// o los elige el usuario.
//
// `fijo`: { tipo, itemId, itemNombre, itemUnidad, loteId, loteLabel, stockActual } | null
//   Cuando viene informado, tipo/ítem/lote se muestran como contexto de solo lectura (no hay
//   selectores) -- caso Inventario.jsx, siempre tipo 'articulo' hoy porque es el único nivel que
//   esa pantalla expone. `null` = modo manual, igual que el formulario original de AjustesStock.jsx.
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
  const [guardando, setGuardando] = useState(false)

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
    } else if (!itemId || !loteId || !cantidad || !motivo) {
      alert(t('ajuste_stock_form:alertas.faltan_campos'))
      return
    }

    const cant = parseFloat(cantidad)
    const fecha = hoyIso()
    setGuardando(true)

    let error
    if (tipo === 'articulo') {
      ;({ error } = await supabase.from('ajustes_articulo').insert({
        articulo_id: parseInt(itemId), entrada_material_id: parseInt(loteId), cantidad: cant, motivo, fecha,
      }))
    } else if (tipo === 'semielaborado') {
      ;({ error } = await supabase.from('ajustes_semielaborado').insert({
        semielaborado_id: parseInt(itemId), produccion_id: parseInt(loteId), cantidad: cant, motivo, fecha,
      }))
    } else {
      ;({ error } = await supabase.from('ajustes_producto_final').insert({
        produccion_pf_id: parseInt(loteId), cantidad: cant, motivo_categoria: motivoCategoria, motivo_detalle: motivoDetalle || null, fecha,
      }))
    }

    setGuardando(false)
    if (error) {
      alert(t('ajuste_stock_form:alertas.error_guardar', { mensaje: error.message }))
      return
    }
    onGuardado()
  }

  const items = tipo === 'articulo' ? articulos : tipo === 'semielaborado' ? semielaborados : productosFinales
  const unidad = fijo ? fijo.itemUnidad : tipo === 'producto_final' ? 'ud' : items.find((i) => i.id === parseInt(itemId))?.unidad

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fijo ? (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm">
          <p className="font-medium text-ink">{fijo.itemNombre}</p>
          <p className="text-gray-500 text-xs mt-0.5">{fijo.loteLabel}</p>
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
                const label = tipo === 'articulo'
                  ? `${masAntiguoPrefijo}${t('ajuste_stock_form:lote_albaran', { numero: l.numero_albaran || t('ajuste_stock_form:lote_sin_numero') })} · ${formatFecha(l.fecha_recepcion)} · ${stockActualSufijo}`
                  : tipo === 'semielaborado'
                  ? `${masAntiguoPrefijo}${l.codigo_lote ? l.codigo_lote + ' · ' : ''}${t('ajuste_stock_form:lote_produccion', { fecha: formatFecha(l.fecha) })} · ${stockActualSufijo}`
                  : `${masAntiguoPrefijo}${l.codigo_lote ? l.codigo_lote + ' · ' : ''}${t('ajuste_stock_form:lote_produccion', { fecha: formatFecha(l.fecha) })}${l.fecha_caducidad ? t('ajuste_stock_form:lote_caduca', { fecha: formatFecha(l.fecha_caducidad) }) : ''} · ${stockActualSufijo}`
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

      <div className="flex gap-2 mt-1">
        <Button type="submit" disabled={guardando}>{guardando ? t('common:actions.saving') : t('ajuste_stock_form:registrar_ajuste')}</Button>
        {onCancelar && <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>}
      </div>
    </form>
  )
}
