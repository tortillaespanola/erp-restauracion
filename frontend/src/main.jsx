import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'
import NegocioProvider from './context/NegocioContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      {(session, onLogout, demoSesion) => (
        <NegocioProvider>
          <App session={session} onLogout={onLogout} demoSesion={demoSesion} />
        </NegocioProvider>
      )}
    </AuthGate>
  </StrictMode>,
)