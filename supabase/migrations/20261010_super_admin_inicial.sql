-- CONTRATO_SUPERADMIN_EMPRESAS.md: alta del primer (y hoy único) super_admin, pedida
-- explícitamente por el usuario -- la migración anterior (20261009_super_admin_empresas.sql)
-- deliberadamente NO tocó el rol de ningún usuario existente por su cuenta.
insert into super_admins (usuario_id) values ('8dec2751-aa16-48b3-8c75-d3fcf2b9ba9a');
