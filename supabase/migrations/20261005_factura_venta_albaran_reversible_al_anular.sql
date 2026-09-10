-- Bug real detectado en producción (Negocio principal): al re-facturar los albaranes DN-260115 y
-- DN-260121 (cliente Zum Kuss), el INSERT en factura_venta_albaran fallaba con
-- "duplicate key value violates unique constraint albaran_venta_facturado_una_vez", pese a que la
-- factura anterior que ya cubría DN-260121 (RE-2026-015) estaba anulada.
--
-- Causa raíz: FacturasVenta.jsx (BLOQUE 4) y FacturaVentaForm.jsx (cargarAlbaranesDelCliente,
-- CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md) ya implementan correctamente la intención de diseño
-- documentada en su propio comentario: anular una factura nunca borra sus filas de
-- factura_venta_albaran (se conservan como rastro de auditoría), y el formulario de nueva factura
-- vuelve a ofrecer esos albaranes como disponibles filtrando en el cliente las relaciones cuya
-- factura esté anulada. Pero el constraint UNIQUE(albaran_venta_id) a nivel de base de datos no
-- sabía nada de "anulada" -- es un unique llano, sin excepción -- así que el INSERT de la fila
-- nueva chocaba igualmente con la fila antigua (nunca borrada, por diseño) de la factura anulada.
--
-- Fix: en vez de tocar la lógica de la aplicación (que ya hace lo correcto) o abandonar el
-- "nunca DELETE" ya establecido para anulación, se añade una columna `anulada` en
-- factura_venta_albaran, sincronizada por trigger con facturas_venta.anulada, y el UNIQUE
-- constraint se sustituye por un índice único parcial que solo exige unicidad de albaran_venta_id
-- entre las filas activas (anulada = false). Esto mantiene intacto el historial (una fila por cada
-- factura, anulada o no, para un mismo albarán) y a la vez permite re-facturar un albarán cuya
-- única relación previa quedó anulada -- que es exactamente el comportamiento que el propio
-- comentario de BLOQUE 4 ya decía que debía pasar.
--
-- BEGIN/COMMIT explícitos para revisión manual antes de aplicar contra producción (Negocio
-- principal tiene datos reales bloqueados ahora mismo por este bug).

begin;

-- ============================================================
-- 1. Columna de sombra + backfill
-- ============================================================

alter table factura_venta_albaran
  add column anulada boolean not null default false;

update factura_venta_albaran fva
set anulada = fv.anulada
from facturas_venta fv
where fv.id = fva.factura_venta_id;

comment on column factura_venta_albaran.anulada is
  'Copia de facturas_venta.anulada en el momento de la relación, sincronizada por el trigger trg_sync_factura_venta_albaran_anulada. Existe solo para poder expresar el índice único parcial albaran_venta_facturado_una_vez (unicidad de albaran_venta_id restringida a las relaciones activas) -- un índice parcial no puede mirar una columna de otra tabla.';

-- ============================================================
-- 2. Trigger de sincronización: al anular/reactivar una factura, sus filas de
--    factura_venta_albaran heredan el mismo estado.
-- ============================================================

create or replace function sync_factura_venta_albaran_anulada()
returns trigger as $$
begin
  update factura_venta_albaran
  set anulada = new.anulada
  where factura_venta_id = new.id;
  return new;
end;
$$ language plpgsql;

create trigger trg_sync_factura_venta_albaran_anulada
after update of anulada on facturas_venta
for each row
when (old.anulada is distinct from new.anulada)
execute function sync_factura_venta_albaran_anulada();

comment on function sync_factura_venta_albaran_anulada() is
  'Mantiene factura_venta_albaran.anulada igual a la de su facturas_venta -- ver comentario de esa columna. Dispara con el UPDATE de anulación (FacturasVenta.jsx, handleAnular) y con cualquier futura reactivación.';

-- ============================================================
-- 3. UNIQUE llano -> índice único parcial (solo relaciones activas)
-- ============================================================

alter table factura_venta_albaran
  drop constraint albaran_venta_facturado_una_vez;

create unique index albaran_venta_facturado_una_vez
  on factura_venta_albaran (albaran_venta_id)
  where not anulada;

comment on index albaran_venta_facturado_una_vez is
  'Un albarán solo puede estar en, como mucho, una factura activa (no anulada) a la vez -- pero puede tener varias filas históricas de facturas ya anuladas. Antes era UNIQUE(albaran_venta_id) sin excepción, lo que bloqueaba para siempre volver a facturar un albarán cuya única factura se hubiera anulado.';

commit;
