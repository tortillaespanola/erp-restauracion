import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Cargando...</div>
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow max-w-sm w-full flex flex-col gap-4">
          <h1 className="text-xl font-bold text-slate-800 text-center">ERP Restauración</h1>
          <p className="text-sm text-slate-500 text-center">Inicia sesión para continuar</p>
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
            className="border rounded px-3 py-2" />
          <input type="password" placeholder="Contraseña" value={password}
            onChange={(e) => setPassword(e.target.value)} required
            className="border rounded px-3 py-2" />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-700">
            Entrar
          </button>
        </form>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-slate-100 px-4 py-1 flex justify-end">
        <button onClick={handleLogout} className="text-xs text-slate-500 hover:underline">
          Cerrar sesión ({session.user.email})
        </button>
      </div>
      {children}
    </div>
  )
}

export default AuthGate