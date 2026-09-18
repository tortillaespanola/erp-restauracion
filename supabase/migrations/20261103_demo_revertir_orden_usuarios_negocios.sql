-- CONTRATO_DEMO.md: tercer bug real encontrado en pruebas. usuarios_negocios es la ÚNICA tabla
-- que negocio_actual() consulta para resolver el tenant -- y en el array estático de las 44
-- tablas (orden alfabético) queda la última tanto al borrar como al reinsertar. Entre que el
-- bucle de DELETE la vacía y el bucle de INSERT llega a reponerla, cualquier trigger de OTRA
-- tabla que dependa de negocio_actual() (p.ej. generar_codigo(), llamado por trg_codigo_gr() al
-- reinsertar en albaranes_compra) encuentra usuarios_negocios vacía para el usuario simulado por
-- 20261102 y revienta con el mismo "no tiene ninguna fila en usuarios_negocios", aunque ese
-- usuario sí tenga fila -- solo que aún no se ha reinsertado.
--
-- Fix: usuarios_negocios se borra la ÚLTIMA (se mantiene disponible durante todo el resto del
-- DELETE) y se reinserta la PRIMERA (disponible antes que cualquier otro INSERT pueda disparar
-- un trigger que dependa de ella). El resto del array conserva su orden -- da igual entre sí,
-- las FKs están deferred (20261027).
create or replace function revertir_demo(p_sesion_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio_id uuid;
  v_reverted_at timestamptz;
  v_started_at timestamptz;
  v_hay_sesion_mas_nueva boolean;
  v_usuario_contexto uuid;
  v_tabla text;
begin
  select negocio_id, reverted_at, started_at
  into v_negocio_id, v_reverted_at, v_started_at
  from demo_sesiones
  where id = p_sesion_id;

  if v_negocio_id is null then
    raise exception 'revertir_demo: sesion % no existe', p_sesion_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('demo:' || v_negocio_id::text));

  if auth.uid() is not null then
    if negocio_actual() <> v_negocio_id then
      raise exception 'revertir_demo: el usuario autenticado no pertenece al tenant demo';
    end if;
  end if;

  if v_reverted_at is not null then
    return;
  end if;

  select exists(
    select 1 from demo_sesiones
    where negocio_id = v_negocio_id and started_at > v_started_at
  ) into v_hay_sesion_mas_nueva;

  if v_hay_sesion_mas_nueva then
    update demo_sesiones set reverted_at = now(), revert_reason = 'superseded' where id = p_sesion_id;
    return;
  end if;

  select usuario_id into v_usuario_contexto
  from usuarios_negocios
  where negocio_id = v_negocio_id
  order by created_at
  limit 1;

  if v_usuario_contexto is not null then
    perform set_config('request.jwt.claim.sub', v_usuario_contexto::text, true);
  end if;

  set constraints all deferred;

  -- DELETE: todas las tablas menos usuarios_negocios, que se deja para el final.
  foreach v_tabla in array demo_tablas_tenant() loop
    if v_tabla <> 'usuarios_negocios' then
      execute format('delete from %I where negocio_id = %L', v_tabla, v_negocio_id);
    end if;
  end loop;
  execute format('delete from usuarios_negocios where negocio_id = %L', v_negocio_id);

  -- INSERT: usuarios_negocios primero, luego el resto.
  execute 'insert into usuarios_negocios overriding system value select * from demo_snapshot.usuarios_negocios';
  foreach v_tabla in array demo_tablas_tenant() loop
    if v_tabla <> 'usuarios_negocios' then
      execute format('insert into %I overriding system value select * from demo_snapshot.%I', v_tabla, v_tabla);
    end if;
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;
