-- Tercera vía de línea de venta, sin FK a ningún catálogo: "Otro / servicio".
--
-- Dos casos de uso reales:
--   1. Compra puntual de reventa sin pasar por stock (ej. "Pan" comprado
--      en el súper para un pedido concreto, nunca dado de alta como
--      articulo_compra ni pasado por entrada_material).
--   2. Servicio facturable sin componente físico (ej. "Horas de
--      showcooking extraordinarias") — puro concepto de facturación,
--      nunca mueve stock.
--
-- Mismo patrón "exactamente una de N" que ya usa receta_producto_final
-- (constraint solo_un_tipo_ingrediente_pf), aplicado aquí a tres vías en
-- vez de dos. La tercera vía no tiene ningún FK — descripcion (texto
-- libre) sustituye a la referencia de catálogo.
--
-- Se añade a las dos tablas (pedido y albarán), sin forzar que una
-- origine a la otra: linea_pedido_id ya es nullable/opcional para las
-- líneas existentes, y sigue siéndolo para esta tercera vía — puede
-- nacer en el pedido (caso 1, "tráeme también pan") o directamente en el
-- albarán (caso 2, decidido en el momento de la entrega).
--
-- Sin validación de precio_unitario/cantidad más allá del NOT NULL que
-- ya exige cantidad hoy — no hay stock ni catálogo contra el que
-- comprobar coherencia.

alter table lineas_pedido_venta add column descripcion text;

alter table lineas_pedido_venta drop constraint chk_lineas_pedido_un_origen;
alter table lineas_pedido_venta add constraint chk_lineas_pedido_un_origen check (
  (producto_final_id is not null and articulo_id is null and descripcion is null)
  or (articulo_id is not null and producto_final_id is null and descripcion is null)
  or (descripcion is not null and producto_final_id is null and articulo_id is null)
);

alter table lineas_albaran_venta add column descripcion text;

alter table lineas_albaran_venta drop constraint chk_lineas_albaran_venta_origen;
alter table lineas_albaran_venta add constraint chk_lineas_albaran_venta_origen check (
  (producto_final_id is not null and produccion_pf_id is not null and articulo_id is null and entrada_material_id is null and descripcion is null)
  or (articulo_id is not null and entrada_material_id is not null and producto_final_id is null and produccion_pf_id is null and descripcion is null)
  or (descripcion is not null and producto_final_id is null and produccion_pf_id is null and articulo_id is null and entrada_material_id is null)
);

-- check_stock_producto_final() es BEFORE INSERT/UPDATE (no diferido) y su
-- rama "else" (NEW.produccion_pf_id is null) asume sin condición que
-- entrada_material_id está presente -- con una línea de texto libre
-- (ambos null) intentaría buscar un lote inexistente y rechazaría la
-- fila con "El lote de artículo indicado no existe". Verificado en
-- transacción de prueba antes de este fix. Añadida guarda explícita al
-- principio: sin FK de catálogo, no hay stock que comprobar.
create or replace function public.check_stock_producto_final()
returns trigger
language plpgsql
as $$
declare
  disponible numeric;
  v_tipo_venta text;
  v_fecha_destino date;
  v_fecha_origen date;
begin
  if NEW.descripcion is not null then
    return NEW;
  end if;

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
$$;
