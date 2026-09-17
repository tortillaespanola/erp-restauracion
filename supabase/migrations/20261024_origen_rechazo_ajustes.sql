-- CONTRATO_UI_INCIDENCIAS_STOCK.md, Parte B (Paso 4.5): desglose explícito de origen del
-- rechazo (cliente / inspección de calidad / producción aguas abajo / otro) sobre el mecanismo
-- de ajuste YA existente (AjusteStockForm.jsx + ajustes_producto_final/ajustes_semielaborado) --
-- campo nuevo, no mecanismo nuevo. No se toca ajustes_articulo: un artículo base no tiene
-- "producción de origen" de la que rechazar algo, el contrato lo excluye explícitamente.
--
-- Nullable a propósito, igual que motivo_categoria/motivo_detalle en su día -- la mayoría de
-- ajustes sobre semielaborado/producto_final siguen siendo correcciones rutinarias (peso mal
-- registrado, caducidad, evento no consumido) sin un "origen de rechazo" real que declarar; forzar
-- el campo obligaría a rellenar un valor sin sentido en esos casos.
alter table ajustes_producto_final
  add column if not exists origen_rechazo text
    check (origen_rechazo in ('cliente', 'inspeccion_calidad', 'produccion_aguas_abajo', 'otro'));

alter table ajustes_semielaborado
  add column if not exists origen_rechazo text
    check (origen_rechazo in ('cliente', 'inspeccion_calidad', 'produccion_aguas_abajo', 'otro'));

-- historial_ajustes_stock es la vista de lectura consumida por AjustesStock.jsx -- se recrea
-- añadiendo origen_rechazo a las 3 ramas del UNION ALL (null en articulo, que no tiene la
-- columna).
--
-- IMPORTANTE (ver aviso ya dejado en 20260907_i18n_idioma_moneda.sql, líneas 53-72): el archivo
-- 20260927_ajustes_stock_usuario_historial.sql NUNCA fue la versión realmente aplicada -- la
-- definición viva de verdad es la de 20260907 (sin join a auth.users, user_email denormalizado en
-- cada tabla base, motivo_categoria como columna propia). Confirmado aquí de nuevo con
-- pg_get_viewdef() contra la base real antes de escribir esta versión, exactamente como pedía ese
-- aviso. Partir de cualquier archivo de migración para tocar esta vista sin pasar antes por
-- pg_get_viewdef() es lo que causó el primer intento fallido de esta misma migración (42P16
-- "cannot change data type of view column user_email from text to character varying(255)").
--
-- CREATE OR REPLACE VIEW solo admite añadir columnas al final -- origen_rechazo va después de
-- motivo_categoria, no en medio.
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
  null::text as origen_rechazo
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
  as_.origen_rechazo
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
  apf.origen_rechazo
from ajustes_producto_final apf
join producciones_producto_final ppf on ppf.id = apf.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id;

-- CRÍTICO (mismo aviso que 20260907): CREATE OR REPLACE VIEW resetea en silencio el reloption
-- security_invoker a false/null. Sin este ALTER explícito, esta vista volvería a evaluarse con los
-- privilegios del dueño de la vista en vez de con el RLS del usuario que consulta -- reabriría el
-- mismo bypass entre negocios que 20260907_security_invoker_vistas_stock.sql corrigió a propósito.
alter view historial_ajustes_stock set (security_invoker = true);

-- El GRANT sí se preserva a través de CREATE OR REPLACE VIEW (a diferencia del reloption de
-- arriba), pero se repite igualmente por si acaso -- es idempotente y barato.
grant select on historial_ajustes_stock to authenticated;
