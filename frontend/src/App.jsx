import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import Articulos from './pages/Articulos'
import Ingredientes from './pages/Ingredientes'
import Inventario from './pages/Inventario'
import Semielaborados from './pages/Semielaborados'
import PedidosDelDia from './pages/PedidosDelDia'
import CierreTanda from './pages/CierreTanda'
import Producciones from './pages/Producciones'
import AjustesStock from './pages/AjustesStock'
import ProductosFinales from './pages/ProductosFinales'
import ProduccionProductosFinales from './pages/ProduccionProductosFinales'
import Proveedores from './pages/Proveedores'
import PedidosCompra from './pages/PedidosCompra'
import AlbaranesCompra from './pages/AlbaranesCompra'
import FacturasCompra from './pages/FacturasCompra'
import PagosCompra from './pages/PagosCompra'
import Pedidos from './pages/Pedidos'
import Clientes from './pages/Clientes'
import AlbaranesVenta from './pages/AlbaranesVenta'
import FacturasVenta from './pages/FacturasVenta'
import Pagos from './pages/Pagos'
import Configuracion from './pages/Configuracion'

function App({ session, onLogout }) {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Layout session={session} onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<Articulos />} />
          <Route path="/articulos" element={<Articulos />} />

          <Route path="/ingredientes" element={<Ingredientes />} />
          <Route path="/inventario" element={<Inventario />} />
          <Route path="/semielaborados" element={<Semielaborados />} />
          <Route path="/pedidos-del-dia" element={<PedidosDelDia />} />
          <Route path="/cierre-tanda" element={<CierreTanda />} />
          <Route path="/producciones" element={<Producciones />} />
          <Route path="/ajustes-stock" element={<AjustesStock />} />
          <Route path="/productos" element={<ProductosFinales />} />
          <Route path="/produccion-productos" element={<ProduccionProductosFinales />} />
          <Route path="/proveedores" element={<Proveedores />} />
          <Route path="/pedidos-compra" element={<PedidosCompra />} />
          <Route path="/albaranes-compra" element={<AlbaranesCompra />} />
          <Route path="/facturas-compra" element={<FacturasCompra />} />
          <Route path="/pagos-compra" element={<PagosCompra />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/albaranes-venta" element={<AlbaranesVenta />} />
          <Route path="/facturas-venta" element={<FacturasVenta />} />
          <Route path="/pagos" element={<Pagos />} />
          <Route path="/configuracion" element={<Configuracion />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
