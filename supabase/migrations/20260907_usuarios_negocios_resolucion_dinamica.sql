-- CONTRATO_MULTITENANT.md, Tarea 1: mecanismo de resolución dinámica del negocio.
--
-- Hasta ahora las 42 policies "Acceso total temporal" comparan negocio_id contra un UUID fijo
-- grabado en la propia policy -- funcional para un único negocio, pero no resuelve nada por
-- usuario. Esta migración construye el mecanismo (tabla de pertenencia + función), sin tocar
-- todavía ninguna de esas 42 policies -- eso es la Tarea 2, deliberadamente aparte para no
-- mezclar el riesgo de tocar 42 tablas de negocio real con el de construir el mecanismo nuevo.
--
-- Enfoque elegido (frente al custom claim en JWT, la otra opción evaluada): tabla de
-- pertenencia `usuarios_negocios`, porque deja abierta la posibilidad de que un usuario
-- pertenezca a más de un negocio en el futuro sin rediseñar nada -- solo añadir una columna
-- `activo` a esta misma tabla el día que haga falta dejar elegir (ver más abajo).
--
-- Probado exhaustivamente en BEGIN...ROLLBACK antes de aplicar esto en firme -- caso feliz,
-- caso sin membresía (huérfano) y caso de varios negocios -- ver feedback_test_rls_authenticated.md
-- para el patrón de prueba reutilizable (simular auth real, no solo SET LOCAL ROLE).

create table usuarios_negocios (
  id bigint generated always as identity,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usuario_id, negocio_id)
);

-- Punto de extensión ya anticipado (no implementado ahora, sin caso de uso real todavía):
-- el día que un usuario deba poder elegir entre varios negocios, añadir aquí una columna
-- `activo boolean not null default false` y hacer que negocio_actual() mire primero
-- `where usuario_id = auth.uid() and activo` antes de caer al criterio de más abajo --
-- así un usuario que nunca ha elegido (o que solo pertenece a uno) sigue funcionando igual,
-- sin migración de datos necesaria. Deliberadamente no es un custom claim de JWT -- rompería
-- la razón por la que se eligió esta tabla en primer lugar.

-- Índice de apoyo para la resolución determinista "el más antiguo" (ver negocio_actual): created_at
-- por sí solo no es fiable como desempate porque varias filas insertadas en la misma transacción
-- comparten el mismo now() -- `id` (identity, estrictamente monótono) desempata sin ambigüedad.
create index idx_usuarios_negocios_resolucion on usuarios_negocios (usuario_id, created_at, id);

alter table usuarios_negocios enable row level security;

-- Auto-restringida, no "Acceso total temporal": un usuario ve únicamente su propia fila de
-- pertenencia, nunca la de otro -- si no, cualquier autenticado podría enumerar qué otros
-- usuarios/negocios existen en el sistema con un simple SELECT.
-- (select auth.uid()) envuelto en select, no auth.uid() a secas: mismo motivo de rendimiento
-- que se aplicará en la Tarea 2 a las 42 policies (InitPlan cacheado una vez por consulta en
-- vez de reevaluado fila a fila) -- se aplica aquí también por consistencia desde el principio.
create policy "Ver la propia pertenencia" on usuarios_negocios
  for select
  using (usuario_id = (select auth.uid()));

-- Solo SELECT para authenticated -- el alta de pertenencia es un acto administrativo (backfill
-- de esta misma migración hoy, un futuro flujo de alta de usuario mañana), no algo que el
-- frontend deba poder escribir por sí mismo todavía.
grant select on usuarios_negocios to authenticated;

-- language plpgsql (no sql): hace falta la rama IF/RAISE del caso "sin membresía" -- ver más abajo.
-- stable: mismo criterio que auth.uid()/auth.role() (verificado en vivo que ambas lo son) -- es lo
-- que permite que Postgres trate negocio_id = (select negocio_actual()) como una constante por
-- consulta en las 42 tablas de la Tarea 2, en vez de reevaluarla fila a fila.
-- security invoker (el valor por defecto, se omite explícito): la policy de arriba ya permite
-- exactamente esta misma consulta (usuario_id = auth.uid()) -- security definer no saltaría
-- ningún muro real, solo añadiría superficie de ataque sin ganar nada.
create or replace function public.negocio_actual()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id
  from public.usuarios_negocios
  where usuario_id = auth.uid()
  order by created_at asc, id asc
  limit 1;

  -- Nunca NULL en silencio ni un negocio arbitrario: un usuario sin fila de pertenencia debe
  -- fallar de forma ruidosa (toda consulta a cualquiera de las 42 tablas, una vez reescritas en
  -- la Tarea 2, devolverá este error) -- la alternativa (devolver NULL) haría que ese usuario
  -- viera la app completamente vacía en todas partes sin ningún error visible, indistinguible de
  -- "no hay datos". Implica que cualquier alta de usuario futura debe crear esta fila de forma
  -- atómica con el usuario -- hoy es de alta manual (1 usuario), no es urgente resolverlo aquí.
  if v_negocio_id is null then
    raise exception 'negocio_actual(): el usuario % no tiene ninguna fila en usuarios_negocios', auth.uid();
  end if;

  return v_negocio_id;
end;
$$;

grant execute on function public.negocio_actual() to authenticated;

-- Backfill de una sola vez para el estado de partida real de este contrato (1 usuario, 1
-- negocio) -- un cross join de "todos los usuarios" contra "todos los negocios" sería incorrecto
-- en cuanto exista un segundo negocio real. Esto NO es el mecanismo de alta de usuarios futuro
-- (eso es la Tarea 5 del contrato, o un flujo de administración aparte) -- es un backfill
-- histórico, no reutilizable tal cual. `on conflict do nothing` lo hace seguro de reintentar.
insert into usuarios_negocios (usuario_id, negocio_id)
select u.id, n.id
from auth.users u
cross join negocios n
on conflict (usuario_id, negocio_id) do nothing;
