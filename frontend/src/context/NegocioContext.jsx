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
//
// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 4: un super_admin, por diseño (ver migración
// 20261009_super_admin_empresas.sql), puede no tener NINGUNA fila en usuarios_negocios -- para
// él, el error P0001 de arriba es el caso normal, no una anomalía. Sin este chequeo adicional,
// un super_admin puro quedaría atrapado para siempre en la pantalla de "sin negocio asignado" y
// jamás podría llegar a /admin/empresas. Se consulta super_admins en paralelo con empresa_config
// (no en cascada) para no penalizar con un round-trip extra al caso normal (usuario de negocio,
// sin super_admin) que es el 100% del tráfico real hoy.
function NegocioProvider({ children }) {
  const [negocio, setNegocio] = useState(null)
  const [esSuperAdmin, setEsSuperAdmin] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function cargar() {
      const [resultadoNegocio, resultadoSuperAdmin] = await Promise.all([
        supabase.from('empresa_config').select('*').single(),
        supabase.from('super_admins').select('usuario_id').maybeSingle(),
      ])
      if (cancelado) return

      const superAdmin = !resultadoSuperAdmin.error && !!resultadoSuperAdmin.data
      setEsSuperAdmin(superAdmin)

      if (resultadoNegocio.error) {
        const sinNegocioAsignado = resultadoNegocio.error.code === 'P0001'
        // Un super_admin sin negocio no es un error a mostrar -- ver nota arriba.
        if (!(sinNegocioAsignado && superAdmin)) setError(resultadoNegocio.error)
      } else {
        setNegocio(resultadoNegocio.data)
      }
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

  return <NegocioContext.Provider value={{ negocio, esSuperAdmin }}>{children}</NegocioContext.Provider>
}

export default NegocioProvider
