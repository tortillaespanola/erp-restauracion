# Contrato: Producción de Productos Finales — Capa B (distribución provisional) y Capa C (cierre del ciclo producir → distribuir → albaranear)

Estado: Capa B — Paso 1 (modelo de datos + función de cálculo) y Paso 2 (UI en Producciones del día) completos, aplicados en firme y verificados, con un fix posterior de permisos ya corregido y verificado bajo el rol real. Ver "Addenda: Paso 2 — UI de distribución y botón play (2026-08-16)" y "Addenda: fix de permisos — GRANT faltante en previsiones_distribucion_pf (2026-08-16)" más abajo. Capa C — Paso 1 (modelo de datos: tanda en la previsión + sugerencia FIFO) y Paso 2 (UI en Pedidos, Producciones del día y AlbaranesVenta, más el trigger de reparto/reconstrucción de previsiones) completos, aplicados en firme y verificados bajo el rol real. Ciclo producir → distribuir → albaranear cerrado de extremo a extremo. Ver "Capa C — cierre del ciclo producir → distribuir → albaranear" más abajo. Fecha: 2026-08-18.

Este contrato es independiente de `CONTRATO_VISTA_DINAMICA_PRODUCCION.md` (Semielaborados + traslado mecánico "Capa A" a Producto final, ya aplicado) — cubre exclusivamente la particularidad real de Producto final que Capa A dejó fuera a propósito: la producción va destinada a pedidos de cliente concretos, y hace falta reflejar de forma provisional qué parte de lo producido hoy se piensa repartir a cada uno, antes de que exista una pantalla de Expediciones real.

## Auditoría previa (resumen — detalle completo en la conversación, no repetido aquí)

- `lineas_pedido_venta` ya tiene `producto_final_id`, `cantidad`, `pedido_id` — de ahí sale "cuánto pide cada pedido".
- `pedidos_venta.fecha_entrega_prevista` es la única señal de urgencia existente.
- No existe ningún mecanismo de reserva/asignación de stock en ningún punto del esquema actual (confirmado por búsqueda exhaustiva de columnas `reserva`/`asignad`/`comprometid`/`bloquead` en todo `information_schema.columns`).
- `albaranes_venta.tipo_venta` (`pedido_planificado`/`evento_directo`) es una feature real y completa a nivel de triggers, pero resuelve un problema distinto (venta sin stock de respaldo, con incidencia) y es 100% inalcanzable desde la UI actual (0 albaranes reales con `evento_directo`, cero referencias en frontend). No se reutiliza para esto.
- `stock_lotes_producto_final` calcula el disponible **histórico** por tanda cerrada (`cantidad_producida - albaranado + ajustes`), sin filtrar por fecha. Es un balance de stock de por vida, no una foto de "lo producido hoy" — distinción importante, ver más abajo.

## Paso 1 — Modelo de datos y función de cálculo

### Tabla `previsiones_distribucion_pf`

```sql
create table previsiones_distribucion_pf (
  id bigint generated always as identity primary key,
  producto_final_id bigint not null references productos_finales(id),
  linea_pedido_id bigint not null references lineas_pedido_venta(id) on delete cascade,
  cantidad_prevista numeric(12,3) not null,
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid references negocios(id),
  created_at timestamptz not null default now(),
  constraint previsiones_distribucion_pf_linea_pedido_id_key unique (linea_pedido_id)
);

alter table previsiones_distribucion_pf enable row level security;

create policy "Acceso total temporal" on previsiones_distribucion_pf
  for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
```

**"Provisional" es deliberado**: sin estado de confirmación (eso vive en la futura Expediciones), sin bloqueo de stock (a diferencia de `check_stock_producto_final()`, que sí bloquea líneas de albarán reales), libremente editable/borrable. No mueve stock ni genera ningún movimiento real — eso sigue pasando únicamente vía `lineas_albaran_venta` al generar el albarán de verdad.

**Dos decisiones que se apartan del patrón calcado de `lineas_albaran_venta`, con justificación — confirmar antes de aplicar:**

1. **`linea_pedido_id ON DELETE CASCADE`** — en `lineas_albaran_venta.linea_pedido_id` NO hay cascade (una línea de albarán es un compromiso real, no debe desaparecer en silencio si se borra la línea de pedido origen). Aquí sí se propone cascade: una previsión no es un compromiso real, así que si la línea de pedido que la origina se borra (pedido corregido/cancelado), la previsión debe desaparecer con ella en vez de bloquear el borrado.
2. **`UNIQUE (linea_pedido_id)`** — no existe en el patrón de `lineas_albaran_venta` (ahí puede haber varias líneas de albarán por línea de pedido, a lo largo de sucesivas entregas parciales reales). Aquí se propone única por línea, editable in situ (`UPDATE`), no una lista acumulable — coherente con "provisional y editable", no con "histórico de entregas parciales".

**RLS**: mismo patrón "Acceso total temporal" verificado idéntico en `lineas_pedido_venta`, `pedidos_venta`, `producciones_producto_final` y `productos_finales` — ninguna de esas tablas tiene trigger que fije `negocio_id`, todas se apoyan solo en el `DEFAULT` de columna; se replica igual aquí.

**Sin CHECK de positividad** en `cantidad_prevista` — mismo criterio que `cantidad`/`cantidad_producida`/`cantidad_objetivo` en el resto del sistema, la validación ">0" vive en el frontend, no en la base de datos.

### Función `distribucion_prevista_pf(p_producto_final_id bigint)`

