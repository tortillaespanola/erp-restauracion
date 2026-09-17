# CONTRATO_MRP_LIGERO_DEMANDA_CIERRE.md

**Estado:** ✅ CERRADO SIN EJECUCIÓN — YA IMPLEMENTADO
**Fecha de auditoría:** 17 de septiembre de 2026
**Veredicto:** El MRP ligero (explosión de demanda multi-nivel a partir de pedidos de venta) ya está construido, en producción y consumido por el frontend. No se redacta un contrato de construcción porque no hay nada que construir.

---

## 0. Contexto

`CONTRATO_RLS_MULTITENANT_CIERRE.md` señalaba como siguiente bloqueador del roadmap la "Fase A3: MRP Ligero (Explosión de Demanda)", asumiendo que el cálculo de materia prima necesaria a partir de varios pedidos se hacía manualmente fuera del sistema. Antes de redactar ese contrato se auditó el estado real de la base de datos y del frontend — esa premisa es incorrecta.

## 1. Hallazgos de la Auditoría (Evidencia)

### 1.1 Funciones SQL de explosión de demanda ya existentes (`public`, todas `SECURITY INVOKER`)

1. **`necesidades_pedidos(p_pedido_ids bigint[])`** — explosión recursiva de demanda bruta: `lineas_pedido_venta` → `producto_final` → `semielaborado` → `ingrediente`/`articulo`, vía `receta_producto_final` y `receta_semielaborado` (CTE recursiva). Incluye guarda de profundidad máxima (20 niveles) que lanza `RAISE EXCEPTION` si detecta un ciclo en las recetas (un semielaborado que acaba consumiéndose a sí mismo).
2. **`necesidades_pedidos_cascada(p_pedido_ids bigint[])`** — versión con **neteo de stock por oleada topológica**: en cada nivel de la cascada resta el stock disponible (`stock_lotes_producto_final`, `stock_lotes_semielaborado`) antes de propagar el déficit —no la necesidad bruta— al siguiente nivel. Esto es MRP real (demanda neta), no solo una lista de materiales explotada.
3. **`demanda_pendiente_ingrediente(p_ingrediente_id bigint)`** — demanda agregada de un ingrediente concreto a través de todos los pedidos con estado `pendiente`/`en_produccion`/`parcial`.
4. **`distribucion_prevista_pf(p_producto_final_id bigint)`** — reparto de lo producido hoy de un producto final entre las líneas de pedido pendientes, con residual libre.

Las 4 funciones son `SECURITY INVOKER` (`prosecdef = false`): heredan el RLS del usuario que las llama, por lo que el aislamiento multi-tenant confirmado en `CONTRATO_RLS_MULTITENANT_CIERRE.md` aplica automáticamente aquí también, sin necesidad de ningún cambio adicional.

### 1.2 Ya consumidas por el frontend (no es lógica huérfana)

- [`PedidosDelDia.jsx:742`](frontend/src/pages/PedidosDelDia.jsx#L742) — llama a `necesidades_pedidos` por pedido individual, para trazabilidad pedido→cliente→fecha.
- [`PedidosDelDia.jsx:768`](frontend/src/pages/PedidosDelDia.jsx#L768) — llama a `necesidades_pedidos_cascada` sobre el conjunto de pedidos del día, para repartir la necesidad neta hacia semielaborados/ingredientes/artículos.
- [`Producciones.jsx:49`](frontend/src/pages/Producciones.jsx#L49) — usa `necesidades_pedidos` para calcular necesidades de una tanda de producción.
- [`ProduccionProductosFinales.jsx:211`](frontend/src/pages/ProduccionProductosFinales.jsx#L211) — recalcula en vivo el nivel `nivel` de `necesidades_pedidos` para una tanda.

Los comentarios del propio código referencian la migración de origen (`supabase/migrations/20260903_...sql`) y documentan explícitamente decisiones de diseño ya resueltas (por qué `necesidades_pedidos` se mantiene "bruta" para trazabilidad mientras `necesidades_pedidos_cascada` neta la demanda real, por qué no hay hueco de doble cobertura entre ambas).

## 2. Decisión

**No se redacta `CONTRATO_MRP_LIGERO_DEMANDA.md` como contrato de construcción.** El roadmap mencionado en el cierre del contrato de RLS estaba desactualizado en este punto, igual que el propio contrato de RLS lo estaba respecto a su implementación.

## 3. Fuera de scope de este cierre

No se ha auditado en profundidad si existen huecos *alrededor* del MRP ya construido (por ejemplo: generación automática de pedidos de compra sugeridos a partir del déficit de artículos, lead times de proveedor, una vista de planificación dedicada más allá de `PedidosDelDia`). Si en el futuro se detecta una necesidad concreta no cubierta por `necesidades_pedidos`/`necesidades_pedidos_cascada`/`demanda_pendiente_ingrediente`, debería auditarse esa necesidad específica antes de redactar un contrato nuevo — no asumir de nuevo que falta construir desde cero.

## 4. Siguiente paso en el roadmap

Pendiente de que se identifique y confirme con evidencia (no solo por inferencia de roadmap) cuál es el siguiente bloqueador real.
