import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconToolsKitchen2 } from '@tabler/icons-react'

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
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6F8] text-gray-400 text-sm">
        Cargando...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg border border-gray-200 max-w-sm w-full flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 mb-2">
            <div className="w-11 h-11 rounded-lg bg-[#0854A0] flex items-center justify-center">
              <IconToolsKitchen2 size={24} stroke={1.75} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-[#1C2938]">ERP Restauración</h1>
            <p className="text-sm text-gray-400">Inicia sesión para continuar</p>
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-500 block mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-500 block mb-1">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" className="bg-[#0854A0] text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-[#0A3D62]">
            Entrar
          </button>
        </form>
      </div>
    )
  }

  return children(session, handleLogout)
}

export default AuthGate
