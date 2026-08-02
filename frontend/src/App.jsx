import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Articulos from './pages/Articulos'
import Semielaborados from './pages/Semielaborados'
import Producciones from './pages/Producciones'
import AjustesStock from './pages/AjustesStock'
import ProductosFinales from './pages/ProductosFinales'
import ProduccionProductosFinales from './pages/ProduccionProductosFinales'
import Proveedores from './pages/Proveedores'
import PedidosCompra from './pages/PedidosCompra'
import AlbaranesCompra from './pages/AlbaranesCompra'
import FacturasCompra from './pages/FacturasCompra'
import Pedidos from './pages/Pedidos'
import Clientes from './pages/Clientes'
import AlbaranesVenta from './pages/AlbaranesVenta'
import FacturasVenta from './pages/FacturasVenta'
import Configuracion from './pages/Configuracion'

function App({ session, onLogout }) {
  return (
    <BrowserRouter>
      <Layout session={session} onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<Articulos />} />
          <Route path="/articulos" element={<Articulos />} />

          <Route path="/semielaborados" element={<Semielaborados />} />
          <Route path="/producciones" element={<Producciones />} />
          <Route path="/ajustes-stock" element={<AjustesStock />} />
          <Route path="/productos" element={<ProductosFinales />} />
          <Route path="/produccion-productos" element={<ProduccionProductosFinales />} />
          <Route path="/proveedores" element={<Proveedores />} />
          <Route path="/pedidos-compra" element={<PedidosCompra />} />
          <Route path="/albaranes-compra" element={<AlbaranesCompra />} />
          <Route path="/facturas-compra" element={<FacturasCompra />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/albaranes-venta" element={<AlbaranesVenta />} />
          <Route path="/facturas-venta" element={<FacturasVenta />} />
          <Route path="/configuracion" element={<Configuracion />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
