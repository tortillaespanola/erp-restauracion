-- Validación de congruencia temporal y de cantidades para producciones
-- (semielaborados y productos finales), extendida a entrada_material.
--
-- Contexto: hasta ahora, todas las reglas de negocio (fechas coherentes,
-- stock suficiente, líneas bloqueadas si ya están consumidas) vivían
-- únicamente en el frontend React. Como la política RLS de este proyecto
-- da acceso total a cualquier usuario autenticado, esas reglas eran
-- triviales de saltarse llamando directamente a la API REST de Supabase.
-- Esta migración mueve la validación real a Postgres.
--
-- Los triggers de consistencia se declaran como CONSTRAINT TRIGGER
-- DEFERRABLE INITIALLY DEFERRED: se evalúan una sola vez al final de la
-- transacción, no tras cada sentencia intermedia. Esto es necesario porque
-- editar una producción cerrada toca varias filas (cabecera + líneas de
-- consumo) en la misma transacción, y solo el estado final debe ser válido.

-- ============================================================
-- 1. consumo_produccion: fecha del origen <= fecha de la producción
--    destino, y cantidad <= stock disponible del origen.
-- ============================================================

create or replace function public.check_consumo_produccion()
returns trigger
language plpgsql
as $$
declare
  v_fecha_destino date;
  v_fecha_origen date;
  v_disponible numeric;
begin
  if (NEW.entrada_material_id is null) = (NEW.produccion_origen_id is null) then
    raise exception 'La línea de consumo debe referenciar exactamente un origen (artículo o producción)';
  end if;

  select fecha into v_fecha_destino
  from producciones_semielaborado
  where id = NEW.produccion_id;

  if v_fecha_destino is null then
    raise exception 'La producción destino (%) no existe', NEW.produccion_id;
  end if;

  if NEW.entrada_material_id is not null then
    select alc.fecha,
      em.cantidad
        - coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.entrada_material_id and id is distinct from NEW.id), 0)
        - coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.entrada_material_id), 0)
        + coalesce((select sum(cantidad) from ajustes_articulo where entrada_material_id = NEW.entrada_material_id), 0)
    into v_fecha_origen, v_disponible
    from entrada_material em
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where em.id = NEW.entrada_material_id;

    if v_fecha_origen is null then
      raise exception 'El lote de artículo indicado (entrada_material %) no existe', NEW.entrada_material_id;
    end if;
  else
    if NEW.produccion_origen_id = NEW.produccion_id then
      raise exception 'Una producción no puede consumir de sí misma';
    end if;

    select p.fecha,
      p.cantidad_producida
        - coalesce((select sum(cantidad) from consumo_produccion where produccion_origen_id = NEW.produccion_origen_id and id is distinct from NEW.id), 0)
        - coalesce((select sum(cantidad) from consumo_produccion_pf where produccion_origen_id = NEW.produccion_origen_id), 0)
        + coalesce((select sum(cantidad) from ajustes_semielaborado where produccion_id = NEW.produccion_origen_id), 0)
    into v_fecha_origen, v_disponible
    from producciones_semielaborado p
    where p.id = NEW.produccion_origen_id and p.estado = 'cerrada';

    if v_fecha_origen is null then
      raise exception 'La producción de origen (%) no existe o no está cerrada', NEW.produccion_origen_id;
    end if;
  end if;

  if v_fecha_origen > v_fecha_destino then
    raise exception 'No se puede consumir un lote de fecha % en una producción con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
  end if;

  if NEW.cantidad > v_disponible then
    raise exception 'Stock insuficiente en el lote de origen: solo hay % unidades disponibles', v_disponible;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_consumo_produccion on consumo_produccion;
create constraint trigger trg_check_consumo_produccion
after insert or update on consumo_produccion
deferrable initially deferred
for each row execute function check_consumo_produccion();

-- ============================================================
-- 2. consumo_produccion_pf: mismo criterio, destino es
--    producciones_producto_final.
-- ============================================================

