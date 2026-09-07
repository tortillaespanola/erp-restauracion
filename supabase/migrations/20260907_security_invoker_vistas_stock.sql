-- CONTRATO_MULTITENANT.md, Tarea 2 (hallazgo derivado): las 7 vistas de stock/historial son
-- propiedad de un rol con BYPASSRLS y, sin security_invoker=true, evalúan el acceso a las
-- tablas base con los privilegios del PROPIETARIO, no del usuario que consulta -- confirmado
-- empíricamente en pruebas con un negocio ficticio: una fila de negocio B, correctamente
-- bloqueada por RLS al consultar la tabla base directamente, aparecía igualmente a través de
-- estas vistas. Reescribir las 42 policies (migración anterior) no cierra esto por sí solo --
-- no importa cómo esté escrita la policy de la tabla base si la vista que la consulta la ignora
-- por completo.
--
-- historial_ajustes_stock necesitó primero quitar su join a auth.users (migración anterior,
-- denormalizando user_email) -- sin eso, security_invoker=true rompe la vista entera con
-- "permission denied for table users", porque authenticated no puede leer auth.users
-- directamente (descubierto al intentar aplicar esto antes que la denormalización). Las otras 6
-- no tienen ninguna dependencia de auth.* (confirmado leyendo su definición completa en vivo),
-- así que el cambio es limpio para ellas.
--
-- Probado en BEGIN...ROLLBACK contra un negocio B ficticio en las 7, incluyendo un
-- articulos_compra real de negocio B (no solo proveedor/albarán/entrada) para stock_articulos
-- específicamente: 0 filas visibles, conteo total sin cambios, antes de aplicar esto en firme.
alter view historial_ajustes_stock set (security_invoker = true);
alter view stock_articulos set (security_invoker = true);
alter view stock_lotes_articulo set (security_invoker = true);
alter view stock_lotes_producto_final set (security_invoker = true);
alter view stock_lotes_semielaborado set (security_invoker = true);
alter view stock_productos_finales set (security_invoker = true);
alter view stock_semielaborados set (security_invoker = true);
