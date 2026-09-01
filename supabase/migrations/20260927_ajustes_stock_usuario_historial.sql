-- CONTRATO_AJUSTE_RAPIDO_INVENTARIO.md: trazabilidad de usuario en los 3 ajustes de stock +
-- vista de historial unificado para la Parte B (AjustesStock.jsx rediseñada como tabla de
-- movimientos, filtrable y paginable, en vez de 3 queries fusionadas en cliente).

-- ============================================================
-- 1. user_id en las 3 tablas de ajuste
-- ============================================================
-- Nullable a propósito: los ajustes ya existentes no tienen autor conocido (la tabla nunca
-- tuvo esta columna), no hay forma correcta de backfillearlos. Los nuevos se autocompletan solos
-- vía default auth.uid() -- el frontend no necesita mandar este campo en el insert.
alter table ajustes_articulo add column user_id uuid references auth.users(id) default auth.uid();
alter table ajustes_semielaborado add column user_id uuid references auth.users(id) default auth.uid();
alter table ajustes_producto_final add column user_id uuid references auth.users(id) default auth.uid();

-- ============================================================
-- 2. Vista de historial unificado
-- ============================================================
-- Normaliza las 3 tablas (esquemas distintos: motivo texto libre en artículo/semielaborado vs.
-- motivo_categoria + motivo_detalle en producto_final -- decisión explícita del contrato de NO
-- unificar el esquema de motivo en las tablas base, solo aquí en la vista de lectura) a una única
-- fila por movimiento. `tipo` + `id` identifican unívocamente la fila de origen (necesario para
-- poder borrar un ajuste desde el histórico sabiendo a qué tabla pertenece).
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
  u1.email as user_email,
  aa.negocio_id
from ajustes_articulo aa
join articulos_compra ac on ac.id = aa.articulo_id
left join auth.users u1 on u1.id = aa.user_id

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
  u2.email as user_email,
  as_.negocio_id
from ajustes_semielaborado as_
join semielaborados s on s.id = as_.semielaborado_id
left join auth.users u2 on u2.id = as_.user_id

union all

select
  'producto_final'::text as tipo,
  apf.id,
  ppf.producto_final_id as item_id,
  pf.nombre as item_nombre,
  'ud'::text as unidad,
  apf.cantidad,
  -- Mismo mapeo categoría → etiqueta que usaba AjustesStock.jsx en cliente (MOTIVO_CATEGORIA_LABEL),
  -- trasladado aquí para que "motivo" sea una columna de texto homogénea en toda la vista.
  (case apf.motivo_categoria
    when 'caducado' then 'Caducado'
    when 'roto' then 'Roto'
    when 'evento_no_consumido' then 'Evento no consumido'
    else 'Otro'
  end) || coalesce(' — ' || apf.motivo_detalle, '') as motivo,
  apf.fecha,
  apf.user_id,
  u3.email as user_email,
  apf.negocio_id
from ajustes_producto_final apf
join producciones_producto_final ppf on ppf.id = apf.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id
left join auth.users u3 on u3.id = apf.user_id;

-- GRANT y RLS son capas independientes (ver feedback_test_rls_authenticated / incidente ya
-- documentado en 20260914_grant_previsiones_distribucion_pf.sql) -- una vista nueva no hereda
-- privilegios de las tablas base, hay que concedérselos explícitamente o toda consulta desde el
-- frontend falla con 42501 "permission denied", silenciosamente confundible con "sin resultados".
-- Solo `authenticated`: confirmado que AuthGate envuelve toda la app en main.jsx, no hay ninguna
-- ruta que consulte Supabase como `anon` -- concedérselo también sería ruido sin caso de uso real.
grant select on historial_ajustes_stock to authenticated;

-- ============================================================
-- 3. Documentación de comportamiento verificado (diagnóstico de esta misma sesión, contra
--    information_schema.triggers/pg_proc en la base real -- ver también PENDIENTES_MODELO.md,
--    sección "Notas de diseño confirmadas", y entrada 11 del mismo documento)
-- ============================================================
comment on view historial_ajustes_stock is
$doc$Un ajuste (INSERT en ajustes_articulo / ajustes_semielaborado / ajustes_producto_final) no
modifica registros de producción o consumo existentes -- es una escritura hoja, sin triggers
propios. Sin embargo, SÍ afecta el cálculo de 'disponible' que leen check_consumo_produccion,
check_consumo_produccion_pf, check_stock_producto_final y los triggers de incidencias_stock_* la
próxima vez que se intente consumir o vender de ese nivel. El efecto es retardado (se manifiesta
en la siguiente operación que lea el stock), no inmediato en el momento del ajuste.$doc$;