```sql
create or replace function distribucion_prevista_pf(p_producto_final_id bigint)
returns table (
  total_producido_hoy numeric,
  total_distribuido numeric,
  residual_libre numeric,
  linea_pedido_id bigint,
  pedido_id bigint,
  codigo_pedido text,
  cliente_nombre text,
  fecha_entrega_prevista date,
  cantidad_pedida numeric,
  cantidad_prevista numeric
)
language sql
stable
as $$
  with producido as (
    select coalesce(sum(cantidad_producida), 0) as total
    from producciones_producto_final
    where producto_final_id = p_producto_final_id
      and estado = 'cerrada'
      and fecha = current_date
  ),
  distribuido as (
    select coalesce(sum(pd.cantidad_prevista), 0) as total
    from previsiones_distribucion_pf pd
    join lineas_pedido_venta lpv on lpv.id = pd.linea_pedido_id
    join pedidos_venta pv on pv.id = lpv.pedido_id
    where pd.producto_final_id = p_producto_final_id
      and pv.estado in ('pendiente', 'en_produccion')
  )
  select
    producido.total, distribuido.total, producido.total - distribuido.total,
    lpv.id, pv.id, pv.codigo_pedido, c.nombre, pv.fecha_entrega_prevista,
    lpv.cantidad, coalesce(pd.cantidad_prevista, 0)
  from lineas_pedido_venta lpv
  join pedidos_venta pv on pv.id = lpv.pedido_id
  join clientes c on c.id = pv.cliente_id
  left join previsiones_distribucion_pf pd on pd.linea_pedido_id = lpv.id
  cross join producido
  cross join distribuido
  where lpv.producto_final_id = p_producto_final_id
    and pv.estado in ('pendiente', 'en_produccion')
  order by pv.fecha_entrega_prevista nulls last, pv.id;
$$;
```

Una fila por línea de pedido **pendiente** de ese producto final (mismo filtro `estado in ('pendiente', 'en_produccion')` que ya usa `PedidosDelDia.jsx`), con los tres totales de cabecera repetidos en cada fila — evita una segunda consulta desde el frontend, mismo criterio que las vistas planas ya existentes (`stock_productos_finales`).

**`total_producido_hoy` es deliberadamente distinto de `stock_lotes_producto_final`/`stock_productos_finales`**: solo tandas `cerrada` con `fecha = current_date`, no el balance histórico completo (que ya descuenta lo albaranado y no filtra por fecha). La pregunta operativa de esta pantalla es "de lo producido HOY, cuánto llevo ya previsto para los pedidos pendientes" — una métrica distinta a propósito, no un duplicado con otro nombre del balance de stock que ya existe.

**`total_distribuido`** suma TODAS las previsiones de ese producto final para pedidos pendientes — no se puede acotar "de hoy" porque la tabla no tiene columna de fecha propia (una previsión puede repartir contra producción de días distintos si el residual libre de ayer sigue sin consumirse). **Limitación conocida, deferida a Expediciones**: si las previsiones se acumulan varios días sin resolverse, comparar solo contra "producido hoy" se queda corto — la reconciliación completa contra el balance histórico de stock es responsabilidad de la futura Expediciones, no de esta pantalla.

**Limitación conocida**: si el producto final no tiene ninguna línea de pedido pendiente, la función no devuelve ninguna fila (ni siquiera los totales) — a resolver en el Paso 2 (UI) si hace falta mostrar el resumen igualmente sin líneas.

## Prueba en transacción (`BEGIN...ROLLBACK`) contra datos reales

Ejecutada contra `ZZ_TORTILLASINCEBOLLAGRANDE` (`producto_final_id = 6`), con sus 2 líneas de pedido pendientes reales (`OV-260101` cliente ZZ_Cliente1, `OV-260102` cliente ZZ_Empresa1). Resultado, todo limpio:

- Tabla + RLS + policy + función se crean sin error.
- Función sin previsiones: `cantidad_prevista = 0` en ambas líneas, totales en 0.
- Insert de una previsión (2.5 uds): se refleja correctamente en `total_distribuido`/`residual_libre` (que salió negativo, `-2.5`, sin bloqueo — no había producción de hoy).
- `UNIQUE(linea_pedido_id)`: un segundo insert para la misma línea fue rechazado.
- `UPDATE cantidad_prevista = 999` (muy por encima de lo producido): permitido sin error, `residual_libre = -999` — confirma que no hay ningún bloqueo de stock.
- `DELETE` de la línea de pedido real (`lineas_pedido_venta`): la previsión asociada desapareció sola vía cascade, sin bloquear el borrado.
- `DELETE` directo de una previsión: sin restricciones, funcionó.
- `ROLLBACK`: confirmado que la tabla no existe y las 2 líneas de pedido originales siguen intactas.

## Pendiente

- Expediciones, `albaranes_venta`, kanban/pedidos ficticios — no tocar, siguen fuera de alcance.
- **Estado vs. distribución (detectado en verificación de frontend, sin resolver)**: el campo ESTADO de la tabla "Productos finales" en Producciones del día solo refleja si hay stock físico suficiente (necesidad vs. producido), pero no si lo producido ya está totalmente distribuido a pedidos vía `previsiones_distribucion_pf`. Un producto puede mostrar OK con residual libre sin repartir — visible solo al expandir el desglose, no en la tabla principal. Pendiente decidir tratamiento (indicador aparte del estado, o sub-estado nuevo) en una próxima sesión de detalles UI.

---

## Addenda: Paso 2 — UI de distribución y botón play (2026-08-16)

Nota de corrección: la fecha de este contrato figuraba inicialmente como "2026-09-12" en el Paso 1 — error de arrastre de contexto (no del reloj del sistema, que siempre ha dado la fecha real), corregido a la fecha real. La migración `20260912_previsiones_distribucion_pf.sql` mantiene su nombre de archivo (numeración secuencial de migraciones, no fecha literal) para no romper el orden respecto a `20260911_...` ya aplicada.

### 1. Desglose de la tabla "Productos finales" — de receta a distribución a cliente

`PedidosDelDia.jsx`: el desglose expandible de cada producto final ya NO muestra la cadena de receta/semielaborados (`construirFilaDesglose`/`validarStockReceta('producto_final', ...)` para ESTE punto de expand) — muestra la distribución provisional vía `distribucion_prevista_pf()`, en un componente nuevo `DesgloseDistribucionPF` (no reemplaza `DesgloseComponentes`, que sigue intacto y en uso exclusivo de la tabla de Semielaborados).

