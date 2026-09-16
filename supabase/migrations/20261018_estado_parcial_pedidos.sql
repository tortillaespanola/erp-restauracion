-- CONTRATO_ESTADO_PARCIAL_PEDIDOS.md (P0-3 del roadmap Fase 06): pedidos_compra y pedidos_venta no
-- distinguían un pedido sin empezar de uno recibido/servido parcialmente -- evidencia real de la
-- Fase 06 (FASE06_SIMULACION_RESUMEN.md 5.1): OV-260057 con 5/8 sillas entregadas quedaba en
-- 'pendiente', igual que el pedido del Hotel Vier Jahreszeiten con 8/10 mesas.
--
-- Auditoría de esquema (obligatoria según el contrato) antes de escribir esto:
-- - pedidos_compra.estado / pedidos_venta.estado: CHECK constraint añadido en
--   20260910b_check_estado_pedidos.sql (antes texto libre). Vocabulario actual: pedidos_compra
--   {pendiente, recibido, cancelado}; pedidos_venta {pendiente, en_produccion, servido, cancelado}.
-- - actualizar_estado_pedido_compra() (20260802, corregida en 20260816): trigger AFTER
--   INSERT/UPDATE/DELETE en entrada_material. Antes solo miraba si EXISTE alguna línea con
--   remanente (lp.cantidad > recibido), sin agregar cantidades -- por eso "algo entregado, no todo"
--   caía siempre en 'pendiente', nunca en un estado intermedio.
-- - actualizar_estado_pedido_por_servicio() (20260801, corregida en 20260817): mismo patrón sobre
--   lineas_albaran_venta, con la complicación extra de 'en_produccion' (ver comentario de
--   20260817_fix_estado_pedido_venta.sql). Se preserva ese criterio (existe producciones_producto_
--   final vinculada al pedido) para el caso "0% servido", pero 'parcial' tiene prioridad sobre
--   'en_produccion' en cuanto hay CUALQUIER cantidad entregada -- la entrega real importa más que
--   si sigue habiendo producción abierta.
-- - actualizar_estado_pedido_por_produccion() (avanza 'pendiente' -> 'en_produccion' al insertar
--   producción) no se toca: solo actúa `where estado = 'pendiente'`, así que nunca pisa un pedido ya
--   en 'parcial' o 'servido'.
-- - lineas_pedido_compra.cantidad vs. entrada_material.cantidad (agregado por
--   linea_pedido_compra_id); lineas_pedido_venta.cantidad vs. lineas_albaran_venta.cantidad
--   (agregado por linea_pedido_id) ya eran las columnas usadas por los triggers actuales.
-- - UI: badge de estado en listados (Pedidos.jsx / PedidosCompra.jsx, vía ESTADO_BADGE +
--   t('enums:estado_pedido(_compra).<estado>')) y filtro de "pedidos pendientes de servir" en
--   PedidosDelDia.jsx (`.in('estado', ['pendiente', 'en_produccion'])`) -- se actualizan en el
--   frontend en el mismo commit que esta migración.
--
-- Nueva lógica (agregada por TODO el pedido, no por línea individual, y cubre multi-albarán
-- porque el `sum` ya acumula todas las entradas/entregas sobre cada línea):
--   0 recibido/entregado                       -> 'pendiente' (o 'en_produccion' en ventas si ya
--                                                  hay producción abierta vinculada)
--   0 < recibido/entregado < pedido            -> 'parcial'
--   recibido/entregado >= pedido               -> 'recibido' / 'servido'
-- 'cancelado' nunca se toca (mismo guard `estado <> 'cancelado'` que ya tenían ambos triggers).
--
-- Idempotente: el bloque de constraints comprueba antes de tocar nada; CREATE OR REPLACE FUNCTION
-- y los UPDATE de backfill (con guarda `estado <> estado_calculado`) son idempotentes por
-- construcción. Aplicar a mano desde el SQL Editor del Dashboard de Supabase, como el resto de
-- migraciones de este proyecto.

-- ============================================================
-- 1. Vocabulario: añadir 'parcial' a ambos CHECK constraints.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chk_pedidos_venta_estado'
      and pg_get_constraintdef(oid) like '%parcial%'
  ) then
    raise notice 'chk_pedidos_venta_estado ya incluye parcial. Nada que hacer.';
  else
    alter table pedidos_venta drop constraint chk_pedidos_venta_estado;
    alter table pedidos_venta add constraint chk_pedidos_venta_estado
      check (estado in ('pendiente', 'en_produccion', 'parcial', 'servido', 'cancelado'));
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'chk_pedidos_compra_estado'
      and pg_get_constraintdef(oid) like '%parcial%'
  ) then
    raise notice 'chk_pedidos_compra_estado ya incluye parcial. Nada que hacer.';
  else
    alter table pedidos_compra drop constraint chk_pedidos_compra_estado;
    alter table pedidos_compra add constraint chk_pedidos_compra_estado
      check (estado in ('pendiente', 'parcial', 'recibido', 'cancelado'));
  end if;
end $$;

-- ============================================================
-- 2. Trigger de pedidos_compra: agregado por pedido en vez de
--    "existe alguna línea con remanente".
-- ============================================================

