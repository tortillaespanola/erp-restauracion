-- Capa B (CONTRATO_VISTA_PRODUCCION_PRODUCTOS_FINALES.md): distribución PROVISIONAL de lo producido
-- hacia pedidos de cliente pendientes, previa a una futura pantalla de Expediciones (no existe
-- todavía). "Provisional" es deliberado: sin estado de confirmación, sin bloqueo de stock, editable y
-- borrable libremente -- no es un compromiso real ni mueve stock (eso sigue pasando únicamente vía
-- lineas_albaran_venta al generar el albarán real). Confirmado en auditoría previa: no hay ningún
-- mecanismo de reserva/asignación en el esquema actual, y tipo_venta de albaranes_venta resuelve un
-- problema distinto (venta sin stock de respaldo, con incidencia) -- esta tabla es nueva, no reutiliza
-- ninguna de las dos.
--
-- Mismas columnas de trazabilidad que lineas_albaran_venta (negocio_id, linea_pedido_id ->
-- lineas_pedido_venta, created_at), pero deliberadamente SIN el CHECK/trigger de bloqueo por stock de
-- check_stock_producto_final() -- aquí "excede lo producido" es aviso de frontend (próximo paso),
-- nunca una regla dura de base de datos.
--
-- linea_pedido_id ON DELETE CASCADE (a diferencia de lineas_albaran_venta.linea_pedido_id, que NO
-- tiene cascade): una previsión no es un compromiso real como una línea de albarán ya emitida -- si se
-- borra la línea de pedido que la origina (pedido corregido/cancelado y su línea eliminada), la
-- previsión asociada deja de tener sentido y debe desaparecer con ella, no bloquear el borrado.
--
-- UNIQUE(linea_pedido_id): una previsión por línea de pedido, editable in situ (UPDATE) -- no una
-- lista acumulable de previsiones parciales para la misma línea. Coherente con "libremente editable",
-- no con "libremente insertable en paralelo".
create table previsiones_distribucion_pf (
  id bigint generated always as identity primary key,
  producto_final_id bigint not null references productos_finales(id),
  linea_pedido_id bigint not null references lineas_pedido_venta(id) on delete cascade,
  cantidad_prevista numeric(12,3) not null,
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid references negocios(id),
  created_at timestamptz not null default now(),
  constraint previsiones_distribucion_pf_linea_pedido_id_key unique (linea_pedido_id)
);

-- Mismo patrón RLS "Acceso total temporal" verificado idéntico en lineas_pedido_venta, pedidos_venta,
-- producciones_producto_final y productos_finales -- sin trigger que fije negocio_id (confirmado:
-- ninguna de esas tablas lo tiene), se apoya solo en el DEFAULT de columna, igual que el resto.
alter table previsiones_distribucion_pf enable row level security;

create policy "Acceso total temporal" on previsiones_distribucion_pf
  for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

-- Función de apoyo para la futura UI de Capa B: para un producto final dado, una fila por cada línea
-- de pedido PENDIENTE de ese producto (mismo filtro de estado que ya usa PedidosDelDia.jsx:
-- pendiente/en_produccion), con los totales de cabecera repetidos en cada fila -- evita una segunda
-- consulta desde el frontend, mismo criterio que las vistas planas ya existentes
-- (stock_productos_finales). Si el producto no tiene ninguna línea de pedido pendiente, no devuelve
-- ninguna fila (ni siquiera los totales) -- limitación conocida, a resolver en el paso de UI si hace
-- falta mostrar el resumen igualmente sin líneas.
--
-- total_producido_hoy: SOLO tandas cerradas de HOY (fecha = current_date) -- deliberadamente distinto
-- del cálculo de stock_lotes_producto_final/stock_productos_finales (que es un balance histórico
-- completo sin filtrar por fecha, y ya descuenta lo albaranado). La pregunta operativa aquí es "de lo
-- que se ha producido HOY, cuánto llevo ya previsto para los pedidos pendientes" -- una métrica
-- distinta a propósito, no un duplicado con otro nombre del balance de stock.
--
-- total_distribuido: suma de TODAS las previsiones de este producto final para líneas de pedidos
-- pendientes (previsiones_distribucion_pf no tiene columna de fecha propia, no se puede acotar "de
-- hoy"). residual_libre = producido_hoy - distribuido, puede salir negativo si se ha previsto más de
-- lo producido hoy -- informativo, sin bloqueo, mismo criterio que el resto de este contrato.
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
    producido.total,
    distribuido.total,
    producido.total - distribuido.total,
    lpv.id,
    pv.id,
    pv.codigo_pedido,
    c.nombre,
    pv.fecha_entrega_prevista,
    lpv.cantidad,
    coalesce(pd.cantidad_prevista, 0)
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
