-- Fix de regresión de 20261018_estado_parcial_pedidos.sql (CONTRATO_ESTADO_PARCIAL_PEDIDOS.md, P0-3):
-- esa migración introdujo el estado 'parcial' y actualizó el filtro de PedidosDelDia.jsx:728
-- (`.in('estado', ['pendiente', 'en_produccion', 'parcial'])`), pero su propia auditoría (comentario
-- líneas 26-29) solo repasó ESE filtro directo en frontend -- no llegó a las funciones SQL de abajo,
-- que agregan/desglosan sobre pedidos_venta con el vocabulario viejo. Caso real reportado: OV-260134
-- (Tortilla Española con Cebolla 24, pedido=2 servido=1) en cabecera 'parcial' -- "Necesidad agregada"
-- en Producciones del día mostraba correctamente 1.000 uds (necesidades_pedidos_cascada(), que agrega
-- por línea sin mirar estado de cabecera -- sin bug, sin cambios aquí), pero el desglose de pedidos
-- pendientes por producto final decía "Sin pedidos pendientes" -- causa: distribucion_prevista_pf()
-- excluía 'parcial' de su CTE lineas_pendientes.
--
-- Auditoría (grep completo `.eq('estado'`, `.in('estado'`, `estado in (`, `estado = 'pendiente'` en
-- frontend + supabase/migrations) de todos los sitios con el mismo patrón de filtro literal por
-- estado de pedido, hecha antes de escribir este fix:
-- - distribucion_prevista_pf() (vigente: 20260920_distribucion_prevista_pf_servido.sql:56) --
--   BUG CONFIRMADO, se corrige abajo.
-- - demanda_pendiente_ingrediente() (vigente: 20260925_demanda_pendiente_ingrediente.sql:65), usada
--   por la columna "Necesidad agregada" de Inventario.jsx -- mismo BUG, se corrige abajo.
-- - AlbaranesCompra.jsx:224 (`.eq('estado', 'pendiente')` sobre pedidos_compra) -- mismo patrón en
--   compras, se corrige en el mismo commit (fuera de esta migración, cambio de frontend).
-- - ESTADOS_PEDIDO_VENTA / ESTADOS_PEDIDO_COMPRA (frontend/src/lib/estadoPedido.js) -- 'parcial' ya
--   estaba incluido desde 20261018 (verificado leyendo el archivo); el MultiSelect de Pedidos.jsx /
--   PedidosCompra.jsx ya lo ofrece como opción. Sin cambios.
-- - grupo_estado_pedidos_venta (20260928_grupo_estado_pedidos_venta.sql:12): usa el patrón inverso
--   (`case when estado in ('servido','cancelado') then 1 else 0`) -- cualquier estado nuevo cae en
--   "activo" sin tocar la función. Sin bug, sin cambios.
-- - actualizar_estado_pedido_por_produccion() (20260801, guard `where estado = 'pendiente'`): ya
--   auditado y confirmado intencional en el comentario de 20261018_estado_parcial_pedidos.sql:20-22
--   -- solo avanza pendiente -> en_produccion, nunca debe tocar un pedido ya en 'parcial'/'servido'.
--   Sin cambios.
-- - necesidad_agregada_ingrediente() (20260922) y las versiones de actualizar_estado_pedido_compra()
--   anteriores a 20261018 (20260802, 20260816): código histórico ya sustituido/eliminado (`drop
--   function` / `create or replace` posterior), no están activas. Sin cambios.
--
-- Vocabulario completo por si se escapa algún estado más (constraints de 20261018_estado_parcial_
-- pedidos.sql:59,71): pedidos_venta {pendiente, en_produccion, parcial, servido, cancelado};
-- pedidos_compra {pendiente, parcial, recibido, cancelado}. Los filtros de "pendiente de completar"
-- deben excluir únicamente los estados terminales (servido/recibido/cancelado) -- justo lo que hacen
-- las dos funciones de abajo tras este fix.
--
-- Idempotente: CREATE OR REPLACE FUNCTION sobre la misma firma ya existente en ambos casos (sin
-- cambio de tipo de retorno, no hace falta DROP previo). Aplicar a mano desde el SQL Editor del
-- Dashboard de Supabase, probando antes en una transacción BEGIN...ROLLBACK simulando el rol
-- authenticated real (SET LOCAL request.jwt.claim.role = 'authenticated' + SET LOCAL ROLE
-- authenticated, en ese orden).

