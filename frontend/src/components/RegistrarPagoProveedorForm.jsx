import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import { documentosPendientesProveedor, EPSILON } from '../lib/saldosCompra'
import { Field, Select, Input, DateInput, Textarea, SectionLabel, Button } from './ui'
import { useNegocio } from '../context/useNegocio'

// Mismo enum que RegistrarPagoForm.jsx (metodo_pago es compartido entre cobro y pago, no depende
// de la dirección del dinero).
const METODOS_PAGO = ['efectivo', 'twint', 'tarjeta', 'transferencia']

function claveDoc(d) {
  return `${d.tipo}-${d.id}`
}

// CONTRATO_PAGOS_COMPRA.md, sección 4.2: espejo de RegistrarPagoForm.jsx (venta) -- mismos campos,
// misma auto-aplicación FIFO, misma validación de "no aplicar más de lo pagado" -- adaptado a
// insertar en pagos con proveedor_id (no cliente_id) y en pago_aplicacion con
// factura_compra_id/albaran_compra_id (no las columnas de venta). Sin lógica de negocio nueva, solo
// el espejo de nombres de tabla/columna, igual que saldosCompra.js respecto a saldosVenta.js.
export default function RegistrarPagoProveedorForm({ proveedores, proveedorIdInicial = null, documentoPreseleccionado = null, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'registrar_pago_proveedor_form'])
  const { negocio } = useNegocio()
  const METODOS = METODOS_PAGO.map((value) => ({ value, label: t(`enums:metodo_pago.${value}`) }))
  const [proveedorId, setProveedorId] = useState(proveedorIdInicial != null ? String(proveedorIdInicial) : '')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [monto, setMonto] = useState(documentoPreseleccionado ? documentoPreseleccionado.saldo.toFixed(2) : '')
  const [metodo, setMetodo] = useState('')
  const [notas, setNotas] = useState('')

  const [documentos, setDocumentos] = useState([])
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false)
  // key = `${tipo}-${id}` -> { checked, monto }
  const [aplicaciones, setAplicaciones] = useState({})
  // Una vez el usuario toca algo a mano, la auto-aplicación deja de recalcularse al cambiar el
  // monto pagado -- mismo criterio que RegistrarPagoForm.jsx: la propuesta automática es un punto
  // de partida, no una imposición.
  const [tocadoManualmente, setTocadoManualmente] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    async function cargar() {
      if (!proveedorId) {
        setDocumentos([])
        setAplicaciones({})
        return
      }
      setCargandoDocumentos(true)
      try {
        const docs = await documentosPendientesProveedor(Number(proveedorId))
        setDocumentos(docs)
      } catch (error) {
        console.error(error)
        alert(t('registrar_pago_proveedor_form:alertas.error_cargar_documentos', { mensaje: error.message }))
        setDocumentos([])
      }
      setAplicaciones({})
      setTocadoManualmente(false)
      setCargandoDocumentos(false)
    }
    cargar()
  }, [proveedorId])

  // Auto-aplicación: idéntica a RegistrarPagoForm.jsx (coincidencia exacta con un solo documento,
  // si no FIFO por fecha ascendente) -- incluyendo la misma corrección de la preselección
  // compitiendo con la búsqueda genérica (CONTRATO_PAGOS_VENTA.md sección 9, bug real ya corregido
  // allí, replicado aquí tal cual para no reintroducirlo).
  useEffect(() => {
    if (tocadoManualmente) return
    const montoNum = Number(monto)
    if (documentos.length === 0 || !montoNum || montoNum <= 0) {
      setAplicaciones({})
      return
    }

    if (documentoPreseleccionado) {
      const doc = documentos.find(
        (d) => d.tipo === documentoPreseleccionado.tipo && d.id === documentoPreseleccionado.id
      )
      if (doc) {
        setAplicaciones({ [claveDoc(doc)]: { checked: true, monto: Math.min(doc.saldo, montoNum).toFixed(2) } })
      } else {
        setAplicaciones({})
      }
      return
    }

    const exacto = documentos.find((d) => Math.abs(d.saldo - montoNum) < EPSILON)
    const nuevas = {}
    if (exacto) {
      nuevas[claveDoc(exacto)] = { checked: true, monto: exacto.saldo.toFixed(2) }
    } else {
      let restante = montoNum
      for (const d of documentos) {
        if (restante <= EPSILON) break
        const aplicar = Math.min(d.saldo, restante)
        if (aplicar > 0) {
          nuevas[claveDoc(d)] = { checked: true, monto: aplicar.toFixed(2) }
          restante -= aplicar
        }
      }
    }
    setAplicaciones(nuevas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monto, documentos])

  function toggleDocumento(d) {
    setTocadoManualmente(true)
    const key = claveDoc(d)
    setAplicaciones((prev) => {
      const actual = prev[key]
      if (actual?.checked) {
        const resto = { ...prev }
        delete resto[key]
        return resto
      }
      const yaAplicado = Object.values(prev).reduce((sum, a) => sum + Number(a.monto || 0), 0)
      const montoPagado = Number(monto) || 0
      const disponible = Math.max(0, montoPagado - yaAplicado)
      const sugerido = Math.min(d.saldo, disponible || d.saldo)
      return { ...prev, [key]: { checked: true, monto: sugerido.toFixed(2) } }
    })
  }

  function cambiarMontoAplicado(d, valor) {
    setTocadoManualmente(true)
    const key = claveDoc(d)
    setAplicaciones((prev) => ({ ...prev, [key]: { checked: true, monto: valor } }))
  }

  const montoPagado = Number(monto) || 0
  const totalAplicado = Object.values(aplicaciones).reduce((sum, a) => sum + (a.checked ? Number(a.monto || 0) : 0), 0)
  const sinAplicar = montoPagado - totalAplicado
  const excedeLoPagado = totalAplicado > montoPagado + EPSILON

  let colorIndicador = 'text-gray-500'
  if (montoPagado > 0) {
    if (excedeLoPagado) colorIndicador = 'text-red-600'
    else if (Math.abs(sinAplicar) < EPSILON) colorIndicador = 'text-green-600'
    else colorIndicador = 'text-amber-600'
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (excedeLoPagado) {
      alert(t('registrar_pago_proveedor_form:alertas.excede_lo_pagado'))
      return
    }

    setGuardando(true)

    const { data: pagoCreado, error: errorPago } = await supabase
      .from('pagos')
      .insert({
        proveedor_id: parseInt(proveedorId),
        fecha,
        monto: montoPagado,
        metodo,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorPago) {
      alert(t('registrar_pago_proveedor_form:alertas.error_registrar_pago', { mensaje: errorPago.message }))
      setGuardando(false)
      return
    }

    const filasAplicacion = documentos
      .map((d) => ({ d, apl: aplicaciones[claveDoc(d)] }))
      .filter(({ apl }) => apl?.checked && Number(apl.monto) > 0)
      .map(({ d, apl }) => ({
        pago_id: pagoCreado.id,
        factura_compra_id: d.tipo === 'factura' ? d.id : null,
        albaran_compra_id: d.tipo === 'albaran' ? d.id : null,
        monto_aplicado: Number(apl.monto),
      }))

    if (filasAplicacion.length > 0) {
      const { error: errorAplicacion } = await supabase.from('pago_aplicacion').insert(filasAplicacion)
      if (errorAplicacion) {
        await supabase.from('pagos').delete().eq('id', pagoCreado.id)
        alert(t('registrar_pago_proveedor_form:alertas.error_aplicar_pago', { mensaje: errorAplicacion.message }))
        setGuardando(false)
        return
      }
    }

    setGuardando(false)
    toast.success(t('common:feedback.guardado'))
    onGuardado(pagoCreado.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={t('registrar_pago_proveedor_form:campos.proveedor')}>
          <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
            <option value="">{t('compras_comun:selecciona_proveedor')}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('registrar_pago_proveedor_form:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={t('registrar_pago_proveedor_form:campos.monto_pagado', { moneda: negocio?.moneda || 'CHF' })}>
          <Input type="number" step="0.01" min="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required />
        </Field>
        <Field label={t('registrar_pago_proveedor_form:campos.metodo')}>
          <Select value={metodo} onChange={(e) => setMetodo(e.target.value)} required>
            <option value="">{t('registrar_pago_proveedor_form:selecciona_metodo')}</option>
            {METODOS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={`text-sm font-medium ${colorIndicador}`}>
        {t('registrar_pago_proveedor_form:aplicado_pagado', { aplicado: formatMoneda(totalAplicado, negocio?.moneda), recibido: formatMoneda(montoPagado, negocio?.moneda) })}
        {excedeLoPagado && t('registrar_pago_proveedor_form:excede_lo_pagado_aviso')}
      </div>

      <Field label={t('registrar_pago_proveedor_form:notas_opcional')}>
        <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
      </Field>

      <div>
        <SectionLabel>{t('registrar_pago_proveedor_form:documentos_saldo_pendiente_titulo')}</SectionLabel>

        {!proveedorId ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_proveedor_form:elige_proveedor_primero')}</p>
        ) : cargandoDocumentos ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_proveedor_form:cargando_documentos')}</p>
        ) : documentos.length === 0 ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_proveedor_form:sin_documentos_pendientes')}</p>
        ) : (
          // Mismo agrupamiento visual por tipo que RegistrarPagoForm.jsx (sección 5 del contrato de
          // venta, ya probado en real): documentos sigue siendo el mismo array plano en orden de
          // fecha ascendente que usa la auto-aplicación FIFO más arriba.
          <div className="flex flex-col gap-3">
            {[
              { tipo: 'factura', titulo: t('registrar_pago_proveedor_form:grupo_facturas') },
              { tipo: 'albaran', titulo: t('registrar_pago_proveedor_form:grupo_albaranes') },
            ].map(({ tipo, titulo }) => {
              const docsDelGrupo = documentos.filter((d) => d.tipo === tipo)
              if (docsDelGrupo.length === 0) return null
              return (
                <div key={tipo}>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{titulo}</p>
                  <div className="flex flex-col gap-1.5">
                    {docsDelGrupo.map((d) => {
                      const key = claveDoc(d)
                      const apl = aplicaciones[key]
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={!!apl?.checked} onChange={() => toggleDocumento(d)} />
                          <span className="flex-1">
                            {t('registrar_pago_proveedor_form:doc_saldo_linea', { codigo: d.codigo, fecha: formatFecha(d.fecha), saldo: formatMoneda(d.saldo, negocio?.moneda) })}
                          </span>
                          <Input
                            type="number" step="0.01" min="0"
                            className="w-24"
                            value={apl?.monto ?? ''}
                            disabled={!apl?.checked}
                            onChange={(e) => cambiarMontoAplicado(d, e.target.value)}
                          />
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-1">
        <Button type="submit" disabled={guardando || excedeLoPagado} className="flex-1">
          {guardando ? t('common:actions.saving') : t('registrar_pago_proveedor_form:guardar_pago')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  )
}
