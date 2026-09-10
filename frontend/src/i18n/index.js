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
import pagosCompraEs from './es/pagos_compra.json'
import registrarPagoFormEs from './es/registrar_pago_form.json'
import registrarPagoProveedorFormEs from './es/registrar_pago_proveedor_form.json'
import comprasComunEs from './es/compras_comun.json'
import albaranesCompraEs from './es/albaranes_compra.json'
import pedidosCompraEs from './es/pedidos_compra.json'
import facturasCompraEs from './es/facturas_compra.json'
import articulosEs from './es/articulos.json'
import inventarioEs from './es/inventario.json'
import ajustesStockEs from './es/ajustes_stock.json'
import ajusteStockFormEs from './es/ajuste_stock_form.json'
import configuracionEs from './es/configuracion.json'
import contactosComunEs from './es/contactos_comun.json'
import proveedoresEs from './es/proveedores.json'
import clientesEs from './es/clientes.json'
import ingredientesEs from './es/ingredientes.json'
import recetasComunEs from './es/recetas_comun.json'
import semielaboradosEs from './es/semielaborados.json'
import productosFinalesEs from './es/productos_finales.json'
import authGateEs from './es/auth_gate.json'
import cierreTandaEs from './es/cierre_tanda.json'
import albaranVentaFormEs from './es/albaran_venta_form.json'
import facturaVentaFormEs from './es/factura_venta_form.json'

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
import pagosCompraEn from './en/pagos_compra.json'
import registrarPagoFormEn from './en/registrar_pago_form.json'
import registrarPagoProveedorFormEn from './en/registrar_pago_proveedor_form.json'
import comprasComunEn from './en/compras_comun.json'
import albaranesCompraEn from './en/albaranes_compra.json'
import pedidosCompraEn from './en/pedidos_compra.json'
import facturasCompraEn from './en/facturas_compra.json'
import articulosEn from './en/articulos.json'
import inventarioEn from './en/inventario.json'
import ajustesStockEn from './en/ajustes_stock.json'
import ajusteStockFormEn from './en/ajuste_stock_form.json'
import configuracionEn from './en/configuracion.json'
import contactosComunEn from './en/contactos_comun.json'
import proveedoresEn from './en/proveedores.json'
import clientesEn from './en/clientes.json'
import ingredientesEn from './en/ingredientes.json'
import recetasComunEn from './en/recetas_comun.json'
import semielaboradosEn from './en/semielaborados.json'
import productosFinalesEn from './en/productos_finales.json'
import authGateEn from './en/auth_gate.json'
import cierreTandaEn from './en/cierre_tanda.json'
import albaranVentaFormEn from './en/albaran_venta_form.json'
import facturaVentaFormEn from './en/factura_venta_form.json'

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
import pagosCompraDe from './de/pagos_compra.json'
import registrarPagoFormDe from './de/registrar_pago_form.json'
import registrarPagoProveedorFormDe from './de/registrar_pago_proveedor_form.json'
import comprasComunDe from './de/compras_comun.json'
import albaranesCompraDe from './de/albaranes_compra.json'
import pedidosCompraDe from './de/pedidos_compra.json'
import facturasCompraDe from './de/facturas_compra.json'
import articulosDe from './de/articulos.json'
import inventarioDe from './de/inventario.json'
import ajustesStockDe from './de/ajustes_stock.json'
import ajusteStockFormDe from './de/ajuste_stock_form.json'
import configuracionDe from './de/configuracion.json'
import contactosComunDe from './de/contactos_comun.json'
import proveedoresDe from './de/proveedores.json'
import clientesDe from './de/clientes.json'
import ingredientesDe from './de/ingredientes.json'
import recetasComunDe from './de/recetas_comun.json'
import semielaboradosDe from './de/semielaborados.json'
import productosFinalesDe from './de/productos_finales.json'
import authGateDe from './de/auth_gate.json'
import cierreTandaDe from './de/cierre_tanda.json'
import albaranVentaFormDe from './de/albaran_venta_form.json'
import facturaVentaFormDe from './de/factura_venta_form.json'

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
      registrar_pago_proveedor_form: registrarPagoProveedorFormEs,
      compras_comun: comprasComunEs, albaranes_compra: albaranesCompraEs,
      pedidos_compra: pedidosCompraEs, facturas_compra: facturasCompraEs,
      pagos_compra: pagosCompraEs,
      articulos: articulosEs, inventario: inventarioEs, ajustes_stock: ajustesStockEs,
      ajuste_stock_form: ajusteStockFormEs, configuracion: configuracionEs,
      contactos_comun: contactosComunEs, proveedores: proveedoresEs, clientes: clientesEs,
      ingredientes: ingredientesEs, recetas_comun: recetasComunEs,
      semielaborados: semielaboradosEs, productos_finales: productosFinalesEs,
      auth_gate: authGateEs, cierre_tanda: cierreTandaEs,
      albaran_venta_form: albaranVentaFormEs, factura_venta_form: facturaVentaFormEs,
    },
    en: {
      common: commonEn, enums: enumsEn, estados_calculados: estadosCalculadosEn,
      produccion_comun: produccionComunEn, producciones: produccionesEn,
      produccion_productos_finales: produccionProductosFinalesEn,
      pedidos_del_dia: pedidosDelDiaEn, pedidos: pedidosEn, pedido_form: pedidoFormEn,
      ventas_comun: ventasComunEn, albaranes_venta: albaranesVentaEn,
      facturas_venta: facturasVentaEn, pagos: pagosEn, registrar_pago_form: registrarPagoFormEn,
      registrar_pago_proveedor_form: registrarPagoProveedorFormEn,
      compras_comun: comprasComunEn, albaranes_compra: albaranesCompraEn,
      pedidos_compra: pedidosCompraEn, facturas_compra: facturasCompraEn,
      pagos_compra: pagosCompraEn,
      articulos: articulosEn, inventario: inventarioEn, ajustes_stock: ajustesStockEn,
      ajuste_stock_form: ajusteStockFormEn, configuracion: configuracionEn,
      contactos_comun: contactosComunEn, proveedores: proveedoresEn, clientes: clientesEn,
      ingredientes: ingredientesEn, recetas_comun: recetasComunEn,
      semielaborados: semielaboradosEn, productos_finales: productosFinalesEn,
      auth_gate: authGateEn, cierre_tanda: cierreTandaEn,
      albaran_venta_form: albaranVentaFormEn, factura_venta_form: facturaVentaFormEn,
    },
    de: {
      common: commonDe, enums: enumsDe, estados_calculados: estadosCalculadosDe,
      produccion_comun: produccionComunDe, producciones: produccionesDe,
      produccion_productos_finales: produccionProductosFinalesDe,
      pedidos_del_dia: pedidosDelDiaDe, pedidos: pedidosDe, pedido_form: pedidoFormDe,
      ventas_comun: ventasComunDe, albaranes_venta: albaranesVentaDe,
      facturas_venta: facturasVentaDe, pagos: pagosDe, registrar_pago_form: registrarPagoFormDe,
      registrar_pago_proveedor_form: registrarPagoProveedorFormDe,
      compras_comun: comprasComunDe, albaranes_compra: albaranesCompraDe,
      pedidos_compra: pedidosCompraDe, facturas_compra: facturasCompraDe,
      pagos_compra: pagosCompraDe,
      articulos: articulosDe, inventario: inventarioDe, ajustes_stock: ajustesStockDe,
      ajuste_stock_form: ajusteStockFormDe, configuracion: configuracionDe,
      contactos_comun: contactosComunDe, proveedores: proveedoresDe, clientes: clientesDe,
      ingredientes: ingredientesDe, recetas_comun: recetasComunDe,
      semielaborados: semielaboradosDe, productos_finales: productosFinalesDe,
      auth_gate: authGateDe, cierre_tanda: cierreTandaDe,
      albaran_venta_form: albaranVentaFormDe, factura_venta_form: facturaVentaFormDe,
    },
  },
  lng: idiomaInicial(),
  fallbackLng: 'es',
  ns: [
    'common', 'enums', 'estados_calculados', 'produccion_comun', 'producciones',
    'produccion_productos_finales', 'pedidos_del_dia', 'pedidos', 'pedido_form',
    'ventas_comun', 'albaranes_venta', 'facturas_venta', 'pagos', 'registrar_pago_form',
    'registrar_pago_proveedor_form',
    'compras_comun', 'albaranes_compra', 'pedidos_compra', 'facturas_compra', 'pagos_compra',
    'articulos', 'inventario', 'ajustes_stock', 'ajuste_stock_form', 'configuracion',
    'contactos_comun', 'proveedores', 'clientes', 'ingredientes', 'recetas_comun',
    'semielaborados', 'productos_finales', 'auth_gate', 'cierre_tanda',
    'albaran_venta_form', 'factura_venta_form',
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