create or replace function public.check_consumo_produccion_pf()
returns trigger
language plpgsql
as $$
declare
  v_fecha_destino date;
  v_fecha_origen date;
  v_disponible numeric;
begin
  if (NEW.entrada_material_id is null) = (NEW.produccion_origen_id is null) then
    raise exception 'La línea de consumo debe referenciar exactamente un origen (artículo o producción)';
  end if;

  select fecha into v_fecha_destino
  from producciones_producto_final
  where id = NEW.produccion_pf_id;

  if v_fecha_destino is null then
    raise exception 'La producción destino (%) no existe', NEW.produccion_pf_id;
  end if;

  if NEW.entrada_material_id is not null then
    select alc.fecha,
      em.cantidad
        - coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.entrada_material_id), 0)
        - coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.entrada_material_id and id is distinct from NEW.id), 0)
        + coalesce((select sum(cantidad) from ajustes_articulo where entrada_material_id = NEW.entrada_material_id), 0)
    into v_fecha_origen, v_disponible
    from entrada_material em
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where em.id = NEW.entrada_material_id;

    if v_fecha_origen is null then
      raise exception 'El lote de artículo indicado (entrada_material %) no existe', NEW.entrada_material_id;
    end if;
  else
    select p.fecha,
      p.cantidad_producida
        - coalesce((select sum(cantidad) from consumo_produccion where produccion_origen_id = NEW.produccion_origen_id), 0)
        - coalesce((select sum(cantidad) from consumo_produccion_pf where produccion_origen_id = NEW.produccion_origen_id and id is distinct from NEW.id), 0)
        + coalesce((select sum(cantidad) from ajustes_semielaborado where produccion_id = NEW.produccion_origen_id), 0)
    into v_fecha_origen, v_disponible
    from producciones_semielaborado p
    where p.id = NEW.produccion_origen_id and p.estado = 'cerrada';

    if v_fecha_origen is null then
      raise exception 'La producción de origen (%) no existe o no está cerrada', NEW.produccion_origen_id;
    end if;
  end if;

  if v_fecha_origen > v_fecha_destino then
    raise exception 'No se puede consumir un lote de fecha % en una producción con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
  end if;

  if NEW.cantidad > v_disponible then
    raise exception 'Stock insuficiente en el lote de origen: solo hay % unidades disponibles', v_disponible;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_consumo_produccion_pf on consumo_produccion_pf;
create constraint trigger trg_check_consumo_produccion_pf
after insert or update on consumo_produccion_pf
deferrable initially deferred
for each row execute function check_consumo_produccion_pf();

-- ============================================================
-- 3. producciones_semielaborado: al editar una producción ya
--    cerrada, la fecha y la cantidad deben seguir siendo
--    coherentes con lo que consumió y con lo que se consumió de ella.
-- ============================================================

create or replace function public.check_edicion_produccion_semielaborado()
returns trigger
language plpgsql
as $$
declare
  v_max_fecha_ingredientes date;
  v_min_fecha_downstream date;
  v_consumido_downstream numeric;
  v_ajustes numeric;
