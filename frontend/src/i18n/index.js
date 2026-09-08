import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import commonEs from './es/common.json'
import enumsEs from './es/enums.json'
import estadosCalculadosEs from './es/estados_calculados.json'
import produccionComunEs from './es/produccion_comun.json'
import produccionesEs from './es/producciones.json'
import produccionProductosFinalesEs from './es/produccion_productos_finales.json'
import pedidosDelDiaEs from './es/pedidos_del_dia.json'
import pedidosEs from './es/pedidos.json'
import pedidoFormEs from './es/pedido_form.json'
import ventasComunEs from './es/ventas_comun.json'
import albaranesVentaEs from './es/albaranes_venta.json'
import facturasVentaEs from './es/facturas_venta.json'
import pagosEs from './es/pagos.json'
import registrarPagoFormEs from './es/registrar_pago_form.json'

import commonEn from './en/common.json'
import enumsEn from './en/enums.json'
import estadosCalculadosEn from './en/estados_calculados.json'
import produccionComunEn from './en/produccion_comun.json'
import produccionesEn from './en/producciones.json'
import produccionProductosFinalesEn from './en/produccion_productos_finales.json'
import pedidosDelDiaEn from './en/pedidos_del_dia.json'
import pedidosEn from './en/pedidos.json'
import pedidoFormEn from './en/pedido_form.json'
import ventasComunEn from './en/ventas_comun.json'
import albaranesVentaEn from './en/albaranes_venta.json'
import facturasVentaEn from './en/facturas_venta.json'
import pagosEn from './en/pagos.json'
import registrarPagoFormEn from './en/registrar_pago_form.json'

import commonDe from './de/common.json'
import enumsDe from './de/enums.json'
import estadosCalculadosDe from './de/estados_calculados.json'
import produccionComunDe from './de/produccion_comun.json'
import produccionesDe from './de/producciones.json'
import produccionProductosFinalesDe from './de/produccion_productos_finales.json'
import pedidosDelDiaDe from './de/pedidos_del_dia.json'
import pedidosDe from './de/pedidos.json'
import pedidoFormDe from './de/pedido_form.json'
import ventasComunDe from './de/ventas_comun.json'
import albaranesVentaDe from './de/albaranes_venta.json'
import facturasVentaDe from './de/facturas_venta.json'
import pagosDe from './de/pagos.json'
import registrarPagoFormDe from './de/registrar_pago_form.json'

// CONTRATO_I18N.md, Fase 0. El idioma real por usuario vive en usuarios_negocios.idioma (con
// fallback a empresa_config.idioma) -- NegocioProvider sincroniza ese valor aquí en cuanto carga
// la sesión. localStorage es solo una caché de lectura inmediata para el primer render (evita un
// parpadeo en español antes de que responda Supabase), nunca la fuente de verdad.
const IDIOMA_STORAGE_KEY = 'erp_idioma'
export const IDIOMAS_VALIDOS = ['es', 'en', 'de']

function idiomaInicial() {
  try {
    const guardado = localStorage.getItem(IDIOMA_STORAGE_KEY)
    if (IDIOMAS_VALIDOS.includes(guardado)) return guardado
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.) -- cae al default sin romper
  }
  return 'es'
}

// CONTRATO_I18N.md, Fase 1: estados_calculados es el namespace de estados computados en cliente
// (badges de PedidosDelDia/Producciones/ProduccionProductosFinales) -- nunca van en enums.json,
// que es solo para valores crudos de un CHECK de BD. produccion_comun es compartido entre
// Producciones.jsx y ProduccionProductosFinales.jsx (mismo componente duplicado en la práctica),
// el resto son namespaces de una sola pantalla.
i18n.use(initReactI18next).init({
  resources: {
    es: {
      common: commonEs, enums: enumsEs, estados_calculados: estadosCalculadosEs,
      produccion_comun: produccionComunEs, producciones: produccionesEs,
      produccion_productos_finales: produccionProductosFinalesEs,
      pedidos_del_dia: pedidosDelDiaEs, pedidos: pedidosEs, pedido_form: pedidoFormEs,
      ventas_comun: ventasComunEs, albaranes_venta: albaranesVentaEs,
      facturas_venta: facturasVentaEs, pagos: pagosEs, registrar_pago_form: registrarPagoFormEs,
    },
    en: {
      common: commonEn, enums: enumsEn, estados_calculados: estadosCalculadosEn,
      produccion_comun: produccionComunEn, producciones: produccionesEn,
      produccion_productos_finales: produccionProductosFinalesEn,
      pedidos_del_dia: pedidosDelDiaEn, pedidos: pedidosEn, pedido_form: pedidoFormEn,
      ventas_comun: ventasComunEn, albaranes_venta: albaranesVentaEn,
      facturas_venta: facturasVentaEn, pagos: pagosEn, registrar_pago_form: registrarPagoFormEn,
    },
    de: {
      common: commonDe, enums: enumsDe, estados_calculados: estadosCalculadosDe,
      produccion_comun: produccionComunDe, producciones: produccionesDe,
      produccion_productos_finales: produccionProductosFinalesDe,
      pedidos_del_dia: pedidosDelDiaDe, pedidos: pedidosDe, pedido_form: pedidoFormDe,
      ventas_comun: ventasComunDe, albaranes_venta: albaranesVentaDe,
      facturas_venta: facturasVentaDe, pagos: pagosDe, registrar_pago_form: registrarPagoFormDe,
    },
  },
  lng: idiomaInicial(),
  fallbackLng: 'es',
  ns: [
    'common', 'enums', 'estados_calculados', 'produccion_comun', 'producciones',
    'produccion_productos_finales', 'pedidos_del_dia', 'pedidos', 'pedido_form',
    'ventas_comun', 'albaranes_venta', 'facturas_venta', 'pagos', 'registrar_pago_form',
  ],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export function cambiarIdioma(idioma) {
  if (!IDIOMAS_VALIDOS.includes(idioma)) return
  i18n.changeLanguage(idioma)
  try {
    localStorage.setItem(IDIOMA_STORAGE_KEY, idioma)
  } catch {
    // ver comentario en idiomaInicial()
  }
}

export default i18n
