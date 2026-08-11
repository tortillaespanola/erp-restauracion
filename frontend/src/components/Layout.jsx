import { Link, useLocation } from 'react-router-dom'
import {
  IconToolsKitchen2, IconTruckDelivery, IconPackage, IconFileInvoice, IconReceipt,
  IconChefHat, IconSoup, IconTools, IconBowlSpoon, IconFlame,
  IconClipboardList, IconClipboardCheck, IconUsers, IconTruck, IconFileDollar, IconSettings, IconSearch, IconBell, IconLogout,
  IconCarrot, IconStack2,
} from '@tabler/icons-react'

const NAV_SECTIONS = [
  {
    titulo: 'Compras',
    items: [
      { to: '/pedidos-compra', label: 'Pedidos de compra', icon: IconClipboardCheck },
      { to: '/proveedores', label: 'Proveedores', icon: IconTruckDelivery },
      { to: '/articulos', label: 'Artículos', icon: IconPackage },
      { to: '/albaranes-compra', label: 'Albaranes compra', icon: IconFileInvoice },
      { to: '/facturas-compra', label: 'Facturas compra', icon: IconReceipt },
    ],
  },
  {
    titulo: 'Producción',
    items: [
      { to: '/pedidos-del-dia', label: 'Pedidos del día', icon: IconStack2 },
      { to: '/ingredientes', label: 'Ingredientes', icon: IconCarrot },
      { to: '/semielaborados', label: 'Semielaborados', icon: IconChefHat },
      { to: '/producciones', label: 'Producciones', icon: IconSoup },
      { to: '/ajustes-stock', label: 'Ajustes de stock', icon: IconTools },
      { to: '/productos', label: 'Productos finales', icon: IconBowlSpoon },
      { to: '/produccion-productos', label: 'Producción prod. finales', icon: IconFlame },
    ],
  },
  {
    titulo: 'Ventas',
    items: [
      { to: '/pedidos', label: 'Pedidos', icon: IconClipboardList },
      { to: '/clientes', label: 'Clientes', icon: IconUsers },
      { to: '/albaranes-venta', label: 'Albaranes venta', icon: IconTruck },
      { to: '/facturas-venta', label: 'Facturas venta', icon: IconFileDollar },
    ],
  },
]

const TITULOS = {
  '/pedidos-compra': ['Pedidos de compra', 'Compras · Pedidos de compra'],
  '/proveedores': ['Proveedores', 'Compras · Proveedores'],
  '/articulos': ['Artículos de compra', 'Compras · Artículos'],
  '/albaranes-compra': ['Albaranes de compra', 'Compras · Albaranes compra'],
  '/facturas-compra': ['Facturas de compra', 'Compras · Facturas compra'],
  '/pedidos-del-dia': ['Pedidos del día', 'Producción · Pedidos del día'],
  '/ingredientes': ['Ingredientes', 'Producción · Ingredientes'],
  '/semielaborados': ['Semielaborados', 'Producción · Semielaborados'],
  '/producciones': ['Producciones', 'Producción · Producciones'],
  '/ajustes-stock': ['Ajustes de stock', 'Producción · Ajustes de stock'],
  '/productos': ['Productos finales', 'Producción · Productos finales'],
  '/produccion-productos': ['Producción de productos finales', 'Producción · Producción prod. finales'],
  '/pedidos': ['Pedidos', 'Ventas · Pedidos'],
  '/clientes': ['Clientes', 'Ventas · Clientes'],
  '/albaranes-venta': ['Albaranes de venta', 'Ventas · Albaranes venta'],
  '/facturas-venta': ['Facturas de venta', 'Ventas · Facturas venta'],
  '/configuracion': ['Configuración', 'Configuración de empresa'],
}

function iniciales(email) {
  if (!email) return '?'
  return email.slice(0, 2).toUpperCase()
}

function Layout({ children, session, onLogout }) {
  const location = useLocation()
  const [titulo, breadcrumb] = TITULOS[location.pathname] ?? ['ERP Restauración', '']

  return (
    <div className="flex h-screen overflow-hidden bg-[#F5F6F8] text-[#1C2938]">
      <aside className="w-60 bg-[#0854A0] text-white flex flex-col shrink-0">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded bg-white/15 flex items-center justify-center shrink-0">
            <IconToolsKitchen2 size={18} stroke={1.75} />
          </div>
          <span className="font-semibold text-sm tracking-wide">ERP RESTAURACIÓN</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 text-sm">
          {NAV_SECTIONS.map((seccion) => (
            <div key={seccion.titulo}>
              <p className="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-blue-200/70 first:pt-2">
                {seccion.titulo}
              </p>
              {seccion.items.map(({ to, label, icon: Icon }) => {
                const activo = location.pathname === to
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-3 px-4 py-2 border-l-[3px] ${
                      activo
                        ? 'bg-[#0A3D62] border-[#4FA3E3] font-medium text-white'
                        : 'border-transparent text-blue-50 hover:bg-white/10'
                    }`}
                  >
                    <Icon size={17} stroke={1.75} className="shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <Link
          to="/configuracion"
          className={`p-3 border-t border-white/10 flex items-center gap-2 hover:bg-white/10 ${
            location.pathname === '/configuracion' ? 'bg-white/10' : ''
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-blue-200 text-blue-900 flex items-center justify-center text-xs font-semibold shrink-0">
            {iniciales(session?.user?.email)}
          </div>
          <div className="text-xs min-w-0">
            <p className="font-medium leading-tight truncate">{session?.user?.email ?? 'Usuario'}</p>
            <p className="text-blue-200/70 leading-tight flex items-center gap-1">
              <IconSettings size={12} stroke={1.75} /> Configuración
            </p>
          </div>
        </Link>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <div>
            <h1 className="text-[15px] font-semibold text-[#1C2938]">{titulo}</h1>
            <p className="text-xs text-gray-400">{breadcrumb}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <IconSearch size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                placeholder="Buscar..."
                disabled
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
              />
            </div>
            <IconBell size={18} className="text-gray-400" />
            <button
              type="button"
              onClick={onLogout}
              title="Cerrar sesión"
              className="text-gray-400 hover:text-gray-600"
            >
              <IconLogout size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}

export default Layout
