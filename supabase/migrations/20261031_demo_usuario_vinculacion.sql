-- CONTRATO_DEMO.md: vincula el usuario demo (creado manualmente en Supabase Dashboard >
-- Authentication > Add user, con contraseña propia y "Auto Confirm User" -- no por invitación,
-- porque no hay una bandeja de entrada real detrás para aceptar el enlace mágico) al tenant
-- AlpenWerk Möbel GmbH. Mismo patrón que 20260915_alpenwerk_usuario_vinculacion.sql: el usuario
-- ya existe en auth.users, esta migración solo crea la fila de usuarios_negocios que le da
-- acceso.
insert into usuarios_negocios (usuario_id, negocio_id)
values (
  '9a3de0d5-70e8-4844-96b2-0edaa8da0cc2',
  (select id from negocios where codigo_corto = 'ALP')
);
