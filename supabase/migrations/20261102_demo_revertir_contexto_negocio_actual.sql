-- CONTRATO_DEMO.md: segundo bug real encontrado en pruebas -- al invocar revertir_demo() sin
-- usuario autenticado (el cron de la red de seguridad, 20261030; o una prueba manual desde el
-- SQL Editor), el DELETE sobre albaranes_venta dispara actualizar_previsiones_por_linea_albaran(),
-- que en su rama de fallback reinserta en previsiones_distribucion_pf sin fijar negocio_id de
-- forma explícita -- esa columna tiene default negocio_actual(), un patrón que funciona en el
-- flujo normal de la app (siempre hay un usuario autenticado detrás de cada request) pero que
-- revienta con "el usuario <NULL> no tiene ninguna fila en usuarios_negocios" en cuanto
-- revertir_demo() se ejecuta sin JWT -- exactamente el caso para el que existe el cron.
--
-- No es solo este trigger: auditar uno a uno todos los triggers de las 44 tablas que puedan
-- depender de negocio_actual() para sus propios INSERT derivados sería un trabajo mucho mayor
-- (y frágil frente a triggers futuros). En vez de eso, se simula temporalmente -- solo para el
-- resto de esta transacción, vía SET LOCAL/set_config -- la identidad de cualquier usuario
-- vinculado al tenant demo, justo antes de los dos bucles destructivos. No es una vía de
-- escalada de privilegios: el usuario simulado sale de usuarios_negocios filtrado por el
-- v_negocio_id ya validado (resuelto vía negocios.es_demo, nunca un parámetro del cliente), y a
-- efectos de negocio_actual() da igual cuál de los usuarios vinculados a ese tenant se escoja,
-- todos resuelven al mismo negocio.
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

  foreach v_tabla in array demo_tablas_tenant() loop
    execute format('delete from %I where negocio_id = %L', v_tabla, v_negocio_id);
  end loop;

  foreach v_tabla in array demo_tablas_tenant() loop
    execute format('insert into %I overriding system value select * from demo_snapshot.%I', v_tabla, v_tabla);
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;
