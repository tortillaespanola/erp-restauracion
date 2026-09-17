# CONTRATO_PROPAGACION_RECHAZOS.md

**Estado:** BORRADOR — PENDIENTE DE REVISIÓN
**Prioridad:** P1
**Fecha estimada de ejecución:** Post Fase A2 (sobre `CONTRATO_UI_INCIDENCIAS_STOCK.md` ya cerrado)
**Responsable:** Claude Code (bajo supervisión de revisión humana)
**Dependencias:** `AjusteStockForm` + `historial_ajustes_stock` (ya en producción). MRP ligero ya construido y confirmado en `CONTRATO_MRP_LIGERO_DEMANDA_CIERRE.md` (`necesidades_pedidos`, `necesidades_pedidos_cascada`, `demanda_pendiente_ingrediente`, `distribucion_prevista_pf`). Modelo de estados parciales de pedido ya construido en `CONTRATO_ESTADO_PARCIAL_PEDIDOS.md`.

---

## 0. Contexto

`CONTRATO_UI_INCIDENCIAS_STOCK.md` resolvió el **registro** de rechazos (con origen) y su revisión en pantalla. No resolvió su **propagación**: hoy declarar un rechazo no crea automáticamente ni una línea de reposición en el pedido, ni visibilidad en las pantallas afectadas.

Dos precedentes directos de esta tanda de contratos obligan a partir de auditoría, no de asunción:

- `CONTRATO_RLS_MULTITENANT_CIERRE.md`: el aislamiento multi-tenant ya estaba construido.
- `CONTRATO_MRP_LIGERO_DEMANDA_CIERRE.md`: el motor de explosión de demanda con neteo de stock ya está construido y en producción (`necesidades_pedidos_cascada` neta stock disponible nivel a nivel, propagando el déficit —no la necesidad bruta— hacia arriba en la receta).

Esto cambia el punto de partida de este contrato: **es probable que parte de la propagación de necesidades ya ocurra sola**, porque `AjusteStockForm` ya escribe un movimiento de stock negativo sobre `stock_lotes_semielaborado`/`stock_lotes_producto_final`, y `necesidades_pedidos_cascada` neta contra esas mismas tablas. Antes de escribir una sola línea de SQL de explosión de demanda nueva, hay que confirmar con evidencia si ese comportamiento ya se da o si hay un hueco puntual (por ejemplo, una vista materializada de stock que no refleja el ajuste en tiempo real, o un filtro de estado de lote que excluye o duplica la cantidad rechazada).

---

## 1. Objetivo

Cerrar tres huecos concretos identificados sobre el flujo de rechazo ya construido:

**A. Resolución de rechazo de cliente.** Un rechazo declarado sobre una línea de albarán ya entregada debe poder resolverse de tres formas — **abono**, **reenvío** o **descarte** — y solo el reenvío debe generar una nueva línea de pedido pendiente de servir.

**B. Verificación/cierre del neteo automático de necesidades.** Confirmar que un rechazo sobre un lote aún no albaraneado (semielaborado o producto final) reduce el stock disponible que consume `necesidades_pedidos_cascada`, de forma que la cadena completa de necesidades (el propio ítem rechazado y, vía la misma función ya existente, sus componentes/recetas) se recalcula sola. Si existe un hueco puntual, cerrarlo — no reconstruir el motor.

**C. Badges visuales de scrap declarado**, visibles en Albaranes de Venta, Producciones, Producción de Productos Finales y Pedidos del Día, para que el usuario vea sin entrar al detalle que una línea/lote/producción tiene rechazos asociados.

---

## 2. Contexto / Estado actual

- `historial_ajustes_stock` (vista, `security_invoker = true`) ya unifica los ajustes de artículo, semielaborado y producto final, con `origen_rechazo` (cliente / inspección de calidad / producción aguas abajo / otro) desde `CONTRATO_UI_INCIDENCIAS_STOCK.md`.
- El "Declarar rechazo de cliente" desde `AlbaranesVenta.jsx` abre `AjusteStockForm` pre-rellenado, pero termina ahí: no hay paso posterior de decidir qué pasa con el pedido.
- `necesidades_pedidos_cascada` ya neta demanda contra `stock_lotes_producto_final`/`stock_lotes_semielaborado` por oleada topológica — es decir, la lógica de "un déficit en un nivel se propaga como necesidad al nivel de abajo en la receta" **ya existe y no debe duplicarse**.
- El modelo de estados parciales de pedido (`CONTRATO_ESTADO_PARCIAL_PEDIDOS.md`) ya resuelve el caso de "un pedido servido parcialmente" — la nueva línea de reposición por reenvío debe encajar en ese modelo existente, no crear un segundo sistema de estados en paralelo.

