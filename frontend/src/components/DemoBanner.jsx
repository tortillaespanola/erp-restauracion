import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClock } from '@tabler/icons-react'

const UMBRAL_URGENTE_MS = 2 * 60 * 1000

function formatearRestante(ms) {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000))
  const minutos = Math.floor(totalSegundos / 60)
  const segundos = totalSegundos % 60
  return `${minutos}:${String(segundos).padStart(2, '0')}`
}

// Cuenta atrás solo visual, con su propio intervalo de 1s -- deliberadamente independiente de
// los setTimeout de corrección en AuthGate.jsx (aviso a 2 min, revert a los 15) para que un
// posible desfase de renderizado aquí nunca afecte a cuándo se revierten los datos de verdad.
function DemoBanner({ expiresAt, onSalir }) {
  const { t } = useTranslation('demo')
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const restanteMs = new Date(expiresAt).getTime() - ahora
  const esUrgente = restanteMs <= UMBRAL_URGENTE_MS

  return (
    <div
      className={`flex items-center justify-between gap-3 px-5 py-2 text-meta shrink-0 ${
        esUrgente ? 'bg-danger-50 text-danger-600' : 'bg-warning-50 text-warning-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <IconClock size={15} stroke={1.75} />
        <span className="font-medium">{t('banner.titulo')}</span>
        <span>· {formatearRestante(restanteMs)}</span>
      </div>
      <button
        type="button"
        onClick={onSalir}
        className="text-meta font-semibold underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        {t('banner.salir')}
      </button>
    </div>
  )
}

export default DemoBanner
