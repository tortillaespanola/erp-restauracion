-- CONTRATO_DEMO.md, "Red de seguridad server-side (cron)": si el visitante cierra la pestaña o
-- pierde conexión antes de que el frontend dispare el revert, la sesión queda "colgada" -- sin
-- esto, el revert dependería por completo de que el navegador del visitante siga ejecutando JS,
-- lo cual no está garantizado.
create extension if not exists pg_cron;

-- Función nombrada y revisable en vez de pasarle a cron.schedule un bloque SQL suelto --
-- SECURITY DEFINER porque, igual que revertir_demo(), necesita poder actuar aunque quien la
-- dispare (el propio scheduler de pg_cron) no tenga JWT de usuario.
create or replace function revertir_demo_expiradas()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sesion record;
begin
  for v_sesion in
    select id from demo_sesiones where expires_at < now() and reverted_at is null
  loop
    perform revertir_demo(v_sesion.id, 'cron_safety_net');
  end loop;
end;
$$;

revoke execute on function revertir_demo_expiradas() from public;

select cron.schedule('demo-revert-safety-net', '* * * * *', 'select revertir_demo_expiradas();');