- Cabecera: producido hoy / distribuido / residual libre. Residual negativo en rojo con aviso textual, **sin bloqueo** — mismo criterio de advertencia-no-bloqueo del resto del sistema.
- Una fila por línea de pedido pendiente: cliente, código de pedido, fecha de entrega prevista, cantidad pedida, y campo editable de `cantidad_prevista`.
- Orden: el que ya devuelve la función (`fecha_entrega_prevista` ascendente, nulls al final) — no se reordena en el cliente.
- Edición: patrón onChange-local/onBlur-guarda (mismo que "Cantidad objetivo" de Capa A) — `guardarPrevision()` hace `upsert` contra `previsiones_distribucion_pf` con `onConflict: 'linea_pedido_id'` (la `UNIQUE` del Paso 1 lo garantiza), y **refresca la distribución de ese producto final tras guardar** para que los totales se actualicen al instante.

**Diferencia deliberada de caché respecto al desglose de Semielaborados**: `desgloseSemiPorId` se cachea para siempre (la receta no cambia durante la sesión de pantalla); `desglosePFPorId` se **recarga en cada expand** (no solo la primera vez) porque el propio operador edita datos desde aquí y "producido hoy" puede cambiar mientras la pantalla sigue abierta (otra tanda que cierra).

**Vista de receta retirada de aquí, no destruida**: sigue disponible dentro de "Producción en curso" (`ProduccionProductosFinales.jsx`), que desde Capa A ya fusiona estimación/disponible por línea de ingrediente al fijar la cantidad objetivo — no se ha tocado nada ahí.

### 2. Botón play en la tabla "Productos finales"

`handleProducirPF(fila)` navega a `/produccion-productos?producto_final_id=X&cantidad=Y` (mismos query params ya leídos por `ProduccionProductosFinales.jsx` desde Capa A: `producto_final_id` precarga el selector, `cantidad` precarga la nueva "Cantidad a producir" del formulario de inicio, guardada como `cantidad_objetivo` al insertar). Oculto/deshabilitado en estado `ok`, mismo patrón visual y de tooltip que el botón play de Semielaborados (fix Fricción 1) — sobreproducir sigue siendo posible entrando directo a la pantalla de producción.

### 3. Producto final sin líneas de pedido pendientes

Decisión confirmada antes de implementar: se ajustó `distribucion_prevista_pf()` (migración `20260913_distribucion_prevista_pf_sin_lineas.sql`, probada en `BEGIN...ROLLBACK` contra un caso real sin pedidos y aplicada en firme) para que la función se conduzca desde los totales (`producido`/`distribuido`) con `LEFT JOIN` hacia una CTE de líneas pendientes, en vez de depender de que existan líneas para devolver algo. Efecto: **siempre** devuelve al menos una fila — una por línea pendiente, o una única fila con las columnas de línea en `NULL` si no hay ninguna. El frontend detecta `linea_pedido_id == null` como señal de "sin pedidos pendientes" y muestra ese texto en el cuerpo del desglose, pero con la cabecera de totales visible igualmente (ej. "producido hoy: 5.000 uds" sigue siendo información real y útil aunque nadie lo reclame todavía). Cambio aditivo verificado: con líneas pendientes, resultado idéntico al de antes.

### Fuera de alcance de este Paso 2 (sin tocar)

Expediciones, `albaranes_venta`, kanban/pedidos ficticios; el modelo de datos del Paso 1 más allá del ajuste puntual del punto 3; Semielaborados y su propio desglose (`DesgloseComponentes`, `construirFilaDesglose`, `toggleExpandSemi`) — intactos.

### Verificación

`npx eslint` sobre `PedidosDelDia.jsx`: 2 problemas, misma categoría y cantidad que el baseline antes de esta sesión — sin regresión. `npm run build`: compila sin errores. La migración del punto 3 se probó en transacción `BEGIN...ROLLBACK` contra un caso real (`producto_final_id` sin pedidos pendientes) antes de aplicarse en firme. Sin navegador disponible en este entorno para click-through real — no se ha probado la interacción en vivo, solo build/lint/pruebas SQL contra datos reales. **Esta ausencia de prueba real bajo el rol `authenticated` fue precisamente lo que dejó pasar el bug de permisos documentado en la addenda siguiente.**

---

## Addenda: fix de permisos — GRANT faltante en previsiones_distribucion_pf (2026-08-16)

**Bug real reportado tras el Paso 2**: al expandir el desglose de "Productos finales" para cualquier producto con líneas de pedido pendientes, el frontend mostraba "Error al cargar la distribución -- inténtalo de nuevo." Reproducido y diagnosticado contra los 4 productos finales reales con pedidos pendientes (`ZZ_AlbondigasconTomate` id 8, `ZZ_Hamburguesas` id 9, `ZZ_TORTILLACONCEBOLLAGRANDE` id 7, `ZZ_TORTILLASINCEBOLLAGRANDE` id 6) — **fallaba en los 4 por igual**, no era específico de ninguno.

**Error real** (código Postgres `42501`, ejecutando la función como el rol `authenticated`, el mismo que usa la app vía PostgREST):
```
permission denied for table previsiones_distribucion_pf
```

**Causa raíz**: la migración del Paso 1 (`20260912_previsiones_distribucion_pf.sql`) activó RLS y creó la política "Acceso total temporal" en `previsiones_distribucion_pf`, pero **nunca concedió los privilegios de tabla** (`GRANT`) al rol `authenticated`. `GRANT` y RLS son dos capas independientes en Postgres: el `GRANT` decide si el rol puede tocar la tabla en absoluto; RLS decide qué filas ve dentro de eso. Comparado contra el resto de tablas que toca la función (`producciones_producto_final`, `lineas_pedido_venta`, `pedidos_venta`, `clientes`, todas con `SELECT, INSERT, UPDATE, DELETE` para `authenticated`), `previsiones_distribucion_pf` solo tenía `REFERENCES, TRIGGER, TRUNCATE` — heredados por defecto, sin ninguno de los privilegios que realmente hacen falta.

