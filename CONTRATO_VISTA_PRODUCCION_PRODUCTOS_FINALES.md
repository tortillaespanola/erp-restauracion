# Contrato: Producción de Productos Finales — Capa B (distribución provisional)

Estado: Paso 1 (modelo de datos + función de cálculo) diseñado, probado en transacción `BEGIN...ROLLBACK` y aplicado en firme contra datos reales. Sin UI todavía (Paso 2, siguiente prompt). Fecha: 2026-08-16.

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

- **Aplicar esta migración en firme** — pendiente de confirmación explícita.
- **Paso 2 (siguiente prompt)**: UI en Producciones del día — desglose por cliente/pedido en la tabla de "Productos finales", edición de `cantidad_prevista` por línea, indicador de residual libre. Fuera de alcance de este documento todavía.
- Expediciones, `albaranes_venta`, kanban/pedidos ficticios — no tocar, siguen fuera de alcance.
