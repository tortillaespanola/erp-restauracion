-- Fix: "Producciones del día" mostraba necesidad BRUTA de receta para
-- semielaborados/ingredientes/artículos, en vez de necesidad NETA en
-- cascada -- un semielaborado ya cubierto por su propio stock seguía
-- arrastrando la necesidad completa de su receta hacia sus hijos, aunque
-- el stock físico de éstos estuviera en 0 y no hiciera falta producir
-- nada más de ellos.
--
-- Caso real que lo confirmó (dataset ZZ): ZZ_ALBODIGACONTOMATE (id 18)
-- necesita 4 uds (pedido OV-260101), tiene stock 4 (ya producido,
-- consumiendo el stock de sus dos semielaborados hijos) -> "OK" en su
-- propia fila, correcto. Pero ZZ_Albondiga frita (19) y ZZ_TomateFrito
-- (15), con stock 0 tras esa producción, seguían mostrando necesidad
-- bruta 4.000 y 0.020 respectivamente -- "Pendiente de producir" cuando
-- en realidad nadie necesita ya que se produzca más de ellos.
--
-- necesidades_pedidos() NO se toca -- es una función compartida por tres
-- pantallas (PedidosDelDia.jsx, Producciones.jsx,
-- ProduccionProductosFinales.jsx, ver CONTRATO_VISTA_DINAMICA_PRODUCCION.md)
-- y sigue sirviendo necesidad bruta por pedido individual para la
-- trazabilidad a pedido/cliente (tooltip). Función nueva y separada:
-- necesidades_pedidos_cascada(), que en vez de explotar la receta hacia
-- abajo multiplicando cantidades sin más, propaga DÉFICIT:
--
--   déficit(nodo) = MAX(0, necesidad_agregada(nodo) - stock_disponible(nodo))
--   necesidad_agregada(hijo) = Σ [ déficit(padre) × cantidad_por_unidad_receta ]
--
-- Si un padre (producto final o semielaborado) ya tiene déficit 0 -- su
-- stock cubre su necesidad -- no arrastra ninguna necesidad hacia sus
-- hijos, aunque el stock físico de éstos esté en 0. La necesidad
-- MOSTRADA de cada nodo (columna "Necesidad agregada" de la pantalla)
-- sigue siendo la que le llega de sus padres, nunca neta de su propio
-- stock -- eso sigue siendo la columna "Stock disponible" de al lado,
-- comparación sin cambios. El déficit es un concepto interno de la
-- función, nunca se expone directamente.
--
-- Por qué una llamada batch (todos los pedido_ids a la vez) y no una
-- función por pedido como necesidades_pedidos(): el déficit
-- (MAX(0, necesidad - stock)) no es lineal, no distribuye sobre una
-- suma -- calcularlo por pedido individual y sumar después descontaría
-- el mismo stock físico una vez por cada pedido que lo mirase por
-- separado. Debe calcularse una sola vez sobre la necesidad ya agregada
-- de todos los pedidos.
--
-- Resuelto por oleadas (profundidad TOPOLÓGICA máxima de cada
-- semielaborado, no la profundidad de una ruta cualquiera): un
-- semielaborado puede recibir aportes de varios padres a profundidades
-- distintas (ej. un ingrediente/semielaborado compartido por dos ramas
-- de receta) -- no se puede calcular su déficit ni repartirlo a sus
-- hijos hasta que TODOS sus padres, de cualquier profundidad, ya se han
-- resuelto. Mismo guarda de ciclo (profundidad máxima 20) que
-- necesidades_pedidos().
--
-- Alcance de la cascada, decidido explícitamente (no solo semielaborado
-- -> semielaborado): el propio stock de producto final también reduce lo
-- que se traslada a sus semielaborados hijos, y el déficit sigue
-- bajando hasta ingredientes/artículos (materia prima) -- cascada
-- completa desde producto final hasta el final de la receta. La fila
-- 'producto_final' devuelta sigue siendo necesidad bruta de pedido, sin
-- cambio de comportamiento visible en esa tabla.
--
-- Probado en transacción de prueba (con ROLLBACK) contra los pedidos
-- reales pendientes (OV-260101, OV-260102, dataset ZZ):
--  - Caso real tal cual: ZZ_ALBODIGACONTOMATE (18) y otros 3
--    semielaborados de nivel 1 tienen stock == necesidad bruta (déficit
--    0) -- ZZ_Albondiga frita (19) y ZZ_TomateFrito (15) correctamente
--    ausentes del resultado (necesidad 0, ya no hace falta producirlos);
--    ingredientes/artículos de esa rama también en 0. Las otras 3 ramas,
--    sin relación con el bug, sin cambios frente a necesidades_pedidos().
--  - Déficit parcial de un nivel (stock de 18 bajado a 1.5 => déficit
--    2.5): 19 y 15 reciben exactamente 2.5×ratio cada uno; sus hijos
--    (artículos/ingredientes) reciben el déficit de 19/15 (completo,
--    stock 0) multiplicado por su propia receta -- valores verificados
--    exactos.
--  - Déficit parcial en dos niveles encadenados (además, producción
--    ficticia de 1.25 uds para 19 dentro de la misma transacción):
--    déficit(19) pasa de 2.5 a 1.25, sus artículos hijos se reducen a la
--    mitad exacta; 15 y sus ingredientes, sin tocar, sin cambio -- 0
--    diffs frente a lo calculado a mano.
--  - Nivel 'producto_final': idéntico a necesidades_pedidos() en los 4
--    productos finales de los pedidos reales (ninguno tiene stock propio
--    en este dataset).

