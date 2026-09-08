import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { NegocioContext } from './useNegocio'
import logoIcon from '../assets/logos/flowbase-icon.svg'

// CONTRATO_MULTITENANT.md, Tarea 5 (alcance reducido): no hay selector multi-negocio -- el
// escenario real es un usuario por negocio. Lo unico que hace falta es no dejar que la app
// renderice en silencio cuando negocio_actual() no puede resolver ningun negocio para el
// usuario (huerfano, sin fila en usuarios_negocios) -- hasta ahora cada pantalla hacia
// console.error(error) y seguia mostrando una lista vacia, indistinguible de "negocio sin datos
// todavia" (ver hallazgo documentado en el propio contrato).
//
// Se reutiliza empresa_config (ya es 1:1 con el negocio) en vez de crear una tabla o RPC nueva
// solo para esto -- confirmado en vivo con un usuario de prueba desechable que el error que
// PostgREST propaga cuando negocio_actual() lanza su excepcion tiene code 'P0001' y el mensaje
// empieza por "negocio_actual():" -- ese code es el que se usa para distinguir el caso "sin
// negocio asignado" de cualquier otro fallo inesperado (red, etc.).
function NegocioProvider({ children }) {
  const [negocio, setNegocio] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function cargar() {
      const { data, error } = await supabase.from('empresa_config').select('*').single()
      if (cancelado) return
      if (error) setError(error)
      else setNegocio(data)
      setCargando(false)
    }

    cargar()
    return () => {
      cancelado = true
    }
  }, [])

  if (cargando) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-ink-subtle text-body">
        <img src={logoIcon} alt="" width={40} height={40} />
        Cargando...
      </div>
    )
  }

  if (error) {
    const sinNegocioAsignado = error.code === 'P0001'
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="bg-surface p-8 rounded-modal border border-border shadow-overlay max-w-sm w-full text-center flex flex-col gap-3">
          <h1 className="text-title text-ink">
            {sinNegocioAsignado ? 'Tu usuario no tiene ningún negocio asignado' : 'No se pudo cargar tu negocio'}
          </h1>
          <p className="text-body text-ink-muted">
            {sinNegocioAsignado
              ? 'Contacta al administrador para que te asigne a un negocio antes de continuar.'
              : 'Ha ocurrido un error inesperado. Inténtalo de nuevo o contacta al administrador.'}
          </p>
        </div>
      </div>
    )
  }

  return <NegocioContext.Provider value={{ negocio }}>{children}</NegocioContext.Provider>
}

export default NegocioProvider
