-- CONTRATO_DEMO.md: núcleo del mecanismo de sesión DEMO -- snapshot al iniciar, revert (manual,
-- por timeout, o por el cron de red de seguridad, ver 20261030) al finalizar. Ambas funciones
-- son SECURITY DEFINER porque revertir_demo() tiene que poder ejecutarse desde el cron, que no
-- tiene auth.uid()/JWT de usuario -- por eso el guard de más abajo se salta explícitamente
-- cuando auth.uid() es null. Precisamente por ser SECURITY DEFINER es CRÍTICO que ninguna de
-- las dos acepte negocio_id como parámetro del cliente (ver comentario de REVOKE/GRANT al
-- final): aceptar un negocio_id llegado del cliente convertiría esto en un "borra cualquier
-- tenant" el día que el grant se relajase por error.

create or replace function demo_tablas_tenant()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Lista estática y revisada a mano de las 44 tablas con negocio_id -- misma lista que
  -- 20261027_demo_fks_deferrable.sql, repetida aquí como fuente única para que
  -- iniciar_demo()/revertir_demo() no puedan desincronizarse entre sí.
  select array[
    'ajustes_articulo','ajustes_producto_final','ajustes_semielaborado','albaranes_compra','albaranes_venta',
    'articulo_ingrediente','articulo_proveedor','articulos_compra','categorias_articulo','clientes',
    'consumo_produccion','consumo_produccion_pf','datos_bancarios','empresa_config','entrada_material',
    'factura_compra_albaran','factura_venta_albaran','facturas_compra','facturas_venta','facturas_venta_secuencia',
    'incidencias_reparto_pedido','incidencias_stock_articulo','incidencias_stock_producto_final','incidencias_stock_semielaborado',
    'ingredientes','lineas_albaran_venta','lineas_pedido_compra','lineas_pedido_venta','pago_aplicacion','pagos',
    'pedidos_compra','pedidos_venta','previsiones_distribucion_pf','producciones_producto_final','producciones_semielaborado',
    'productos_finales','proveedores','receta_producto_final','receta_semielaborado','secuencias_lote','semielaborados',
    'tandas_produccion','ubicaciones','unidades_medida','usuarios_negocios'
  ]::text[];
$$;

revoke execute on function demo_tablas_tenant() from public;

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
  v_tabla text;
begin
  select negocio_id, reverted_at, started_at
  into v_negocio_id, v_reverted_at, v_started_at
  from demo_sesiones
  where id = p_sesion_id;

  if v_negocio_id is null then
    raise exception 'revertir_demo: sesion % no existe', p_sesion_id;
  end if;

  -- Serializa contra iniciar_demo()/otro revertir_demo() concurrente sobre el mismo tenant --
  -- evita que un snapshot nuevo y un revert se intercalen (incluye el caso de doble click en
  -- DEMO, o el cron disparando justo cuando el cliente también está saliendo del demo).
  perform pg_advisory_xact_lock(hashtext('demo:' || v_negocio_id::text));

  -- El guard se salta cuando auth.uid() es null: esa es precisamente la llamada del cron
  -- (20261030), que no tiene JWT de usuario. Cuando sí hay un usuario autenticado, debe
  -- pertenecer al tenant demo, igual que cualquier política RLS del resto de la app.
  if auth.uid() is not null then
    if negocio_actual() <> v_negocio_id then
      raise exception 'revertir_demo: el usuario autenticado no pertenece al tenant demo';
    end if;
  end if;

  -- Idempotente: si ya se revirtió (por el propio cliente, por el cron, o por otra llamada
  -- concurrente que ganó la carrera del advisory lock), no repetir el trabajo.
  if v_reverted_at is not null then
    return;
  end if;

  -- Si ya existe una sesión más nueva para este mismo tenant, esta sesión quedó abandonada y
  -- superada -- la sesión nueva ya tomó su propio snapshot sobre el estado actual (ver
  -- self-heal en iniciar_demo()), así que reejecutar el revert de la sesión vieja machacaría
  -- el trabajo en curso de la nueva. Se marca como revertida solo a efectos de registro.
  select exists(
    select 1 from demo_sesiones
    where negocio_id = v_negocio_id and started_at > v_started_at
  ) into v_hay_sesion_mas_nueva;

  if v_hay_sesion_mas_nueva then
    update demo_sesiones set reverted_at = now(), revert_reason = 'superseded' where id = p_sesion_id;
    return;
  end if;

  -- Prerrequisito: 20261027_demo_fks_deferrable.sql. Sin esto, el orden de borrado/inserción
  -- entre las 44 tablas importaría y este bucle plano fallaría por violaciones de FK.
  set constraints all deferred;

  foreach v_tabla in array demo_tablas_tenant() loop
    execute format('delete from %I where negocio_id = %L', v_tabla, v_negocio_id);
  end loop;

  foreach v_tabla in array demo_tablas_tenant() loop
    execute format('insert into %I select * from demo_snapshot.%I', v_tabla, v_tabla);
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;

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
      -- CONTRATO_DEMO.md decisión #4: sesión ya viva -- se reinicia el temporizador sobre la
      -- MISMA sesión (mismo snapshot, mismos cambios en curso), sin crear una sesión paralela
      -- ni resnapshotear.
      update demo_sesiones
      set expires_at = now() + interval '15 minutes'
      where id = v_sesion_existente
      returning id, expires_at into v_nueva_sesion_id, v_nueva_expira;

      return jsonb_build_object('sesion_id', v_nueva_sesion_id, 'expires_at', v_nueva_expira);
    else
      -- Sesión abandonada: expiró pero el cron (20261030, corre cada minuto) todavía no la ha
      -- revertido. Self-heal síncrono antes de tomar un snapshot nuevo, para no snapshotear
      -- encima de un estado mutado y abandonado.
      perform revertir_demo(v_sesion_existente, 'timeout');
    end if;
  end if;

  foreach v_tabla in array demo_tablas_tenant() loop
    execute format('drop table if exists demo_snapshot.%I', v_tabla);
    execute format(
      'create table demo_snapshot.%I as select * from public.%I where negocio_id = %L',
      v_tabla, v_tabla, v_negocio_id
    );
  end loop;

  insert into demo_sesiones (negocio_id, expires_at)
  values (v_negocio_id, now() + interval '15 minutes')
  returning id, expires_at into v_nueva_sesion_id, v_nueva_expira;

  return jsonb_build_object('sesion_id', v_nueva_sesion_id, 'expires_at', v_nueva_expira);
end;
$$;

-- Blindaje frente al grant a PUBLIC que Postgres concede por defecto en CREATE FUNCTION:
-- SECURITY DEFINER + un guard que se salta cuando auth.uid() es null (necesario para el cron)
-- sería explotable por cualquier visitante anónimo con la clave anon/publishable si esto se
-- quedara en PUBLIC. Revocar explícitamente y conceder solo a authenticated.
revoke execute on function iniciar_demo() from public;
revoke execute on function revertir_demo(uuid, text) from public;
grant execute on function iniciar_demo() to authenticated;
grant execute on function revertir_demo(uuid, text) to authenticated;
