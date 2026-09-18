-- CONTRATO_DEMO.md: quinto bug real encontrado en pruebas. Deletar producciones_producto_final
-- dispara el ON DELETE SET NULL de previsiones_distribucion_pf.produccion_pf_id -- pero
-- lineas_albaran_venta (borrada antes, dentro de la misma pasada de DELETE) ya había reinsertado
-- de vuelta filas en previsiones_distribucion_pf vía actualizar_previsiones_por_linea_albaran()
-- (su rama de fallback en DELETE, pensada para cuando un usuario cancela UNA línea de albarán
-- sueltas -- no para un borrado masivo de todo el tenant), y esas filas fantasma chocan con la
-- unique constraint previsiones_distribucion_pf_linea_sin_tanda_key al intentar poner
-- produccion_pf_id a NULL.
--
-- Iterar bugs de este estilo uno a uno (20261102 identidad, 20261103/20261104 orden de tablas,
-- ahora esto) no converge: el esquema tiene múltiples triggers de negocio pensados para
-- mantener consistencia ante ediciones normales de una fila, nunca para un borrado+reinserción
-- masivo de las 45 tablas de un tenant entero. La solución robusta es la técnica estándar de
-- Postgres para carga/restauración masiva de datos: suprimir todos los triggers no-sistema
-- durante las dos pasadas destructivas con SET LOCAL session_replication_role = replica (mismo
-- mecanismo que usa la replicación lógica para no re-disparar lógica de aplicación al aplicar
-- cambios replicados). Se mantiene además SET CONSTRAINTS ALL DEFERRED (20261027) como red de
-- seguridad adicional -- si por lo que sea algún trigger no quedara suprimido, cualquier
-- referencia colgante seguiría detectándose al hacer COMMIT en vez de colarse en silencio.
--
-- La simulación de identidad de 20261102 (v_usuario_contexto / set_config) se mantiene aunque
-- ya no debería hacer falta con los triggers suprimidos -- es barata y no estorba, y cubre el
-- caso de que algún trigger futuro se cree con ENABLE ALWAYS (no suprimible por
-- session_replication_role) y vuelva a depender de negocio_actual().
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
    execute format('insert into %I overriding system value select * from demo_snapshot.%I', v_tabla, v_tabla);
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;