begin
  if OLD.estado <> 'cerrada' then
    return null;
  end if;

  select max(fecha_origen) into v_max_fecha_ingredientes
  from (
    select alc.fecha as fecha_origen
    from consumo_produccion cp
    join entrada_material em on em.id = cp.entrada_material_id
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where cp.produccion_id = NEW.id
    union all
    select p2.fecha
    from consumo_produccion cp
    join producciones_semielaborado p2 on p2.id = cp.produccion_origen_id
    where cp.produccion_id = NEW.id
  ) t;

  if v_max_fecha_ingredientes is not null and NEW.fecha < v_max_fecha_ingredientes then
    raise exception 'La fecha de producción (%) no puede ser anterior a la de sus ingredientes (la más reciente es %)', NEW.fecha, v_max_fecha_ingredientes;
  end if;

  select min(fecha_destino) into v_min_fecha_downstream
  from (
    select p2.fecha as fecha_destino
    from consumo_produccion cp
    join producciones_semielaborado p2 on p2.id = cp.produccion_id
    where cp.produccion_origen_id = NEW.id
    union all
    select p3.fecha
    from consumo_produccion_pf cp
    join producciones_producto_final p3 on p3.id = cp.produccion_pf_id
    where cp.produccion_origen_id = NEW.id
  ) t;

  if v_min_fecha_downstream is not null and NEW.fecha > v_min_fecha_downstream then
    raise exception 'La fecha de producción (%) no puede ser posterior a producciones que ya la consumieron (la más antigua es %)', NEW.fecha, v_min_fecha_downstream;
  end if;

  select coalesce(sum(cantidad), 0) into v_consumido_downstream
  from (
    select cantidad from consumo_produccion where produccion_origen_id = NEW.id
    union all
    select cantidad from consumo_produccion_pf where produccion_origen_id = NEW.id
  ) t;

  select coalesce(sum(cantidad), 0) into v_ajustes
  from ajustes_semielaborado where produccion_id = NEW.id;

  if NEW.cantidad_producida - v_consumido_downstream + v_ajustes < 0 then
    raise exception 'No se puede reducir la cantidad producida a %: ya hay % consumidos/ajustados aguas abajo', NEW.cantidad_producida, v_consumido_downstream - v_ajustes;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_edicion_produccion_semielaborado on producciones_semielaborado;
create constraint trigger trg_check_edicion_produccion_semielaborado
after update on producciones_semielaborado
deferrable initially deferred
for each row execute function check_edicion_produccion_semielaborado();

-- ============================================================
-- 4. producciones_producto_final: mismo criterio, aguas abajo
--    son ventas (lineas_albaran_venta) en vez de otras producciones.
-- ============================================================

create or replace function public.check_edicion_produccion_producto_final()
returns trigger
language plpgsql
as $$
declare
  v_max_fecha_ingredientes date;
  v_min_fecha_venta date;
  v_vendido numeric;
begin
  if OLD.estado <> 'cerrada' then
    return null;
  end if;

  select max(fecha_origen) into v_max_fecha_ingredientes
  from (
    select alc.fecha as fecha_origen
    from consumo_produccion_pf cp
    join entrada_material em on em.id = cp.entrada_material_id
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where cp.produccion_pf_id = NEW.id
    union all
    select p2.fecha
    from consumo_produccion_pf cp
    join producciones_semielaborado p2 on p2.id = cp.produccion_origen_id
    where cp.produccion_pf_id = NEW.id
  ) t;

  if v_max_fecha_ingredientes is not null and NEW.fecha < v_max_fecha_ingredientes then
    raise exception 'La fecha de producción (%) no puede ser anterior a la de sus ingredientes (la más reciente es %)', NEW.fecha, v_max_fecha_ingredientes;
  end if;

  select min(av.fecha) into v_min_fecha_venta
  from lineas_albaran_venta lav
  join albaranes_venta av on av.id = lav.albaran_venta_id
  where lav.produccion_pf_id = NEW.id;

  if v_min_fecha_venta is not null and NEW.fecha > v_min_fecha_venta then
    raise exception 'La fecha de producción (%) no puede ser posterior a ventas que ya la consumieron (la más antigua es %)', NEW.fecha, v_min_fecha_venta;
  end if;

  select coalesce(sum(cantidad), 0) into v_vendido
  from lineas_albaran_venta where produccion_pf_id = NEW.id;

  if NEW.cantidad_producida < v_vendido then
    raise exception 'No se puede reducir la cantidad producida a %: ya se han vendido % unidades de este lote', NEW.cantidad_producida, v_vendido;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_edicion_produccion_pf on producciones_producto_final;
create constraint trigger trg_check_edicion_produccion_pf
after update on producciones_producto_final
deferrable initially deferred
for each row execute function check_edicion_produccion_producto_final();

