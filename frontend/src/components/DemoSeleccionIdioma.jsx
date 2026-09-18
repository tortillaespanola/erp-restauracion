import { useTranslation } from 'react-i18next'
import { IDIOMAS_VALIDOS } from '../i18n'
import logoIconOnbrand from '../assets/logos/flowbase-icon-onbrand.svg'

// CONTRATO_DEMO_IDIOMA_TRANSICION.md, decisión #1: la elección vive solo en sessionStorage de
// esta pestaña (ver AuthGate.jsx) -- nunca se escribe en la fila de preferencias del usuario
// demo en BD, porque ese usuario es compartido entre visitantes.
const NOMBRE_IDIOMA = { es: 'Español', en: 'English', de: 'Deutsch' }

function DemoSeleccionIdioma({ onElegir }) {
  const { t } = useTranslation('demo')

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 gap-6">
      <img src={logoIconOnbrand} alt="" width={40} height={40} className="rounded-control shadow-btn" />
      <h1 className="text-title text-ink text-center">{t('seleccion_idioma.titulo')}</h1>
      <div className="flex flex-col gap-2.5 w-full max-w-xs">
        {IDIOMAS_VALIDOS.map((idioma) => (
          <button
            key={idioma}
            type="button"
            onClick={() => onElegir(idioma)}
            className="h-control border border-border text-ink-body text-meta font-medium rounded-control hover:bg-surface-hover hover:border-border-strong"
          >
            {NOMBRE_IDIOMA[idioma]}
          </button>
        ))}
      </div>
    </div>
  )
}

export default DemoSeleccionIdioma
