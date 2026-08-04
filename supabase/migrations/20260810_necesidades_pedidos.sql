-- necesidades_pedidos: dado un conjunto de pedidos de venta (uno o varios
-- agregados), calcula recursivamente cuánto hace falta en cada nivel de la
-- cadena de receta — producto_final -> semielaborado -> articulo_compra.
--
-- Motivación: FLUJO_TORTILLA.md Sección D documentó que hoy no existe en
-- ningún sitio del sistema la operación "receta × cantidad objetivo", ni
-- siquiera para un solo pedido — el usuario lo calcula a mano cada día
-- antes de ir al almacén. No toca ninguna pantalla; es la base de datos
-- que una futura capa de UI (tipo POS) podría consumir.
--
-- Diseño (función, no vista): necesita parámetros (qué pedidos agregar) y
-- recursividad real de profundidad variable — receta_semielaborado ya tiene
-- ingrediente_semielaborado_id (un semielaborado puede consumir otro
-- semielaborado hoy mismo, no es una hipótesis de futuro), así que un
-- bucle de "2 niveles fijos" sería incorrecto. Usa WITH RECURSIVE con una
-- guarda de profundidad (20 niveles) que, si se alcanza, lanza una
-- excepción explícita con el ítem causante en vez de devolver una lista de
-- compra incompleta en silencio.
--
-- Cubre también el caso borde de una línea de pedido que pide un
-- articulo_compra directamente, sin pasar por ningún producto_final.
--
-- Validado en transacción de prueba (con ROLLBACK) contra los números ya
-- calculados a mano en FLUJO_TORTILLA.md Sección D: 3 pedidos (1+2+3
-- tortillas = 6 unidades) -> 12 kg de Mezcla -> 6.0 kg cebolla, 9.6 kg
-- patata, 4.2 kg huevina, 1.2 l aceite. Caso borde (patata pedida directa,
-- +1.0 kg) -> 10.6 kg patata, resto sin cambio. Guarda de profundidad
-- probada con un ciclo indirecto real (Mezcla -> B -> Mezcla, ya que un
-- CHECK constraint existente, "no_auto_referencia", bloquea la
-- autorreferencia directa) -> excepción clara, sin resultado parcial.

create or replace function necesidades_pedidos(p_pedido_ids bigint[])
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
  v_corte record;
begin
  drop table if exists tmp_necesidades_pedido_pf;
  create temporary table tmp_necesidades_pedido_pf on commit drop as
  select lpv.producto_final_id, sum(lpv.cantidad) as cantidad
  from lineas_pedido_venta lpv
  where lpv.pedido_id = any(p_pedido_ids) and lpv.producto_final_id is not null
  group by lpv.producto_final_id;

  drop table if exists tmp_necesidades_articulo_directo;
  create temporary table tmp_necesidades_articulo_directo on commit drop as
  select lpv.articulo_id, sum(lpv.cantidad) as cantidad
  from lineas_pedido_venta lpv
  where lpv.pedido_id = any(p_pedido_ids) and lpv.articulo_id is not null
  group by lpv.articulo_id;

  drop table if exists tmp_necesidades_explosion;
  create temporary table tmp_necesidades_explosion on commit drop as
  with recursive explosion as (
    select
      1 as profundidad,
      case when rpf.ingrediente_semielaborado_id is not null then 'semielaborado' else 'articulo' end as tipo,
      rpf.ingrediente_semielaborado_id as semielaborado_id,
      rpf.articulo_id as articulo_id,
      rpf.cantidad * ppf.cantidad as cantidad_necesaria
    from tmp_necesidades_pedido_pf ppf
    join receta_producto_final rpf on rpf.producto_final_id = ppf.producto_final_id

    union all

    select
      e.profundidad + 1,
      case when rs.ingrediente_semielaborado_id is not null then 'semielaborado' else 'articulo' end,
      rs.ingrediente_semielaborado_id,
      rs.articulo_id,
      rs.cantidad * e.cantidad_necesaria
    from explosion e
    join receta_semielaborado rs on rs.semielaborado_id = e.semielaborado_id
    where e.tipo = 'semielaborado' and e.profundidad < v_max_profundidad
  )
  select * from explosion;

  -- Si quedan filas 'semielaborado' justo en la profundidad máxima, la
  -- recursión seguía activa cuando se cortó: no devolvemos un resultado
  -- parcial en silencio, lanzamos excepción indicando qué item la causó.
  select s.id, s.nombre into v_corte
  from tmp_necesidades_explosion e
  join semielaborados s on s.id = e.semielaborado_id
  where e.tipo = 'semielaborado' and e.profundidad = v_max_profundidad
  limit 1;

  if found then
    raise exception 'necesidades_pedidos: recursión de receta cortada en profundidad % en el semielaborado "%" (id %) — probable ciclo en receta_semielaborado (un semielaborado que acaba consumiéndose a sí mismo, directa o indirectamente)',
      v_max_profundidad, v_corte.nombre, v_corte.id;
  end if;

  return query
  select 'producto_final'::text, ppf.producto_final_id, pf.nombre, null::text, ppf.cantidad
  from tmp_necesidades_pedido_pf ppf
  join productos_finales pf on pf.id = ppf.producto_final_id

  union all

  select 'semielaborado'::text, e.semielaborado_id, s.nombre, s.unidad, sum(e.cantidad_necesaria)
  from tmp_necesidades_explosion e
  join semielaborados s on s.id = e.semielaborado_id
  where e.tipo = 'semielaborado'
  group by e.semielaborado_id, s.nombre, s.unidad

  union all

  select 'articulo'::text, a.id, a.nombre, a.unidad,
    coalesce((select sum(ex.cantidad_necesaria) from tmp_necesidades_explosion ex where ex.tipo = 'articulo' and ex.articulo_id = a.id), 0)
    + coalesce((select ad.cantidad from tmp_necesidades_articulo_directo ad where ad.articulo_id = a.id), 0)
  from articulos_compra a
  where exists (select 1 from tmp_necesidades_explosion ex where ex.tipo = 'articulo' and ex.articulo_id = a.id)
     or exists (select 1 from tmp_necesidades_articulo_directo ad where ad.articulo_id = a.id);
end;
$$;