**⚠️ Nota para Claude Code antes de ejecutar:** este contrato tiene una Parte B que es de **auditoría antes que de construcción**, siguiendo el mismo criterio que ya evitó dos reconstrucciones innecesarias en esta tanda (RLS y MRP). No asumir que hace falta escribir lógica de propagación de necesidades sin antes probarlo contra datos reales.

---

## 3. Alcance EXACTO

### ✅ QUÉ SE TOCA (IN SCOPE)

**Parte A — Resolución de rechazo de cliente**

1. Al declarar un rechazo con `origen_rechazo = 'cliente'`, añadir un paso de resolución con tres opciones: **Abono**, **Reenvío**, **Descarte**.
2. **Abono:** no genera línea de pedido nueva. Se registra como cierre económico del rechazo (fuera de alcance el detalle contable/facturación — solo marcar la incidencia como resuelta con `tipo_resolucion = 'abono'`).
3. **Descarte:** no genera línea de pedido nueva. Marca la incidencia como resuelta con `tipo_resolucion = 'descarte'`. Es el caso "el cliente no quiere reposición, ya está".
4. **Reenvío:** crea una nueva línea de pedido pendiente de servir, vinculada a la línea de albarán/pedido original (misma cantidad rechazada, mismo artículo/producto), integrada en el modelo de estados parciales ya existente — **auditar `CONTRATO_ESTADO_PARCIAL_PEDIDOS.md` antes de decidir si esto es una nueva línea en el pedido original o un pedido de reposición nuevo enlazado**.
5. Esta nueva línea de pedido, al tener el estado estándar de "pendiente", debe entrar sola en el cálculo de `necesidades_pedidos`/`necesidades_pedidos_cascada` la próxima vez que se ejecuten — **verificar que efectivamente ocurre así antes de dar el paso por cerrado**, no asumirlo.

**Parte B — Verificación del neteo automático (lote no albaranado)**

6. Auditar con datos reales: declarar un rechazo de prueba sobre un lote de semielaborado o producto final **no** albaraneado, y confirmar si `necesidades_pedidos_cascada` refleja el déficit resultante (del propio ítem y, vía la receta, de sus componentes) sin cambio de código.
7. Si la auditoría confirma que ya funciona: documentarlo en un contrato de cierre (mismo patrón que RLS/MRP), sin tocar código.
8. Si la auditoría revela un hueco puntual (ej. `stock_lotes_*` no descuenta el lote rechazado, o lo descuenta pero una vista intermedia cachea el valor anterior): corregir exclusivamente ese punto concreto.

**Parte C — Badges visuales**

9. Componente reutilizable de badge ("Scrap declarado" / icono de advertencia) que consulta `historial_ajustes_stock` filtrando por la entidad relevante (lote, producción, línea de albarán).
10. Integrarlo en: `AlbaranesVenta.jsx` (línea de albarán), `Producciones.jsx` y `ProduccionProductosFinales.jsx` (producción/tanda), `PedidosDelDia.jsx` (línea de pedido con necesidad afectada por rechazo).

### ❌ QUÉ NO SE TOCA (OUT OF SCOPE)

- Reconstruir o duplicar `necesidades_pedidos`/`necesidades_pedidos_cascada`/`demanda_pendiente_ingrediente`/`distribucion_prevista_pf` — se usan tal cual existen.
- Lógica de facturación/abono contable real (solo el estado de resolución de la incidencia).
- Generación automática de pedidos de compra a proveedor a partir del déficit (fuera de alcance, ya señalado como pendiente en `CONTRATO_MRP_LIGERO_DEMANDA_CIERRE.md` §3).
- Rediseño del modelo de estados parciales de pedido — se reutiliza el existente.

---

## 4. Pasos técnicos concretos

### Paso 4.1 (Parte B, primero): Auditoría del neteo automático

Antes de cualquier cambio de esquema, en staging:

