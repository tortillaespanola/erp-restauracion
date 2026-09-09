-- CONTRATO_PAGOS_COMPRA.md, sección 2.1 y 2.2, paso 1 del orden de ejecución (sección 6).
--
-- 2.1: soft-delete en facturas_compra, mismo patrón ya establecido para facturas_venta.anulada
-- (20260929_facturas_venta_anulada.sql). Requisito previo indispensable: pago_aplicacion es una
-- tabla de auditoría insert/select-only (nunca se corrige ni se borra una fila, ver
-- 20260930_pagos_venta.sql), así que el documento al que apunta una aplicación de pago no puede
-- desaparecer físicamente sin dejar el historial huérfano.
--
-- 2.2: amplía pago_aplicacion (la misma tabla puente que ya usa Venta) para poder aplicar pagos a
-- proveedor contra documentos de compra -- no se crea pago_aplicacion_compra por separado. La
-- dirección (cobro/pago) se deriva de qué columna de documento está poblada, no se almacena en una
-- columna aparte.
--
-- BEGIN/COMMIT explícitos a petición del usuario, para revisión antes de aplicar en un editor SQL
-- -- ninguna otra migración de este repo los usa (se apoyan en el wrapping implícito de la propia
-- herramienta de migración), esta es una excepción deliberada para este cambio concreto.

begin;

-- ============================================================
-- 1. facturas_compra.anulada (sección 2.1)
-- ============================================================

alter table facturas_compra
  add column anulada boolean not null default false;

comment on column facturas_compra.anulada is
  'CONTRATO_PAGOS_COMPRA.md sección 2.1: soft-delete, mismo patrón que facturas_venta.anulada -- el borrado de una factura de compra pasa de DELETE físico a marcar esta columna. Sin edición, sin borrado físico, solo apagado simple con rastro de auditoría (mismo criterio que pagos.anulada, 20260930_pagos_venta.sql).';

-- ============================================================
-- 2. pago_aplicacion: nuevas columnas de documento de compra (sección 2.2)
-- ============================================================

alter table pago_aplicacion
  add column factura_compra_id bigint references facturas_compra(id),
  add column albaran_compra_id bigint references albaranes_compra(id);

comment on column pago_aplicacion.factura_compra_id is
  'CONTRATO_PAGOS_COMPRA.md sección 2.2: aplicación de un pago a proveedor contra una factura de compra. Exactamente una de las 4 columnas de documento (factura_venta_id/albaran_venta_id/factura_compra_id/albaran_compra_id) debe estar poblada -- ver constraint pago_aplicacion_exactamente_un_documento.';
comment on column pago_aplicacion.albaran_compra_id is
  'CONTRATO_PAGOS_COMPRA.md sección 2.2: aplicación de un pago a proveedor contra un albarán de compra suelto (no agrupado todavía en una factura). Ver comentario de factura_compra_id.';

-- ============================================================
-- 3. CHECK ampliado de "exactamente uno de 2" a "exactamente uno de 4" (sección 2.2)
-- ============================================================
--
-- Sustituye pago_aplicacion_exactamente_un_documento (definido en 20260930_pagos_venta.sql como
-- "(factura_venta_id no nulo Y albaran_venta_id nulo) O (factura_venta_id nulo Y albaran_venta_id
-- no nulo)") por una versión de recuento que exige exactamente 1 columna no nula de las 4.
--
-- Equivalencia para filas existentes: factura_compra_id y albaran_compra_id son NULL en todas las
-- filas ya existentes (columnas recién creadas arriba), así que el recuento de columnas no nulas
-- no cambia respecto al CHECK original para ninguna fila -- todas las filas actuales (que ya
-- tenían exactamente una de las 2 columnas originales poblada) siguen cumpliendo el CHECK
-- ampliado sin excepción.

alter table pago_aplicacion
  drop constraint pago_aplicacion_exactamente_un_documento;

alter table pago_aplicacion
  add constraint pago_aplicacion_exactamente_un_documento check (
    (case when factura_venta_id is not null then 1 else 0 end)
    + (case when albaran_venta_id is not null then 1 else 0 end)
    + (case when factura_compra_id is not null then 1 else 0 end)
    + (case when albaran_compra_id is not null then 1 else 0 end)
    = 1
  );

comment on constraint pago_aplicacion_exactamente_un_documento on pago_aplicacion is
  'CONTRATO_PAGOS_COMPRA.md sección 2.2: ampliado de "exactamente uno de 2" a "exactamente uno de 4" -- cada fila de pago_aplicacion resuelve a un único documento, de cobro (venta) o de pago a proveedor (compra), nunca a más de uno ni a ninguno.';

commit;
