# CONTRATO_AJUSTES_RECHAZO_CLIENTE.md

## Contexto

Investigando un stock negativo (`-2`) en un lote ya completamente servido, se
encontró la causa: un ajuste de tipo `rechazo cliente` registrado sobre un
lote sin stock físico restante. La fórmula de la vista
`stock_lotes_producto_final` (`cantidad_producida − servido + ajustes`) es
correcta y no requiere cambios. El problema no está en el cálculo, sino en:

1. Un hueco de validación que permite crear el ajuste sin el dato necesario
   para poder resolverlo después.
2. La ausencia de una señal visual que distinga "negativo por rechazo
   pendiente de resolver" de "negativo por error real de datos".

Caso de referencia: ajuste `#11` sobre el lote `FG-ALP-C001-260005`
(`origen_rechazo='cliente'`, `tipo_resolucion IS NULL`,
`linea_pedido_origen_id IS NULL`), que bloquea la RPC
`resolver_rechazo_cliente` porque esta no sabe a qué línea de pedido reponer.

## Objetivo

- Impedir que se puedan crear ajustes de rechazo de cliente sin los datos
  necesarios para resolverlos.
- Hacer visualmente distinguible, en Inventario y en Incidencias de Stock,
  un lote en negativo por rechazo pendiente frente a uno en negativo por
  error de datos genuino.

## Alcance

### Fase 1 — Validación de datos en ajustes por rechazo de cliente

- Cuando `origen_rechazo = 'cliente'`, el formulario de incidencias de stock
  debe exigir `linea_pedido_origen_id` como campo obligatorio antes de
  permitir guardar el ajuste.
- A nivel de base de datos: añadir un CHECK constraint condicional (o
  trigger, según lo que permita el motor para constraints condicionales)
  en la tabla de ajustes que impida `origen_rechazo = 'cliente'` con
  `linea_pedido_origen_id IS NULL`.
- Migración de datos: identificar ajustes existentes con este patrón
  (como el `#11`) y completar manualmente el campo faltante antes de
  activar el constraint, para no romper filas históricas.

### Fase 2 — Señal visual para stock negativo por rechazo pendiente

- Añadir un indicador (badge o icono) en `Inventario.jsx` y en la vista de
  detalle de lote que distinga:
  - Stock negativo por rechazo de cliente sin resolver (ajuste con
    `tipo_resolucion IS NULL` y `origen_rechazo = 'cliente'` vinculado al
    lote).
  - Stock negativo por cualquier otra causa (tratado como posible error de
    datos real, a revisar manualmente).
- Implementación sugerida: una consulta/vista derivada que compruebe, por
  lote, si existen ajustes pendientes de resolución vinculados — sin tocar
  la fórmula de `stock_disponible` en la vista existente.

## Decisiones a confirmar antes de bloquear el contrato

1. ¿El constraint de la Fase 1 debe implementarse a nivel de base de datos
   (CHECK/trigger), o basta con la validación en el formulario/frontend?
2. ¿La distinción visual de la Fase 2 se muestra como badge en
   `Inventario.jsx`, o prefieres un estado/sub-sección dedicada dentro del
   panel de Incidencias de Stock?
3. ¿Se revisan también otras `motivo_categoria` (además de `cliente`) que
   puedan tener el mismo problema de campo obligatorio ausente?

## Fuera de alcance

- Cambiar la fórmula de cálculo de `stock_disponible` en la vista
  `stock_lotes_producto_final`.
- Corregir automáticamente ajustes históricos con datos incompletos (se
  trata como paso de migración manual en la Fase 1, no como corrección
  automática).

## 8. Resultado de ejecución (2026-09-18)

Decisiones confirmadas antes de bloquear el contrato: constraint a nivel de
BD + validación en frontend; señal visual en ambos sitios (badge junto al
lote/producto + filtro dedicado en Incidencias de Stock); alcance acotado a
`origen_rechazo='cliente'`, sin auditar otras `motivo_categoria`.

**Fase 1 — migración `20261026_validacion_rechazo_cliente.sql`:**
- Auditados los 2 ajustes históricos que violaban la regla (no solo el #11
  del contexto): #11 (lote FG-ALP-C001-260005) se completó con
  `linea_pedido_origen_id=610` (único pedido al que se envió ese lote, sin
  ambigüedad). #10 (lote #457) resultó genuinamente ambiguo -- ese lote se
  repartió entre 3 pedidos de 3 clientes distintos y no hay dato que diga
  cuál rechazó la unidad -- decisión del usuario: se quitó `origen_rechazo`
  en vez de asignar un pedido al azar, conservando el ajuste de stock tal
  cual.
- Añadido `chk_ajuste_rechazo_cliente_requiere_linea` en
  `ajustes_producto_final` (`origen_rechazo IS DISTINCT FROM 'cliente' OR
  linea_pedido_origen_id IS NOT NULL`).
- `AjusteStockForm.jsx`: en modo manual (`fijo=null`, "+ Nuevo ajuste" de
  AjustesStock.jsx -- el punto de entrada real que dejó pasar el ajuste
  #11, no el drawer contextual de AlbaranesVenta.jsx) se añadió un selector
  obligatorio de "línea de pedido de origen", poblado con las líneas de
  albarán reales del lote elegido (`lineas_albaran_venta.produccion_pf_id`)
  -- si el lote no se ha enviado a ningún pedido, la opción "cliente" del
  desplegable de origen de rechazo se deshabilita en vez de dejar un callejón
  sin salida.

**Fase 2 — señal visual:** el contrato asumía que "Inventario.jsx" mostraba
stock de producto final; auditado el código, esa pantalla solo gestiona
materia prima (`articulos_compra`) y nunca toca `stock_lotes_producto_final`.
Se adaptó a los sitios reales donde ya vive el badge equivalente
(`BadgeScrap`, Parte C de `CONTRATO_PROPAGACION_RECHAZOS.md`):
- Nuevo componente `BadgeRechazoPendiente.jsx` (solo `tipo='producto_final'`,
  única tabla con estas columnas) -- consulta `historial_ajustes_stock`
  filtrando `origen_rechazo='cliente' AND tipo_resolucion IS NULL`.
- Añadido junto a `BadgeScrap` en `AlbaranesVenta.jsx` (por línea de
  albarán), `ProduccionProductosFinales.jsx` (por lote) y
  `PedidosDelDia.jsx` (por producto agregado, fila de producto final).
- `AjustesStock.jsx` ("Incidencias de Stock"): nuevo filtro "Rechazos de
  cliente / Solo pendientes de resolver" sobre el histórico, como vista
  centralizada complementaria a los badges por lote.

**Verificación:** 88/88 tests (`npx vitest run`), `npx vite build` limpio.
Migración pendiente de ejecución manual (MCP de Supabase en modo
`read_only`) -- ver instrucciones en el mensaje de entrega.