```sql
-- 1. Capturar necesidad neta actual para un producto final/semielaborado de prueba
SELECT * FROM necesidades_pedidos_cascada(ARRAY[<pedido_id_prueba>]);

-- 2. Declarar un rechazo de prueba (vía AjusteStockForm o INSERT directo controlado)
--    sobre un lote de ese mismo semielaborado/producto final, SIN albaranear

-- 3. Repetir la consulta y comparar
SELECT * FROM necesidades_pedidos_cascada(ARRAY[<pedido_id_prueba>]);
```

Documentar el resultado exacto (aumenta la necesidad como se espera / no cambia / cambia mal) antes de decidir el resto de los pasos de la Parte B.

### Paso 4.2: Esquema de resolución de rechazo (Parte A)

Sobre la tabla de incidencia relevante (`ajustes_producto_final`/`ajustes_semielaborado`, ya con `origen_rechazo`):

```sql
ALTER TABLE ajustes_producto_final
  ADD COLUMN IF NOT EXISTS tipo_resolucion text
    CHECK (tipo_resolucion IN ('abono', 'reenvio', 'descarte')),
  ADD COLUMN IF NOT EXISTS linea_pedido_reposicion_id bigint REFERENCES lineas_pedido_venta(id);
-- repetir en ajustes_semielaborado si el rechazo de cliente puede aplicar sobre semielaborado vendido directamente
```

*(Verificar contra el Paso 4.1 de `CONTRATO_ESTADO_PARCIAL_PEDIDOS.md` si `lineas_pedido_venta` es el nombre real y si el modelo de estados parciales ya tiene un concepto de "línea de reposición" que deba reutilizarse en vez de esta columna.)*

### Paso 4.3: RPC de resolución

Función RPC `resolver_rechazo_cliente(p_ajuste_id, p_tipo_resolucion, ...)` que:
1. Valida negocio vía `negocio_actual()` (RLS ya cubierto, pero la RPC debe validar explícitamente el ajuste pertenece al negocio activo antes de tocar el pedido).
2. Si `tipo_resolucion = 'reenvio'`: crea la línea de pedido pendiente con la cantidad y artículo del rechazo, usando el modelo de estados parciales ya existente, y guarda su id en `linea_pedido_reposicion_id`.
3. Si `abono`/`descarte`: solo actualiza `tipo_resolucion`, sin tocar pedidos.
4. Transacción única (todo o nada).

### Paso 4.4: UI de resolución (Parte A)

En el drawer de detalle de `IncidenciasStock.jsx` (o inmediatamente tras declarar el rechazo desde `AlbaranesVenta.jsx`), añadir el selector de resolución para incidencias con `origen_rechazo = 'cliente'` y `tipo_resolucion` aún nulo.

### Paso 4.5: Cierre del hueco de neteo (Parte B, solo si el Paso 4.1 lo confirma necesario)

Alcance a definir según lo que revele la auditoría — no especificar SQL a ciegas aquí. Ejemplos de huecos posibles y su fix típico:
- Vista de stock no reflejando el ajuste → revisar si hay `security_invoker`/vista materializada de por medio y si necesita `REFRESH` o dejar de ser materializada.
- Filtro de estado de lote que no excluye "rechazado" → añadir la condición al `WHERE` de la función correspondiente, sin tocar su firma ni el resto de la lógica.

### Paso 4.6: Componente de badge (Parte C)

`BadgeScrap.jsx`, recibe tipo de entidad + id, consulta `historial_ajustes_stock` filtrado, muestra icono/tooltip con cantidad y motivo si hay coincidencias. Integrar en las 4 pantallas listadas en el punto 10 del alcance.

---

## 5. Criterios de aceptación verificables

1. Declarar un rechazo de cliente y elegir "Reenvío" crea una línea de pedido pendiente visible en `PedidosDelDia.jsx`, sin modificar el albarán original.
2. Elegir "Abono" o "Descarte" cierra la incidencia sin crear ninguna línea de pedido.
3. La nueva línea de pedido por reenvío aparece reflejada en `necesidades_pedidos`/`necesidades_pedidos_cascada` sin cambios adicionales de código, la próxima vez que se calculen.
4. Un rechazo sobre un lote no albaraneado de producto final incrementa la necesidad neta de sus semielaborados/ingredientes componentes en `necesidades_pedidos_cascada`, verificable con el mismo procedimiento del Paso 4.1.
5. Un rechazo sobre un lote no albaraneado de un semielaborado incrementa la necesidad neta de los ingredientes de su propia receta.
6. Los badges de scrap aparecen en las 4 pantallas listadas, solo sobre entidades con al menos un ajuste asociado, sin falsos positivos.
7. Nada de lo anterior modifica el comportamiento de `necesidades_pedidos_cascada` para pedidos/lotes sin rechazos — regresión cero sobre el MRP ya en producción.

