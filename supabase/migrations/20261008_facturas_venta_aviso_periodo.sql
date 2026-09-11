-- CONTRATO_FACTURA_PDF.md, sección 5: guarda, en el momento de crear la factura, el aviso (si lo
-- hubo) sobre albaranes del mismo periodo no incluidos -- así el PDF, si se regenera más
-- adelante, muestra siempre el mismo aviso calculado al facturar, en vez de recalcularlo contra
-- el estado actual de la base de datos. Nullable: la mayoría de facturas no tendrán aviso.
alter table facturas_venta
  add column aviso_periodo text;

-- facturas_venta_con_saldo (20261001_vista_facturas_venta_con_saldo.sql) se define con `fv.*`,
-- cuya lista de columnas queda fijada en el momento de crear la vista -- una columna añadida
-- después a facturas_venta no aparece sola, hay que recrear la vista para que la recoja.
-- CREATE OR REPLACE VIEW no sirve aquí: fv.* ahora incluye aviso_periodo justo antes de
-- saldo_pendiente/prioridad_grupo (columnas calculadas que van después en el SELECT), lo que
-- desplaza sus posiciones -- Postgres solo permite añadir columnas nuevas al FINAL de la lista
-- con REPLACE, no en medio. Se dropea y se recrea entera (sin objetos dependientes: solo
-- consultada desde PostgREST, verificado por grep en supabase/migrations y frontend/src).
drop view facturas_venta_con_saldo;

create view facturas_venta_con_saldo
with (security_invoker = true) as
select
  fv.*,
  case when fv.anulada then null
       else fv.total - coalesce(directo.aplicado, 0) - coalesce(via_albaran.aplicado, 0)
  end as saldo_pendiente,
  case
    when fv.anulada then 2
    when (fv.total - coalesce(directo.aplicado, 0) - coalesce(via_albaran.aplicado, 0)) <= 0.005 then 1
    else 0
  end as prioridad_grupo
from facturas_venta fv
left join (
  select pa.factura_venta_id, sum(pa.monto_aplicado) as aplicado
  from pago_aplicacion pa
  join pagos p on p.id = pa.pago_id
  where pa.factura_venta_id is not null and not p.anulada
  group by pa.factura_venta_id
) directo on directo.factura_venta_id = fv.id
left join (
  select fva.factura_venta_id, sum(pa.monto_aplicado) as aplicado
  from factura_venta_albaran fva
  join pago_aplicacion pa on pa.albaran_venta_id = fva.albaran_venta_id
  join pagos p on p.id = pa.pago_id
  where not p.anulada
  group by fva.factura_venta_id
) via_albaran on via_albaran.factura_venta_id = fv.id;

grant select on facturas_venta_con_saldo to authenticated;
