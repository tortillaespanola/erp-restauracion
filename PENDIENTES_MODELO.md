# Pendientes conscientes del modelo de datos

Documento de seguimiento para decisiones de modelo que se identificaron durante la auditoría de asimetrías "camino ideal vs. variante directa/informal" (ver historial: Flujo A/B de compras, `tipo_venta` en ventas, `tipo_produccion` en producción) pero que se dejaron deliberadamente sin resolver, para no mezclarlas con el flujo de regularización de incidencias que todavía no existe.

## 1. `ajustes_articulo` / `ajustes_semielaborado` / `ajustes_producto_final` exigen un lote específico

Las tres tablas de ajustes (merma/corrección) requieren identificar el lote exacto de origen:

- `ajustes_articulo.entrada_material_id` — `NOT NULL`
- `ajustes_semielaborado.produccion_id` — `NOT NULL`
- `ajustes_producto_final.produccion_pf_id` — `NOT NULL`

En el día a día normal esto es correcto y deseable (trazabilidad exacta). Pero en un evento o showcooking caótico, puede no estar claro de qué lote concreto salió lo que se estropeó o no se consumió — por ejemplo, si hay dos lotes del mismo artículo mezclados físicamente sobre la mesa de trabajo. Hoy el sistema obligaría a elegir un lote aunque sea una atribución aproximada; no hay forma de registrar una merma "genérica" sin lote conocido.

**Por qué no se resolvió ahora**: a diferencia de la asimetría de bloqueo de stock (que impedía completar la acción por completo), aquí *sí* existe un camino — elegir el lote más plausible — así que el impacto es menor. Además, la forma correcta de resolverlo probablemente dependa de cómo se diseñe el futuro flujo de regularización de incidencias (¿una merma sin lote se reparte proporcionalmente entre los lotes negativos existentes? ¿se dispara desde la propia pantalla de incidencias en vez de desde el formulario de ajuste?) — resolverlo antes de tener ese diseño podría significar rehacerlo.

**Cuándo retomarlo**: junto con el diseño del flujo de regularización de `incidencias_stock_producto_final`, `incidencias_stock_articulo` e `incidencias_stock_semielaborado` (las tres tablas ya tienen `estado` ampliable a `'pendiente' | 'regularizado' | 'ignorado'`, preparadas para ese momento).
