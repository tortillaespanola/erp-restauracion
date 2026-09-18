-- CONTRATO_DEMO.md: identificación inequívoca del tenant demo + estructuras de control para el
-- ciclo de vida de una sesión DEMO (snapshot al iniciar, revert al expirar/salir).
--
-- Existen DOS filas en `negocios` con el mismo nombre "AlpenWerk Möbel GmbH": una huérfana
-- vacía y la real (codigo_corto = 'ALP', la que tiene datos y el usuario vinculado). Resolver
-- el tenant demo por nombre sería ambiguo; en vez de enterrar el UUID real como literal dentro
-- de las funciones de iniciar_demo()/revertir_demo() (20261029), se marca explícitamente con un
-- flag, resuelto aquí una sola vez por codigo_corto (mismo patrón que
-- 20260915_alpenwerk_usuario_vinculacion.sql) y consultado desde las funciones.
alter table negocios add column es_demo boolean not null default false;

update negocios set es_demo = true where codigo_corto = 'ALP';

-- Blindaje: si alguna vez se marcara una segunda fila como demo por error, esto lo impide a
-- nivel de base de datos en vez de depender de que nadie se equivoque -- toda la lógica de
-- resolución del tenant demo asume "select id from negocios where es_demo" devuelve como mucho
-- una fila.
create unique index one_demo_negocio on negocios (es_demo) where es_demo;

-- Espejo de las 44 tablas tenant-scoped en el momento exacto de iniciar_demo(). Sin permisos
-- para authenticated/anon: es un detalle interno de iniciar_demo()/revertir_demo() (SECURITY
-- DEFINER), nunca se consulta directamente desde PostgREST. Las tablas dentro de este esquema
-- se crean y destruyen dinámicamente (drop + create table ... as select) en cada sesión, no se
-- predefinen aquí, para no arrastrar una copia de la estructura de columnas que quede
-- desincronizada si las tablas reales cambian con el tiempo.
create schema if not exists demo_snapshot;

-- Registro de sesiones DEMO. Nunca se expone vía PostgREST (RLS activado, cero políticas, cero
-- grants a authenticated/anon): el frontend recibe sesion_id/expires_at como valor de retorno
-- de la llamada RPC a iniciar_demo(), no consultando esta tabla.
create table demo_sesiones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reverted_at timestamptz,
  -- 'superseded': una sesión quedó abandonada (expiró sin revert) y fue sustituida por una
  -- sesión más nueva antes de que el cron llegara a revertirla -- revertir_demo() la marca así
  -- sin tocar datos, porque el revert real ya lo hace la sesión nueva. Ver 20261029.
  revert_reason text check (revert_reason in ('timeout', 'manual', 'cron_safety_net', 'superseded'))
);

alter table demo_sesiones enable row level security;