**Por qué no se detectó al probar el Paso 1**: todas las pruebas en transacción de esa migración se ejecutaron con la conexión directa de Postgres (rol superusuario), que ignora tanto RLS como `GRANT` de tabla — nunca habría revelado este fallo por esa vía, aunque la prueba fuera exhaustiva en todo lo demás (UNIQUE, CASCADE, ausencia de bloqueo por stock). Lección aplicada: toda verificación de aquí en adelante sobre estas tablas debe simular el rol `authenticated` real, no basta con la conexión de superusuario.

**Fix**: migración nueva `20260914_grant_previsiones_distribucion_pf.sql` (no se editó la migración del Paso 1, ya aplicada y commiteada) — `grant select, insert, update, delete on previsiones_distribucion_pf to authenticated`.

**Verificación bajo el rol real** (no superusuario): primero con `SET LOCAL ROLE authenticated` a secas -- confirmó que el error 42501 desaparecía, pero la función devolvía la fila "sin pedidos pendientes" para los 4 productos aunque SÍ tienen líneas reales, porque `auth.role()` (usado por las políticas RLS) lee el *claim* del JWT, no el rol de Postgres, y sin ese claim las políticas de `lineas_pedido_venta`/`pedidos_venta` seguían filtrando todo. Repetido con `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claim.role = 'authenticated'` (simulación fiel de lo que hace PostgREST con un usuario real) — los 4 productos devolvieron sus datos reales sin error: id 8 → 1 línea (4 uds pedidas), id 9 → 1 línea (5 uds), id 7 → 1 línea (3 uds), id 6 → 2 líneas (2 y 5 uds), coincidiendo exactamente con lo ya visto como superusuario en el diagnóstico.

**Fuera de alcance**: no se ha revisado si el mismo patrón de GRANT faltante existe en alguna otra tabla nueva de sesiones anteriores -- esta addenda corrige únicamente `previsiones_distribucion_pf`, la única tabla nueva creada en este contrato.

---

## Capa C — cierre del ciclo producir → distribuir → albaranear (2026-08-18)

Objetivo de Capa C: cerrar el ciclo que Capa B dejó abierto a propósito. Capa B distribuye de forma provisional lo producido hoy entre pedidos pendientes, pero sin decidir qué tanda concreta cubre cada previsión ni conectar eso con la creación real del albarán. Capa C añade esa tanda concreta a la previsión (con sugerencia FIFO editable) y, en un Paso 2 posterior, precarga esa asignación al crear el albarán de venta.

### Auditoría previa (resumen — detalle completo en la conversación, no repetido aquí)

- "Crear albarán de venta" en `Pedidos.jsx` solo navega a `AlbaranesVenta.jsx?pedido_id=X` — no crea nada ni precarga lote. La precarga de cantidad/precio por línea de pedido ya existe ahí (`lineaPedidoPara()`), pero el selector de lote (`produccion_pf_id`) arranca siempre vacío; es 100% manual hoy.
- La columna "Servido" de `Pedidos.jsx` ya suma `lineas_albaran_venta` por `linea_pedido_id`, confirmado. Añadir "Previsto" (Paso 2 de Capa C) es el mismo patrón, sumando `previsiones_distribucion_pf.cantidad_prevista`.
- No existe FIFO de lote reutilizable. El FIFO de `CierreTanda.jsx` reparte cantidad de stock entre varios *pedidos* en déficit (orden de llegada), no elige una *tanda* concreta para una línea — no aplica aquí y no se toca.
- `stock_lotes_producto_final` es la fuente correcta para FIFO de lote: expone `fecha` (fecha de producción) y `stock_disponible` por tanda cerrada, ya usada con `order by fecha asc` en `AlbaranesVenta.jsx` y `CierreTanda.jsx`.
- `trg_actualizar_estado_pedido_por_servicio` (recalcula `pedidos_venta.estado = 'servido'` tras cambios en `lineas_albaran_venta`) ya resuelve gratis el paso de pedido a histórico — no se toca.
- `trg_actualizar_estado_pedido_por_produccion` es código muerto: depende de `producciones_producto_final.pedido_id`, vínculo obsoleto que el flujo actual (por tanda) deja sin rellenar a propósito — no se toca.

### Paso 1 — Modelo de datos: tanda en la previsión + sugerencia FIFO

**Migración**: `supabase/migrations/20260915_produccion_pf_id_previsiones_distribucion.sql`.

```sql
alter table previsiones_distribucion_pf
  add column produccion_pf_id bigint references producciones_producto_final(id) on delete set null;

create or replace function tanda_fifo_producto_final(p_producto_final_id bigint)
returns table (
  produccion_id bigint,
  fecha date,
  stock_disponible numeric,
  codigo_lote text
)
language sql
stable
as $$
  select produccion_id, fecha, stock_disponible, codigo_lote
  from stock_lotes_producto_final
  where producto_final_id = p_producto_final_id
    and stock_disponible > 0
  order by fecha asc, produccion_id asc
  limit 1
$$;

grant execute on function tanda_fifo_producto_final(bigint) to authenticated;
```

**Tres decisiones de diseño, justificadas:**

1. **`produccion_pf_id` nullable** (no `NOT NULL`): una previsión puede fijarse antes de que exista ninguna tanda cerrada de ese producto — el desglose de Capa B ya permite hoy `cantidad_prevista` con `residual_libre` negativo, sin bloqueo. Forzar `NOT NULL` rompería ese caso ya aceptado. Sin tanda, la columna queda `NULL` y la sugerencia FIFO tampoco devuelve nada hasta que haya stock.
2. **`UNIQUE(linea_pedido_id)` sin cambios**: sigue siendo "una previsión por línea de pedido"; añadir a qué tanda apunta esa única previsión no contradice esa unicidad. Reasignar a otra tanda (FIFO recalculado, o cambio manual desde el futuro selector de la UI) es un `UPDATE` de la fila existente, nunca un `INSERT` nuevo — verificado explícitamente en la prueba.
3. **`ON DELETE SET NULL`** (no `CASCADE`, no `RESTRICT`): borrar una tanda es un caso real — `ProduccionProductosFinales.jsx` permite cancelar producciones abiertas y borrar producciones ya cerradas. La previsión no es un compromiso real (mismo principio que el `CASCADE` de `linea_pedido_id` en el Paso 1 de Capa B), pero aquí la fuente de verdad es la intención del cliente (`linea_pedido_id`), no la tanda que la cubre: borrar la tanda no debe borrar la previsión, solo debe hacerle perder su asignación de lote y volver a "sin tanda asignada".

