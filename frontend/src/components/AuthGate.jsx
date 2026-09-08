import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import logoIconOnbrand from '../assets/logos/flowbase-icon-onbrand.svg'
import logoIcon from '../assets/logos/flowbase-icon.svg'

function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

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
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email o contraseña incorrectos')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-ink-subtle text-body">
        <img src={logoIcon} alt="" width={40} height={40} />
        Cargando...
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
            <p className="text-meta text-ink-muted">Inicia sesión para continuar</p>
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          <div>
            <label className="text-label text-ink-muted block mb-1">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full h-control border border-border rounded-control px-3 text-body bg-surface transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus" />
          </div>
          {error && <p className="text-danger-600 text-body">{error}</p>}
          <button type="submit" className="h-control bg-primary-600 text-white text-meta font-semibold rounded-control shadow-btn hover:bg-primary-500 active:bg-primary-700">
            Entrar
          </button>
        </form>
      </div>
    )
  }

  return children(session, handleLogout)
}

export default AuthGate
