-- Método de pago y distinción explícita "sin factura prevista" en
-- albaranes_compra. Cierra la ambigüedad de que una compra_directa sin
-- factura vinculada podía significar tanto "efectivo, nunca habrá factura,
-- es correcto" como "todavía no se ha metido la factura pero se espera".
-- Alcance mínimo: solo albaranes_compra. No toca facturas_compra ni el
-- resto del modelo.

alter table albaranes_compra
  add column metodo_pago text check (metodo_pago in ('efectivo', 'transferencia', 'otro')),
  add column sin_factura_prevista boolean not null default false;

-- Backfill del histórico: clasificación caso por caso confirmada por el
-- usuario para los 7 albaranes compra_directa existentes sin factura
-- asociada. No se ha inferido nada automáticamente.

update albaranes_compra
  set metodo_pago = 'efectivo', sin_factura_prevista = true
  where id in (12, 13, 14, 15, 20, 21);

update albaranes_compra
  set metodo_pago = 'transferencia', sin_factura_prevista = false
  where id in (22);
