# CONTRATO_I18N.md

## Objetivo

Hacer el ERP multilenguaje en español, inglés y alemán — interfaz (menús, botones,
etiquetas, mensajes), no el contenido introducido por cada negocio (nombres de
proveedores, artículos, notas), que permanece en el idioma en que se escribió.

## Fuera de alcance (explícitamente, para esta fase)

- Traducción automática de datos ya existentes
- Idiomas adicionales a los tres acordados
- Traducción de contenido generado por IA (si en el futuro se usa) — solo interfaz fija

## Decisiones de alcance pendientes (a confirmar antes de implementar)

1. **¿Idioma por negocio o por usuario?** Propuesta: idioma por defecto en
   `empresa_config` (por negocio), con posibilidad de que cada usuario lo cambie sobre
   la marcha sin afectar al resto.
2. **PDFs (facturas, albaranes) — ¿en qué idioma se generan?** Deben decidirse con el
   mismo cuidado que el formato de numeración (Tareas 4/7 del contrato multi-tenant):
   ¿siempre en el idioma del negocio, o elegible al momento de generar el documento?
3. **Alcance de la primera fase:** ¿toda la interfaz de una vez, o un subconjunto
   (navegación + pantallas más usadas) primero, con el resto incremental?

## Tarea 1 — Investigación previa (sin tocar código)

Antes de escribir ninguna traducción, pedir a Claude Code:

1. Inventario del volumen real: cuántos archivos y cuántas cadenas de texto fijas hay
   hoy en español directamente en el código (no en constantes/config).
2. Recomendación de librería para React + Vite (candidata natural: `react-i18next`) y
   justificación.
3. Cómo tratar los **enums de negocio** (p. ej. `motivo_categoria`, estados de
   pedido/factura) — hoy la vista `historial_ajustes_stock` ya traduce algunos valores
   fijos a una etiqueta; hay que decidir si esa traducción vive en el frontend (vía
   i18n) o se queda en la base de datos, para no duplicar la lógica en dos sitios.
4. Formato de número/fecha/moneda por idioma (CHF, separador decimal, orden
   día/mes/año) — confirmar qué usa cada pantalla hoy y qué debería cambiar por idioma.
5. Estructura de archivos de traducción propuesta (namespaces por módulo vs. un único
   archivo por idioma) y convención de claves.
6. Plan de migración incremental: qué pantallas se traducen primero sin dejar la app en
   un estado mixto confuso (mitad en español fijo, mitad ya traducido).

## Decisiones de alcance (confirmadas)

1. **Idioma por negocio + override por usuario:** `empresa_config.idioma` (por defecto
   del negocio) y `usuarios_negocios.idioma` nullable (si es NULL, hereda el del
   negocio). `localStorage` puede usarse como caché de lectura inmediata, pero la
   fuente de verdad vive en base de datos — necesario para que el idioma persista
   entre dispositivos/logins, no solo en el navegador actual.
2. **PDFs en el idioma del negocio** (`empresa_config.idioma`), no del usuario que
   genera el documento — mismo principio que el formato de numeración (Tareas 4/7 del
   contrato multi-tenant): es una propiedad del negocio, no de la sesión. Elegir
   idioma por cliente/documento queda como fase futura, fuera de alcance aquí.
3. **Por fases, por criticidad operativa, no por volumen** — cada fase se da por
   cerrada solo cuando esa pantalla está 100% traducida y verificada en los 3 idiomas
   en navegador real, nunca a medias.
4. **Formato de fecha en inglés: europeo (`dd/mm/yyyy`)**, no americano — el negocio
   opera en Suiza, y mezclar `mm/dd/yyyy` con el resto de idiomas de la misma interfaz
   generaría ambigüedad real en las fechas.

## Hallazgos incorporados al alcance (no son solo diseño, son bugs activos)

