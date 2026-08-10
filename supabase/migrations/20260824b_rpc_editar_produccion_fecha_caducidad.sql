-- Amplía rpc_editar_produccion_semielaborado() y
-- rpc_editar_produccion_producto_final() para aceptar y guardar
-- fecha_caducidad -- necesario para que el campo editable de
-- fecha_caducidad (Producciones.jsx y ProduccionProductosFinales.jsx)
-- funcione de verdad; sin esto, la columna añadida en la migración
-- anterior (20260824) no tendría ninguna forma de editarse desde la UI.
--
-- IMPORTANTE: se hace con DROP FUNCTION + CREATE explícito, no solo
-- CREATE OR REPLACE -- verificado en transacción de prueba que
-- CREATE OR REPLACE con un parámetro nuevo (aunque tenga DEFAULT) no
-- sustituye la función existente, crea un segundo overload duplicado
-- (firma de 5 argumentos conviviendo con la de 6). El DROP explícito de
-- la firma antigua evita dejar la versión vieja como código muerto
-- alcanzable.
--
-- Como DROP FUNCTION borra también los GRANT asociados, hace falta
-- volver a conceder EXECUTE a authenticated tras recrear cada función.
--
-- p_fecha_caducidad tiene DEFAULT null para no romper compatibilidad
-- de forma, aunque en la práctica el único llamador es el frontend, que
-- se actualiza en el mismo commit para pasarlo siempre explícitamente.

drop function if exists public.rpc_editar_produccion_semielaborado(bigint, date, numeric, text, jsonb);
drop function if exists public.rpc_editar_produccion_producto_final(bigint, date, numeric, text, jsonb);

create or replace function public.rpc_editar_produccion_semielaborado(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb,
  p_fecha_caducidad date default null
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
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas, fecha_caducidad = p_fecha_caducidad
  where id = p_id;
end;
$$;

grant execute on function public.rpc_editar_produccion_semielaborado(bigint, date, numeric, text, jsonb, date) to authenticated;

create or replace function public.rpc_editar_produccion_producto_final(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb,
  p_fecha_caducidad date default null
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
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas, fecha_caducidad = p_fecha_caducidad
  where id = p_id;
end;
$$;

grant execute on function public.rpc_editar_produccion_producto_final(bigint, date, numeric, text, jsonb, date) to authenticated;
