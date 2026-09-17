-- =====================================================================
-- AUDITORÍA — CONTRATO_RLS_MULTITENANT.md
-- Script de SOLO LECTURA. No modifica esquema ni datos.
-- Objetivo: listar las ~42 tablas con negocio_id, su RLS actual, y el
-- estado de las secuencias globales antes de tocar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas con columna negocio_id: tipo, nullability, DEFAULT actual,
--    y si RLS está activado/forzado a nivel de tabla.
-- ---------------------------------------------------------------------
SELECT
  c.table_schema,
  c.table_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  t.relrowsecurity  AS rls_enabled,
  t.relforcerowsecurity AS rls_forced
FROM information_schema.columns c
JOIN pg_class t
  ON t.relname = c.table_name
JOIN pg_namespace n
  ON n.oid = t.relnamespace
 AND n.nspname = c.table_schema
WHERE c.column_name = 'negocio_id'
  AND c.table_schema = 'public'
ORDER BY c.table_name;

-- ---------------------------------------------------------------------
-- 2. Políticas RLS actuales para cada una de esas tablas
--    (nombre, permisiva/restrictiva, roles, comando, USING, WITH CHECK)
-- ---------------------------------------------------------------------
SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual        AS using_expression,
  p.with_check  AS with_check_expression
FROM pg_policies p
WHERE p.tablename IN (
  SELECT c.table_name
  FROM information_schema.columns c
  WHERE c.column_name = 'negocio_id'
    AND c.table_schema = 'public'
)
ORDER BY p.tablename, p.policyname;

-- ---------------------------------------------------------------------
-- 3. Tablas con negocio_id que NO tienen ninguna política RLS todavía
--    (posible hueco de seguridad a revisar antes de generalizar)
-- ---------------------------------------------------------------------
SELECT c.table_name
FROM information_schema.columns c
WHERE c.column_name = 'negocio_id'
  AND c.table_schema = 'public'
  AND c.table_name NOT IN (
    SELECT DISTINCT p.tablename FROM pg_policies p WHERE p.schemaname = 'public'
  )
ORDER BY c.table_name;

-- ---------------------------------------------------------------------
-- 4. Literales UUID hardcodeados detectados en el texto de las
--    políticas (USING / WITH CHECK) — para confirmar el patrón descrito
--    en el contrato ("negocio_id = 'xxxx...'::uuid").
-- ---------------------------------------------------------------------
SELECT
  p.tablename,
  p.policyname,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    p.qual ILIKE '%uuid%'
    OR p.with_check ILIKE '%uuid%'
  )
ORDER BY p.tablename, p.policyname;

-- ---------------------------------------------------------------------
-- 5. Estado de las restricciones (PK/UNIQUE) en las tablas de
--    secuencias globales mencionadas en el contrato
-- ---------------------------------------------------------------------
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('facturas_venta_secuencia', 'secuencias_lote')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
ORDER BY tc.table_name, tc.constraint_type;

-- ¿'facturas_venta_secuencia' y 'secuencias_lote' ya tienen columna negocio_id?
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('facturas_venta_secuencia', 'secuencias_lote')
ORDER BY table_name, ordinal_position;

-- ---------------------------------------------------------------------
-- 6. ¿Existe ya la función public.negocio_actual()?
-- ---------------------------------------------------------------------
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS returns,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'negocio_actual';

-- ---------------------------------------------------------------------
-- 7. Recuento aproximado de filas por tabla afectada (vía estadísticas
--    del planner, sin escanear las tablas), para dimensionar el
--    backfill y el riesgo antes de tocar nada.
-- ---------------------------------------------------------------------
SELECT
  s.relname AS table_name,
  s.n_live_tup AS filas_aprox
FROM pg_stat_user_tables s
WHERE s.schemaname = 'public'
  AND s.relname IN (
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'negocio_id'
      AND c.table_schema = 'public'
  )
ORDER BY s.n_live_tup DESC;
