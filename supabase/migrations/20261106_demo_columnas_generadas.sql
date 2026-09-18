-- CONTRATO_DEMO.md: sexto bug real encontrado en pruebas. pedidos_venta.grupo_estado (y
-- potencialmente otras columnas GENERATED ALWAYS AS (...) STORED en cualquiera de las 45 tablas,
-- presentes o futuras) no admite un valor explícito en INSERT -- Postgres la recalcula siempre.
-- create table demo_snapshot.<t> as select * from public.<t> copia el VALOR calculado como una
-- columna normal (pierde la propiedad "generated" al copiar la estructura), así que el
-- insert ... select * de vuelta a la tabla real revienta con "cannot insert a non-DEFAULT value
-- into column ... es una columna generada".
--
-- Fix general (no un parche solo para grupo_estado): calcular en tiempo de ejecución, por
-- tabla, la lista de columnas NO generadas vía information_schema.columns, y usarla de forma
-- explícita tanto al crear el snapshot (iniciar_demo) como al reinsertar (revertir_demo) --
-- mismo enfoque "auto-reparable ante cambios de esquema" que ya se usaba para el resto de
-- columnas, solo que ahora también cubre columnas generadas presentes o que se añadan más
-- adelante a cualquiera de las 45 tablas, sin tener que enumerarlas a mano.
create or replace function demo_columnas_no_generadas(p_tabla text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public' and table_name = p_tabla and is_generated = 'NEVER';
$$;

revoke execute on function demo_columnas_no_generadas(text) from public;

create or replace function iniciar_demo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio_id uuid;
  v_sesion_existente uuid;
  v_expira_existente timestamptz;
  v_nueva_sesion_id uuid;
  v_nueva_expira timestamptz;
  v_tabla text;
  v_columnas text;
begin
  select id into v_negocio_id from negocios where es_demo;

  if v_negocio_id is null then
    raise exception 'iniciar_demo: no hay ningún negocio marcado como es_demo';
  end if;

  perform pg_advisory_xact_lock(hashtext('demo:' || v_negocio_id::text));

  if auth.uid() is null then
    raise exception 'iniciar_demo: se requiere autenticación';
  end if;
  if negocio_actual() <> v_negocio_id then
    raise exception 'iniciar_demo: el usuario autenticado no pertenece al tenant demo';
  end if;

  select id, expires_at into v_sesion_existente, v_expira_existente
  from demo_sesiones
  where negocio_id = v_negocio_id and reverted_at is null
  order by started_at desc
  limit 1;

  if v_sesion_existente is not null then
    if v_expira_existente > now() then
      update demo_sesiones
      set expires_at = now() + interval '15 minutes'
      where id = v_sesion_existente
      returning id, expires_at into v_nueva_sesion_id, v_nueva_expira;

      return jsonb_build_object('sesion_id', v_nueva_sesion_id, 'expires_at', v_nueva_expira);
    else
      perform revertir_demo(v_sesion_existente, 'timeout');
    end if;
  end if;

  foreach v_tabla in array demo_tablas_tenant() loop
    v_columnas := demo_columnas_no_generadas(v_tabla);
    execute format('drop table if exists demo_snapshot.%I', v_tabla);
    execute format(
      'create table demo_snapshot.%I as select %s from public.%I where negocio_id = %L',
      v_tabla, v_columnas, v_tabla, v_negocio_id
    );
  end loop;

  insert into demo_sesiones (negocio_id, expires_at)
  values (v_negocio_id, now() + interval '15 minutes')
  returning id, expires_at into v_nueva_sesion_id, v_nueva_expira;

  return jsonb_build_object('sesion_id', v_nueva_sesion_id, 'expires_at', v_nueva_expira);
end;
$$;

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
  v_tablas text[];
  v_tabla text;
  v_columnas text;
  i int;
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
  set local session_replication_role = replica;

  v_tablas := demo_tablas_tenant();

  for i in reverse array_upper(v_tablas, 1)..array_lower(v_tablas, 1) loop
    execute format('delete from %I where negocio_id = %L', v_tablas[i], v_negocio_id);
  end loop;

  foreach v_tabla in array v_tablas loop
    v_columnas := demo_columnas_no_generadas(v_tabla);
    execute format(
      'insert into %I (%s) overriding system value select %s from demo_snapshot.%I',
      v_tabla, v_columnas, v_columnas, v_tabla
    );
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;
