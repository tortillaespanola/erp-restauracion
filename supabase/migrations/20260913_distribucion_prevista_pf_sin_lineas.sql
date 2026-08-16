-- Addenda al Paso 1 de Capa B (CONTRATO_VISTA_PRODUCCION_PRODUCTOS_FINALES.md): cuando un producto
-- final no tiene ninguna línea de pedido pendiente, distribucion_prevista_pf() devolvía CERO filas --
-- ni siquiera los totales (producido hoy, distribuido, residual), aunque esa cifra sea información
-- real y útil ("hemos producido X hoy y no hay ningún pedido que lo reclame todavía"). Decisión
-- explícita, confirmada antes de implementar el Paso 2 (UI): en vez de dejar el desglose sin poder
-- expandirse en ese caso, la función pasa a conducirse desde los totales (producido/distribuido) con
-- LEFT JOIN hacia las líneas pendientes -- devuelve SIEMPRE una fila (una por línea pendiente, o una
-- única fila con las columnas de línea en NULL si no hay ninguna), en vez de depender de que existan
-- líneas para aparecer. Cambio aditivo: con líneas pendientes, resultado idéntico al de antes (misma
-- cantidad de filas, mismos valores) -- solo cambia el caso que antes devolvía cero filas.
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
  lineas_pendientes as (
    select
      lpv.id as linea_pedido_id,
      lpv.cantidad as cantidad_pedida,
      pv.id as pedido_id,
      pv.codigo_pedido,
      c.nombre as cliente_nombre,
      pv.fecha_entrega_prevista,
      coalesce(pd.cantidad_prevista, 0) as cantidad_prevista
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
    lp.cantidad_prevista
  from producido
  cross join distribuido
  left join lineas_pendientes lp on true
  order by lp.fecha_entrega_prevista nulls last, lp.pedido_id;
$$;
