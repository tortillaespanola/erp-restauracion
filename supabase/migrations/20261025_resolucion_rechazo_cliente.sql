-- CONTRATO_PROPAGACION_RECHAZOS.md, Parte A: resolución de un rechazo de cliente ya declarado
-- (origen_rechazo = 'cliente' sobre ajustes_producto_final, CONTRATO_UI_INCIDENCIAS_STOCK.md) con
-- tres desenlaces -- abono / reenvío / descarte -- solo el reenvío crea trabajo nuevo (una línea de
-- pedido pendiente de servir).
--
-- Por qué solo ajustes_producto_final y no ajustes_semielaborado (riesgo señalado en el propio
-- contrato, §7): auditado el esquema real de lineas_pedido_venta -- solo tiene producto_final_id y
-- articulo_id, nunca semielaborado_id. Un semielaborado no puede ser la línea de un pedido de venta,
-- así que "rechazo de cliente" (que solo tiene sentido sobre algo que el cliente compró) no aplica a
-- ajustes_semielaborado. Confirmado también por el propio botón "Declarar rechazo de cliente" en
-- AlbaranesVenta.jsx, que solo se renderiza sobre líneas de producto final.
--
-- `linea_pedido_origen_id` (nueva): a diferencia de incidencias_stock_*, ajustes_producto_final solo
-- referencia el lote de producción (`produccion_pf_id`), no la línea de pedido/albarán concreta que
-- se está rechazando -- necesaria para que la RPC de resolución sepa a qué pedido añadir la línea de
-- reenvío. Se rellena desde el frontend al declarar el rechazo desde AlbaranesVenta.jsx (la única
-- pantalla que declara rechazos de cliente, y la única con esa línea en contexto).
alter table ajustes_producto_final
  add column if not exists tipo_resolucion text
    check (tipo_resolucion in ('abono', 'reenvio', 'descarte')),
  add column if not exists linea_pedido_origen_id bigint references lineas_pedido_venta(id),
  add column if not exists linea_pedido_reposicion_id bigint references lineas_pedido_venta(id);

-- Paso 4.1 (auditoría obligatoria, ver hallazgos completos más abajo): actualizar_estado_pedido_por_servicio()
-- solo se dispara con cambios en lineas_albaran_venta -- insertar una línea de reenvío directamente en
-- lineas_pedido_venta (sin albarán todavía) no la dispara, así que un pedido que ya estaba 'servido' se
-- quedaría marcado 'servido' aunque ahora tenga una línea pendiente de servir. Se extrae el cálculo a una
-- función propia para reutilizarlo desde la nueva RPC sin duplicar el CASE -- refactor puro, mismo
-- comportamiento para el trigger existente.
create or replace function public.recalcular_estado_pedido_venta(p_pedido_id bigint)
returns void
language plpgsql
as $$
declare
  v_pedido numeric;
  v_servido numeric;
  v_en_produccion boolean;
begin
  -- Mismo capado least() que en actualizar_estado_pedido_compra() -- ver comentario allí.
  select
    sum(lp.cantidad),
    sum(least(lp.cantidad, coalesce((select sum(cantidad) from lineas_albaran_venta where linea_pedido_id = lp.id), 0)))
  into v_pedido, v_servido
  from lineas_pedido_venta lp
  where lp.pedido_id = p_pedido_id;

  select exists (
    select 1 from producciones_producto_final where pedido_id = p_pedido_id
  ) into v_en_produccion;

  update pedidos_venta
  set estado = case
    when v_servido >= v_pedido then 'servido'
    when v_servido > 0 then 'parcial'
    when v_en_produccion then 'en_produccion'
    else 'pendiente'
  end
  where id = p_pedido_id and estado <> 'cancelado';
end;
$$;

create or replace function public.actualizar_estado_pedido_por_servicio()
returns trigger
language plpgsql
as $$
declare
  v_pedido_id bigint;
begin
  select pedido_id into v_pedido_id
  from lineas_pedido_venta
  where id = coalesce(NEW.linea_pedido_id, OLD.linea_pedido_id);

  if v_pedido_id is null then
    return coalesce(NEW, OLD);
  end if;

  perform recalcular_estado_pedido_venta(v_pedido_id);
  return coalesce(NEW, OLD);
end;
$$;

-- Paso 4.3: RPC de resolución. SECURITY INVOKER (por defecto, igual que necesidades_pedidos_cascada
-- y el resto de funciones de este módulo) -- hereda el RLS de "Acceso total temporal" de
-- ajustes_producto_final/lineas_pedido_venta/pedidos_venta (todas scoped a negocio_actual()), y
-- además valida explícitamente el negocio del ajuste, como pide el contrato.
create or replace function public.resolver_rechazo_cliente(p_ajuste_id bigint, p_tipo_resolucion text)
returns bigint
language plpgsql
as $$
declare
  v_ajuste ajustes_producto_final%rowtype;
  v_linea_origen lineas_pedido_venta%rowtype;
  v_nueva_linea_id bigint;
