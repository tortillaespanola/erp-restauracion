import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconToolsKitchen2, IconTruckDelivery, IconPackage, IconFileInvoice, IconReceipt,
  IconChefHat, IconSoup, IconTools, IconBowlSpoon, IconFlame,
  IconClipboardList, IconClipboardCheck, IconUsers, IconTruck, IconFileDollar, IconSettings, IconSearch, IconBell, IconLogout,
  IconCarrot, IconStack2, IconBuildingWarehouse, IconCash,
} from '@tabler/icons-react'
import { cambiarIdioma, IDIOMAS_VALIDOS } from '../i18n'

// CONTRATO_I18N.md, Fase 0: las claves (compras/proveedores/...) son estables e independientes
// del idioma -- las etiquetas visibles se resuelven en el render vía t('nav.items.<clave>'), ver
// common.json en cada carpeta de idioma. Antes esta lista llevaba el texto en español directo.
const NAV_SECTIONS = [
  {
    clave: 'compras',
    items: [
      { to: '/pedidos-compra', clave: 'pedidos_compra', icon: IconClipboardCheck },
      { to: '/proveedores', clave: 'proveedores', icon: IconTruckDelivery },
      { to: '/articulos', clave: 'articulos', icon: IconPackage },
      { to: '/albaranes-compra', clave: 'albaranes_compra', icon: IconFileInvoice },
      { to: '/facturas-compra', clave: 'facturas_compra', icon: IconReceipt },
    ],
  },
  {
    clave: 'produccion',
    items: [
      { to: '/pedidos-del-dia', clave: 'pedidos_del_dia', icon: IconStack2 },
      { to: '/inventario', clave: 'inventario', icon: IconBuildingWarehouse },
      { to: '/ingredientes', clave: 'ingredientes', icon: IconCarrot },
      { to: '/semielaborados', clave: 'semielaborados', icon: IconChefHat },
      { to: '/producciones', clave: 'producciones', icon: IconSoup },
      { to: '/ajustes-stock', clave: 'ajustes_stock', icon: IconTools },
      { to: '/productos', clave: 'productos', icon: IconBowlSpoon },
      { to: '/produccion-productos', clave: 'produccion_productos', icon: IconFlame },
    ],
  },
  {
    clave: 'ventas',
    items: [
      { to: '/pedidos', clave: 'pedidos', icon: IconClipboardList },
      { to: '/clientes', clave: 'clientes', icon: IconUsers },
      { to: '/albaranes-venta', clave: 'albaranes_venta', icon: IconTruck },
      { to: '/facturas-venta', clave: 'facturas_venta', icon: IconFileDollar },
      { to: '/pagos', clave: 'pagos', icon: IconCash },
    ],
  },
]

// Ruta -> clave de traducción en titles.* (ver common.json). Mismo mapeo que antes tenía TITULOS,
// solo que ahora guarda la clave en vez del texto ya resuelto.
const RUTA_A_CLAVE = {
  '/pedidos-compra': 'pedidos_compra',
  '/proveedores': 'proveedores',
  '/articulos': 'articulos',
  '/albaranes-compra': 'albaranes_compra',
  '/facturas-compra': 'facturas_compra',
  '/pedidos-del-dia': 'pedidos_del_dia',
  '/inventario': 'inventario',
  '/cierre-tanda': 'cierre_tanda',
  '/ingredientes': 'ingredientes',
  '/semielaborados': 'semielaborados',
  '/producciones': 'producciones',
  '/ajustes-stock': 'ajustes_stock',
  '/productos': 'productos',
  '/produccion-productos': 'produccion_productos',
  '/pedidos': 'pedidos',
  '/clientes': 'clientes',
  '/albaranes-venta': 'albaranes_venta',
  '/facturas-venta': 'facturas_venta',
  '/pagos': 'pagos',
  '/configuracion': 'configuracion',
}

const NOMBRE_IDIOMA = { es: 'ES', en: 'EN', de: 'DE' }

function iniciales(email) {
  if (!email) return '?'
  return email.slice(0, 2).toUpperCase()
}

function Layout({ children, session, onLogout }) {
  const location = useLocation()
  const { t, i18n } = useTranslation('common')
  const claveRuta = RUTA_A_CLAVE[location.pathname]
  const titulo = claveRuta ? t(`titles.${claveRuta}.title`) : 'FlowBase'
  const breadcrumb = claveRuta ? t(`titles.${claveRuta}.breadcrumb`) : ''

  return (
    <div className="flex h-screen overflow-hidden bg-[#F5F6F8] text-[#1C2938]">
      <aside className="w-60 bg-[#0854A0] text-white flex flex-col shrink-0">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded bg-white/15 flex items-center justify-center shrink-0">
            <IconToolsKitchen2 size={18} stroke={1.75} />
          </div>
          <span className="font-semibold text-sm tracking-wide">FLOWBASE</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 text-sm">
          {NAV_SECTIONS.map((seccion) => (
            <div key={seccion.clave}>
              <p className="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-blue-200/70 first:pt-2">
                {t(`nav.sections.${seccion.clave}`)}
              </p>
              {seccion.items.map(({ to, clave, icon: Icon }) => {
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
                    {t(`nav.items.${clave}`)}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* CONTRATO_I18N.md, Fase 0: cambia el idioma de interfaz al instante (sin recargar,
            i18next re-renderiza todo lo que usa useTranslation) y lo persiste en localStorage --
            la persistencia por usuario en usuarios_negocios.idioma se conecta aquí en cuanto la
            migración de BD esté aplicada. */}
        <div className="flex items-center justify-center gap-1 px-4 py-2 border-t border-white/10">
          {IDIOMAS_VALIDOS.map((idioma) => (
            <button
              key={idioma}
              type="button"
              onClick={() => cambiarIdioma(idioma)}
              className={`px-2 py-1 rounded text-xs font-medium ${
                i18n.language === idioma ? 'bg-white/20 text-white' : 'text-blue-200/70 hover:bg-white/10'
              }`}
            >
              {NOMBRE_IDIOMA[idioma]}
            </button>
          ))}
        </div>

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
            <p className="font-medium leading-tight truncate">{session?.user?.email ?? t('actions.default_user')}</p>
            <p className="text-blue-200/70 leading-tight flex items-center gap-1">
              <IconSettings size={12} stroke={1.75} /> {t('actions.settings')}
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
                placeholder={t('actions.search_placeholder')}
                disabled
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
              />
            </div>
            <IconBell size={18} className="text-gray-400" />
            <button
              type="button"
              onClick={onLogout}
              title={t('actions.logout')}
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
