-- Amplía las 3 tablas de incidencias_stock_* para admitir motivo='caducidad'
-- además del 'stock_negativo' original, mismo patrón ya usado en
-- incidencias_reparto_pedido (columna motivo discriminadora, no tabla
-- separada, porque el encaje estructural es exacto: mismo nivel de
-- entidad, mismas claves foráneas).
--
-- incidencias_stock_articulo necesita además una tercera vía de origen
-- (linea_albaran_venta_id) para poder registrar un artículo caducado
-- vendido directamente como mercadería (hoy solo tenía las dos vías de
-- consumo interno de producción). Las otras dos tablas
-- (incidencias_stock_semielaborado, incidencias_stock_producto_final)
-- no necesitan FK nueva: ya tienen exactamente lo necesario para los
-- casos de caducidad que les corresponden.
--
-- cantidad_negativa pasa a nullable en las tres: no aplica a una
-- incidencia de motivo='caducidad' (no hay "cantidad negativa" en ese
-- caso, el hecho relevante es la fecha, no una cantidad).
--
-- Probado en transacción antes de aplicar: las 3 tablas están vacías en
-- datos reales hoy (coherente con que evento_directo es inalcanzable
-- desde la UI -- ver MEJORAS_UI_PENDIENTES.md #19 -- así que nunca se
-- generó ninguna incidencia de stock negativo todavía), sin riesgo de
-- afectar datos existentes. Confirmado que el nuevo CHECK de
-- incidencias_stock_articulo acepta exactamente una de las tres vías de
-- origen y rechaza cero o dos; que motivo solo acepta los dos valores
-- válidos; y que las otras dos tablas aceptan motivo='caducidad' sin
-- cantidad_negativa.

alter table incidencias_stock_articulo drop constraint chk_incidencias_stock_articulo_origen;
alter table incidencias_stock_articulo add column linea_albaran_venta_id bigint references lineas_albaran_venta(id);
alter table incidencias_stock_articulo alter column cantidad_negativa drop not null;
alter table incidencias_stock_articulo add column motivo text not null default 'stock_negativo' check (motivo in ('stock_negativo', 'caducidad'));
alter table incidencias_stock_articulo add column nota text;
alter table incidencias_stock_articulo add constraint chk_incidencias_stock_articulo_origen check (
  (case when consumo_produccion_id is not null then 1 else 0 end
   + case when consumo_produccion_pf_id is not null then 1 else 0 end
   + case when linea_albaran_venta_id is not null then 1 else 0 end) = 1
);

alter table incidencias_stock_semielaborado alter column cantidad_negativa drop not null;
alter table incidencias_stock_semielaborado add column motivo text not null default 'stock_negativo' check (motivo in ('stock_negativo', 'caducidad'));
alter table incidencias_stock_semielaborado add column nota text;

alter table incidencias_stock_producto_final alter column cantidad_negativa drop not null;
alter table incidencias_stock_producto_final add column motivo text not null default 'stock_negativo' check (motivo in ('stock_negativo', 'caducidad'));
alter table incidencias_stock_producto_final add column nota text;
