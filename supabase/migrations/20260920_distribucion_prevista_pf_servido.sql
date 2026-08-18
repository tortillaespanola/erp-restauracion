-- Fix: en el desglose de "Producciones del día", una línea de pedido ya completamente servida (por
-- ejemplo dentro de un pedido que sigue abierto por otra línea distinta) seguía mostrando el campo
-- "Previsto" editable y el link "+ repartir en otra tanda" activos, aunque no quedara nada pendiente
-- ahí -- distribucion_prevista_pf() no exponía cuánto llevaba servido cada línea, así que el frontend
-- no tenía forma de distinguir "línea genuinamente pendiente" de "línea ya servida del todo, pedido
-- abierto solo por otra línea" (mismo tipo de hueco que el fix de necesidades_pedidos_cascada() de esta
-- misma sesión, pero aquí a nivel de UI/lectura, no de cálculo de déficit).
--
-- Cambio aditivo: añade `servido` a la CTE lineas_pendientes y a la salida -- mismo cálculo
-- (sum(lineas_albaran_venta.cantidad) por linea_pedido_id) que ya usa Pedidos.jsx para su columna
-- "Servido". No cambia ninguna otra columna, orden, ni la estructura LEFT JOIN "siempre al menos una
-- fila" ya existente.
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
  servido numeric,
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
      coalesce((select sum(lav.cantidad) from lineas_albaran_venta lav where lav.linea_pedido_id = lpv.id), 0) as servido,
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
    lp.servido,
    lp.cantidad_prevista,
    lp.produccion_pf_id
  from producido
  cross join distribuido
  left join lineas_pendientes lp on true
  order by lp.fecha_entrega_prevista nulls last, lp.pedido_id;
$$;
