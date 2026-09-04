-- BLOQUE 1 (CONTRATO_UX_FACTURAS_VENTA.md): resolución técnica del ordenamiento/paginación por un
-- valor calculado (estado de pago), no almacenado.
--
-- Por qué NO es una columna generada (patrón grupo_estado de pedidos_venta, migración 20260928):
-- una columna `generated always as (...) stored` solo puede leer columnas de la MISMA fila. El
-- saldo de una factura depende de pago_aplicacion/pagos, tablas externas -- Postgres rechaza esa
-- definición directamente, no es una opción.
--
-- Por qué NO un trigger que mantenga una columna desnormalizada en facturas_venta: funcionaría,
-- pero reintroduce justo lo que CONTRATO_PAGOS_VENTA.md sección 2 rechaza explícitamente (un valor
-- persistido que alguien puede olvidar sincronizar) -- y aquí con más superficie de sincronización
-- que en Pedidos, porque el trigger tendría que dispararse desde OTRA tabla (pago_aplicacion/pagos),
-- no desde la propia fila que cambia.
--
-- Por qué NO vista materializada: necesitaría REFRESH manual o programado -- un cobro recién
-- registrado no se reflejaría hasta entonces. Inaceptable para una pantalla que se abre justo
-- después de registrar un pago.
--
-- Solución: vista SQL normal (no materializada), recalculada en cada consulta, que reutiliza la
-- misma fórmula ya escrita en JS en saldosDeFacturas() (frontend/src/lib/saldosVenta.js) pero
-- resuelta en SQL para poder .order()/.range() sobre un valor ya calculado en servidor.
--
-- security_invoker = true (Postgres 15+, confirmado 17.6 en este proyecto): sin esto, una vista
-- por defecto se ejecuta con los privilegios de su propietario, saltándose las políticas RLS de
-- las tablas base para quien la consulte -- con esto, respeta las mismas políticas RLS que
-- facturas_venta/pagos/pago_aplicacion ya tienen.
create view facturas_venta_con_saldo
with (security_invoker = true) as
select
  fv.*,
  -- saldo_pendiente: NULL para anuladas (sección 4 de CONTRATO_PAGOS_VENTA.md -- una factura
  -- anulada no es un documento con saldo pendiente, su saldo es irrelevante una vez anulada).
  case when fv.anulada then null
       else fv.total - coalesce(directo.aplicado, 0) - coalesce(via_albaran.aplicado, 0)
  end as saldo_pendiente,
  -- prioridad_grupo: 0 = Pendiente/Parcial, 1 = Pagada, 2 = Anulada (siempre al final, sin
  -- importar su saldo -- sección 1 del contrato). Primera clave de .order() en el listado, igual
  -- que grupo_estado en pedidos_venta.
  case
    when fv.anulada then 2
    when (fv.total - coalesce(directo.aplicado, 0) - coalesce(via_albaran.aplicado, 0)) <= 0.005 then 1
    else 0
  end as prioridad_grupo
from facturas_venta fv
-- Pagos aplicados directo a la factura.
left join (
  select pa.factura_venta_id, sum(pa.monto_aplicado) as aplicado
  from pago_aplicacion pa
  join pagos p on p.id = pa.pago_id
  where pa.factura_venta_id is not null and not p.anulada
  group by pa.factura_venta_id
) directo on directo.factura_venta_id = fv.id
-- Pagos aplicados a los albaranes que esta factura agrupa (factura_venta_albaran) -- mismo
-- razonamiento "mirar hacia abajo" que ya usa la columna "Pedido origen" de Albaranes.
left join (
  select fva.factura_venta_id, sum(pa.monto_aplicado) as aplicado
  from factura_venta_albaran fva
  join pago_aplicacion pa on pa.albaran_venta_id = fva.albaran_venta_id
  join pagos p on p.id = pa.pago_id
  where not p.anulada
  group by fva.factura_venta_id
) via_albaran on via_albaran.factura_venta_id = fv.id;

grant select on facturas_venta_con_saldo to authenticated;

comment on view facturas_venta_con_saldo is
  'CONTRATO_UX_FACTURAS_VENTA.md Bloque 1: facturas_venta + saldo_pendiente y prioridad_grupo calculados al vuelo (no persistidos), para poder ordenar/paginar en servidor por estado de pago. Misma fórmula que saldosDeFacturas() en saldosVenta.js.';
