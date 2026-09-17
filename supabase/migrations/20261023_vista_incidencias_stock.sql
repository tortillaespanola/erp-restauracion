-- CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte A: pantalla de Incidencias. Auditoría de esquema
-- (Paso 4.1, obligatoria según el propio contrato) confirmó que NO existe una tabla única
-- `incidencias_stock` -- existen 4 tablas separadas, generadas por triggers (nunca por el
-- usuario, ninguna tiene user_id):
--   - incidencias_stock_articulo / _semielaborado / _producto_final: detección de stock
--     negativo o caducidad al consumir/vender, motivo/estado ya con CHECK
--     ('pendiente'|'regularizado'|'ignorado').
--   - incidencias_reparto_pedido: discrepancia entre lo esperado y lo repartido de un pedido.
-- Las 4 YA tienen el ciclo de vida de revisión que pedía el contrato (columna `estado`) -- no
-- hace falta ninguna migración de tipo Paso 4.2 (`revisada`/`revisada_por`/`revisada_en`), solo
-- la vista de lectura unificada (Paso 4.3) y la pantalla (Paso 4.4, aparte).
--
-- Igual que historial_ajustes_stock (20260927_ajustes_stock_usuario_historial.sql), se unifican
-- con UNION ALL bajo un discriminador `tipo`, sin tocar las tablas base. `id` + `tipo` identifican
-- unívocamente la fila de origen (necesario para poder marcarla como revisada sabiendo a qué
-- tabla pertenece, ver Paso 4.4 -- exactamente el mismo patrón que ya usa AjustesStock.jsx para
-- borrar). No se expone filtro por "usuario que la registró" (a diferencia de lo que pedía el
-- contrato original): no aplica, estas filas no las da de alta ningún usuario.
--
-- No es una vista actualizable (UNION ALL de 4 relaciones) -- el frontend hace UPDATE directo
-- sobre la tabla base según `tipo`, protegido por las mismas políticas RLS de "Acceso total
-- temporal" que ya tienen las 4 tablas (ya confirmadas: ALL commands, scoped a negocio_actual()).
create or replace view public.vista_incidencias_stock as
select
  'stock_articulo'::text as tipo,
  i.id,
  i.negocio_id,
  i.motivo,
  i.estado,
  i.nota,
  ac.nombre as item_nombre,
  ac.unidad as item_unidad,
  i.cantidad_negativa as cantidad,
  coalesce(em.codigo_lote, 'EM-' || i.entrada_material_id::text) as referencia,
  i.detectada_en,
  i.created_at
from incidencias_stock_articulo i
join entrada_material em on em.id = i.entrada_material_id
join articulos_compra ac on ac.id = em.articulo_id

union all

select
  'stock_semielaborado'::text,
  i.id,
  i.negocio_id,
  i.motivo,
  i.estado,
  i.nota,
  s.nombre,
  s.unidad,
  i.cantidad_negativa,
  coalesce(ps.codigo_lote, 'PROD-' || i.produccion_semielaborado_id::text),
  i.detectada_en,
  i.created_at
from incidencias_stock_semielaborado i
join producciones_semielaborado ps on ps.id = i.produccion_semielaborado_id
join semielaborados s on s.id = ps.semielaborado_id

union all

select
  'stock_producto_final'::text,
  i.id,
  i.negocio_id,
  i.motivo,
  i.estado,
  i.nota,
  pf.nombre,
  'ud'::text,
  i.cantidad_negativa,
  coalesce(ppf.codigo_lote, 'PROD-' || i.produccion_pf_id::text),
  i.detectada_en,
  i.created_at
from incidencias_stock_producto_final i
join producciones_producto_final ppf on ppf.id = i.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id

union all

select
  'reparto_pedido'::text,
  i.id,
  i.negocio_id,
  i.motivo,
  i.estado,
  i.nota,
  pf.nombre,
  'ud'::text,
  null::numeric,
  coalesce(pv.codigo_pedido, 'PED-' || coalesce(i.pedido_real_id, i.pedido_esperado_id)::text),
  i.detectada_en,
  i.created_at
from incidencias_reparto_pedido i
join producciones_producto_final ppf on ppf.id = i.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id
left join pedidos_venta pv on pv.id = coalesce(i.pedido_real_id, i.pedido_esperado_id);

-- Una vista nueva no hereda privilegios de las tablas base (mismo gotcha documentado en
-- 20260927_ajustes_stock_usuario_historial.sql / 20260914_grant_previsiones_distribucion_pf.sql)
-- -- sin este GRANT, la pantalla fallaría con 42501 silenciosamente disfrazado de "sin resultados".
grant select on public.vista_incidencias_stock to authenticated;

-- CORRECCIÓN post-aplicación (detectado al preparar 20261024, ver su propio comentario sobre
-- security_invoker): esta migración se aplicó originalmente SIN este ALTER. El propietario de la
-- vista (postgres) tiene rolbypassrls=true -- sin security_invoker=true, la vista se evalúa con
-- los privilegios del propietario y NO aplica el RLS de negocio_actual() del usuario que consulta,
-- exponiendo incidencias de todos los negocios a través de esta vista. Mismo bypass ya corregido
-- una vez en 20260907_security_invoker_vistas_stock.sql -- confirmar siempre este reloption tras
-- cualquier CREATE OR REPLACE VIEW sobre datos particionados por negocio_id.
alter view public.vista_incidencias_stock set (security_invoker = true);