**Función `tanda_fifo_producto_final(p_producto_final_id)`**: da solo la sugerencia (primera tanda por antigüedad con `stock_disponible > 0`, o cero filas si no hay ninguna). El resto de tandas disponibles, para que el operador pueda cambiar a otra, se consulta directamente contra `stock_lotes_producto_final` desde el frontend en el Paso 2 — mismo patrón ya usado en `AlbaranesVenta.jsx`, no hace falta una segunda función.

**`GRANT EXECUTE` explícito**: Postgres concede `EXECUTE` en funciones a `PUBLIC` por defecto (a diferencia de las tablas) — `distribucion_prevista_pf()` de Capa B nunca lo necesitó por eso, y de hecho el bug de la addenda anterior fue de `GRANT` de *tabla*, no de función. Se añade aquí de todos modos, explícito, por la misma disciplina que motivó esa addenda.

### Prueba en transacción (`BEGIN...ROLLBACK`) y aplicación en firme

Probado primero en transacción contra datos reales (líneas de pedido pendientes 143/145/146/147 de los productos 6/7/8/9, más dos tandas de prueba insertadas y revertidas): columna nullable confirmada, FK con `confdeltype='n'` (`SET NULL`) confirmada, `UNIQUE` sigue rechazando duplicados, reasignación por `UPDATE` funciona, `ON DELETE SET NULL` confirmado (al borrar la tanda referenciada, la previsión real sobrevivió con `produccion_pf_id=NULL`), FIFO devolvió correctamente la tanda más antigua de dos. Todo revertido con `ROLLBACK`, cero datos de prueba persistidos.

Aplicada después en firme (`BEGIN; ...; COMMIT`). Verificación posterior, solo de lectura:

- Columna, FK (`ON DELETE SET NULL`) y `UNIQUE` confirmados vía `information_schema`/`pg_constraint`.
- Función registrada con la firma esperada; `EXECUTE` confirmado para `authenticated` (y `PUBLIC`, por el default).
- **Verificación bajo el rol `authenticated` real** (no superusuario, con `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claim.role = 'authenticated'`, simulando PostgREST): `SELECT` de `produccion_pf_id` y llamada a `tanda_fifo_producto_final()` funcionan sin `42501`, para los 4 productos reales con pedidos pendientes.
- `tanda_fifo_producto_final()` devuelve 0 filas para los 4 productos reales (6, 7, 8, 9) — correcto: actualmente no hay ninguna tanda cerrada con stock disponible para ninguno de ellos, no es un error.
- Las 3 previsiones reales ya existentes (líneas 143, 145, 146) quedaron intactas, todas con `produccion_pf_id=NULL` — ni se tocaron ni se dejó ningún dato de prueba.

### Fuera de alcance de este Paso 1 (sin tocar)

UI de Pedidos, Producciones del día, AlbaranesVenta (Paso 2 de Capa C, siguiente); los dos triggers auditados (`trg_actualizar_estado_pedido_por_servicio`, `trg_actualizar_estado_pedido_por_produccion`); Expediciones.

### Paso 2 — UI en Pedidos, Producciones del día y AlbaranesVenta

Cierra el ciclo: Pedidos ya no ofrece iniciar producción por línea (es agregada, desde Producciones del día); el desglose de "Producciones del día" permite fijar/cambiar la tanda de cada previsión; AlbaranesVenta precarga y bloquea el lote cuando viene de una previsión, y un trigger nuevo mantiene sincronizada la previsión con lo efectivamente albaranado.

**Tres decisiones abiertas, confirmadas antes de implementar:**

1. **Selector de tanda en el desglose**: icono junto al campo "Previsto", visible solo cuando hay más de una tanda con stock disponible; al pulsarlo despliega un `<Select>` inline con todas las tandas disponibles. Con una previsión sin alternativas (0 o 1 tanda), no se muestra el icono, solo una etiqueta pasiva ("Sin tanda asignada" / "Tanda `fecha`").
2. **`cantidad_prevista` al llegar a 0 o menos**: se trunca a 0 (`greatest(0, ...)`, nunca negativa) pero la fila se mantiene, conservando `produccion_pf_id` como rastro de qué tanda cubrió finalmente esa línea de pedido -- trazabilidad para el futuro histórico, y evita que la reconstrucción al borrar una línea de albarán tenga que decidir entre `UPDATE` e `INSERT` en el caso normal.
3. **Identificación fiable para reconstruir la previsión al borrar una línea de albarán**: trigger DB simétrico `AFTER INSERT OR DELETE` en `lineas_albaran_venta` (mismo patrón que `trg_actualizar_estado_pedido_por_servicio`, ya existente en esa tabla), identificando la previsión únicamente por `linea_pedido_id` -- el `UNIQUE(linea_pedido_id)` del Paso 1 garantiza que hay como mucho una, sea cual sea la tanda a la que apunte en ese momento. Atómico, y cubre igual el borrado de una línea suelta o el borrado en cascada de un albarán completo (`lineas_albaran_venta_albaran_venta_id_fkey` tiene `ON DELETE CASCADE`, confirmado), sin depender de por qué vía desaparece la línea.

**Migración `supabase/migrations/20260916_previsiones_trigger_lineas_albaran.sql`** -- trigger `trg_actualizar_previsiones_por_linea_albaran`:

