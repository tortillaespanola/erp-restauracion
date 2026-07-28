import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Articulos from './pages/Articulos'
import Semielaborados from './pages/Semielaborados'
import Producciones from './pages/Producciones'
import AjustesStock from './pages/AjustesStock'
import ProductosFinales from './pages/ProductosFinales'
import ProduccionProductosFinales from './pages/ProduccionProductosFinales'
import Proveedores from './pages/Proveedores'
import AlbaranesCompra from './pages/AlbaranesCompra'
import FacturasCompra from './pages/FacturasCompra'
import Clientes from './pages/Clientes'
import AlbaranesVenta from './pages/AlbaranesVenta'
import FacturasVenta from './pages/FacturasVenta'
import Configuracion from './pages/Configuracion'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-slate-900 text-white p-4 flex flex-wrap gap-4 md:gap-6 text-sm">
          <span className="font-bold mr-2">ERP Restauración</span>

          <span className="text-slate-400">Compras:</span>
          <Link to="/proveedores" className="hover:underline">Proveedores</Link>
          <Link to="/articulos" className="hover:underline">Artículos</Link>
          <Link to="/albaranes-compra" className="hover:underline">Albaranes compra</Link>
          <Link to="/facturas-compra" className="hover:underline">Facturas compra</Link>
          
          <span className="text-slate-400 ml-4">Producción:</span>
          <Link to="/semielaborados" className="hover:underline">Semielaborados</Link>
          <Link to="/producciones" className="hover:underline">Producciones</Link>
          <Link to="/ajustes-stock" className="hover:underline">Ajustes de stock</Link>
          <Link to="/productos" className="hover:underline">Productos finales</Link>
          <Link to="/produccion-productos" className="hover:underline">Producción prod. finales</Link>

          <span className="text-slate-400 ml-4">Ventas:</span>
          <Link to="/clientes" className="hover:underline">Clientes</Link>
          <Link to="/albaranes-venta" className="hover:underline">Albaranes venta</Link>
          <Link to="/facturas-venta" className="hover:underline">Facturas venta</Link>

          <Link to="/configuracion" className="hover:underline">Configuración</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Articulos />} />
          <Route path="/articulos" element={<Articulos />} />
          
          <Route path="/semielaborados" element={<Semielaborados />} />
          <Route path="/producciones" element={<Producciones />} />
          <Route path="/ajustes-stock" element={<AjustesStock />} />
          <Route path="/productos" element={<ProductosFinales />} />
          <Route path="/produccion-productos" element={<ProduccionProductosFinales />} />
          <Route path="/proveedores" element={<Proveedores />} />
          <Route path="/albaranes-compra" element={<AlbaranesCompra />} />
          <Route path="/facturas-compra" element={<FacturasCompra />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/albaranes-venta" element={<AlbaranesVenta />} />
          <Route path="/facturas-venta" element={<FacturasVenta />} />
          <Route path="/configuracion" element={<Configuracion />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App