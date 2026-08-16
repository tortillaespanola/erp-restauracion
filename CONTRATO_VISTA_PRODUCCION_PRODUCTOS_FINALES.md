# Contrato: Producción de Productos Finales — Capa B (distribución provisional)

Estado: Paso 1 (modelo de datos + función de cálculo) y Paso 2 (UI en Producciones del día) completos, aplicados en firme y verificados, con un fix posterior de permisos ya corregido y verificado bajo el rol real. Ver "Addenda: Paso 2 — UI de distribución y botón play (2026-08-16)" y "Addenda: fix de permisos — GRANT faltante en previsiones_distribucion_pf (2026-08-16)" más abajo. Fecha: 2026-08-16.

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
