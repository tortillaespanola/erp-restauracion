import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Articulos from './pages/Articulos'
import Materiales from './pages/Materiales'
import Semielaborados from './pages/Semielaborados'
import ProductosFinales from './pages/ProductosFinales'
import Clientes from './pages/Clientes'
import Albaranes from './pages/Albaranes'
import Facturas from './pages/Facturas'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-slate-900 text-white p-4 flex flex-wrap gap-4 md:gap-6">
          <span className="font-bold mr-2">ERP Restauración</span>
          <Link to="/articulos" className="hover:underline">Artículos</Link>
          <Link to="/materiales" className="hover:underline">Materiales</Link>
          <Link to="/semielaborados" className="hover:underline">Semielaborados</Link>
          <Link to="/productos" className="hover:underline">Productos finales</Link>
          <Link to="/clientes" className="hover:underline">Clientes</Link>
          <Link to="/albaranes" className="hover:underline">Albaranes</Link>
          <Link to="/facturas" className="hover:underline">Facturas</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Articulos />} />
          <Route path="/articulos" element={<Articulos />} />
          <Route path="/materiales" element={<Materiales />} />
          <Route path="/semielaborados" element={<Semielaborados />} />
          <Route path="/productos" element={<ProductosFinales />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/albaranes" element={<Albaranes />} />
          <Route path="/facturas" element={<Facturas />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App