-- Vista Inventario (Fase 2): necesidad agregada de un ingrediente = demanda bruta de todos los
-- pedidos de venta pendientes, explotada a través de la receta, menos lo ya producido (cerrado)
-- que también se explota a nivel de ingrediente. Puede devolver negativo (se produjo de más /
-- hay stock de sobra) -- no se clampea a 0, la interpretación de ese caso es del frontend.
--
-- articulo_id directo en receta_producto_final/receta_semielaborado es legado inerte hoy (3 filas
-- ZZ_ de test, 0 en producción real, confirmado antes de escribir esta función) -- se ignora en el
-- cálculo, pero deja constancia explícita vía RAISE NOTICE si aparece alguna, para no fallar en
-- silencio si algún día se da de alta una receta así por error.
create or replace function public.necesidad_agregada_ingrediente(p_ingrediente_id bigint)
returns numeric
language plpgsql
stable
as $$
declare
  v_fila record;
  v_demanda numeric;
  v_producido numeric;
begin
  for v_fila in
    select 'receta_producto_final'::text as tabla, id, producto_final_id as nodo_id
    from receta_producto_final where articulo_id is not null
    union all
    select 'receta_semielaborado'::text, id, semielaborado_id
    from receta_semielaborado where articulo_id is not null
  loop
    raise notice 'necesidad_agregada_ingrediente: % id=% (nodo %) usa articulo_id directo -- ignorada, no soportado por esta función',
      v_fila.tabla, v_fila.id, v_fila.nodo_id;
  end loop;

  -- 1) Demanda bruta explotada -- SÍ lleva WITH RECURSIVE: para demanda no hay "ya contado por
  -- otro lado" del que protegerse, hay que bajar hasta el ingrediente por cada nivel real.
  --
  -- Postgres exige que la autorreferencia recursiva aparezca EXACTAMENTE UNA VEZ dentro de la
  -- CTE recursiva -- dos ramas de bajada por separado (producto_final->semi y semi->semi
  -- anidado), cada una referenciando arbol_demanda, no es válido ("recursive reference ... must
  -- not appear more than once", probado antes de fijar esta forma). Se unifican ambos descensos
  -- en `grafo_bajada` (unión NO recursiva de receta_producto_final/receta_semielaborado hacia su
  -- semielaborado hijo), y la parte recursiva hace un único join contra ella, distinguiendo el
  -- tipo de nodo origen con `nodo_tipo` en vez de dos columnas nullable.
  --
  -- Nivel 0: líneas de pedidos pendientes/en_producción, netas por LÍNEA de lo ya servido vía
  -- albarán (mismo criterio que necesidades_pedidos_cascada(), migración
  -- 20260918_necesidades_pedidos_cascada_neta_por_linea.sql -- sin esto, un pedido que sigue
  -- en_produccion por una línea sin servir volvería a contar OTRA línea del mismo pedido que ya
  -- se sirvió por separado, caso real ya diagnosticado con ZZ_Empresa1).
  with recursive grafo_bajada as (
    select 'pf'::text as origen_tipo, rpf.producto_final_id as origen_id,
      rpf.ingrediente_semielaborado_id as destino_semi_id, rpf.cantidad
    from receta_producto_final rpf
    where rpf.ingrediente_semielaborado_id is not null

    union all

    -- Semi -> semi anidado -- caso real activo, no hipotético: ZZ_ALBODIGACONTOMATE ->
    -- ZZ_TomateFrito / ZZ_Albondiga frita.
    select 'semi'::text, rs.semielaborado_id, rs.ingrediente_semielaborado_id, rs.cantidad
    from receta_semielaborado rs
    where rs.ingrediente_semielaborado_id is not null
  ),
  arbol_demanda(nodo_tipo, nodo_id, cantidad_nodo) as (
    select
      'pf'::text,
      lpv.producto_final_id,
      greatest(lpv.cantidad - coalesce(serv.cantidad, 0), 0)
    from lineas_pedido_venta lpv
    join pedidos_venta pv on pv.id = lpv.pedido_id
    left join (
      select linea_pedido_id, sum(cantidad) as cantidad
      from lineas_albaran_venta
      where linea_pedido_id is not null
      group by linea_pedido_id
    ) serv on serv.linea_pedido_id = lpv.id
    where pv.estado in ('pendiente', 'en_produccion')
      and lpv.producto_final_id is not null

    union all

    select 'semi'::text, g.destino_semi_id, ad.cantidad_nodo * g.cantidad
    from arbol_demanda ad
    join grafo_bajada g on g.origen_tipo = ad.nodo_tipo and g.origen_id = ad.nodo_id
  )
  select coalesce(sum(contribucion), 0) into v_demanda
  from (
    -- Contribución del ingrediente en cada nodo del árbol donde aparece de forma directa --
    -- producto_final...
    select ad.cantidad_nodo * rpf.cantidad as contribucion
    from arbol_demanda ad
    join receta_producto_final rpf on rpf.producto_final_id = ad.nodo_id
    where ad.nodo_tipo = 'pf' and rpf.ingrediente_id = p_ingrediente_id

    union all

    -- ...o semielaborado, en cualquier nivel de la cadena.
    select ad.cantidad_nodo * rs.cantidad
    from arbol_demanda ad
    join receta_semielaborado rs on rs.semielaborado_id = ad.nodo_id
    where ad.nodo_tipo = 'semi' and rs.ingrediente_id = p_ingrediente_id
  ) contribuciones_demanda;

  -- 2) Ya producido explotado -- unión plana, SIN recursión más allá del nodo raíz de cada
  -- producción cerrada. Si se recursara desde un producto_final cerrado hacia el semielaborado de
  -- su receta, se duplicaría el ingrediente: una vez vía la re-explosión teórica de la receta del
  -- padre, otra vez vía la producción cerrada propia de ese semielaborado (ya contada aquí abajo
  -- de forma independiente).
  --
  -- Supuesto del que depende esto -- verificado con datos reales antes de aplicar, no asumido:
  -- que el ingrediente-equivalente "atrapado" dentro de un semielaborado usado por un
  -- producto_final ya cerrado está cubierto, EN AGREGADO, por las producciones cerradas propias
  -- de ese semielaborado. NO se exige trazabilidad 1:1 por evento -- de hecho no se sostiene
  -- siempre: la producción cerrada 121 (Tortilla Espanola con Cebolla 20, dato real, no ZZ_ de
  -- test) no tiene ninguna fila en consumo_produccion_pf (backfill histórico sin ledger de
  -- consumo). Pese a eso, en agregado: Mezcla Tortilla Espanola con Cebolla (semielaborado_id=6)
  -- tiene 122 uds cerradas frente a 121 uds implicadas por la receta de TODAS las producciones
  -- cerradas de Tortilla 20+24 que la usan -- el supuesto agregado se sostiene hoy (122 >= 121).
  -- Si en el futuro el histórico se desequilibra al revés (semielaborado cerrado por debajo de lo
  -- que sus padres implican), esta función infravalorará ya_producido_explotado para los
  -- ingredientes de ese semielaborado -- no hay chequeo automático de esa condición aquí.
  select coalesce(sum(contribucion), 0) into v_producido
  from (
    select pd.cantidad_producida * rpf.cantidad as contribucion
    from producciones_producto_final pd
    join receta_producto_final rpf on rpf.producto_final_id = pd.producto_final_id
    where pd.estado = 'cerrada' and rpf.ingrediente_id = p_ingrediente_id

    union all

    select ps.cantidad_producida * rs.cantidad
    from producciones_semielaborado ps
    join receta_semielaborado rs on rs.semielaborado_id = ps.semielaborado_id
    where ps.estado = 'cerrada' and rs.ingrediente_id = p_ingrediente_id
  ) contribuciones_producido;

  return v_demanda - v_producido;
end;
$$;

grant execute on function public.necesidad_agregada_ingrediente(bigint) to authenticated;
