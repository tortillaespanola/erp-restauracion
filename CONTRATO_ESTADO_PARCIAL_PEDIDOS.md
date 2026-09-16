# CONTRATO: Estado "Parcial" en Pedidos (P0-3 del Roadmap Fase 06)

## Contexto

La simulación de 6 meses (`FASE06_SIMULACION_RESUMEN.md`, sección 5.1) detectó que
tanto `pedidos_compra` como `pedidos_venta` no distinguen un pedido sin empezar de
uno servido parcialmente. Hoy, si entregas el 50% de un pedido, el estado sigue
siendo `pendiente`.

**Evidencia real:**
- Mes 4: OV-260057, 5/8 sillas entregadas, estado `pendiente`.
- Mes 5: Hotel Vier Jahreszeiten, 8/10 mesas, estado `pendiente`.

## Objetivo

Añadir un estado `parcial` (o `parcialmente_servido` / `parcialmente_recibido`, a
decidir según el naming ya existente en el esquema) que se calcule
automáticamente en los triggers de actualización de estado de `pedidos_compra` y
`pedidos_venta`, y que se refleje en la UI.

## Antes de empezar: auditoría de esquema obligatoria

Lección de la propia Fase 06 (sección 6.3): revisa el código real de estos
triggers/funciones antes de asumir su comportamiento.

- `actualizar_estado_pedido_compra()` (o equivalente)
- `actualizar_estado_pedido_venta()` (o equivalente)
- Las tablas `lineas_pedido_compra` / `lineas_pedido_venta` y cómo calculan
  cantidad pedida vs. cantidad recibida/entregada (vía `albaranes_compra` /
  `lineas_albaran_venta`)
- Los estados actuales válidos de `pedidos_compra.estado` y
  `pedidos_venta.estado` (enum, check constraint o texto libre)
- Dónde se muestra el estado en la UI (listados y detalle de pedido, en ambos
  módulos de Compras y Ventas)

## Alcance

### 1. Migración SQL

Idempotente, con guarda tipo `if exists ... raise notice ... return` como en el
resto de la Fase 06.

- Añadir el nuevo valor de estado donde corresponda (enum/constraint).
- Modificar los triggers de actualización de estado para que comparen
  cantidad recibida/entregada (agregada por líneas) contra cantidad pedida:
  - `0` recibido/entregado → `pendiente` (o el estado inicial actual)
  - `0 <` recibido/entregado `<` pedido → `parcial`
  - recibido/entregado `>=` pedido → estado actual de "completado"
- Cubrir el caso multi-albarán (varias recepciones/entregas parciales
  acumulativas sobre el mismo pedido), no solo una.

### 2. Frontend

- Reflejar el nuevo estado `parcial` en los listados y en el detalle de
  pedido, tanto en Compras como en Ventas (badge/color distintivo).
- Revisar los locales de i18next (es/en, y los que existan) para el nuevo
  label.
- Revisar cualquier filtro por estado existente (ej. "pedidos pendientes")
  para decidir si `parcial` debe incluirse o no en esos filtros.

### 3. Tests

Vitest + Testing Library, como en contratos anteriores.

- Test del trigger/función SQL con recepción/entrega 0%, parcial y 100%.
- Test de UI mostrando el badge correcto según estado.

### 4. Backfill (opcional)

Evaluar si hace falta recalcular el estado de pedidos ya existentes en la base
(incluida la demo AlpenWerk Möbel GmbH) que hoy están mal marcados como
`pendiente` pese a tener entregas parciales.

## Fuera de alcance (dejar para roadmap posterior)

- Stock negativo / incidencias (P0-2)
- Cancelación de producción con motivo (P0-1)
- `cantidad_rechazada` / `motivo_rechazo` (P1-4)

## Criterios de aceptación

- Un pedido de compra o venta con recepción/entrega parcial muestra estado
  `parcial` en BD y en UI, en ambos módulos.
- Los pedidos ya completados o ya en `pendiente` (0% servido) no cambian de
  comportamiento.
- La migración es idempotente y puede re-ejecutarse sin duplicar ni romper
  nada.
- Tests pasan en CI.

## Nota de calidad

Antes de escribir SQL largo con patrones repetitivos, ten especial cuidado con
errores de tokenización (multiplicaciones sin `*`, variables con espacios,
palabras clave rotas) — fueron el problema más recurrente en la Fase 06.