create or replace function necesidades_pedidos_cascada(p_pedido_ids bigint[])
returns table (
  nivel text,
  item_id bigint,
  nombre text,
  unidad text,
  cantidad_necesaria numeric
)
language plpgsql
as $$
declare
  v_max_profundidad constant int := 20;
  v_profundidad int;
  v_corte record;
begin
  drop table if exists tmp_cs_pf;
  create temporary table tmp_cs_pf on commit drop as
  select lpv.producto_final_id as id, sum(lpv.cantidad) as necesidad
  from lineas_pedido_venta lpv
  where lpv.pedido_id = any(p_pedido_ids) and lpv.producto_final_id is not null
  group by lpv.producto_final_id;

  drop table if exists tmp_cs_articulo_directo;
  create temporary table tmp_cs_articulo_directo on commit drop as
  select lpv.articulo_id as id, sum(lpv.cantidad) as necesidad
  from lineas_pedido_venta lpv
  where lpv.pedido_id = any(p_pedido_ids) and lpv.articulo_id is not null
  group by lpv.articulo_id;

  drop table if exists tmp_cs_deficit_pf;
  create temporary table tmp_cs_deficit_pf on commit drop as
  select pf.id, greatest(pf.necesidad - coalesce(stock.disponible, 0), 0) as deficit
  from tmp_cs_pf pf
  left join (
    select producto_final_id, sum(stock_disponible) as disponible
    from stock_lotes_producto_final
    group by producto_final_id
  ) stock on stock.producto_final_id = pf.id;

  drop table if exists tmp_cs_profundidad;
  create temporary table tmp_cs_profundidad on commit drop as
  with recursive alcance as (
    select rpf.ingrediente_semielaborado_id as semielaborado_id, 1 as profundidad
    from receta_producto_final rpf
    join tmp_cs_deficit_pf d on d.id = rpf.producto_final_id
    where rpf.ingrediente_semielaborado_id is not null

    union all

    select rs.ingrediente_semielaborado_id, a.profundidad + 1
    from alcance a
    join receta_semielaborado rs on rs.semielaborado_id = a.semielaborado_id
    where rs.ingrediente_semielaborado_id is not null and a.profundidad < v_max_profundidad
  )
  select semielaborado_id, max(profundidad) as profundidad
  from alcance
  group by semielaborado_id;

  select s.id, s.nombre into v_corte
  from tmp_cs_profundidad p
  join semielaborados s on s.id = p.semielaborado_id
  where p.profundidad = v_max_profundidad
  limit 1;

  if found then
    raise exception 'necesidades_pedidos_cascada: recursión de receta cortada en profundidad % en el semielaborado "%" (id %) — probable ciclo en receta_semielaborado (un semielaborado que acaba consumiéndose a sí mismo, directa o indirectamente)',
      v_max_profundidad, v_corte.nombre, v_corte.id;
  end if;

  drop table if exists tmp_cs_acumulado_semi;
  create temporary table tmp_cs_acumulado_semi (semielaborado_id bigint primary key, necesidad numeric not null default 0) on commit drop;

  drop table if exists tmp_cs_total_semi;
  create temporary table tmp_cs_total_semi (semielaborado_id bigint primary key, necesidad numeric not null default 0) on commit drop;

  drop table if exists tmp_cs_total_ingrediente;
  create temporary table tmp_cs_total_ingrediente (ingrediente_id bigint primary key, necesidad numeric not null default 0) on commit drop;

  drop table if exists tmp_cs_total_articulo;
  create temporary table tmp_cs_total_articulo (articulo_id bigint primary key, necesidad numeric not null default 0) on commit drop;

  -- Oleada 0: explota el déficit de cada producto final por su receta directa (receta_producto_final).
  insert into tmp_cs_acumulado_semi (semielaborado_id, necesidad)
  select rpf.ingrediente_semielaborado_id, sum(rpf.cantidad * d.deficit)
  from tmp_cs_deficit_pf d
  join receta_producto_final rpf on rpf.producto_final_id = d.id
  where rpf.ingrediente_semielaborado_id is not null and d.deficit > 0
  group by rpf.ingrediente_semielaborado_id
  on conflict (semielaborado_id) do update set necesidad = tmp_cs_acumulado_semi.necesidad + excluded.necesidad;

  insert into tmp_cs_total_ingrediente (ingrediente_id, necesidad)
  select rpf.ingrediente_id, sum(rpf.cantidad * d.deficit)
  from tmp_cs_deficit_pf d
  join receta_producto_final rpf on rpf.producto_final_id = d.id
  where rpf.ingrediente_id is not null and d.deficit > 0
  group by rpf.ingrediente_id
  on conflict (ingrediente_id) do update set necesidad = tmp_cs_total_ingrediente.necesidad + excluded.necesidad;

  insert into tmp_cs_total_articulo (articulo_id, necesidad)
  select rpf.articulo_id, sum(rpf.cantidad * d.deficit)
  from tmp_cs_deficit_pf d
  join receta_producto_final rpf on rpf.producto_final_id = d.id
  where rpf.articulo_id is not null and d.deficit > 0
  group by rpf.articulo_id
  on conflict (articulo_id) do update set necesidad = tmp_cs_total_articulo.necesidad + excluded.necesidad;

  -- Oleadas 1..N: por cada profundidad topológica creciente, se resuelven los semielaborados
  -- asignados a ella (ya han recibido todos sus aportes posibles -- cualquier padre suyo tiene
  -- profundidad menor y ya se resolvió en una oleada anterior), se calcula su déficit tras su propio
  -- stock, y se reparte ese déficit -- nunca la necesidad bruta -- a sus hijos.
  for v_profundidad in 1..v_max_profundidad loop
    if not exists (select 1 from tmp_cs_profundidad where profundidad = v_profundidad) then
      continue;
    end if;

    drop table if exists tmp_cs_deficit_nivel;
    create temporary table tmp_cs_deficit_nivel on commit drop as
    select p.semielaborado_id, greatest(a.necesidad - coalesce(stock.disponible, 0), 0) as deficit
    from tmp_cs_profundidad p
    join tmp_cs_acumulado_semi a on a.semielaborado_id = p.semielaborado_id
    left join (
      select semielaborado_id, sum(stock_disponible) as disponible
      from stock_lotes_semielaborado
      group by semielaborado_id
    ) stock on stock.semielaborado_id = p.semielaborado_id
    where p.profundidad = v_profundidad;

    insert into tmp_cs_total_semi (semielaborado_id, necesidad)
    select p.semielaborado_id, a.necesidad
    from tmp_cs_profundidad p
    join tmp_cs_acumulado_semi a on a.semielaborado_id = p.semielaborado_id
    where p.profundidad = v_profundidad;

    insert into tmp_cs_acumulado_semi (semielaborado_id, necesidad)
    select rs.ingrediente_semielaborado_id, sum(rs.cantidad * dn.deficit)
    from tmp_cs_deficit_nivel dn
    join receta_semielaborado rs on rs.semielaborado_id = dn.semielaborado_id
    where rs.ingrediente_semielaborado_id is not null and dn.deficit > 0
    group by rs.ingrediente_semielaborado_id
    on conflict (semielaborado_id) do update set necesidad = tmp_cs_acumulado_semi.necesidad + excluded.necesidad;

    insert into tmp_cs_total_ingrediente (ingrediente_id, necesidad)
    select rs.ingrediente_id, sum(rs.cantidad * dn.deficit)
    from tmp_cs_deficit_nivel dn
    join receta_semielaborado rs on rs.semielaborado_id = dn.semielaborado_id
    where rs.ingrediente_id is not null and dn.deficit > 0
    group by rs.ingrediente_id
    on conflict (ingrediente_id) do update set necesidad = tmp_cs_total_ingrediente.necesidad + excluded.necesidad;

    insert into tmp_cs_total_articulo (articulo_id, necesidad)
    select rs.articulo_id, sum(rs.cantidad * dn.deficit)
    from tmp_cs_deficit_nivel dn
    join receta_semielaborado rs on rs.semielaborado_id = dn.semielaborado_id
    where rs.articulo_id is not null and dn.deficit > 0
    group by rs.articulo_id
    on conflict (articulo_id) do update set necesidad = tmp_cs_total_articulo.necesidad + excluded.necesidad;
  end loop;

  return query
  select 'producto_final'::text, pf.id, p.nombre, null::text, pf.necesidad
  from tmp_cs_pf pf
  join productos_finales p on p.id = pf.id

  union all

  select 'semielaborado'::text, t.semielaborado_id, s.nombre, s.unidad, t.necesidad
  from tmp_cs_total_semi t
  join semielaborados s on s.id = t.semielaborado_id
  where t.necesidad > 0

  union all

  select 'ingrediente'::text, t.ingrediente_id, i.nombre, i.unidad, t.necesidad
  from tmp_cs_total_ingrediente t
  join ingredientes i on i.id = t.ingrediente_id
  where t.necesidad > 0

  union all

  select 'articulo'::text, a.id, a.nombre, a.unidad,
    coalesce((select necesidad from tmp_cs_total_articulo ta where ta.articulo_id = a.id), 0)
    + coalesce((select necesidad from tmp_cs_articulo_directo ad where ad.id = a.id), 0)
  from articulos_compra a
  where (
    coalesce((select necesidad from tmp_cs_total_articulo ta where ta.articulo_id = a.id), 0)
    + coalesce((select necesidad from tmp_cs_articulo_directo ad where ad.id = a.id), 0)
  ) > 0;
end;
$$;
