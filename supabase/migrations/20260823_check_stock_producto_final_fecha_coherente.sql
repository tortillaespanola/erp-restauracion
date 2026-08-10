-- Amplía check_stock_producto_final() para validar coherencia de fecha
-- (producción/recepción del lote origen no puede ser posterior a la
-- fecha del albarán de venta destino), mismo patrón ya aplicado en
-- check_consumo_produccion()/check_consumo_produccion_pf().
--
-- Motivado por dos casos reales encontrados: líneas 92 y 115 de
-- lineas_albaran_venta, con fecha_produccion posterior a fecha_albaran
-- (corregidos antes de esta migración, tras confirmar con el usuario
-- cuál de los dos campos era el erróneo en cada caso — en ambos, la
-- fecha real de entrega/producción se confirmó por evidencia directa,
-- no solo inferencia: producción 68 -> 2026-05-05 (el albarán 79 y su
-- hermano 74 ya estaban bien), albarán 101 -> 2026-05-28).
--
-- A diferencia del bloqueo de STOCK (que si se bypasea en
-- tipo_venta = 'evento_directo'), la coherencia de FECHA se aplica
-- siempre, sin excepción: vender algo antes de que exista físicamente
-- no tiene sentido en ningún escenario, evento o no.
--
-- Se añade también en la rama de mercadería/artículo (entrada_material),
-- mismo hueco aunque hoy no haya ningún caso real ahí.
--
-- trg_check_stock_pf es BEFORE INSERT OR UPDATE, no diferido -- se
-- evalúa al instante, sin la sutileza de constraint triggers diferidos
-- del caso anterior (check_consumo_produccion_pf).
--
-- Probado antes de aplicar, en transacción con ROLLBACK: reproducido el
-- caso ya visto como rechazado; re-validadas (UPDATE no-op) las 57
-- líneas reales existentes de lineas_albaran_venta sin ningún fallo,
-- incluidas las líneas 92 y 115 ya corregidas; confirmado que
-- evento_directo con fecha incoherente sigue rechazándose por fecha
-- (no por stock); confirmado que evento_directo con fecha coherente
-- pero cantidad excesiva se sigue aceptando (bypass de stock intacto).

create or replace function public.check_stock_producto_final()
returns trigger
language plpgsql
as $function$
declare
  disponible numeric;
  v_tipo_venta text;
  v_fecha_destino date;
  v_fecha_origen date;
begin
  select fecha into v_fecha_destino from albaranes_venta where id = NEW.albaran_venta_id;

  if NEW.produccion_pf_id is not null then
    select tipo_venta into v_tipo_venta from albaranes_venta where id = NEW.albaran_venta_id;

    select p.fecha, p.cantidad_producida - coalesce(sum(v.cantidad), 0)
        + coalesce((select sum(a.cantidad) from ajustes_producto_final a where a.produccion_pf_id = p.id), 0)
    into v_fecha_origen, disponible
    from producciones_producto_final p
    left join lineas_albaran_venta v
      on v.produccion_pf_id = p.id
      and v.id is distinct from NEW.id
    where p.id = NEW.produccion_pf_id
    group by p.id, p.cantidad_producida, p.fecha;

    if disponible is null then
      raise exception 'La producción indicada no existe o no está cerrada';
    end if;

    if v_fecha_origen > v_fecha_destino then
      raise exception 'No se puede vender un lote de producción con fecha % en un albarán con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
    end if;

    if NEW.cantidad > disponible and v_tipo_venta is distinct from 'evento_directo' then
      raise exception 'Stock insuficiente: solo hay % unidades disponibles en ese lote de producción', disponible;
    end if;
  else
    select alc.fecha, em.cantidad
      - coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(v.cantidad) from lineas_albaran_venta v where v.entrada_material_id = NEW.entrada_material_id and v.id is distinct from NEW.id), 0)
      + coalesce((select sum(cantidad) from ajustes_articulo where entrada_material_id = NEW.entrada_material_id), 0)
    into v_fecha_origen, disponible
    from entrada_material em
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where em.id = NEW.entrada_material_id;

    if disponible is null then
      raise exception 'El lote de artículo indicado no existe';
    end if;

    if v_fecha_origen > v_fecha_destino then
      raise exception 'No se puede vender un lote de artículo con fecha de recepción % en un albarán con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
    end if;

    if NEW.cantidad > disponible then
      raise exception 'Stock insuficiente: solo hay % unidades disponibles en ese lote de artículo', disponible;
    end if;
  end if;

  return NEW;
end;
$function$;
