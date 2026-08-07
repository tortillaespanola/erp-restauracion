-- Mismo bug de asignación asimétrica ya corregido en pedidos_compra (ver
-- 20260816_fix_estado_pedido_compra.sql): el CASE original de
-- actualizar_estado_pedido_por_servicio solo avanzaba a 'servido', nunca
-- retrocedía cuando una lineas_albaran_venta que cubría una línea de pedido
-- se borraba (ej. al borrar un albarán de venta histórico, caso real:
-- DN-260017 sobre OV-260014).
--
-- A diferencia de pedidos_compra, pedidos_venta.estado sí tiene un estado
-- intermedio ('en_produccion', ver comentario de columna en
-- 20260801_pedidos_venta.sql:15) además de 'pendiente' — al retroceder hace
-- falta decidir entre los dos. Se añade v_en_produccion: existe alguna
-- producciones_producto_final vinculada al pedido -> 'en_produccion', si no
-- -> 'pendiente'. Mismo criterio que ya usa actualizar_estado_pedido_por_produccion
-- para avanzar de 'pendiente' a 'en_produccion'.
--
-- Limitación conocida y documentada (no corregida aquí, fuera de alcance):
-- este trigger vive en lineas_albaran_venta, no en producciones_producto_final
-- (confirmado: lineas_albaran_venta.produccion_pf_id no tiene ON DELETE
-- CASCADE, así que cancelar/borrar una producción sin servir todavía no
-- dispara este trigger). Si la única producción de un pedido se cancela, el
-- pedido puede quedar en 'en_produccion' sin retroceder a 'pendiente' — ya
-- pasaba así antes de este fix, no lo introduce ni lo agrava.
--
-- Corrige también el pedido real ya afectado hoy: OV-260014 (id=39),
-- estado='servido' con su única línea sin cobertura real de
-- lineas_albaran_venta y sin ninguna producción vinculada.
--
-- Probado en transacción de prueba (ROLLBACK) antes de aplicar: confirmado
-- que OV-260014 pasa a 'pendiente' y que los otros 3 pedidos de venta no
-- cancelados no cambian.

create or replace function public.actualizar_estado_pedido_por_servicio()
returns trigger
language plpgsql
as $$
declare
  v_pedido_id bigint;
  v_pendiente boolean;
  v_en_produccion boolean;
begin
  select pedido_id into v_pedido_id
  from lineas_pedido_venta
  where id = coalesce(NEW.linea_pedido_id, OLD.linea_pedido_id);

  if v_pedido_id is null then
    return coalesce(NEW, OLD);
  end if;

  select exists (
    select 1
    from lineas_pedido_venta lp
    where lp.pedido_id = v_pedido_id
      and lp.cantidad > coalesce((select sum(cantidad) from lineas_albaran_venta where linea_pedido_id = lp.id), 0)
  ) into v_pendiente;

  select exists (
    select 1 from producciones_producto_final where pedido_id = v_pedido_id
  ) into v_en_produccion;

  update pedidos_venta
  set estado = case
    when v_pendiente then (case when v_en_produccion then 'en_produccion' else 'pendiente' end)
    else 'servido'
  end
  where id = v_pedido_id and estado <> 'cancelado';

  return coalesce(NEW, OLD);
end;
$$;

update pedidos_venta set estado = 'pendiente' where id = 39;
