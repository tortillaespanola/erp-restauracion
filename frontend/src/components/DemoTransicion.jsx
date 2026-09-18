import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DURACION_MS = 5000
const LINEAS = ['linea1', 'linea2', 'linea3', 'linea4']
const RETRASO_POR_LINEA_MS = 700

// CONTRATO_DEMO_IDIOMA_TRANSICION.md: texto revelado línea a línea (fade-in escalonado),
// 5s de duración o hasta que se pulse "Continuar" (decisión #4 -- incluido desde el primer build).
function DemoTransicion({ onContinuar }) {
  const { t } = useTranslation('demo')
  const [lineasVisibles, setLineasVisibles] = useState(0)

  useEffect(() => {
    const timersLineas = LINEAS.map((_, i) =>
      setTimeout(() => setLineasVisibles((n) => Math.max(n, i + 1)), i * RETRASO_POR_LINEA_MS)
    )
    const timerFinal = setTimeout(onContinuar, DURACION_MS)
    return () => {
      timersLineas.forEach(clearTimeout)
      clearTimeout(timerFinal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe armarse una vez al montar.
  }, [])

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 gap-8">
      <div className="max-w-md w-full flex flex-col gap-3">
        {LINEAS.map((clave, i) => (
          <p
            key={clave}
            className={`text-title text-ink text-center transition-opacity duration-700 ${
              i < lineasVisibles ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {t(`transicion.${clave}`)}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={onContinuar}
        className="h-control px-5 border border-border text-ink-body text-meta font-medium rounded-control hover:bg-surface-hover"
      >
        {t('transicion.continuar')}
      </button>
    </div>
  )
}

export default DemoTransicion
