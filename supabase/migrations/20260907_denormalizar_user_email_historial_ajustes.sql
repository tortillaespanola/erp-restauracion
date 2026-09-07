-- CONTRATO_MULTITENANT.md, Tarea 2 (hallazgo derivado): historial_ajustes_stock hacía
-- LEFT JOIN a auth.users para resolver el email del autor de cada ajuste -- eso obliga a que
-- la vista siga corriendo con los privilegios de su propietario (bypassa RLS, ver la migración
-- de security_invoker que sigue a esta) porque `authenticated` no tiene SELECT sobre auth.users
-- (confirmado: "permission denied for table users" al intentar security_invoker=true sin este
-- cambio primero). Opción A elegida (frente a mantener security_invoker=false con un filtro
-- duplicado): eliminar el join, denormalizando un snapshot del email en el momento del ajuste.
--
-- Snapshot, no join en vivo: si el usuario cambia de email después, el histórico debe seguir
-- diciendo quién era en ese momento -- mismo criterio que el resto del proyecto usa para datos
-- ya cerrados (ej. el total de una factura, persistido y no recalculado).

alter table ajustes_articulo add column user_email text;
alter table ajustes_semielaborado add column user_email text;
alter table ajustes_producto_final add column user_email text;

-- security definer justificado aquí (a diferencia de negocio_actual()): `authenticated` no
-- tiene SELECT sobre auth.users, así que el propio insert del frontend fallaría sin este
-- privilegio elevado, acotado a leer un solo campo de una sola fila ya legítima (el propio
-- auth.uid() que generó el insert). BEFORE INSERT, no INSERT OR UPDATE: el snapshot se toma
-- una vez, nunca se refresca en una edición posterior del ajuste.
create or replace function public.snapshot_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.user_id is not null then
    select email into NEW.user_email from auth.users where id = NEW.user_id;
  end if;
  return NEW;
end;
$$;

create trigger trg_snapshot_user_email before insert on ajustes_articulo
  for each row execute function snapshot_user_email();
create trigger trg_snapshot_user_email before insert on ajustes_semielaborado
  for each row execute function snapshot_user_email();
create trigger trg_snapshot_user_email before insert on ajustes_producto_final
  for each row execute function snapshot_user_email();

-- Backfill de las filas ya existentes con user_id conocido -- las que tienen user_id NULL
-- (autor desconocido, columna nullable a propósito desde que se creó, ver
-- 20260927_ajustes_stock_usuario_historial.sql) quedan con user_email NULL también, coherente,
-- no un error silencioso. El caso "user_id apunta a un usuario borrado" no puede darse hoy:
-- la FK user_id -> auth.users(id) es ON DELETE NO ACTION (confirmado vía pg_constraint), así
-- que Postgres ya bloquearía el borrado de un usuario referenciado -- verificado en pruebas
-- simulando el caso (quitando la FK temporalmente dentro de una transacción de prueba) que el
-- backfill tampoco rompe si algún día esto cambiara: la fila simplemente no matchea y queda con
-- user_email NULL, igual que un user_id NULL.
update ajustes_articulo a set user_email = u.email
  from auth.users u where u.id = a.user_id and a.user_email is null;
update ajustes_semielaborado a set user_email = u.email
  from auth.users u where u.id = a.user_id and a.user_email is null;
update ajustes_producto_final a set user_email = u.email
  from auth.users u where u.id = a.user_id and a.user_email is null;

-- CREATE OR REPLACE VIEW no vale: el tipo de user_email cambia de character varying(255)
-- (heredado de auth.users.email) a text (la columna nueva), y Postgres rechaza un
-- CREATE OR REPLACE que cambie el tipo de una columna de salida existente (descubierto al
-- intentarlo en la prueba en BEGIN...ROLLBACK). DROP + CREATE hace falta, y con eso se pierde
-- el GRANT -- hay que reconcederlo explícitamente o el frontend deja de poder leer la vista.
drop view historial_ajustes_stock;

create view historial_ajustes_stock as
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
  aa.negocio_id
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
  as_.negocio_id
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
  (case apf.motivo_categoria
    when 'caducado' then 'Caducado'
    when 'roto' then 'Roto'
    when 'evento_no_consumido' then 'Evento no consumido'
    else 'Otro'
  end) || coalesce(' — ' || apf.motivo_detalle, '') as motivo,
  apf.fecha,
  apf.user_id,
  apf.user_email,
  apf.negocio_id
from ajustes_producto_final apf
join producciones_producto_final ppf on ppf.id = apf.produccion_pf_id
join productos_finales pf on pf.id = ppf.producto_final_id;

grant select on historial_ajustes_stock to authenticated;
