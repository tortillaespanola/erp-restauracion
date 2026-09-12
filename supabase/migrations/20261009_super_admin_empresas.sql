-- CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 1: modelo de datos y permisos para que un usuario
-- super_admin pueda crear negocios nuevos desde el ERP, sin tocar Supabase a mano.
--
-- Auditoría previa (ver reporte de Fase 0 en la conversación): hoy no existe ninguna tabla de
-- perfiles ni columna de rol en todo el esquema -- los usuarios son auth.users directamente, y
-- su pertenencia a un negocio vive en usuarios_negocios (usuario_id, negocio_id), consultada por
-- negocio_actual(), que lanza excepción si el usuario no tiene ninguna fila ahí.
--
-- Decisión de modelo (confirmada con el usuario): tabla `super_admins` nueva e independiente,
-- NO una columna en usuarios_negocios. Un super_admin "no pertenece a ningún negocio en
-- particular" (premisa explícita del contrato) -- forzarlo dentro de usuarios_negocios habría
-- exigido relajar su PK compuesta (negocio_id ya no NOT NULL) y tocar negocio_actual() para no
-- reventar con un super_admin sin fila de pertenencia. Una tabla aparte no toca nada de eso: un
-- super_admin puede seguir sin ninguna fila en usuarios_negocios, negocio_actual() sigue
-- intacto, y las pantallas normales del ERP (que sí dependen de negocio_actual()) simplemente no
-- son el terreno de un super_admin -- la Fase 4 lo redirige a /admin/empresas en vez de dejar que
-- reviente ahí.
create table super_admins (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table super_admins enable row level security;

-- Solo lectura de la propia fila -- necesaria para que el frontend pueda preguntar "¿soy
-- super_admin?" sin exponer qué otros usuarios lo son (mismo criterio que usuarios_negocios: un
-- SELECT sin esta restricción permitiría enumerar todos los super_admins del sistema).
create policy "Ver la propia condición de super_admin" on super_admins
  for select
  using (usuario_id = (select auth.uid()));

grant select on super_admins to authenticated;
-- Sin policy de INSERT/UPDATE/DELETE para authenticated a propósito: conceder o revocar
-- super_admin es un acto administrativo de altísimo privilegio (equivalente a poder crear
-- negocios enteros), igual que hoy dar de alta una fila de usuarios_negocios -- solo por
-- conexión de superusuario/SQL directo, nunca desde la app ni siquiera por otro super_admin.

-- language sql (no plpgsql): solo un EXISTS, sin ninguna rama que justifique plpgsql.
-- stable: mismo criterio que negocio_actual()/auth.uid() -- permite que Postgres trate
-- es_super_admin() como una constante por consulta (InitPlan) en las policies que la usan.
-- security invoker (por defecto, se omite explícito): la policy de arriba ya permite exactamente
-- esta misma consulta (usuario_id = auth.uid()) -- security definer no saltaría ningún muro
-- real, solo añadiría superficie de ataque sin ganar nada. Mismo razonamiento ya usado en
-- negocio_actual().
create or replace function public.es_super_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from super_admins where usuario_id = auth.uid());
$$;

grant execute on function public.es_super_admin() to authenticated;

-- ============================================================
-- RLS de negocios: hoy solo tiene 1 policy (SELECT de la propia fila, vía negocio_actual()) y
-- ningún INSERT -- ni un usuario normal ni ningún "admin" puede crear un negocio desde el
-- cliente hoy. Un super_admin necesita ver TODOS los negocios (no solo el suyo) y poder crear
-- uno nuevo.
-- ============================================================

-- Se sustituye la policy de lectura para dejar de depender de negocio_actual(): esa función
-- lanza excepción si el usuario no tiene fila en usuarios_negocios -- exactamente el caso de un
-- super_admin. Una excepción lanzada durante la evaluación de UNA policy aborta toda la consulta
-- entera, sin importar que otra policy permisiva (como la de super_admin, más abajo) hubiera
-- concedido acceso igualmente -- Postgres no puede "descartar" una policy que reventó a mitad de
-- evaluación. La reescritura de abajo resuelve la misma pertenencia consultando usuarios_negocios
-- directamente (nunca lanza), en vez de reutilizar negocio_actual().
drop policy "Lectura del propio negocio" on negocios;

create policy "Lectura del propio negocio" on negocios for select
  using (
    (select auth.role()) = 'authenticated'
    and id in (select negocio_id from usuarios_negocios where usuario_id = (select auth.uid()))
  );

-- Policy permisiva adicional (se combina con la de arriba mediante OR, comportamiento estándar
-- de múltiples policies permisivas para el mismo comando): un super_admin ve además cualquier
-- negocio, no solo el suyo (que además, por diseño, no tiene).
create policy "Super admin ve todos los negocios" on negocios for select
  using ((select auth.role()) = 'authenticated' and (select public.es_super_admin()));

create policy "Super admin crea negocios" on negocios for insert
  with check ((select auth.role()) = 'authenticated' and (select public.es_super_admin()));

grant insert on negocios to authenticated;

-- ============================================================
-- RLS de usuarios_negocios: hoy sin policy de INSERT -- un super_admin necesita poder dar de
-- alta la pertenencia del usuario admin recién creado para el negocio nuevo.
-- ============================================================
create policy "Super admin da de alta pertenencias" on usuarios_negocios for insert
  with check ((select auth.role()) = 'authenticated' and (select public.es_super_admin()));

grant insert on usuarios_negocios to authenticated;

-- Nota: la Edge Function de la Fase 2 usa la service_role key (bypassa RLS por completo), así
-- que estas dos policies de INSERT no son la vía real por la que se crean negocios/pertenencias
-- -- son defensa en profundidad, para que ni siquiera un intento de INSERT directo desde el
-- cliente (sin pasar por la función) pueda crear un negocio o una pertenencia sin ser
-- super_admin. Mismo criterio ya aplicado en todo este proyecto: RLS es el muro real, no la
-- disciplina del frontend.
