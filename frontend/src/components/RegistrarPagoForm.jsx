import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatMoneda } from '../lib/formatCantidad'
import { documentosPendientesCliente, EPSILON } from '../lib/saldosVenta'
import { Field, Select, Input, DateInput, Textarea, SectionLabel, Button } from './ui'
import { useNegocio } from '../context/useNegocio'

// CONTRATO_I18N.md, Fase 0: mismo enum que METODO_LABEL en Pagos.jsx, consolidado en
// enums.json -- antes estaba duplicado aquí con el texto español fijo.
const METODOS_PAGO = ['efectivo', 'twint', 'tarjeta', 'transferencia']

function claveDoc(d) {
  return `${d.tipo}-${d.id}`
}

// CONTRATO_PAGOS_VENTA.md, Bloque 5: drawer "Registrar pago", patrón Receive Payment. Se usa
// tanto desde Pagos.jsx (alta libre, sin nada preseleccionado) como desde el icono de acceso
// rápido de Facturas/Albaranes (Bloque 6, con clienteIdInicial + documentoPreseleccionado ya
// resueltos por el llamador).
export default function RegistrarPagoForm({ clientes, clienteIdInicial = null, documentoPreseleccionado = null, onGuardado, onCancelar }) {
  const { t } = useTranslation(['common', 'enums', 'registrar_pago_form'])
  const { negocio } = useNegocio()
  const METODOS = METODOS_PAGO.map((value) => ({ value, label: t(`enums:metodo_pago.${value}`) }))
  const [clienteId, setClienteId] = useState(clienteIdInicial != null ? String(clienteIdInicial) : '')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [monto, setMonto] = useState(documentoPreseleccionado ? documentoPreseleccionado.saldo.toFixed(2) : '')
  const [metodo, setMetodo] = useState('')
  const [notas, setNotas] = useState('')

  const [documentos, setDocumentos] = useState([])
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false)
  // key = `${tipo}-${id}` -> { checked, monto }
  const [aplicaciones, setAplicaciones] = useState({})
  // Una vez el usuario toca algo a mano, la auto-aplicación deja de recalcularse al cambiar el
  // monto recibido -- sección 5 del contrato: "la propuesta automática es un punto de partida,
  // no una imposición".
  const [tocadoManualmente, setTocadoManualmente] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    async function cargar() {
      if (!clienteId) {
        setDocumentos([])
        setAplicaciones({})
        return
      }
      setCargandoDocumentos(true)
      try {
        const docs = await documentosPendientesCliente(Number(clienteId))
        setDocumentos(docs)
      } catch (error) {
        console.error(error)
        alert(t('registrar_pago_form:alertas.error_cargar_documentos', { mensaje: error.message }))
        setDocumentos([])
      }
      setAplicaciones({})
      setTocadoManualmente(false)
      setCargandoDocumentos(false)
    }
    cargar()
  }, [clienteId])

  // Auto-aplicación (sección 5): coincidencia exacta con un solo documento -> ese documento
  // completo; si no, FIFO por fecha ascendente (documentos ya llega ordenado así desde
  // saldosVenta.js) hasta agotar el monto o los documentos.
  //
  // BUG REAL corregido (CONTRATO_PAGOS_VENTA.md sección 9, encontrado 2026-09-04): cuando el
  // drawer se abre con documentoPreseleccionado (acceso rápido desde el icono de una factura/
  // albarán concreto), ese documento tenía que competir igual que cualquier otro en la búsqueda
  // de "coincidencia exacta contra TODA la lista" -- si otro documento del mismo cliente empataba
  // en saldo y tenía fecha anterior, ganaba él (caso real: DN-260047 vs RE-2026-003, ambos 50
  // CHF). La corrección distingue los dos casos desde el principio, no como un desempate a
  // posteriori: con preselección, el documento pulsado manda siempre, sin pasar por la búsqueda
  // genérica; sin preselección (alta libre desde Pagos.jsx), el comportamiento no cambia.
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
      // Si el documento preseleccionado ya no está en la lista (p. ej. se saldó por otra vía
      // mientras tanto), no hay nada seguro que marcar automáticamente -- se deja vacío en vez de
      // caer de vuelta a la búsqueda genérica, que es justo el comportamiento que causó el bug.
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
      const montoRecibido = Number(monto) || 0
      const disponible = Math.max(0, montoRecibido - yaAplicado)
      const sugerido = Math.min(d.saldo, disponible || d.saldo)
      return { ...prev, [key]: { checked: true, monto: sugerido.toFixed(2) } }
    })
  }

  function cambiarMontoAplicado(d, valor) {
    setTocadoManualmente(true)
    const key = claveDoc(d)
    setAplicaciones((prev) => ({ ...prev, [key]: { checked: true, monto: valor } }))
  }

  const montoRecibido = Number(monto) || 0
  const totalAplicado = Object.values(aplicaciones).reduce((sum, a) => sum + (a.checked ? Number(a.monto || 0) : 0), 0)
  const sinAplicar = montoRecibido - totalAplicado
  const excedeLoRecibido = totalAplicado > montoRecibido + EPSILON

  let colorIndicador = 'text-gray-500'
  if (montoRecibido > 0) {
    if (excedeLoRecibido) colorIndicador = 'text-red-600'
    else if (Math.abs(sinAplicar) < EPSILON) colorIndicador = 'text-green-600'
    else colorIndicador = 'text-amber-600'
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (excedeLoRecibido) {
      alert(t('registrar_pago_form:alertas.excede_lo_recibido'))
      return
    }

    setGuardando(true)

    const { data: pagoCreado, error: errorPago } = await supabase
      .from('pagos')
      .insert({
        cliente_id: parseInt(clienteId),
        fecha,
        monto: montoRecibido,
        metodo,
        notas: notas || null,
      })
      .select()
      .single()

    if (errorPago) {
      alert(t('registrar_pago_form:alertas.error_registrar_pago', { mensaje: errorPago.message }))
      setGuardando(false)
      return
    }

    const filasAplicacion = documentos
      .map((d) => ({ d, apl: aplicaciones[claveDoc(d)] }))
      .filter(({ apl }) => apl?.checked && Number(apl.monto) > 0)
      .map(({ d, apl }) => ({
        pago_id: pagoCreado.id,
        factura_venta_id: d.tipo === 'factura' ? d.id : null,
        albaran_venta_id: d.tipo === 'albaran' ? d.id : null,
        monto_aplicado: Number(apl.monto),
      }))

    if (filasAplicacion.length > 0) {
      const { error: errorAplicacion } = await supabase.from('pago_aplicacion').insert(filasAplicacion)
      if (errorAplicacion) {
        await supabase.from('pagos').delete().eq('id', pagoCreado.id)
        alert(t('registrar_pago_form:alertas.error_aplicar_pago', { mensaje: errorAplicacion.message }))
        setGuardando(false)
        return
      }
    }

    setGuardando(false)
    onGuardado(pagoCreado.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={t('registrar_pago_form:campos.cliente')}>
          <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
            <option value="">{t('registrar_pago_form:selecciona_cliente')}</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('registrar_pago_form:campos.fecha')}>
          <DateInput value={fecha} onChange={setFecha} required />
        </Field>
        <Field label={t('registrar_pago_form:campos.monto_recibido', { moneda: negocio?.moneda || 'CHF' })}>
          <Input type="number" step="0.01" min="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required />
        </Field>
        <Field label={t('registrar_pago_form:campos.metodo')}>
          <Select value={metodo} onChange={(e) => setMetodo(e.target.value)} required>
            <option value="">{t('registrar_pago_form:selecciona_metodo')}</option>
            {METODOS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={`text-sm font-medium ${colorIndicador}`}>
        {t('registrar_pago_form:aplicado_recibido', { aplicado: formatMoneda(totalAplicado, negocio?.moneda), recibido: formatMoneda(montoRecibido, negocio?.moneda) })}
        {excedeLoRecibido && t('registrar_pago_form:excede_lo_recibido_aviso')}
      </div>

      <Field label={t('registrar_pago_form:notas_opcional')}>
        <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
      </Field>

      <div>
        <SectionLabel>{t('registrar_pago_form:documentos_saldo_pendiente_titulo')}</SectionLabel>

        {!clienteId ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_form:elige_cliente_primero')}</p>
        ) : cargandoDocumentos ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_form:cargando_documentos')}</p>
        ) : documentos.length === 0 ? (
          <p className="text-sm text-gray-400">{t('registrar_pago_form:sin_documentos_pendientes')}</p>
        ) : (
          // Ajuste tras pruebas reales (sección 5 del contrato, actualizada): una lista plana
          // mezclando facturas y albaranes hacía que una factura real pasara desapercibida entre
          // albaranes -- se agrupa visualmente por tipo, con un encabezado por grupo. Puramente
          // visual: `documentos` sigue siendo el mismo array plano y en el mismo orden (fecha
          // ascendente) que usa la auto-aplicación FIFO más arriba, esto solo cambia cómo se
          // renderiza, no qué ni en qué orden se procesa.
          <div className="flex flex-col gap-3">
            {[
              { tipo: 'factura', titulo: t('registrar_pago_form:grupo_facturas') },
              { tipo: 'albaran', titulo: t('registrar_pago_form:grupo_albaranes') },
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
                            {t('registrar_pago_form:doc_saldo_linea', { codigo: d.codigo, fecha: formatFecha(d.fecha), saldo: formatMoneda(d.saldo, negocio?.moneda) })}
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
        <Button type="submit" disabled={guardando || excedeLoRecibido} className="flex-1">
          {guardando ? t('common:actions.saving') : t('registrar_pago_form:guardar_pago')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancelar}>{t('common:actions.cancel')}</Button>
      </div>
    </form>
  )
}
