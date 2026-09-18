import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase, requiereNuevaContrasena } from '../lib/supabase'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../lib/demoAuth'
import { cambiarIdioma } from '../i18n'
import DemoSeleccionIdioma from './DemoSeleccionIdioma'
import DemoTransicion from './DemoTransicion'
import logoIconOnbrand from '../assets/logos/flowbase-icon-onbrand.svg'
import logoIcon from '../assets/logos/flowbase-icon.svg'

// CONTRATO_DEMO_IDIOMA_TRANSICION.md, decisión #1: sessionStorage (no BD) -- el usuario demo es
// compartido entre visitantes, así que persistir el idioma en su fila contaminaría al siguiente
// visitante antes de que llegue a elegir el suyo. Claves propias del demo, ajenas al mecanismo
// de idioma normal de la app (localStorage, ver i18n/index.js).
const CLAVE_DEMO_IDIOMA = 'demo_idioma'

function leerSessionStorage(clave) {
  try {
    return sessionStorage.getItem(clave)
  } catch {
    // sessionStorage puede no estar disponible (modo privado, etc.) -- se repite la selección
    // de idioma/transición esa vez en vez de romper el flujo.
    return null
  }
}

function escribirSessionStorage(clave, valor) {
  try {
    sessionStorage.setItem(clave, valor)
  } catch {
    // ver leerSessionStorage()
  }
}

