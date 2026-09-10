-- CONTRATO_GENERICO_CATALOGO.md, Fase 3: pedidos_venta.estado y pedidos_compra.estado son
-- `text not null default 'pendiente'` sin ninguna restricción real -- el vocabulario de valores
-- válidos vive solo en un comentario SQL (20260801_pedidos_venta.sql / 20260802_flujo_compras_
-- pedido_directa.sql) y en los triggers que los escriben. Un UPDATE manual o un bug futuro podía
-- escribir cualquier string sin que la base de datos protestara.
--
-- Paso previo (4.1, solo lectura, ejecutado el 10-09-2026 vía conexión directa en
-- transacción READ ONLY): `select estado, count(*) from pedidos_venta group by estado` y lo
-- mismo para pedidos_compra. Resultado: pedidos_venta = {cancelado: 5, pendiente: 5, servido:
-- 107}; pedidos_compra = {cancelado: 3, recibido: 45}. Ningún valor fuera del vocabulario
-- documentado en ninguna de las dos tablas -- vía libre para añadir el CHECK sin backfill previo.
--
-- Probado en transacción de prueba (BEGIN...ROLLBACK) antes de aplicar en firme, con
-- confirmación explícita del usuario dado que es una acción de esquema sobre la BD real (mismo
-- criterio que la Fase 1). Verificado además en navegador tras aplicar: ciclo completo de un
-- pedido de venta (crear -> en_produccion -> servido) sin que los triggers
-- actualizar_estado_pedido_por_produccion()/actualizar_estado_pedido_por_servicio() violen el
-- constraint.
--
-- Reversible con `alter table ... drop constraint chk_pedidos_venta_estado/chk_pedidos_compra_estado`
-- si hiciera falta.

alter table pedidos_venta
  add constraint chk_pedidos_venta_estado
  check (estado in ('pendiente', 'en_produccion', 'servido', 'cancelado'));

alter table pedidos_compra
  add constraint chk_pedidos_compra_estado
  check (estado in ('pendiente', 'recibido', 'cancelado'));
