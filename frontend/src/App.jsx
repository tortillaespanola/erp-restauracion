import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { IconCircleCheck, IconAlertCircle } from '@tabler/icons-react'
import Layout from './components/Layout'
import { useNegocio } from './context/useNegocio'
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
import AdminEmpresas from './pages/AdminEmpresas'

// Ajuste visual del toast (react-hot-toast): estilo inline para forzar que gane sobre las reglas
// por defecto de la librería (inyectadas en runtime por goober, con orden en el <head>
// impredecible frente al bundle de Tailwind) -- mismos tokens que tailwind.config.js (surface,
// ink.body, border, radius "card", shadow "raised") en vez de clases, para que no dependa de
// qué stylesheet se inyectó último.
const TOAST_STYLE = {
  background: '#ffffff',
  color: 'oklch(0.30 0.02 265)',
  border: '1px solid oklch(0.925 0.004 265)',
  borderRadius: '10px',
  boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 8px 24px -12px rgba(16,24,40,.18)',
  fontFamily: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: '12.5px',
  lineHeight: '17px',
  padding: '10px 14px',
  maxWidth: '420px',
}

// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 4: la ruta /admin/empresas está protegida a nivel de
// ruta (no solo oculta del menú, ver Layout.jsx) -- un usuario sin esSuperAdmin que teclee la
// URL directamente es redirigido, nunca ve el componente. En sentido inverso, un super_admin
// puro (sin negocio, ver NegocioContext.jsx) es redirigido DESDE cualquier otra ruta hacia
// /admin/empresas -- el resto de pantallas del ERP consultan tablas particionadas por
// negocio_id y no tienen ningún sentido (ni funcionan: negocio_actual() lanzaría excepción bajo
// RLS) para un usuario que no pertenece a ningún negocio.
function Enrutado() {
  const { negocio, esSuperAdmin } = useNegocio()
  const location = useLocation()

  const superAdminSinNegocio = esSuperAdmin && !negocio
  if (superAdminSinNegocio && location.pathname !== '/admin/empresas') {
    return <Navigate to="/admin/empresas" replace />
  }

  return (
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
      <Route path="/admin/empresas" element={esSuperAdmin ? <AdminEmpresas /> : <Navigate to="/" replace />} />
    </Routes>
  )
}

function App({ session, onLogout }) {
  return (
    <BrowserRouter>
      <Toaster
        position="top-center"
        toastOptions={{
          style: TOAST_STYLE,
          success: { icon: <IconCircleCheck size={18} stroke={1.75} className="text-success-600" /> },
          error: { icon: <IconAlertCircle size={18} stroke={1.75} className="text-danger-600" /> },
        }}
      />
      <Layout session={session} onLogout={onLogout}>
        <Enrutado />
      </Layout>
    </BrowserRouter>
  )
}

export default App