function AuthGate({ children }) {
  const { t } = useTranslation(['common', 'auth_gate', 'demo'])
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [necesitaContrasena, setNecesitaContrasena] = useState(requiereNuevaContrasena)
  const [nuevaContrasena, setNuevaContrasena] = useState('')
  const [confirmarContrasena, setConfirmarContrasena] = useState('')
  const [demoSesion, setDemoSesion] = useState(null)
  const [demoMensaje, setDemoMensaje] = useState('')
  const [entrandoDemo, setEntrandoDemo] = useState(false)
  const [demoIdioma, setDemoIdioma] = useState(() => leerSessionStorage(CLAVE_DEMO_IDIOMA))
  // CONTRATO_DEMO_IDIOMA_TRANSICION.md, decisión #2: capturado UNA vez al montar -- si ya había
  // un idioma guardado de una carga anterior de esta pestaña (p.ej. F5 a mitad de sesión demo),
  // nunca vuelve a false dentro de este ciclo de vida, así que ambas pantallas (selección y
  // transición) se saltan enteras. Si se elige un idioma recién ahora (demoIdioma pasa de null a
  // un valor durante ESTE render), sigue en false y la transición se muestra una vez, como toca.
  const [demoIdiomaYaEstabaGuardado] = useState(() => leerSessionStorage(CLAVE_DEMO_IDIOMA) !== null)
  const [demoIntroTerminada, setDemoIntroTerminada] = useState(false)

  function handleElegirIdiomaDemo(idioma) {
    cambiarIdioma(idioma)
    escribirSessionStorage(CLAVE_DEMO_IDIOMA, idioma)
    setDemoIdioma(idioma)
  }

  // Temporizador de la sesión demo como efecto (no como funciones manuales que arman/desarman
  // setTimeout): se re-arma solo cuando cambia sesionId/expiresAt (cubre tanto una sesión nueva
  // como el reinicio del contador sobre la misma sesión, CONTRATO_DEMO.md decisión #4), y el
  // cleanup de React cancela los timers automáticamente en cuanto demoSesion pasa a null -- sin
  // necesidad de limpiarlos a mano desde finalizarDemo().
  useEffect(() => {
    if (!demoSesion) return undefined

    const msRestantes = new Date(demoSesion.expiresAt).getTime() - Date.now()
    const msAviso = msRestantes - 2 * 60 * 1000

    const avisoId = msAviso > 0
      ? setTimeout(() => toast(t('demo:aviso_2_minutos.cuerpo'), { icon: '⏳', duration: 8000 }), msAviso)
      : null
    const expiraId = setTimeout(() => finalizarDemo(demoSesion.sesionId, 'timeout'), Math.max(0, msRestantes))

    return () => {
      if (avisoId) clearTimeout(avisoId)
      clearTimeout(expiraId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finalizarDemo/t son estables en la práctica; solo debe re-armar cuando cambia la sesión.
  }, [demoSesion?.sesionId, demoSesion?.expiresAt])

  // Llamado tanto por el corte automático a los 15 min (efecto de arriba) como por la salida
  // manual (handleLogout). El RPC de revert se llama MIENTRAS todavía hay sesión autenticada
  // como usuario demo (el guard de revertir_demo exige negocio_actual() = tenant demo) -- si
  // esta llamada falla por lo que sea, el cron (revertir_demo_expiradas, 20261030, cada 1 min)
  // es la red de seguridad.
  async function finalizarDemo(sesionId, motivo) {
    setDemoSesion(null)
    await supabase.rpc('revertir_demo', { p_sesion_id: sesionId, p_motivo: motivo })
    await supabase.auth.signOut()
    setDemoMensaje(motivo === 'manual' ? t('demo:salida_manual') : t('demo:sesion_expirada'))
  }

  async function handleDemoLogin() {
    setError('')
    setDemoMensaje('')
    setEntrandoDemo(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    })
    if (signInError) {
      setError(t('auth_gate:demo_no_disponible'))
      setEntrandoDemo(false)
      return
    }
    const { data, error: rpcError } = await supabase.rpc('iniciar_demo')
    if (rpcError || !data) {
      // Nunca dejar una sesión autenticada como demo sin un temporizador confirmado por el
      // servidor -- si iniciar_demo() falla, se deshace el login inmediatamente.
      await supabase.auth.signOut()
      setError(t('auth_gate:demo_no_disponible'))
      setEntrandoDemo(false)
      return
    }
    setDemoSesion({ sesionId: data.sesion_id, expiresAt: data.expires_at })
    setEntrandoDemo(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCargando(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setDemoMensaje('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(t('auth_gate:credenciales_incorrectas'))
  }

  // Punto único de logout, expuesto a toda la app vía el render-prop de más abajo (botón del
  // header en Layout.jsx). Si hay una sesión demo activa, revierte los datos antes de cerrar
  // sesión -- así el revert ocurre siempre que el usuario demo cierre sesión por cualquier vía,
  // no solo desde el botón "Salir del demo" del banner.
  async function handleLogout() {
    if (demoSesion) {
      await finalizarDemo(demoSesion.sesionId, 'manual')
      return
    }
    await supabase.auth.signOut()
  }

  async function handleSetPassword(e) {
    e.preventDefault()
    setError('')
    if (nuevaContrasena.length < 6) {
      setError(t('auth_gate:contrasena_muy_corta'))
      return
    }
    if (nuevaContrasena !== confirmarContrasena) {
      setError(t('auth_gate:contrasenas_no_coinciden'))
      return
    }
    const { error } = await supabase.auth.updateUser({ password: nuevaContrasena })
    if (error) {
      setError(error.message)
      return
    }
    setNecesitaContrasena(false)
  }

  // Mientras sepamos (por el hash de la URL, capturado en lib/supabase.js) que venimos de un
  // enlace de invitación/recuperación, esperamos a que la sesión aterrice antes de decidir qué
  // pantalla mostrar -- si no, se ve un parpadeo del formulario de login normal de por medio.
  if (cargando || (necesitaContrasena && !session)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-ink-subtle text-body">
        <img src={logoIcon} alt="" width={40} height={40} />
        {t('common:actions.loading')}
      </div>
    )
  }

  if (necesitaContrasena) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <form onSubmit={handleSetPassword} className="bg-surface p-7 rounded-modal border border-border shadow-overlay max-w-sm w-full flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2.5 mb-1">
            <img src={logoIconOnbrand} alt="" width={40} height={40} className="rounded-control shadow-btn" />
            <h1 className="text-title text-ink">{t('auth_gate:crear_contrasena_titulo')}</h1>
            <p className="text-meta text-ink-muted text-center">{t('auth_gate:crear_contrasena_subtitulo')}</p>
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">{t('auth_gate:nueva_contrasena')}</label>
            <input type="password" value={nuevaContrasena} onChange={(e) => setNuevaContrasena(e.target.value)} required minLength={6}
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">{t('auth_gate:confirmar_contrasena')}</label>
            <input type="password" value={confirmarContrasena} onChange={(e) => setConfirmarContrasena(e.target.value)} required minLength={6}
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          {error && <p className="text-danger-600 text-body">{error}</p>}
          <button type="submit" className="h-control bg-primary-600 text-white text-meta font-semibold rounded-control shadow-btn hover:bg-primary-500 active:bg-primary-700">
            {t('auth_gate:guardar_contrasena')}
          </button>
        </form>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="bg-surface p-7 rounded-modal border border-border shadow-overlay max-w-sm w-full flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2.5 mb-1">
            <img src={logoIconOnbrand} alt="" width={40} height={40} className="rounded-control shadow-btn" />
            <h1 className="text-title text-ink">FlowBase</h1>
            <p className="text-meta text-ink-muted">{t('auth_gate:inicia_sesion_continuar')}</p>
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">{t('auth_gate:email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">{t('auth_gate:contrasena')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          {demoMensaje && <p className="text-success-600 text-body">{demoMensaje}</p>}
          {error && <p className="text-danger-600 text-body">{error}</p>}
          <button type="submit" className="h-control bg-primary-600 text-white text-meta font-semibold rounded-control shadow-btn hover:bg-primary-500 active:bg-primary-700">
            {t('auth_gate:entrar')}
          </button>
          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={entrandoDemo}
            className="h-control border border-border text-ink-body text-meta font-medium rounded-control hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('auth_gate:entrar_demo')}
          </button>
        </form>
      </div>
    )
  }

  // CONTRATO_DEMO_IDIOMA_TRANSICION.md: solo se interpone en el flujo DEMO (demoSesion truthy)
  // -- un login normal aterriza en el ERP exactamente igual que antes de este contrato.
  if (demoSesion && !demoIdiomaYaEstabaGuardado && !demoIntroTerminada) {
    if (!demoIdioma) {
      return <DemoSeleccionIdioma onElegir={handleElegirIdiomaDemo} />
    }
    return <DemoTransicion onContinuar={() => setDemoIntroTerminada(true)} />
  }

  return children(session, handleLogout, demoSesion)
}

export default AuthGate
