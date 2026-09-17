-- =====================================================================
-- AUDITORÍA COMPLEMENTARIA — CONTRATO_RLS_MULTITENANT.md
-- Script de SOLO LECTURA. Continúa la numeración de
-- audit_rls_multitenant.sql (secciones 1-7). Requiere permisos de
-- lectura sobre auth.users (service_role o rol postgres) para la
-- sección 8 — con el rol "authenticated" estándar esa sección fallará.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8. Usuarios y claims (auth.users)
-- ---------------------------------------------------------------------

-- 8a. Total de usuarios
SELECT count(*) AS total_usuarios FROM auth.users;

-- 8b. Cuántos ya tienen negocio_id en app_metadata (o en el top-level
--     de raw_app_meta_data, que es lo que alimenta el claim app_metadata)
SELECT
  count(*) FILTER (WHERE raw_app_meta_data ? 'negocio_id') AS con_negocio_id,
  count(*) FILTER (WHERE NOT (raw_app_meta_data ? 'negocio_id')) AS sin_negocio_id
FROM auth.users;

-- 8c. Detalle por usuario (id, email, negocio_id resuelto, metadata completa)
SELECT
  id,
  email,
  raw_app_meta_data ->> 'negocio_id' AS negocio_id_claim,
  raw_app_meta_data,
  created_at
FROM auth.users
ORDER BY created_at;

-- 8d. Valores distintos de negocio_id encontrados entre los usuarios
SELECT
  raw_app_meta_data ->> 'negocio_id' AS negocio_id_claim,
  count(*) AS usuarios
FROM auth.users
GROUP BY raw_app_meta_data ->> 'negocio_id'
ORDER BY usuarios DESC;

-- ---------------------------------------------------------------------
-- 9. empresa_config — ¿cuántas filas y con qué negocio_id?
-- ---------------------------------------------------------------------

-- 9a. Contenido completo (tabla pequeña por diseño)
SELECT * FROM public.empresa_config;

-- 9b. Resumen: total de filas vs. filas con negocio_id no nulo vs.
--     negocios distintos representados
SELECT
  count(*) AS total_filas,
  count(negocio_id) AS filas_con_negocio_id,
  count(DISTINCT negocio_id) AS negocios_distintos
FROM public.empresa_config;

-- ---------------------------------------------------------------------
-- 10. Funciones en el esquema public con literales tipo UUID
--     hardcodeados en su definición (posibles asignaciones de
--     negocio_id fijas que el contrato debería contemplar)
-- ---------------------------------------------------------------------
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
ORDER BY p.proname;

-- ---------------------------------------------------------------------
-- 11. Triggers sobre las tablas con negocio_id, y la función que
--     invoca cada uno (para cruzar con los hallazgos de la sección 10
--     y confirmar si algún trigger propaga un UUID fijo)
-- ---------------------------------------------------------------------
SELECT
  t.event_object_table AS table_name,
  t.trigger_name,
  t.action_timing,
  t.event_manipulation,
  t.action_statement
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
  AND t.event_object_table IN (
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'negocio_id'
      AND c.table_schema = 'public'
  )
ORDER BY t.event_object_table, t.trigger_name;

-- ---------------------------------------------------------------------
-- 12. Vistas (y vistas materializadas) en public con literales tipo
--     UUID hardcodeados en su definición
-- ---------------------------------------------------------------------
SELECT
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE schemaname = 'public'
  AND definition ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

UNION ALL

SELECT
  schemaname,
  matviewname AS viewname,
  definition
FROM pg_matviews
WHERE schemaname = 'public'
  AND definition ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

ORDER BY viewname;