-- ============================================================
-- 5. entrada_material: si una línea de albarán de compra ya
--    tiene consumo/ajustes, no se puede cambiar de artículo ni
--    reducir la cantidad por debajo de lo ya usado.
-- ============================================================

create or replace function public.check_edicion_entrada_material()
returns trigger
language plpgsql
as $$
declare
  v_consumido numeric;
  v_ajustes numeric;
begin
  select
    coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.id), 0)
    + coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.id), 0)
  into v_consumido;

  select coalesce(sum(cantidad), 0) into v_ajustes
  from ajustes_articulo where entrada_material_id = NEW.id;

  if v_consumido > 0 and NEW.articulo_id is distinct from OLD.articulo_id then
    raise exception 'No se puede cambiar el artículo de un lote ya consumido';
  end if;

  if NEW.cantidad - v_consumido + v_ajustes < 0 then
    raise exception 'No se puede reducir la cantidad del lote por debajo de lo ya consumido/ajustado (quedarían % unidades)', NEW.cantidad - v_consumido + v_ajustes;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_edicion_entrada_material on entrada_material;
create constraint trigger trg_check_edicion_entrada_material
after update on entrada_material
deferrable initially deferred
for each row execute function check_edicion_entrada_material();

-- ============================================================
-- 6. RPCs atómicas para editar una producción cerrada completa
--    (cabecera + líneas de consumo) en una sola transacción.
-- ============================================================

create or replace function public.rpc_editar_produccion_semielaborado(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb
)
returns void
language plpgsql
as $$
declare
  v_linea jsonb;
begin
  if not exists (select 1 from producciones_semielaborado where id = p_id and estado = 'cerrada') then
    raise exception 'La producción % no existe o no está cerrada', p_id;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    if coalesce((v_linea->>'_deleted')::boolean, false) then
      delete from consumo_produccion where id = (v_linea->>'id')::bigint and produccion_id = p_id;
    elsif v_linea->>'id' is not null then
      update consumo_produccion
      set cantidad = (v_linea->>'cantidad')::numeric
      where id = (v_linea->>'id')::bigint and produccion_id = p_id;
    else
      insert into consumo_produccion (produccion_id, entrada_material_id, produccion_origen_id, cantidad)
      values (
        p_id,
        (v_linea->>'entrada_material_id')::bigint,
        (v_linea->>'produccion_origen_id')::bigint,
        (v_linea->>'cantidad')::numeric
      );
    end if;
  end loop;

  update producciones_semielaborado
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas
  where id = p_id;
end;
$$;

grant execute on function public.rpc_editar_produccion_semielaborado(bigint, date, numeric, text, jsonb) to authenticated;

create or replace function public.rpc_editar_produccion_producto_final(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb
)
returns void
language plpgsql
as $$
declare
  v_linea jsonb;
begin
  if not exists (select 1 from producciones_producto_final where id = p_id and estado = 'cerrada') then
    raise exception 'La producción % no existe o no está cerrada', p_id;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    if coalesce((v_linea->>'_deleted')::boolean, false) then
      delete from consumo_produccion_pf where id = (v_linea->>'id')::bigint and produccion_pf_id = p_id;
    elsif v_linea->>'id' is not null then
      update consumo_produccion_pf
      set cantidad = (v_linea->>'cantidad')::numeric
      where id = (v_linea->>'id')::bigint and produccion_pf_id = p_id;
    else
      insert into consumo_produccion_pf (produccion_pf_id, entrada_material_id, produccion_origen_id, cantidad)
      values (
        p_id,
        (v_linea->>'entrada_material_id')::bigint,
        (v_linea->>'produccion_origen_id')::bigint,
        (v_linea->>'cantidad')::numeric
      );
    end if;
  end loop;

  update producciones_producto_final
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas
  where id = p_id;
end;
$$;

grant execute on function public.rpc_editar_produccion_producto_final(bigint, date, numeric, text, jsonb) to authenticated;
