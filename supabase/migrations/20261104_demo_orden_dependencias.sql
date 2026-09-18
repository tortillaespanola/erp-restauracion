-- CONTRATO_DEMO.md: cuarto bug real encontrado en pruebas (tras 20261101/20261102/20261103).
-- articulo_ingrediente se reinsertaba antes que articulos_compra/ingredientes (orden alfabético
-- del array estático), y validar_unidad_articulo_ingrediente() -- un trigger que compara
-- unidad_id de ambas tablas referenciadas -- encontraba esas filas todavía sin reinsertar
-- (unidad_id=NULL como si no existieran). Las FKs deferred (20261027) evitan que la CONSTRAINT
-- reviente por esto, pero no protegen a triggers de aplicación que hacen sus propias consultas
-- cruzadas -- exactamente la misma familia de problema que 20261102/20261103 resolvieron para
-- usuarios_negocios, solo que aquí afecta a cualquier par tabla-padre/tabla-hija.
--
-- En vez de seguir parcheando pares uno a uno según vayan apareciendo en las pruebas, esta
-- migración sustituye el orden alfabético por un orden topológico real, calculado a partir del
-- grafo de FKs entre las 45 tablas tenant-scoped (contando usuarios_negocios; el resto de este
-- contrato la ha llamado "44" por error de cuenta desde el principio -- es cosmético, el array
-- usado en SQL siempre ha tenido las 45) y verificado contra pg_constraint en vivo antes de
-- escribir esta migración (cero violaciones: ninguna tabla depende de otra que aparezca después
-- en el orden). usuarios_negocios encabeza el orden -- no por FK (no tiene ninguna entre tablas
-- tenant-scoped) sino porque es la única tabla que negocio_actual() consulta (ver 20261102).
--
-- revertir_demo() ya no necesita el caso especial de usuarios_negocios de 20261103: con el
-- array en orden de dependencias, insertar en ese mismo orden (padres antes que hijos) y borrar
-- en orden inverso (hijos antes que padres) basta para todas las tablas a la vez.
create or replace function demo_tablas_tenant()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Orden de dependencias (de "raíz" a "hoja" según el grafo de FKs entre estas 45 tablas),
  -- no alfabético -- ver razonamiento arriba. usuarios_negocios primero por la razón semántica
  -- (negocio_actual()), el resto por FK real.
  select array[
    'usuarios_negocios','categorias_articulo','clientes','datos_bancarios','empresa_config',
    'facturas_venta_secuencia','proveedores','secuencias_lote','tandas_produccion','ubicaciones','unidades_medida',
    'articulos_compra','ingredientes','productos_finales','semielaborados','albaranes_venta','facturas_venta',
    'pedidos_compra','facturas_compra','pedidos_venta',
    'articulo_ingrediente','articulo_proveedor','lineas_pedido_compra','lineas_pedido_venta','albaranes_compra',
    'factura_venta_albaran','producciones_semielaborado','pagos','receta_producto_final','receta_semielaborado',
    'entrada_material','factura_compra_albaran','producciones_producto_final',
    'ajustes_articulo','consumo_produccion','consumo_produccion_pf','ajustes_semielaborado','ajustes_producto_final',
    'lineas_albaran_venta','previsiones_distribucion_pf','pago_aplicacion',
    'incidencias_stock_articulo','incidencias_stock_semielaborado','incidencias_stock_producto_final','incidencias_reparto_pedido'
  ]::text[];
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

  v_tablas := demo_tablas_tenant();

  -- DELETE en orden inverso: hojas primero, raíces (usuarios_negocios incluida) al final.
  for i in reverse array_upper(v_tablas, 1)..array_lower(v_tablas, 1) loop
    execute format('delete from %I where negocio_id = %L', v_tablas[i], v_negocio_id);
  end loop;

  -- INSERT en orden de dependencias: raíces (usuarios_negocios incluida) primero, hojas al final.
  foreach v_tabla in array v_tablas loop
    execute format('insert into %I overriding system value select * from demo_snapshot.%I', v_tabla, v_tabla);
  end loop;

  update demo_sesiones set reverted_at = now(), revert_reason = p_motivo where id = p_sesion_id;
end;
$$;
