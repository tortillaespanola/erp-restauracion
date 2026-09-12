-- CONTRATO_SUPERADMIN_EMPRESAS.md: la Edge Function create-company es el primer consumidor de
-- la service_role key en todo este proyecto -- hasta ahora todo el acceso pasaba por RLS con el
-- rol `authenticated`. La service_role bypasea RLS, pero eso es un mecanismo aparte de los GRANT
-- de nivel tabla: sin un GRANT explícito, Postgres devuelve "permission denied for table X"
-- incluso con la service_role key. Ninguna tabla tocada por adminClient (super_admins, negocios,
-- usuarios_negocios, empresa_config) tenía grant a service_role, porque nunca hizo falta antes.
grant select on super_admins to service_role;
grant insert, delete on negocios to service_role;
grant insert, delete on usuarios_negocios to service_role;
grant insert on empresa_config to service_role;
