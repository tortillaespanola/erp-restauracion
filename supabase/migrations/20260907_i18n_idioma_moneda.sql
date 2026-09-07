-- CONTRATO_I18N.md, Fase 0: idioma (por negocio, con override por usuario) y moneda real del
-- negocio, más la corrección de la duplicación de traducción de motivo_categoria encontrada en
-- 20260927_ajustes_stock_usuario_historial.sql.
--
-- ============================================================
-- 1. Idioma: default por negocio + override nullable por usuario
-- ============================================================
-- empresa_config.idioma: default del negocio (1:1 con el negocio, ya cargado por
-- NegocioProvider -- ver frontend/src/context/NegocioContext.jsx). 'es' para no cambiar el
-- comportamiento visible de ningún negocio existente hoy.
alter table empresa_config add column idioma text not null default 'es'
  constraint empresa_config_idioma_check check (idioma in ('es', 'en', 'de'));

-- usuarios_negocios.idioma: NULLABLE a propósito -- NULL significa "hereda el del negocio",
-- solo se rellena cuando un usuario cambia su idioma explícitamente desde el selector del
-- Layout, sin afectar a otros usuarios del mismo negocio.
alter table usuarios_negocios add column idioma text
  constraint usuarios_negocios_idioma_check check (idioma is null or idioma in ('es', 'en', 'de'));

-- Grant de columna, no de tabla: un usuario autenticado solo puede escribir su propio idioma,
-- nunca reasignarse a otro negocio ni tocar su propia fila de pertenencia de ninguna otra forma
-- -- usuarios_negocios hoy solo tenía GRANT SELECT (ver 20260907_usuarios_negocios_resolucion_
-- dinamica.sql), el alta/baja de pertenencia sigue siendo un acto administrativo. La policy de
-- fila de abajo por sí sola no bastaría: sin este GRANT restringido a la columna, un UPDATE
-- que sí cumpliera la policy de fila podría reescribir negocio_id de la propia fila.
grant update (idioma) on usuarios_negocios to authenticated;

create policy "Actualizar el propio idioma" on usuarios_negocios
  for update
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- ============================================================
-- 2. Moneda real del negocio
-- ============================================================
-- Bug corregido (no una decisión de diseño): varios sitios del frontend concatenaban " €" a mano
-- pese a que el negocio opera en Suiza -- confirmado por el usuario que CHF es la moneda correcta
-- para los dos negocios existentes (negocio A y Demo Catering Basel), € era un símbolo heredado
-- de una plantilla inicial. NOT NULL DEFAULT 'CHF' ya backfillea las filas existentes -- no hace
-- falta un UPDATE aparte.
alter table empresa_config add column moneda text not null default 'CHF';

-- ============================================================
-- 3. historial_ajustes_stock: quitar la traducción a español fija del CASE WHEN
-- ============================================================
-- CONTRATO_I18N.md, Fase 0, punto 2: la etiqueta de motivo_categoria ya estaba duplicada en dos
-- sitios (MOTIVO_CATEGORIA_LABEL en el frontend y este CASE WHEN) -- la BD debe devolver el valor
-- crudo del enum, el frontend traduce con t('enums:motivo_categoria.<clave>'). Se separa en una
-- columna propia (motivo_categoria, NULL para articulo/semielaborado, que no tienen este concepto)
-- en vez de seguir concatenándola dentro de `motivo` -- así el frontend puede traducir solo la
-- categoría sin tener que parsear un string ya compuesto.
--
-- CORRECCIÓN IMPORTANTE encontrada al probar esto en BEGIN...ROLLBACK: el archivo de migración
-- 20260927_ajustes_stock_usuario_historial.sql (fecha de nombre posterior, pero NO es la versión
-- realmente aplicada) quedó obsoleto sin que nadie lo marcara -- la definición que de verdad está
-- viva hoy es la de 20260907_denormalizar_user_email_historial_ajustes.sql (sin join a
-- auth.users, user_email denormalizado vía snapshot_user_email(), security_invoker=true). Un
-- CREATE OR REPLACE VIEW basado en el archivo de 20260927 falló en la prueba con "cannot change
-- data type of view column user_email from text to character varying(255)" -- confirmado con
-- pg_get_viewdef() contra la base real antes de escribir la versión de abajo. Los dos archivos de
-- migración siguen en el repo tal cual están (no se reescribe historial ya aplicado), pero
-- cualquier cambio futuro a esta vista debe partir de pg_get_viewdef(), no de leer el archivo con
-- la fecha más alta.
--
-- CREATE OR REPLACE VIEW admite añadir una columna al final sin romper nada que ya lea las
-- columnas existentes por nombre, y SÍ preserva el GRANT -- pero NO el reloption
-- security_invoker=true, que vuelve a null (equivalente a false) tras el reemplazo (confirmado
-- en la prueba en BEGIN...ROLLBACK). Sin el ALTER VIEW explícito de abajo, este cambio habría
-- reintroducido en silencio exactamente el bypass de RLS que
-- 20260907_security_invoker_vistas_stock.sql corrigió a propósito (una fila de negocio B volvía
-- a ser visible a través de la vista). Confirmar siempre este reloption tras cualquier futuro
-- CREATE OR REPLACE sobre una vista con security_invoker=true.
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
  null::text as motivo_categoria
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
  null::text as motivo_categoria
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
  apf.motivo_categoria::text as motivo_categoria
from ajustes_producto_final apf
join producciones_producto_final ppf on ppf.id = apf.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id;

alter view historial_ajustes_stock set (security_invoker = true);
