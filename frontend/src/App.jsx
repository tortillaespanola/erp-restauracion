import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Articulos from './pages/Articulos'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-slate-900 text-white p-4 flex gap-6">
          <span className="font-bold">ERP Restauración</span>
          <Link to="/articulos" className="hover:underline">Artículos</Link>
        </nav>

        <Routes>
          <Route path="/articulos" element={<Articulos />} />
          <Route path="/" element={<Articulos />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App