-- ============================================================
-- 1. distribucion_prevista_pf(): incluir 'parcial' en lineas_pendientes.
-- ============================================================

create or replace function distribucion_prevista_pf(p_producto_final_id bigint)
returns table (
  total_producido_hoy numeric,
  total_distribuido numeric,
  residual_libre numeric,
  linea_pedido_id bigint,
  pedido_id bigint,
  codigo_pedido text,
  cliente_nombre text,
  fecha_entrega_prevista date,
  cantidad_pedida numeric,
  servido numeric,
  cantidad_prevista numeric,
  produccion_pf_id bigint
)
language sql
stable
as $$
  with producido as (
    select coalesce(sum(cantidad_producida), 0) as total
    from producciones_producto_final
    where producto_final_id = p_producto_final_id
      and estado = 'cerrada'
      and fecha = current_date
  ),
  lineas_pendientes as (
    select
      lpv.id as linea_pedido_id,
      lpv.cantidad as cantidad_pedida,
      coalesce((select sum(lav.cantidad) from lineas_albaran_venta lav where lav.linea_pedido_id = lpv.id), 0) as servido,
      pv.id as pedido_id,
      pv.codigo_pedido,
      c.nombre as cliente_nombre,
      pv.fecha_entrega_prevista,
      coalesce(pd.cantidad_prevista, 0) as cantidad_prevista,
      pd.produccion_pf_id
    from lineas_pedido_venta lpv
    join pedidos_venta pv on pv.id = lpv.pedido_id
    join clientes c on c.id = pv.cliente_id
    left join previsiones_distribucion_pf pd on pd.linea_pedido_id = lpv.id
    where lpv.producto_final_id = p_producto_final_id
      and pv.estado in ('pendiente', 'en_produccion', 'parcial')
  ),
  distribuido as (
    select coalesce(sum(cantidad_prevista), 0) as total from lineas_pendientes
  )
  select
    producido.total,
    distribuido.total,
    producido.total - distribuido.total,
    lp.linea_pedido_id,
    lp.pedido_id,
    lp.codigo_pedido,
    lp.cliente_nombre,
    lp.fecha_entrega_prevista,
    lp.cantidad_pedida,
    lp.servido,
    lp.cantidad_prevista,
    lp.produccion_pf_id
  from producido
  cross join distribuido
  left join lineas_pendientes lp on true
  order by lp.fecha_entrega_prevista nulls last, lp.pedido_id;
$$;

-- ============================================================
-- 2. demanda_pendiente_ingrediente(): incluir 'parcial' en arbol_demanda (nodo raíz 'pf').
-- ============================================================

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
    where pv.estado in ('pendiente', 'en_produccion', 'parcial')
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

-- ============================================================
-- 3. Verificación post-migración sugerida (comentario, no ejecutable en bloque). Ejecutar a mano en
--    el SQL Editor tras aplicar, simulando el rol authenticated real:
--
--   -- Caso real OV-260134 (o equivalente reproducido): pedido de venta con una línea de un producto
--   -- final, pedido=2 servido=1 (estado de cabecera 'parcial' por el trigger
--   -- actualizar_estado_pedido_por_servicio()).
--   -- 1. select * from distribucion_prevista_pf(<producto_final_id>);
--   --    -- debe devolver una fila con linea_pedido_id = <la del pedido parcial>, servido = 1,
--   --    -- cantidad_pedida = 2 -- ya NO debe salir la fila "vacía" (linea_pedido_id is null) si ese
--   --    -- era el único pedido pendiente de ese producto final.
--   -- 2. select demanda_pendiente_ingrediente(<ingrediente_id de la receta de ese producto final>);
--   --    -- debe incluir ahora la cantidad pendiente de esa línea (2 - 1 = 1 x cantidad de receta),
--   --    -- ya no debe dar 0 / infravalorar la demanda.
--   -- 3. Regresión -- repetir 1 y 2 con:
--   --    a) un pedido en 'pendiente' puro (0 servido): debe seguir apareciendo igual que antes.
--   --    b) un pedido ya 'servido' (cantidad_pedida = servido): debe seguir SIN aparecer en el
--   --       desglose ni sumar a la demanda (comportamiento sin cambios, estado terminal).
--   --    c) un pedido 'cancelado': debe seguir sin aparecer (sin cambios).
-- ============================================================
