-- Capa C, Paso 2: distribucion_prevista_pf() debe exponer también produccion_pf_id de cada previsión,
-- para que la UI de Producciones del día (selector de tanda del desglose) sepa qué tanda tiene asignada
-- cada línea de pedido sin una segunda consulta -- mismo criterio ya documentado en el Paso 1 de Capa B
-- ("evita una segunda consulta desde el frontend").
--
-- Cambio puramente aditivo sobre la versión vigente (20260913_distribucion_prevista_pf_sin_lineas.sql):
-- añade produccion_pf_id a la CTE lineas_pendientes, a las columnas de salida y al SELECT final, sin
-- tocar la estructura LEFT JOIN "siempre al menos una fila" ni ninguna otra columna/orden ya existente.
--
-- DROP previo obligatorio: Postgres no permite CREATE OR REPLACE cuando cambia el conjunto de columnas
-- de un RETURNS TABLE (error 42P13, "cannot change return type of existing function") -- añadir
-- produccion_pf_id cuenta como cambio de tipo de retorno aunque el resto sea idéntico.
drop function if exists distribucion_prevista_pf(bigint);

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
  cantidad_prevista numeric,
  produccion_pf_id bigint
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
  lineas_pendientes as (
    select
      lpv.id as linea_pedido_id,
      lpv.cantidad as cantidad_pedida,
      pv.id as pedido_id,
      pv.codigo_pedido,
      c.nombre as cliente_nombre,
      pv.fecha_entrega_prevista,
      coalesce(pd.cantidad_prevista, 0) as cantidad_prevista,
      pd.produccion_pf_id
    from lineas_pedido_venta lpv
    join pedidos_venta pv on pv.id = lpv.pedido_id
    join clientes c on c.id = pv.cliente_id
    left join previsiones_distribucion_pf pd on pd.linea_pedido_id = lpv.id
    where lpv.producto_final_id = p_producto_final_id
      and pv.estado in ('pendiente', 'en_produccion')
  ),
  distribuido as (
    select coalesce(sum(cantidad_prevista), 0) as total from lineas_pendientes
  )
  select
    producido.total,
    distribuido.total,
    producido.total - distribuido.total,
    lp.linea_pedido_id,
    lp.pedido_id,
    lp.codigo_pedido,
    lp.cliente_nombre,
    lp.fecha_entrega_prevista,
    lp.cantidad_pedida,
    lp.cantidad_prevista,
    lp.produccion_pf_id
  from producido
  cross join distribuido
  left join lineas_pendientes lp on true
  order by lp.fecha_entrega_prevista nulls last, lp.pedido_id;
$$;
