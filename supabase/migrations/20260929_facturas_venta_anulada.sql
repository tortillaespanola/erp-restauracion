-- BLOQUE 2 (CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md): columna `anulada` para reemplazar el
-- borrado físico de facturas por una anulación simple (sección 3 del contrato) -- una factura
-- anulada conserva su numero_factura "quemado" para siempre y sus relaciones en
-- factura_venta_albaran intactas (para que sus albaranes vuelvan a estar disponibles), solo deja
-- de contar como una factura válida. Sin botón de reactivar: si algo salió mal, se anula y se
-- emite una factura nueva.
--
-- NOT NULL además de DEFAULT false (el contrato solo pedía DEFAULT false) -- mismo criterio ya
-- usado en el proyecto para flags booleanos de este tipo (ver sin_factura_prevista en
-- albaranes_compra, migración 20260806): evita el estado ambiguo NULL para un campo que solo
-- tiene sentido como true/false.
alter table facturas_venta
  add column anulada boolean not null default false;