begin
  if p_tipo_resolucion not in ('abono', 'reenvio', 'descarte') then
    raise exception 'tipo_resolucion inválido: %', p_tipo_resolucion;
  end if;

  select * into v_ajuste from ajustes_producto_final where id = p_ajuste_id;
  if not found then
    raise exception 'Ajuste % no encontrado', p_ajuste_id;
  end if;

  if v_ajuste.negocio_id <> negocio_actual() then
    raise exception 'Ajuste % no pertenece al negocio activo', p_ajuste_id;
  end if;

  if v_ajuste.origen_rechazo is distinct from 'cliente' then
    raise exception 'El ajuste % no es un rechazo de cliente (origen_rechazo=%)', p_ajuste_id, v_ajuste.origen_rechazo;
  end if;

  if v_ajuste.tipo_resolucion is not null then
    raise exception 'El ajuste % ya tiene una resolución (%)', p_ajuste_id, v_ajuste.tipo_resolucion;
  end if;

  if p_tipo_resolucion = 'reenvio' then
    if v_ajuste.linea_pedido_origen_id is null then
      raise exception 'El ajuste % no tiene línea de pedido de origen -- no se puede reenviar', p_ajuste_id;
    end if;

    select * into v_linea_origen from lineas_pedido_venta where id = v_ajuste.linea_pedido_origen_id;
    if not found then
      raise exception 'Línea de pedido de origen % no encontrada', v_ajuste.linea_pedido_origen_id;
    end if;

    -- Misma cantidad rechazada (ajuste.cantidad es negativo, ver AjusteStockForm.jsx), mismo
    -- producto y mismo precio que la línea original -- una nueva línea "pendiente" dentro del MISMO
    -- pedido, no un pedido nuevo: reutiliza el modelo de estados parciales ya existente
    -- (pedidos_venta.estado se recalcula justo abajo) en vez de duplicarlo, como pedía el contrato.
    -- `descripcion` se deja NULL a propósito: chk_lineas_pedido_un_origen exige que sea NULL cuando
    -- producto_final_id va relleno (línea de producto, no línea libre) -- la trazabilidad de que esta
    -- línea nace de un reenvío vive en ajustes_producto_final.linea_pedido_reposicion_id, no aquí.
    insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    values (
      v_linea_origen.pedido_id, v_linea_origen.producto_final_id, abs(v_ajuste.cantidad),
      v_linea_origen.precio_unitario, v_ajuste.negocio_id
    )
    returning id into v_nueva_linea_id;

    update ajustes_producto_final
    set tipo_resolucion = p_tipo_resolucion, linea_pedido_reposicion_id = v_nueva_linea_id
    where id = p_ajuste_id;

    perform recalcular_estado_pedido_venta(v_linea_origen.pedido_id);
  else
    update ajustes_producto_final
    set tipo_resolucion = p_tipo_resolucion
    where id = p_ajuste_id;
  end if;

  return v_nueva_linea_id;
end;
$$;

grant execute on function public.resolver_rechazo_cliente(bigint, text) to authenticated;

-- Parte C: historial_ajustes_stock necesita el id del lote/producción de origen (`origen_id`, unifica
-- produccion_pf_id/produccion_id/entrada_material_id bajo un nombre común, mismo patrón que
-- `referencia` en vista_incidencias_stock) para que BadgeScrap.jsx pueda filtrar por lote/tanda
-- concreta en Producciones.jsx/ProduccionProductosFinales.jsx/AlbaranesVenta.jsx -- `item_id` (ya
-- existente) identifica el producto/semielaborado, no el lote. Se añaden también las 3 columnas
-- nuevas de resolución para que AjustesStock.jsx pueda ofrecer el mismo flujo de resolución sobre
-- cualquier rechazo de cliente pendiente, no solo el que se acaba de declarar.
--
-- CREATE OR REPLACE VIEW solo admite añadir columnas al final (ver aviso ya dejado en
-- 20261024_origen_rechazo_ajustes.sql) -- origen_id/linea_pedido_origen_id/linea_pedido_reposicion_id/
-- tipo_resolucion van después de origen_rechazo, no en medio.
create or replace view historial_ajustes_stock as
select
  'articulo'::text as tipo,
  aa.id,
  aa.articulo_id as item_id,
  ac.nombre as item_nombre,
  ac.unidad,
  aa.cantidad,
  aa.motivo,
  aa.fecha,
  aa.user_id,
  aa.user_email,
  aa.negocio_id,
  null::text as motivo_categoria,
  null::text as origen_rechazo,
  aa.entrada_material_id as origen_id,
  null::bigint as linea_pedido_origen_id,
  null::bigint as linea_pedido_reposicion_id,
  null::text as tipo_resolucion
from ajustes_articulo aa
join articulos_compra ac on ac.id = aa.articulo_id

union all

select
  'semielaborado'::text as tipo,
  as_.id,
  as_.semielaborado_id as item_id,
  s.nombre as item_nombre,
  s.unidad,
  as_.cantidad,
  as_.motivo,
  as_.fecha,
  as_.user_id,
  as_.user_email,
  as_.negocio_id,
  null::text as motivo_categoria,
  as_.origen_rechazo,
  as_.produccion_id as origen_id,
  null::bigint as linea_pedido_origen_id,
  null::bigint as linea_pedido_reposicion_id,
  null::text as tipo_resolucion
from ajustes_semielaborado as_
join semielaborados s on s.id = as_.semielaborado_id

union all

select
  'producto_final'::text as tipo,
  apf.id,
  ppf.producto_final_id as item_id,
  pf.nombre as item_nombre,
  'ud'::text as unidad,
  apf.cantidad,
  apf.motivo_detalle as motivo,
  apf.fecha,
  apf.user_id,
  apf.user_email,
  apf.negocio_id,
  apf.motivo_categoria::text as motivo_categoria,
  apf.origen_rechazo,
  apf.produccion_pf_id as origen_id,
  apf.linea_pedido_origen_id,
  apf.linea_pedido_reposicion_id,
  apf.tipo_resolucion
from ajustes_producto_final apf
join producciones_producto_final ppf on ppf.id = apf.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id;

-- CRÍTICO (mismo aviso que 20260907/20261024): CREATE OR REPLACE VIEW resetea en silencio el
-- reloption security_invoker a false/null en cada reemplazo.
alter view historial_ajustes_stock set (security_invoker = true);

grant select on historial_ajustes_stock to authenticated;