---

## 6. Plan de testing

### 6.1 Testing de Base de Datos

- Repetir el procedimiento del Paso 4.1 como test de regresión permanente, no solo como auditoría puntual.
- Cualquier migración (`ALTER TABLE` del Paso 4.2, o el fix del Paso 4.5) probada primero con `BEGIN...ROLLBACK` en staging.

### 6.2 Testing unitario (Vitest)

- Lógica de habilitación del selector de resolución (solo visible si `origen_rechazo = 'cliente'` y `tipo_resolucion` es nulo).
- Lógica de `BadgeScrap.jsx` (no debe pintar nada si no hay ajustes asociados).

### 6.3 Testing E2E (Playwright)

1. Declarar rechazo de cliente sobre una línea de albarán de prueba, resolver como "Reenvío", verificar la nueva línea de pedido en `PedidosDelDia.jsx`.
2. Repetir con "Abono" y "Descarte", verificar que no aparece ninguna línea nueva.
3. Declarar rechazo sobre un lote no albaraneado, ejecutar `necesidades_pedidos_cascada` antes/después y comparar (mismo criterio del Paso 4.1).
4. Verificar la aparición del badge en las 4 pantallas tras declarar un rechazo, y su ausencia en entidades sin rechazos.

---

## 7. Riesgos y Rollback

### Riesgos identificados

- **Asumir que hace falta reconstruir el MRP sin auditar primero:** ya ocurrió dos veces en esta tanda (RLS y MRP). *Mitigación:* el Paso 4.1 es obligatorio y bloqueante antes de tocar cualquier función de explosión de demanda.
- **Duplicar el concepto de "línea de reposición" si `CONTRATO_ESTADO_PARCIAL_PEDIDOS.md` ya tiene uno:** generaría dos sistemas de estados de pedido conviviendo mal. *Mitigación:* auditar ese contrato antes del Paso 4.2.
- **Rechazo de semielaborado vendido directamente (no solo como componente):** si esto es posible en el negocio, la Parte A debe cubrir `ajustes_semielaborado` igual que `ajustes_producto_final`, no solo este último. *Mitigación:* confirmar con el usuario si este caso existe en el flujo real antes de limitar el alcance a producto final.

### Plan de Rollback

- Las columnas nuevas (`tipo_resolucion`, `linea_pedido_reposicion_id`) son aditivas — revertibles con `DROP COLUMN` sin pérdida de datos de ajustes ya registrados.
- La RPC de resolución se puede deshabilitar sin afectar el registro de rechazos ya existente (`AjusteStockForm` sigue funcionando igual).
- Los badges son puramente visuales — retirables sin efecto en datos o lógica.
- Si el Paso 4.5 termina no siendo necesario (la Parte B ya funciona sola), no hay nada que revertir en el MRP.

---

## 8. Resultado de ejecución (2026-09-17)

### Parte B — Auditoría del neteo automático: **sin hueco, sin código nuevo**

Confirmado con datos reales de producción, sin necesidad de insertar datos de prueba (el conector
MCP de Supabase de esta sesión es de solo lectura):

- `stock_lotes_producto_final`/`stock_lotes_semielaborado` son **vistas no materializadas**
  (`p.cantidad_producida - servido + sum(ajustes.cantidad)`, recalculadas en cada consulta) — no
  hay caché que refrescar.
- `necesidades_pedidos_cascada` lee esas mismas vistas directamente en cada oleada de su cálculo,
  sin ningún `WHERE` que excluya ajustes negativos.
- Prueba con datos reales: el ajuste #11 (`ajustes_producto_final`, `origen_rechazo='cliente'`,
  `cantidad=-2`, producto_final 196) ya había reducido `stock_lotes_producto_final.stock_disponible`
  a -2 antes de tocar nada. Replicando manualmente (vía `SELECT` puro, sin poder invocar la función
  en sí por el mismo motivo de solo-lectura — usa tablas temporales) la primera oleada del cálculo
  de `necesidades_pedidos_cascada` sobre el pedido 453 (línea de 6 uds del mismo producto 196):
  `deficit = necesidad(6) - stock_disponible(-2) = 8`, y ese déficit se propagó correctamente a los
  dos semielaborados de su receta (32 y 8 unidades respectivamente) — el rechazo ya declarado se
  refleja en el déficit exactamente como debería, sin ningún cambio de código.