```sql
create or replace function public.actualizar_previsiones_por_linea_albaran()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.linea_pedido_id is not null and NEW.produccion_pf_id is not null then
      update previsiones_distribucion_pf
      set cantidad_prevista = greatest(0, cantidad_prevista - NEW.cantidad)
      where linea_pedido_id = NEW.linea_pedido_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.linea_pedido_id is not null and OLD.produccion_pf_id is not null then
      update previsiones_distribucion_pf
      set cantidad_prevista = cantidad_prevista + OLD.cantidad
      where linea_pedido_id = OLD.linea_pedido_id;
      if not found then
        insert into previsiones_distribucion_pf (producto_final_id, linea_pedido_id, cantidad_prevista, produccion_pf_id)
        values (OLD.producto_final_id, OLD.linea_pedido_id, OLD.cantidad, OLD.produccion_pf_id);
      end if;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

create trigger trg_actualizar_previsiones_por_linea_albaran
after insert or delete on lineas_albaran_venta
for each row execute function actualizar_previsiones_por_linea_albaran();
```

Solo actúa sobre líneas de tipo "producto final" ligadas a un pedido real (`linea_pedido_id` y `produccion_pf_id` no nulos) -- mercadería, libres, o ventas directas sin pedido de origen no participan de `previsiones_distribucion_pf` y el trigger no las toca. La rama `if not found` en el `DELETE` es una red de seguridad defensiva (el flujo normal, con la decisión de "mantener la fila en 0", casi nunca la ejecuta) para el caso en que la previsión falte por cualquier otro motivo.

**Migración `supabase/migrations/20260917_distribucion_prevista_pf_produccion_pf_id.sql`** -- `distribucion_prevista_pf()` amplía su salida con `produccion_pf_id` (columna aditiva sobre la CTE `lineas_pendientes` de la versión vigente desde el ajuste "sin líneas"), para que el desglose de "Producciones del día" sepa qué tanda tiene asignada cada línea sin una segunda consulta. Requiere `drop function` previo (Postgres no permite `CREATE OR REPLACE` cuando cambia el conjunto de columnas de un `RETURNS TABLE`, error `42P13`).

**Prueba en transacción y aplicación en firme**: probadas ambas migraciones juntas contra datos reales (líneas de pedido pendientes 143/145/146 con previsiones reales existentes, más una tanda y un albarán de prueba insertados y revertidos) -- `INSERT` resta correctamente, `DELETE` de línea suelta reconstruye al valor original, `DELETE` en cascada de un albarán con dos líneas (145 y 146) reconstruye ambas previsiones correctamente, la rama defensiva `not found` recrea la fila desde cero cuando se fuerza su ausencia. Repetido bajo el rol `authenticated` real (`SET LOCAL ROLE` + JWT claim simulado): `INSERT`, `DELETE` y la función ampliada funcionan sin `42501`. Todo revertido con `ROLLBACK`; aplicado después en firme (`BEGIN; ...; COMMIT`) y confirmado por lectura que no quedó ningún dato de prueba (previsiones reales intactas, cero tandas/albaranes de prueba persistidos).

**Cambios de UI:**

- **`Pedidos.jsx`**: eliminado el link "Iniciar producción" por línea (ya no aplica, la producción es agregada desde Producciones del día); añadida columna "Previsto" entre "Pedido" y "Servido", sumando `previsiones_distribucion_pf.cantidad_prevista` por `linea_pedido_id` -- mismo patrón que "Servido". El link "Crear albarán de venta" y el agrupamiento pendientes/histórico (vía `trg_actualizar_estado_pedido_por_servicio`) no se han tocado.
- **`PedidosDelDia.jsx`** (`DesgloseDistribucionPF`): `cargarDistribucionPF` ahora también carga las tandas con stock disponible del producto (`stock_lotes_producto_final`, mismo `order by fecha asc` que `AlbaranesVenta.jsx`/`CierreTanda.jsx`). `guardarPrevision()` sugiere la tanda FIFO (`tanda_fifo_producto_final()`) solo cuando la previsión todavía no tenía ninguna asignada -- no pisa una elección manual ya hecha. Nuevo `cambiarTandaPrevision()` para el cambio manual desde el selector. El icono de cambio de tanda (`IconArrowsExchange`) solo aparece con más de una tanda disponible; debajo del campo "Previsto" siempre se muestra una etiqueta pasiva con la tanda asignada o "Sin tanda asignada".
- **`AlbaranesVenta.jsx`** (`ProductoParaVender`): la carga de líneas del pedido (`cargarPedido`) ahora también trae `previsiones_distribucion_pf(produccion_pf_id, cantidad_prevista)`, exponiendo `produccion_pf_id_previsto` por línea. Si existe, se precarga `loteId` y el selector de lote se sustituye por una etiqueta fija no editable ("asignado desde Producciones del día") -- cantidad y precio siguen editables igual que antes. La consulta de lotes deja de filtrar `stock_disponible > 0` en el servidor (se filtra en JS vía `lotesConDisponibleReal`, ya existente) para poder mostrar el lote bloqueado aunque su stock actual sea 0; el guard de "sin nada que ofrecer" ahora respeta ese caso (`lotesConDisponibleReal.length === 0 && !loteBloqueado`). El `INSERT` real en `lineas_albaran_venta` no cambia -- la resta de la previsión ya la hace el trigger del lado de la base de datos, no lógica nueva en el frontend.

### Verificación

`npx eslint` sobre los tres archivos modificados (`Pedidos.jsx`, `PedidosDelDia.jsx`, `AlbaranesVenta.jsx`): 9 problemas (6 errores, 3 warnings), idéntico al baseline antes de esta sesión -- sin regresión (los errores/warnings preexistentes son de `react-hooks/set-state-in-effect` y `exhaustive-deps` en efectos ya existentes, no tocados). `npm run build`: compila sin errores. Sin navegador disponible en este entorno para click-through real -- no se ha probado la interacción en vivo (selector de tanda, precarga/bloqueo de lote en AlbaranesVenta), solo build/lint/pruebas SQL contra datos reales bajo el rol `authenticated`.