- **Duplicación real del mapeo enum→etiqueta:** ya vive tanto en
  `AjusteStockForm.jsx:7-12` (`MOTIVO_CATEGORIA_LABEL`) como en un `CASE WHEN`
  reimplementado en `20260927_ajustes_stock_usuario_historial.sql:69-74`. Corrección:
  la base de datos solo guarda/devuelve el valor crudo del enum; toda traducción a
  etiqueta vive en el frontend, en un único namespace `enums.json`. Esto es la Fase 0
  de todos modos, así que se corrige como parte del mismo trabajo, no aparte.
- **Bug de moneda €/CHF — confirmado, no es una decisión abierta:** `€` es un error
  heredado de una plantilla/ejemplo inicial. La moneda correcta para el negocio en
  Basilea es **CHF**. Corrección a incluir en este contrato: separar "qué moneda"
  (hecho del negocio, campo en `empresa_config`, hoy inconsistente entre `€` disperso
  y `CHF` en `RegistrarPagoForm.jsx:231`) de "cómo se formatea el número" (depende del
  idioma, vía `Intl.NumberFormat(locale, {style:'currency', currency: negocio.moneda})`).

## Librería y estructura

- **react-i18next** (estándar de facto en React, cero fricción con Vite, soporta
  namespaces y pluralización nativa por idioma — necesario porque es/en/de pluralizan
  distinto).
- Estructura: `frontend/src/i18n/{es,en,de}/{common,enums,<módulo>}.json`. Claves
  semánticas (`actions.save`), nunca el texto en español como clave literal.

## Plan de migración por fases

- **Fase 0 (infraestructura):** instalar `react-i18next`, montar `i18n/`, selector de
  idioma + persistencia (`usuarios_negocios.idioma`), `common.json` (nav/Layout) y
  `enums.json` — corrigiendo de paso la duplicación SQL, misma pieza de trabajo.
- **Fase 1 (uso diario):** `PedidosDelDia`, `Pedidos`, `Producciones`,
  `ProduccionProductosFinales`.
- **Fase 2 (documentos comerciales):** `AlbaranesVenta`, `FacturasVenta`,
  `Pagos`/`RegistrarPagoForm`, generación de PDFs (aquí entra la decisión de idioma
  de PDF). Si se confirma el bug €/CHF, se corrige aquí también (mismos archivos).
- **Fase 3 (back office):** `AlbaranesCompra`, `PedidosCompra`, `FacturasCompra`,
  `Articulos`, `Inventario`, `AjustesStock`, `Configuración`.

## Inventario real (auditado, no estimado)

39 archivos en `frontend/src` (31 `.jsx` + 8 `.js`), 36 de 39 (92%) con texto visible
en español. Los 5 con más volumen: `PedidosDelDia.jsx` (~291 líneas), `Producciones.jsx`
(~207), `ProduccionProductosFinales.jsx` (~183), `AlbaranesVenta.jsx` (~159),
`AlbaranVentaForm.jsx` (~144). Ninguna librería de i18n instalada hoy.

## Plan de prueba

Cambiar el idioma debe reflejarse de inmediato en toda la interfaz visible sin recargar
la página, y debe persistir entre sesiones (usuario) sin pisar el idioma por defecto
del negocio para otros usuarios del mismo negocio.

## Limitaciones conocidas (documentadas, no bugs pendientes de esta fase)

- **Buscador de `AjustesStock.jsx` no es i18n-aware:** compara contra el valor crudo en
  español del enum (`caducado`, `evento_no_consumido`), así que buscar en inglés/alemán
  (p. ej. "Expired") no encuentra resultados aunque la tabla ya se muestre traducida.
  Fuera de alcance de Fase 0 — a resolver en una fase posterior de búsqueda i18n-aware
  (probablemente traduciendo el término de búsqueda antes de consultar, o manteniendo
  un índice de búsqueda en los tres idiomas). Es probable que el mismo patrón aparezca
  en otros buscadores de la app conforme avancen las fases — vigilar.
