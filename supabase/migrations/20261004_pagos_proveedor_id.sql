-- CONTRATO_PAGOS_COMPRA.md, sección 8 ("Hallazgo bloqueante (09-09-2026)"), corrección de la
-- sección 2.2 antes de empezar el paso 3.
--
-- 2.2 asumía "pagos: sin cambios de estructura", pero pagos.cliente_id es NOT NULL y no existe
-- proveedor_id -- hoy es imposible registrar un pago a proveedor sin abusar de cliente_id. Esta
-- migración generaliza pagos igual que 20261002 generalizó pago_aplicacion: una sola tabla
-- ampliada, no pagos_proveedor aparte. La dirección (cobro/pago) se deriva de qué columna de
-- titular está poblada, mismo criterio que ya usa pago_aplicacion con sus columnas de documento.
--
-- BEGIN/COMMIT explícitos, mismo procedimiento que las migraciones anteriores de este contrato.

begin;

-- ============================================================
-- 1. pagos.proveedor_id (nueva, nullable)
-- ============================================================

alter table pagos
  add column proveedor_id bigint references proveedores(id);

comment on column pagos.proveedor_id is
  'CONTRATO_PAGOS_COMPRA.md sección 8: pago a proveedor. Exactamente uno de (cliente_id, proveedor_id) debe estar poblado -- ver constraint pagos_exactamente_un_titular. NULL para cobros de venta (comportamiento existente, sin cambios).';

-- ============================================================
-- 2. pagos.cliente_id: de NOT NULL a nullable
-- ============================================================
--
-- Necesario para que un pago a proveedor (cliente_id NULL, proveedor_id poblado) sea insertable.
-- Las 12 filas reales existentes ya tienen cliente_id poblado -- relajar el NOT NULL no les afecta.

alter table pagos
  alter column cliente_id drop not null;

-- ============================================================
-- 3. CHECK "exactamente uno de 2" (mismo estilo de recuento que
--    pago_aplicacion_exactamente_un_documento, 20261002)
-- ============================================================

alter table pagos
  add constraint pagos_exactamente_un_titular check (
    (case when cliente_id is not null then 1 else 0 end)
    + (case when proveedor_id is not null then 1 else 0 end)
    = 1
  );

comment on constraint pagos_exactamente_un_titular on pagos is
  'CONTRATO_PAGOS_COMPRA.md sección 8: cada fila de pagos resuelve a un único titular, cliente (cobro de venta) o proveedor (pago a proveedor), nunca a más de uno ni a ninguno. Mismo patrón de recuento que pago_aplicacion_exactamente_un_documento.';

commit;
