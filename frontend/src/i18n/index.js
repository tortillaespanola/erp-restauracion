import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import commonEs from './es/common.json'
import enumsEs from './es/enums.json'
import commonEn from './en/common.json'
import enumsEn from './en/enums.json'
import commonDe from './de/common.json'
import enumsDe from './de/enums.json'

// CONTRATO_I18N.md, Fase 0. El idioma real por usuario vive en usuarios_negocios.idioma (con
// fallback a empresa_config.idioma) -- NegocioProvider sincroniza ese valor aquí en cuanto carga
// la sesión. localStorage es solo una caché de lectura inmediata para el primer render (evita un
// parpadeo en español antes de que responda Supabase), nunca la fuente de verdad.
const IDIOMA_STORAGE_KEY = 'erp_idioma'
export const IDIOMAS_VALIDOS = ['es', 'en', 'de']

function idiomaInicial() {
  try {
    const guardado = localStorage.getItem(IDIOMA_STORAGE_KEY)
    if (IDIOMAS_VALIDOS.includes(guardado)) return guardado
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.) -- cae al default sin romper
  }
  return 'es'
}

i18n.use(initReactI18next).init({
  resources: {
    es: { common: commonEs, enums: enumsEs },
    en: { common: commonEn, enums: enumsEn },
    de: { common: commonDe, enums: enumsDe },
  },
  lng: idiomaInicial(),
  fallbackLng: 'es',
  ns: ['common', 'enums'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export function cambiarIdioma(idioma) {
  if (!IDIOMAS_VALIDOS.includes(idioma)) return
  i18n.changeLanguage(idioma)
  try {
    localStorage.setItem(IDIOMA_STORAGE_KEY, idioma)
  } catch {
    // ver comentario en idiomaInicial()
  }
}

export default i18n
