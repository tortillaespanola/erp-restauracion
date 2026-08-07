-- Mismo bug de asignación asimétrica que en actualizar_estado_pedido_por_servicio
-- (ver 20260801_pedidos_venta.sql), diagnosticado en pedidos_venta y confirmado
-- también aquí: el CASE original solo avanza a 'recibido', nunca retrocede a
-- 'pendiente' cuando una entrada_material que cubría una línea se borra
-- (ej. al borrar un albarán de compra histórico).
--
-- pedidos_compra.estado solo tiene 3 valores (pendiente | recibido | cancelado,
-- ver comentario de columna en 20260802_flujo_compras_pedido_directa.sql:13) —
-- a diferencia de pedidos_venta no hay un estado intermedio equivalente a
-- 'en_produccion', así que no hace falta ninguna subconsulta adicional: el
-- CASE corregido es simétrico sin más cambios.
--
-- Corrige también los 2 pedidos reales ya afectados hoy (detectados por
-- auditoría: estado='recibido' con al menos una línea sin cobertura real de
-- entrada_material) — OC-260002 (id=4) y OC-260003 (id=5).
--
-- Probado en transacción de prueba (ROLLBACK) antes de aplicar: confirmado que
-- ambos pasan a 'pendiente' y que el resto de pedidos_compra no cancelados no
-- cambia.

create or replace function public.actualizar_estado_pedido_compra()
returns trigger
language plpgsql
as $$
declare
  v_pedido_id bigint;
  v_pendiente boolean;
begin
  select pedido_compra_id into v_pedido_id
  from lineas_pedido_compra
  where id = coalesce(NEW.linea_pedido_compra_id, OLD.linea_pedido_compra_id);

  if v_pedido_id is null then
    return coalesce(NEW, OLD);
  end if;

  select exists (
    select 1
    from lineas_pedido_compra lp
    where lp.pedido_compra_id = v_pedido_id
      and lp.cantidad > coalesce((select sum(cantidad) from entrada_material where linea_pedido_compra_id = lp.id), 0)
  ) into v_pendiente;

  update pedidos_compra
  set estado = case when v_pendiente then 'pendiente' else 'recibido' end
  where id = v_pedido_id and estado <> 'cancelado';

  return coalesce(NEW, OLD);
end;
$$;

update pedidos_compra set estado = 'pendiente' where id in (4, 5);
