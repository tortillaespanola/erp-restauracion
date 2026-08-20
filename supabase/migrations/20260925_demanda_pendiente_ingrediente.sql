-- Corrección de diseño: necesidad_agregada_ingrediente() restaba "ya_producido_explotado"
-- (histórico ACUMULADO de toda producción cerrada alguna vez, sin límite temporal) de la demanda
-- pendiente actual -- con 0 pedidos pendientes, el resultado seguía creciendo en negativo cada vez
-- que se cerraba una nueva producción, sin relación con cuánto stock hay realmente hoy. Confirmado
-- en navegador durante la construcción de Inventario (valores como -97.600 kg para Patata sin
-- ningún pedido pendiente).
--
-- Decisión de producto: la necesidad agregada es demanda pendiente de fabricar MENOS el stock
-- ACTUAL de ese ingrediente en almacén -- no un acumulado histórico. El stock actual ya se calcula
-- en el frontend (Inventario.jsx, subtotal de Nivel 1 sobre stock_articulos), así que esta función
-- deja de calcular "ya producido" por completo y pasa a devolver solo la demanda bruta explotada
-- -- la resta final la hace el frontend, reutilizando el stock que ya tenía calculado.
--
-- demanda_pendiente_ingrediente() reemplaza a necesidad_agregada_ingrediente(): misma lógica de
-- demanda_bruta_explotada ya verificada (grafo_bajada no recursivo + arbol_demanda recursivo +
-- neto por línea de pedido vía lineas_albaran_venta, mismo criterio que
-- necesidades_pedidos_cascada() -- ver 20260918_necesidades_pedidos_cascada_neta_por_linea.sql),
-- sin ningún cambio en esa parte. Se elimina por completo la sección de ya_producido_explotado y
-- su verificación anti-doble-conteo (ya no aplica, no hay nada que doble-contar).
create or replace function public.demanda_pendiente_ingrediente(p_ingrediente_id bigint)
returns numeric
language plpgsql
stable
as $$
declare
  v_fila record;
  v_demanda numeric;
begin
  for v_fila in
    select 'receta_producto_final'::text as tabla, id, producto_final_id as nodo_id
    from receta_producto_final where articulo_id is not null
    union all
    select 'receta_semielaborado'::text, id, semielaborado_id
    from receta_semielaborado where articulo_id is not null
  loop
    raise notice 'demanda_pendiente_ingrediente: % id=% (nodo %) usa articulo_id directo -- ignorada, no soportado por esta función',
      v_fila.tabla, v_fila.id, v_fila.nodo_id;
  end loop;

  with recursive grafo_bajada as (
    select 'pf'::text as origen_tipo, rpf.producto_final_id as origen_id,
      rpf.ingrediente_semielaborado_id as destino_semi_id, rpf.cantidad
    from receta_producto_final rpf
    where rpf.ingrediente_semielaborado_id is not null

    union all

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
    select ad.cantidad_nodo * rpf.cantidad as contribucion
    from arbol_demanda ad
    join receta_producto_final rpf on rpf.producto_final_id = ad.nodo_id
    where ad.nodo_tipo = 'pf' and rpf.ingrediente_id = p_ingrediente_id

    union all

    select ad.cantidad_nodo * rs.cantidad
    from arbol_demanda ad
    join receta_semielaborado rs on rs.semielaborado_id = ad.nodo_id
    where ad.nodo_tipo = 'semi' and rs.ingrediente_id = p_ingrediente_id
  ) contribuciones_demanda;

  return v_demanda;
end;
$$;

grant execute on function public.demanda_pendiente_ingrediente(bigint) to authenticated;

-- necesidad_agregada_ingrediente() queda sin ningún llamador tras migrar Inventario.jsx a la
-- función nueva (único consumidor, verificado por grep antes de dropear) -- se elimina en vez de
-- dejarla como código muerto marcado "deprecated".
drop function if exists public.necesidad_agregada_ingrediente(bigint);

-- Hallazgo menor de paso: ZZ_Tomate Triturado mostraba "k" en vez de "kg" en Stock -- el trigger
-- espejo de unidad (20260923_unidades_medida.sql) solo dispara en INSERT/UPDATE OF unidad_id; las
-- filas backfilleadas en la Fase B nunca dispararon un UPDATE real tras crearse el trigger, así que
-- su columna `unidad` (texto) se quedó con el valor original pre-migración. Forzar
-- `unidad_id = unidad_id` SÍ cuenta como "UPDATE OF unidad_id" en Postgres (el trigger se define por
-- columna en el SET, no por cambio de valor), así que dispara el trigger espejo para todas las
-- filas existentes sin tocar ningún otro dato.
update ingredientes set unidad_id = unidad_id;
update articulos_compra set unidad_id = unidad_id;