### Fuera de alcance de este Paso 2 (sin tocar)

Expediciones, kanban/pedidos ficticios; reparto de una línea entre varias tandas a la vez (descartado, una tanda por línea de pedido); los dos triggers ya auditados (`trg_actualizar_estado_pedido_por_servicio`, `trg_actualizar_estado_pedido_por_produccion`).

---

## Addenda: fix -- botón play precargaba necesidad total en vez de lo que falta por fabricar (2026-08-18)

**Bug reportado**: al producir un producto final en varias tandas el mismo día, el botón play de la tabla "Productos finales" precargaba siempre la necesidad agregada TOTAL como cantidad objetivo, sin descontar lo ya producido hoy en tandas anteriores del mismo producto. Caso real: `ZZ_TORTILLASINCEBOLLAGRANDE`, necesidad agregada 7; primera tanda cerrada con 5 uds; al pulsar play para la segunda tanda, precargaba 7 en vez de 2 (`7 − 5`).

**Causa raíz confirmada**: `handleProducirPF` (`PedidosDelDia.jsx`) navegaba con `cantidad=${fila.necesidad}`, y `fila.necesidad` viene directa de `necesidades_pedidos_cascada()` -- que para el nivel `producto_final` devuelve explícitamente necesidad **bruta** de pedido, nunca neta de stock propio (documentado en la cabecera de esa función: "La fila 'producto_final' devuelta sigue siendo necesidad bruta de pedido, sin cambio de comportamiento visible en esa tabla"). `necesidades_pedidos_cascada()` no se ha tocado -- sigue siendo correcta para lo que hace, que es calcular necesidad agregada bruta y cascada de déficit hacia semielaborados/ingredientes, no un residual de fabricación por producto final.

**No era solo "reutilizar mal una resta ya hecha"**: la tabla no tenía, en ningún sitio, un valor de "cuánto falta por fabricar" listo para reutilizar. La columna "Stock disponible" (`stockPorPF`, de `stock_lotes_producto_final`) es un balance histórico que ya descuenta lo **albaranado** -- útil para la columna "Estado" de la tabla, pero responde a una pregunta distinta ("cuánto queda para vender/entregar"), no a "cuánto queda por producir hoy". Usarla para el play hubiera sido tan incorrecto como el bug original, solo que por el motivo contrario (el enunciado del bug lo advertía explícitamente).

**Fix**: nueva agregación `producidoHoyPorPF` (estado análogo a `stockPorPF`, cargada en el mismo punto de `cargarDatos()`), suma de `cantidad_producida` de `producciones_producto_final` con `estado = 'cerrada'` y `fecha = hoy` por producto final -- mismo criterio que `total_producido_hoy` de `distribucion_prevista_pf()` (Capa B), pero como agregado batch en el frontend en vez de una llamada RPC por fila, para no disparar una consulta por producto solo por tener el botón visible. `handleProducirPF` pasa a navegar con `cantidad = Math.max(0, fila.necesidad - producidoHoy)`.

**Verificación con datos reales**: `ZZ_TORTILLASINCEBOLLAGRANDE` (`producto_final_id = 6`) tiene hoy dos tandas cerradas reales, `id=137` (5 uds) e `id=138` (2 uds), necesidad bruta real 7. Replicando la query nueva solo contra la tanda 137 (escenario real reportado, "primera tanda ya cerrada"): `producidoHoy = 5`, residual `7 − 5 = 2` -- coincide exactamente con lo esperado. Con ambas tandas (estado real actual): `producidoHoy = 7`, residual `0` (ya cubierto). `npx eslint` sobre `PedidosDelDia.jsx`: 2 problemas, idéntico al baseline anterior a este fix -- sin regresión. `npm run build`: compila sin errores.

### Fuera de alcance de este fix

`necesidades_pedidos_cascada()` (no tocada, confirmado correcta para su propósito); lógica de distribución/previsiones (`previsiones_distribucion_pf`, ya cerrada en los pasos anteriores); la columna "Stock disponible"/"Estado" de la tabla, que sigue sin cambios.

---

## Addenda: fix -- selector de reasignación de tanda no mostraba alternativas con la tanda actual vacía (2026-08-18)

**Bug reportado**: al agotar la tanda asignada a una previsión (todo su stock consumido por un albarán real de otra línea del mismo producto), el selector de tanda del desglose de "Producciones del día" dejaba de mostrar cualquier alternativa para reasignar -- aunque existiera otra tanda del mismo producto con stock real. Caso real: `ZZ_TORTILLASINCEBOLLAGRANDE`, tanda 140 (0 disponible, asignada a la previsión de Cliente1) y tanda 141 (2 disponible, sin asignar) -- el icono para cambiar de tanda no aparecía en la fila de Cliente1.

**Causa raíz confirmada**: `hayAlternativas = tandasProducto.length > 1`, donde `tandasProducto` ya viene filtrada por `stock_disponible > 0` (correcto para no reofrecer un lote agotado como opción nueva). Al vaciarse la tanda ya asignada, esta queda excluida de esa lista -- con una sola tanda restante (la 141), `length` daba 1, y `1 > 1` es `false`, ocultando el selector aunque esa tanda sí fuera una alternativa real. El bug estaba solo en el conteo, no en el filtro de la query (que sigue igual, sin tocar).

**Fix** (`DesgloseDistribucionPF`, `PedidosDelDia.jsx`): `hayAlternativas` compara ahora contra la tanda ya asignada de esa previsión en vez de solo contar el tamaño de la lista -- hay alternativa si existe alguna tanda en `tandasProducto` con `produccion_id` distinto de `f.produccion_pf_id`, o si todavía no hay ninguna tanda asignada y la lista tiene al menos una:

```js
const hayAlternativas = f.produccion_pf_id != null
  ? tandasProducto.some((t) => Number(t.produccion_id) !== Number(f.produccion_pf_id))
  : tandasProducto.length > 0
```

