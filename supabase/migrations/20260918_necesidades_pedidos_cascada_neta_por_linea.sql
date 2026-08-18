-- Fix: necesidades_pedidos_cascada() calculaba la necesidad bruta de partida (tmp_cs_pf) sumando
-- lpv.cantidad de TODAS las líneas de pedidos pendiente/en_produccion, sin descontar lo que cada línea
-- individual ya tuviera servido vía lineas_albaran_venta. Antes de Capa C esto era correcto -- nunca
-- existía una línea ya servida dentro de un pedido que siguiera abierto por otra línea distinta, porque
-- la entrega iba ligada al pedido como unidad. Capa C lo hizo posible (producción agregada +
-- previsiones_distribucion_pf + entrega parcial por línea), y desde entonces genera un déficit
-- fantasma: unidades ya entregadas se siguen sumando como pendientes de fabricar, cascadeando el falso
-- déficit hacia semielaborados/ingredientes/artículos.
--
-- Caso real que lo confirmó: ZZ_Empresa1 (5 uds de ZZ_TORTILLASINCEBOLLAGRANDE ya servidas por
-- albarán, pedido sigue en_produccion por otra línea de ZZ_TORTILLACONCEBOLLAGRANDE sin servir) +
-- ZZ_Cliente1 (2 uds, de verdad pendientes) = necesidad bruta 7, cuando la necesidad real pendiente es
-- solo 2.
--
-- Fix: la necesidad de tmp_cs_pf pasa a calcularse por LÍNEA, netando cada una contra lo servido de esa
-- misma línea (GREATEST(0, lpv.cantidad - servido_de_esa_línea)) antes de sumar por producto final --
-- no por pedido completo. Único cambio en toda la función: el resto de la cascada (déficit, oleadas
-- topológicas hacia semielaborados/ingredientes/artículos) sigue leyendo tmp_cs_pf.necesidad exactamente
-- igual que antes, sin tocar su estructura.
--
-- No se toca necesidades_pedidos() (la función hermana sin cascada, compartida por
-- Producciones.jsx/ProduccionProductosFinales.jsx) -- sigue sirviendo necesidad bruta por pedido
-- individual para la trazabilidad a pedido/cliente, sin relación con este fix.
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
  select lpv.producto_final_id as id,
    sum(greatest(lpv.cantidad - coalesce(servido.cantidad, 0), 0)) as necesidad
  from lineas_pedido_venta lpv
  left join (
    select linea_pedido_id, sum(cantidad) as cantidad
    from lineas_albaran_venta
    where linea_pedido_id is not null
    group by linea_pedido_id
  ) servido on servido.linea_pedido_id = lpv.id
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
  where pf.necesidad > 0

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
