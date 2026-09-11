import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/ui'
import ConfiguracionGeneral from './configuracion/ConfiguracionGeneral'
import ConfiguracionErp from './configuracion/ConfiguracionErp'
import ConfiguracionBancaria from './configuracion/ConfiguracionBancaria'

// CONTRATO_CONFIGURACION_SUBMENUS.md, sección 3: tabs internas dentro de /configuracion con
// estado local -- sin sub-rutas nuevas en el router (pantalla de baja frecuencia de uso, no
// necesita ser enlazable por URL). Cada pestaña es un componente separado que se monta/desmonta
// al cambiar de pestaña (no las 3 a la vez ocultas con CSS): así cada una vuelve a cargar su
// propio estado fresco de la base de datos al activarse, en vez de arriesgarse a que un guardado
// en una pestaña pise con datos obsoletos el de otra que comparte la misma tabla (empresa_config,
// leída tanto en General como en el selector de idioma de ERP).
const TABS = [
  { clave: 'general', Componente: ConfiguracionGeneral },
  { clave: 'erp', Componente: ConfiguracionErp },
  { clave: 'bancario', Componente: ConfiguracionBancaria },
]

function Configuracion() {
  const { t } = useTranslation(['configuracion'])
  const [tabActiva, setTabActiva] = useState('general')

  const { Componente } = TABS.find((tab) => tab.clave === tabActiva)

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('configuracion:titulo')} subtitle={t('configuracion:subtitulo')} />

      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map(({ clave }) => (
          <button
            key={clave}
            type="button"
            onClick={() => setTabActiva(clave)}
            className={`px-3 py-2 text-meta font-medium border-b-2 -mb-px transition-colors ${
              tabActiva === clave
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-subtle hover:text-ink-body'
            }`}
          >
            {t(`configuracion:tabs.${clave}`)}
          </button>
        ))}
      </div>

      <Componente />
    </div>
  )
}

export default Configuracion