create or replace function public.actualizar_estado_pedido_compra()
returns trigger
language plpgsql
as $$
declare
  v_pedido_id bigint;
  v_pedido numeric;
  v_recibido numeric;
begin
  select pedido_compra_id into v_pedido_id
  from lineas_pedido_compra
  where id = coalesce(NEW.linea_pedido_compra_id, OLD.linea_pedido_compra_id);

  if v_pedido_id is null then
    return coalesce(NEW, OLD);
  end if;

  -- least(cantidad, recibido_de_esa_linea) capa cada línea a su propia cantidad antes de sumar:
  -- una línea recibida de más (error de picking, ajuste manual) no puede "tapar" el déficit de
  -- otra línea sin recibir nada -- v_recibido >= v_pedido solo es posible si CADA línea alcanzó su
  -- propia cantidad, igual que garantizaba el EXISTS por línea de la versión anterior.
  select
    sum(lp.cantidad),
    sum(least(lp.cantidad, coalesce((select sum(cantidad) from entrada_material where linea_pedido_compra_id = lp.id), 0)))
  into v_pedido, v_recibido
  from lineas_pedido_compra lp
  where lp.pedido_compra_id = v_pedido_id;

  update pedidos_compra
  set estado = case
    when v_recibido >= v_pedido then 'recibido'
    when v_recibido > 0 then 'parcial'
    else 'pendiente'
  end
  where id = v_pedido_id and estado <> 'cancelado';

  return coalesce(NEW, OLD);
end;
$$;

-- ============================================================
-- 3. Trigger de pedidos_venta: mismo agregado, preservando el
--    criterio de 'en_produccion' solo para el tramo 0% servido.
-- ============================================================

create or replace function public.actualizar_estado_pedido_por_servicio()
returns trigger
language plpgsql
as $$
declare
  v_pedido_id bigint;
  v_pedido numeric;
  v_servido numeric;
  v_en_produccion boolean;
begin
  select pedido_id into v_pedido_id
  from lineas_pedido_venta
  where id = coalesce(NEW.linea_pedido_id, OLD.linea_pedido_id);

  if v_pedido_id is null then
    return coalesce(NEW, OLD);
  end if;

  -- Mismo capado least() que en actualizar_estado_pedido_compra() -- ver comentario allí.
  select
    sum(lp.cantidad),
    sum(least(lp.cantidad, coalesce((select sum(cantidad) from lineas_albaran_venta where linea_pedido_id = lp.id), 0)))
  into v_pedido, v_servido
  from lineas_pedido_venta lp
  where lp.pedido_id = v_pedido_id;

  select exists (
    select 1 from producciones_producto_final where pedido_id = v_pedido_id
  ) into v_en_produccion;

  update pedidos_venta
  set estado = case
    when v_servido >= v_pedido then 'servido'
    when v_servido > 0 then 'parcial'
    when v_en_produccion then 'en_produccion'
    else 'pendiente'
  end
  where id = v_pedido_id and estado <> 'cancelado';

  return coalesce(NEW, OLD);
end;
$$;

-- ============================================================
-- 4. Backfill: recalcula con la lógica nueva los pedidos ya
--    existentes (incluida la demo AlpenWerk) que hoy pueden estar
--    mal marcados como 'pendiente'/'en_produccion' pese a tener
--    entregas parciales reales. Idempotente vía el filtro final.
-- ============================================================

-- Mismo capado least(cantidad, recibido/servido_de_esa_línea) que en los triggers -- ver comentario
-- en actualizar_estado_pedido_compra() más arriba: evita que una línea recibida/servida de más
-- tape el déficit de otra línea del mismo pedido.
update pedidos_compra pc
set estado = sub.estado_calculado
from (
  select
    lp.pedido_compra_id as id,
    sum(lp.cantidad) as v_pedido,
    sum(least(lp.cantidad, coalesce((select sum(cantidad) from entrada_material where linea_pedido_compra_id = lp.id), 0))) as v_recibido
  from lineas_pedido_compra lp
  group by lp.pedido_compra_id
) raw,
lateral (
  select case
    when raw.v_recibido >= raw.v_pedido then 'recibido'
    when raw.v_recibido > 0 then 'parcial'
    else 'pendiente'
  end as estado_calculado
) sub
where pc.id = raw.id and pc.estado <> 'cancelado' and pc.estado <> sub.estado_calculado;

update pedidos_venta pv
set estado = sub.estado_calculado
from (
  select
    lp.pedido_id as id,
    sum(lp.cantidad) as v_pedido,
    sum(least(lp.cantidad, coalesce((select sum(cantidad) from lineas_albaran_venta where linea_pedido_id = lp.id), 0))) as v_servido,
    exists (select 1 from producciones_producto_final where pedido_id = lp.pedido_id) as v_en_produccion
  from lineas_pedido_venta lp
  group by lp.pedido_id
) raw,
lateral (
  select case
    when raw.v_servido >= raw.v_pedido then 'servido'
    when raw.v_servido > 0 then 'parcial'
    when raw.v_en_produccion then 'en_produccion'
    else 'pendiente'
  end as estado_calculado
) sub
where pv.id = raw.id and pv.estado <> 'cancelado' and pv.estado <> sub.estado_calculado;
