-- CONTRATO_PAGOS_COMPRA.md, sección 3 y 4.1, paso 2 del orden de ejecución (sección 6).
--
-- Espejo de facturas_venta_con_saldo (20261001_vista_facturas_venta_con_saldo.sql), sobre
-- facturas_compra/factura_compra_id/albaran_compra_id/factura_compra_albaran en vez de sus
-- equivalentes de venta. Mismas razones para la misma solución (no repetidas en detalle aquí, ver
-- el comentario completo en 20261001_vista_facturas_venta_con_saldo.sql):
--   - No es una columna generada: el saldo depende de pago_aplicacion/pagos, tablas externas.
--   - No es un trigger que desnormalice un valor en facturas_compra: reintroduce sincronización
--     manual, justo lo que CONTRATO_PAGOS_COMPRA.md sección 2.2 evita a propósito.
--   - No es una vista materializada: un pago recién registrado no se reflejaría hasta un REFRESH.
--   - Vista SQL normal, recalculada en cada consulta, misma fórmula que saldosDeFacturas() en
--     frontend/src/lib/saldosCompra.js (sección 3 del contrato: "mirar hacia abajo").
--
-- security_invoker = true: sin esto la vista se ejecuta con los privilegios de su propietario,
-- saltándose las políticas RLS de las tablas base -- con esto respeta las mismas políticas RLS que
-- facturas_compra/pagos/pago_aplicacion ya tienen.
--
-- DIFERENCIA respecto a la vista de venta (pedida explícitamente, no un espejo ciego):
-- facturas_compra.total es nullable (campo manual, ver CONTRATO_DRAWERS_COMPRAS.md sección 3 -- no
-- se toca en este contrato), algo que facturas_venta.total nunca es. Sin distinguirlo, una factura
-- sin total se confundía con "pendiente" (saldo_pendiente también sale NULL en ambos casos). Se
-- añade una columna `estado_pago` (text) con 5 valores explícitos -- anulada / sin_total / pagada /
-- parcial / pendiente -- para que el consumidor (icono de estado, paso 5 del contrato) pueda
-- distinguir el motivo exacto sin adivinar a partir de saldo_pendiente=NULL. saldo_pendiente se
-- mantiene NULL tanto para 'anulada' como para 'sin_total' (no calculable en ningún caso) --
-- estado_pago es lo que distingue cuál de los dos motivos es.
--
-- prioridad_grupo se deriva de estado_pago (no se repite la clasificación): 0 = pendiente/parcial/
-- sin_total ("activos", necesitan atención), 1 = pagada, 2 = anulada -- mismo criterio "anulada
-- siempre al final" que la vista de venta, con sin_total ahora agrupada junto a los activos en vez
-- de indistinguible de pendiente.
--
-- Estructura en dos CTE porque Postgres no permite referenciar el alias de una columna calculada
-- en otra expresión del mismo nivel de SELECT: `aplicado` calcula el total aplicado (directo +
-- vía albaranes) sin exponerlo en la vista final; `clasificado` calcula saldo_pendiente y
-- estado_pago como columnas reales de esa relación intermedia; el SELECT final deriva
-- prioridad_grupo a partir de estado_pago, que ya es una columna genuina de `clasificado`, no un
-- alias del mismo nivel.
--
-- BEGIN/COMMIT explícitos, mismo procedimiento que 20261002_facturas_compra_anulada_pago_aplicacion_compra.sql
-- -- para revisión en el SQL Editor antes de aplicar, no por convención del repo.

begin;

create view facturas_compra_con_saldo
with (security_invoker = true) as
with aplicado as (
  select
    fc.id as factura_compra_id,
    coalesce(directo.aplicado, 0) + coalesce(via_albaran.aplicado, 0) as aplicado_total
  from facturas_compra fc
  -- Pagos aplicados directo a la factura.
  left join (
    select pa.factura_compra_id, sum(pa.monto_aplicado) as aplicado
    from pago_aplicacion pa
    join pagos p on p.id = pa.pago_id
    where pa.factura_compra_id is not null and not p.anulada
    group by pa.factura_compra_id
  ) directo on directo.factura_compra_id = fc.id
  -- Pagos aplicados a los albaranes que esta factura agrupa (factura_compra_albaran) -- mismo
  -- razonamiento "mirar hacia abajo" que ya usa la columna "Pedido origen" de Albaranes de compra.
  left join (
    select fca.factura_compra_id, sum(pa.monto_aplicado) as aplicado
    from factura_compra_albaran fca
    join pago_aplicacion pa on pa.albaran_compra_id = fca.albaran_compra_id
    join pagos p on p.id = pa.pago_id
    where not p.anulada
    group by fca.factura_compra_id
  ) via_albaran on via_albaran.factura_compra_id = fc.id
),
clasificado as (
  select
    fc.*,
    -- saldo_pendiente: NULL para anuladas Y para sin_total (ninguno de los dos casos tiene un
    -- saldo calculable) -- estado_pago, más abajo, es lo que distingue cuál de los dos motivos es.
    case when fc.anulada then null
         when fc.total is null then null
         else fc.total - a.aplicado_total
    end as saldo_pendiente,
    case
      when fc.anulada then 'anulada'
      when fc.total is null then 'sin_total'
      when (fc.total - a.aplicado_total) <= 0.005 then 'pagada'
      when a.aplicado_total > 0 then 'parcial'
      else 'pendiente'
    end as estado_pago
  from facturas_compra fc
  join aplicado a on a.factura_compra_id = fc.id
)
select
  clasificado.*,
  case estado_pago
    when 'anulada' then 2
    when 'pagada' then 1
    else 0 -- pendiente / parcial / sin_total
  end as prioridad_grupo
from clasificado;

grant select on facturas_compra_con_saldo to authenticated;

comment on view facturas_compra_con_saldo is
  'CONTRATO_PAGOS_COMPRA.md sección 3: facturas_compra + saldo_pendiente, estado_pago y prioridad_grupo calculados al vuelo (no persistidos). Espejo de facturas_venta_con_saldo, con estado_pago añadido para distinguir "sin_total" (facturas_compra.total nullable, a diferencia de venta) de "pendiente" -- ambos casos dan saldo_pendiente NULL. Misma fórmula que saldosDeFacturas() en saldosCompra.js.';

comment on column facturas_compra_con_saldo.estado_pago is
  'CONTRATO_PAGOS_COMPRA.md sección 3: uno de anulada/sin_total/pagada/parcial/pendiente. anulada tiene prioridad máxima de detección; sin_total es el caso nuevo (facturas_compra.total nullable) que antes se confundía con pendiente al tener ambos saldo_pendiente NULL.';

commit;
