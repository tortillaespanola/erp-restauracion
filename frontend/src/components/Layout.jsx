import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconTruckDelivery, IconPackage, IconFileInvoice, IconReceipt,
  IconComponents, IconStack3, IconTools, IconSquareCheck, IconRoute,
  IconClipboardList, IconClipboardCheck, IconUsers, IconTruck, IconFileDollar, IconSettings, IconSearch, IconLogout,
  IconPlayerPlay, IconStack2, IconBuildingWarehouse, IconCash, IconMenu2, IconBuildingSkyscraper, IconAlertTriangle,
  IconLayoutDashboard,
} from '@tabler/icons-react'
import { cambiarIdioma, IDIOMAS_VALIDOS } from '../i18n'
import { useNegocio } from '../context/useNegocio'
import logoIconOnbrand from '../assets/logos/flowbase-icon-onbrand.svg'

// CONTRATO_I18N.md, Fase 0: las claves (compras/proveedores/...) son estables e independientes
// del idioma -- las etiquetas visibles se resuelven en el render vía t('nav.items.<clave>'), ver
// common.json en cada carpeta de idioma. Antes esta lista llevaba el texto en español directo.
const NAV_SECTIONS = [
  {
    clave: 'general',
    items: [
      { to: '/', clave: 'dashboard', icon: IconLayoutDashboard },
    ],
  },
  {
    clave: 'compras',
    items: [
      { to: '/pedidos-compra', clave: 'pedidos_compra', icon: IconClipboardCheck },
      { to: '/proveedores', clave: 'proveedores', icon: IconTruckDelivery },
      { to: '/articulos', clave: 'articulos', icon: IconPackage },
      { to: '/albaranes-compra', clave: 'albaranes_compra', icon: IconFileInvoice },
      { to: '/facturas-compra', clave: 'facturas_compra', icon: IconReceipt },
      { to: '/pagos-compra', clave: 'pagos_compra', icon: IconCash },
    ],
  },
  {
    clave: 'produccion',
    items: [
      { to: '/pedidos-del-dia', clave: 'pedidos_del_dia', icon: IconStack2 },
      { to: '/inventario', clave: 'inventario', icon: IconBuildingWarehouse },
      { to: '/ingredientes', clave: 'ingredientes', icon: IconComponents },
      { to: '/semielaborados', clave: 'semielaborados', icon: IconStack3 },
      { to: '/producciones', clave: 'producciones', icon: IconPlayerPlay },
      { to: '/ajustes-stock', clave: 'ajustes_stock', icon: IconTools },
      { to: '/incidencias', clave: 'incidencias', icon: IconAlertTriangle },
      { to: '/productos', clave: 'productos', icon: IconSquareCheck },
      { to: '/produccion-productos', clave: 'produccion_productos', icon: IconRoute },
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
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/pedidos-compra': 'pedidos_compra',
  '/proveedores': 'proveedores',
  '/articulos': 'articulos',
  '/albaranes-compra': 'albaranes_compra',
  '/facturas-compra': 'facturas_compra',
  '/pagos-compra': 'pagos_compra',
  '/pedidos-del-dia': 'pedidos_del_dia',
  '/inventario': 'inventario',
  '/cierre-tanda': 'cierre_tanda',
  '/ingredientes': 'ingredientes',
  '/semielaborados': 'semielaborados',
  '/producciones': 'producciones',
  '/ajustes-stock': 'ajustes_stock',
  '/incidencias': 'incidencias',
  '/productos': 'productos',
  '/produccion-productos': 'produccion_productos',
  '/pedidos': 'pedidos',
  '/clientes': 'clientes',
  '/albaranes-venta': 'albaranes_venta',
  '/facturas-venta': 'facturas_venta',
  '/pagos': 'pagos',
  '/configuracion': 'configuracion',
  '/admin/empresas': 'admin_empresas',
}

// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 4: sección aparte, añadida condicionalmente solo si
// esSuperAdmin -- nunca visible para un usuario normal, ni siquiera en el DOM (no es solo
// display:none). La protección real está en la ruta (App.jsx); esto es la otra mitad de "oculta
// del menú" que pide el contrato.
const SECCION_ADMIN = {
  clave: 'administracion',
  items: [{ to: '/admin/empresas', clave: 'admin_empresas', icon: IconBuildingSkyscraper }],
}

const NOMBRE_IDIOMA = { es: 'ES', en: 'EN', de: 'DE' }

function iniciales(email) {
  if (!email) return '?'
  return email.slice(0, 2).toUpperCase()
}

function Layout({ children, session, onLogout }) {
  const location = useLocation()
  const { t, i18n } = useTranslation('common')
  const { esSuperAdmin } = useNegocio()
  const [sidebarAbierto, setSidebarAbierto] = useState(false)
  const claveRuta = RUTA_A_CLAVE[location.pathname]
  const titulo = claveRuta ? t(`titles.${claveRuta}.title`) : 'FlowBase'
  const breadcrumb = claveRuta ? t(`titles.${claveRuta}.breadcrumb`) : ''
  const secciones = esSuperAdmin ? [...NAV_SECTIONS, SECCION_ADMIN] : NAV_SECTIONS

  function cerrarSidebar() {
    setSidebarAbierto(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      {/* CONTRATO_RESPONSIVE_LAYOUT.md: breakpoint md (768px) es el corte sidebar-visible /
          sidebar-drawer. <md el sidebar vive fuera del flujo (fixed) y entra como overlay; en
          md+ vuelve a formar parte del flex normal (md:static, siempre visible, sin transform). */}
      {sidebarAbierto && (
        <div
          className="fixed inset-0 z-40 bg-ink/34 backdrop-blur-[1.5px] md:hidden"
          onClick={cerrarSidebar}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-sidebar bg-surface-sunken border-r border-border flex flex-col shrink-0 transition-transform duration-200 md:translate-x-0 ${
          sidebarAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-topbar flex items-center gap-2.5 px-4 border-b border-border shrink-0">
          <img src={logoIconOnbrand} alt="" width={24} height={24} className="rounded-control shrink-0" />
          <span className="font-semibold text-title text-ink tracking-tight">FlowBase</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-2.5 px-2.5 flex flex-col gap-3.5">
          {secciones.map((seccion) => (
            <div key={seccion.clave} className="flex flex-col gap-px">
              <p className="px-2 pt-1.5 pb-1 text-overline text-ink-faint">
                {t(`nav.sections.${seccion.clave}`)}
              </p>
              {seccion.items.map(({ to, clave, icon: Icon }) => {
                const activo = location.pathname === to
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={cerrarSidebar}
                    className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-control text-meta leading-tight ${
                      activo
                        ? 'bg-primary-100 text-primary-700 font-semibold'
                        : 'text-ink-body/85 hover:bg-surface-hover'
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
        <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-border">
          {IDIOMAS_VALIDOS.map((idioma) => (
            <button
              key={idioma}
              type="button"
              onClick={() => cambiarIdioma(idioma)}
              className={`px-2 py-1 rounded-control text-xs font-medium ${
                i18n.language === idioma ? 'bg-primary-100 text-primary-700' : 'text-ink-subtle hover:bg-surface-hover'
              }`}
            >
              {NOMBRE_IDIOMA[idioma]}
            </button>
          ))}
        </div>

        <Link
          to="/configuracion"
          onClick={cerrarSidebar}
          className={`border-t border-border p-2.5 flex items-center gap-2.5 hover:bg-surface-hover ${
            location.pathname === '/configuracion' ? 'bg-surface-hover' : ''
          }`}
        >
          <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-semibold shrink-0">
            {iniciales(session?.user?.email)}
          </div>
          <div className="text-micro min-w-0">
            <p className="font-medium leading-tight truncate text-ink-body">{session?.user?.email ?? t('actions.default_user')}</p>
            <p className="text-ink-subtle leading-tight flex items-center gap-1">
              <IconSettings size={11} stroke={1.75} /> {t('actions.settings')}
            </p>
          </div>
        </Link>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-topbar bg-surface border-b border-border flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarAbierto(true)}
              className="md:hidden text-ink-faint hover:text-ink-body shrink-0"
              aria-label={t('actions.abrir_menu')}
            >
              <IconMenu2 size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-title text-ink truncate">{titulo}</h1>
              <p className="text-micro text-ink-subtle truncate">{breadcrumb}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <IconSearch size={15} className="absolute left-2.5 top-2.5 text-ink-faint" />
              <input
                placeholder={t('actions.search_placeholder')}
                disabled
                className="pl-8 pr-3 h-control-sm text-body border border-border rounded-control w-56 bg-canvas focus:outline-none focus:border-primary-600 focus:shadow-focus disabled:bg-canvas"
              />
            </div>
            <button
              type="button"
              onClick={onLogout}
              title={t('actions.logout')}
              className="text-ink-faint hover:text-ink-body"
            >
              <IconLogout size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

export default Layout
