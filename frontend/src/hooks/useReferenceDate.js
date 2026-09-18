// CONTRATO dashboard-flowbase-spec.md, sección 14.3: el histórico de AlpenWerk termina en
// septiembre 2026 -- si "hoy" se calcula siempre con `new Date()` real, cualquier demo hecha
// bastante más tarde que esa fecha mostraría todo como "retrasado"/"estancado" sin que eso
// refleje nada real del dataset. Este hook centraliza "qué fecha cuenta como hoy" para todo el
// Dashboard, con el reloj real como default y la posibilidad de fijarla a mano para pruebas
// visuales -- ningún cálculo de retraso/antigüedad en Dashboard.jsx debe usar `new Date()`
// directamente, todos pasan por aquí.
import { useState } from 'react'

function hoyIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

export function useReferenceDate() {
  const [fechaReferencia, setFechaReferencia] = useState(hoyIso())

  return {
    fechaReferencia, // ISO 'yyyy-mm-dd', igual que el resto de fechas del proyecto (ver ui.jsx DateInput)
    setFechaReferencia,
    esFechaReal: fechaReferencia === hoyIso(),
    resetear: () => setFechaReferencia(hoyIso()),
  }
}
