-- Añade codigo_lote a stock_lotes_semielaborado y stock_lotes_producto_final
-- (columna aditiva al final del SELECT, mismo patrón que ubicacion_id en la
-- Capa 2 de ubicaciones — no cambia cardinalidad ni grants).
--
-- Motivo: producciones_semielaborado.codigo_lote y
-- producciones_producto_final.codigo_lote ya existen en la tabla base desde
-- el sistema de códigos de lote automáticos, pero ninguna de las dos vistas
-- los expone — confirmado con colisiones reales de etiqueta en el
-- desplegable de lote (dos lotes de la misma fecha, indistinguibles):
-- stock_lotes_semielaborado produccion_id 45/46 (semielaborado_id 6,
-- 2026-05-05) y stock_lotes_producto_final produccion_id 61/62
-- (2026-04-29) y 66/67 (2026-05-05), ambos de producto_final_id 1.
--
-- stock_lotes_articulo no se toca: entrada_material.codigo_lote existe pero
-- esa vista ya distingue lotes por numero_albaran + proveedor, sin el mismo
-- problema de colisión.

create or replace view stock_lotes_semielaborado as
select p.id as produccion_id,
  p.semielaborado_id,
  s.nombre,
  s.unidad,
  p.cantidad_producida,
  p.cantidad_producida
    - coalesce((select sum(cp.cantidad) from consumo_produccion cp where cp.produccion_origen_id = p.id), 0)
    - coalesce((select sum(cppf.cantidad) from consumo_produccion_pf cppf where cppf.produccion_origen_id = p.id), 0)
    + coalesce((select sum(aj.cantidad) from ajustes_semielaborado aj where aj.produccion_id = p.id), 0)
    as stock_disponible,
  p.fecha,
  p.ubicacion_id,
  p.codigo_lote
from producciones_semielaborado p
  join semielaborados s on s.id = p.semielaborado_id
where p.estado = 'cerrada';

create or replace view stock_lotes_producto_final as
select p.id as produccion_id,
  p.producto_final_id,
  pf.nombre,
  p.cantidad_producida
    - coalesce((select sum(v.cantidad) from lineas_albaran_venta v where v.produccion_pf_id = p.id), 0)
    + coalesce((select sum(a.cantidad) from ajustes_producto_final a where a.produccion_pf_id = p.id), 0)
    as stock_disponible,
  p.fecha,
  p.fecha_caducidad,
  p.ubicacion_id,
  p.codigo_lote
from producciones_producto_final p
  join productos_finales pf on pf.id = p.producto_final_id
where p.estado = 'cerrada';