**Verificación con datos reales**: replicada la query exacta de `cargarDistribucionPF` contra `producto_final_id = 6` -- `tandasProducto` real solo contiene la tanda 141 (2 disponible). Con la previsión real de Cliente1 (`produccion_pf_id = 140`, la tanda vacía), el código corregido da `hayAlternativas = true` (la 141 es distinta de la 140 asignada); el código anterior daba `false` para el mismo caso -- confirma el bug y el fix con el mismo dato real. Caso de control (previsión de Empresa1, también apuntando a la 140): igualmente `true`. `npx eslint` sobre `PedidosDelDia.jsx`: 2 problemas, idéntico al baseline anterior a este fix -- sin regresión. `npm run build`: compila sin errores.

### Fuera de alcance de este fix

El problema 2 reportado junto con este (déficit fantasma en `necesidades_pedidos_cascada()` por líneas ya servidas dentro de un pedido con estado mixto) -- diagnosticado, pendiente de decidir el fix en una revisión aparte. La query de `stock_lotes_producto_final` en `cargarDistribucionPF` (el filtro `gt('stock_disponible', 0)`) no se ha tocado.

---

## Addenda: fix -- déficit fantasma en necesidades_pedidos_cascada() por línea ya servida dentro de pedido abierto (2026-08-18)

**Bug reportado**: con `necesidad_agregada = 7` y `producido_hoy = 7` (ambas tandas ya cerradas) para `ZZ_TORTILLASINCEBOLLAGRANDE`, el estado seguía mostrando "Falta stock de semielaborados", como si aún faltara producir.

**Causa raíz confirmada**: `necesidades_pedidos_cascada()` calculaba la necesidad de partida (`tmp_cs_pf`) sumando `lpv.cantidad` **bruta** de todas las líneas de pedidos `pendiente`/`en_produccion`, sin descontar lo que cada línea individual ya tuviera servido vía `lineas_albaran_venta`. Antes de Capa C esto era correcto -- nunca existía una línea ya servida dentro de un pedido que siguiera abierto por otra línea distinta, porque la entrega iba ligada al pedido como unidad. Capa C lo hizo posible (producción agregada + `previsiones_distribucion_pf` + entrega parcial por línea), abriendo este hueco. Caso real: pedido de ZZ_Empresa1 con la línea de `ZZ_TORTILLASINCEBOLLAGRANDE` (5 uds) ya servida por completo, pero el pedido seguía `pendiente` por otra línea distinta (`ZZ_TORTILLACONCEBOLLAGRANDE`, sin servir) -- esas 5 uds ya entregadas se seguían sumando a la necesidad bruta.

**Fix**: `supabase/migrations/20260918_necesidades_pedidos_cascada_neta_por_linea.sql` -- `CREATE OR REPLACE FUNCTION necesidades_pedidos_cascada()`, único cambio real en la construcción de `tmp_cs_pf`, netando cada línea individualmente contra lo servido de esa misma línea antes de sumar por producto final:

```sql
drop table if exists tmp_cs_pf;
create temporary table tmp_cs_pf on commit drop as
select lpv.producto_final_id as id,
  sum(greatest(lpv.cantidad - coalesce(servido.cantidad, 0), 0)) as necesidad
from lineas_pedido_venta lpv
left join (
  select linea_pedido_id, sum(cantidad) as cantidad
  from lineas_albaran_venta
  where linea_pedido_id is not null
  group by linea_pedido_id
) servido on servido.linea_pedido_id = lpv.id
where lpv.pedido_id = any(p_pedido_ids) and lpv.producto_final_id is not null
group by lpv.producto_final_id;
```

El resto de la función (déficit contra stock, oleadas topológicas hacia semielaborados/ingredientes/artículos) no cambia -- sigue leyendo `tmp_cs_pf.necesidad` exactamente igual que antes. Único añadido complementario: el `select` final del nivel `producto_final` gana un `where pf.necesidad > 0` (los otros tres niveles ya lo tenían) -- antes no hacía falta, la necesidad bruta por producto siempre era `> 0` si el producto aparecía en `tmp_cs_pf`; con el neteo por línea, un producto cuya única demanda venga de una línea ya completamente servida puede netear a 0, y sin este filtro aparecería en la tabla con "Necesidad agregada: 0" sin ningún sentido.

`necesidades_pedidos()` (la función hermana sin cascada, usada por `Producciones.jsx`/`ProduccionProductosFinales.jsx`) no se ha tocado -- no depende de este cálculo.

**Prueba en transacción y aplicación en firme**, contra datos reales:
1. **Caso reportado**: pedidos 126 (ZZ_Cliente1) y 127 (ZZ_Empresa1) -- línea 145 (2 uds, 0 servido) + línea 146 (5 uds, **5 servido**) para `producto_final_id=6` -- resultado `necesidad=2`, no 7. Déficit fantasma desaparecido.
2. **Líneas totalmente sin servir** (mismo pedido 126, productos 8 y 9): sin cambios, `4` y `5` exactos.
3. **Pedido con todas sus líneas servidas** (pedido real 37, estado `servido` confirmado): excluido de forma natural por el filtro del frontend (`estado in (pendiente, en_produccion)`) antes de llegar a la función; prueba defensiva adicional llamando la función directamente con ese id (saltándose el frontend) confirma `0` filas en total.
4. Cascada hacia semielaborados verificada coherente tras el fix (4 filas de nivel `semielaborado`, sin errores).
5. Repetido bajo el rol `authenticated` real (`SET LOCAL ROLE` + JWT claim simulado): mismo resultado, `producto_final_id=6 → 2`, sin `42501`.

Todo revertido con `ROLLBACK`; aplicado después en firme (`BEGIN; ...; COMMIT`) y confirmado por lectura contra los datos reales: `producto_final_id=6 → necesidad=2`, sin tablas temporales residuales, sin cambios en `previsiones_distribucion_pf` (la función es de solo lectura).

### Fuera de alcance de este fix

`necesidades_pedidos()` (no tocada); lógica de distribución/previsiones; la columna "Stock disponible"/"Estado" de la tabla.