**Conclusión: Paso 4.5 no aplica.** Mismo patrón que `CONTRATO_RLS_MULTITENANT_CIERRE.md` y
`CONTRATO_MRP_LIGERO_DEMANDA_CIERRE.md` — el motor ya construido ya cubre este caso.

### Riesgo §7 resuelto por auditoría de esquema, no por pregunta al usuario

`lineas_pedido_venta` solo tiene `producto_final_id`/`articulo_id` — nunca `semielaborado_id`. Un
semielaborado no puede ser la línea de un pedido de venta, así que "rechazo de cliente" (Parte A)
no aplica a `ajustes_semielaborado`, solo a `ajustes_producto_final`. Confirmado además por el
propio botón "Declarar rechazo de cliente" de `AlbaranesVenta.jsx`, que ya solo se renderiza sobre
líneas de producto final.

### Parte A — construido

- `supabase/migrations/20261025_resolucion_rechazo_cliente.sql`:
  - `ajustes_producto_final` + `tipo_resolucion` (abono/reenvio/descarte), `linea_pedido_origen_id`
    (la línea de pedido que se está rechazando — necesaria porque `ajustes_producto_final` solo
    referenciaba el lote de producción, nunca la línea de pedido/albarán), `linea_pedido_reposicion_id`.
  - `recalcular_estado_pedido_venta(p_pedido_id)`: extraído por refactor puro del trigger
    `actualizar_estado_pedido_por_servicio()` (mismo comportamiento, cero regresión) para poder
    reutilizarlo desde la RPC nueva — insertar una línea de reenvío no dispara ese trigger (solo
    reacciona a cambios en `lineas_albaran_venta`), así que sin este recálculo explícito un pedido
    ya `servido` se habría quedado marcado como tal pese a tener trabajo pendiente de nuevo.
  - `resolver_rechazo_cliente(p_ajuste_id, p_tipo_resolucion)`: RPC única de esta parte. Reenvío
    crea una línea nueva **dentro del mismo pedido** (mismo producto, misma cantidad rechazada,
    mismo precio) — reutiliza el modelo de estados parciales ya existente en vez de duplicarlo,
    como pedía el riesgo §7.
  - `historial_ajustes_stock` ampliada con `origen_id` (lote/producción de origen, unifica
    `produccion_pf_id`/`produccion_id`/`entrada_material_id`) y las 3 columnas de resolución.
- Frontend: `AjusteStockForm.jsx` ahora acepta `fijo.lineaPedidoOrigenId` y devuelve la fila
  insertada a su llamador; `ResolverRechazoForm.jsx` (nuevo, reutilizable) ofrece el paso de
  resolución vía la RPC. Encadenado en dos puntos: inmediatamente tras declarar el rechazo en
  `AlbaranesVenta.jsx`, y como acción "Resolver" persistente en `AjustesStock.jsx` para cualquier
  rechazo de cliente aún sin resolver (incluidos los dos ya declarados en producción antes de esta
  migración).

### Parte C — construido

`BadgeScrap.jsx` (nuevo, reutilizable): consulta `historial_ajustes_stock` filtrando por
`origen_id` (lote/tanda concreta) o `item_id` (producto agregado, para `PedidosDelDia.jsx` donde la
necesidad se neta a nivel de producto). Solo cuenta `cantidad < 0` — cualquier merma o rechazo, no
solo los de cliente, según pedía el propio nombre del badge. Integrado en `AlbaranesVenta.jsx`
(línea de albarán, por lote), `Producciones.jsx`/`ProduccionProductosFinales.jsx` (tanda, por lote)
y `PedidosDelDia.jsx` (línea de necesidad, por producto — ambas tablas, producto final y
semielaborado).

### Verificación

- 88/88 tests de Vitest (80 previos + 8 nuevos: `BadgeScrap.test.jsx`, `ResolverRechazoForm.test.jsx`).
- `vite build` limpio.
- Migración pendiente de ejecución manual en el SQL Editor de Supabase (conector MCP de esta sesión
  es de solo lectura) — ver `supabase/migrations/20261025_resolucion_rechazo_cliente.sql`.
