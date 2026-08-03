-- Ubicaciones — Capa 2: vincular stock a ubicación (solo "vincular", sin
-- cambiar comportamiento). Ver UBICACIONES_DIAGNOSTICO.md y las respuestas
-- de diseño acordadas antes de esta migración.
--
-- Alcance:
--   1. Fila "Ubicación principal" (tipo 'almacen') como destino del backfill,
--      mismo patrón que 'Negocio principal' en 20260807.
--   2. ubicacion_id NOT NULL con default a esa fila, en entrada_material,
--      producciones_semielaborado y producciones_producto_final — mismo
--      mecanismo que negocio_id, no nullable-primero (negocio_id es el
--      precedente real, no dias_caducidad_default: todo lote ya está en
--      algún sitio hoy, no hay estado legítimo de "sin ubicación").
--   3. ubicacion_id añadida como columna aditiva (al final del SELECT) en
--      las tres vistas por-lote (stock_lotes_articulo, _semielaborado,
--      _producto_final) — no cambia cardinalidad ni grants.
--
-- Explícitamente FUERA de alcance (acordado antes de generar este SQL):
--   - Las tres vistas agregadas (stock_articulos, stock_productos_finales,
--     stock_semielaborados) NO se tocan — siguen sumando global. Ver
--     PENDIENTES_MODELO.md #2 para el motivo y las dos keys de React que
--     habrá que arreglar cuando eso cambie.
--   - Ningún trigger (check_stock_producto_final, check_consumo_produccion,
--     check_consumo_produccion_pf) cambia — ubicacion_id es descriptivo,
--     no hay validación cruzada de ubicación todavía.

insert into ubicaciones (id, nombre, tipo)
values ('c71c5d6b-742e-47ca-a787-deab175472ed', 'Ubicación principal', 'almacen');

alter table entrada_material
  add column ubicacion_id uuid not null default 'c71c5d6b-742e-47ca-a787-deab175472ed' references ubicaciones(id);

alter table producciones_semielaborado
  add column ubicacion_id uuid not null default 'c71c5d6b-742e-47ca-a787-deab175472ed' references ubicaciones(id);

alter table producciones_producto_final
  add column ubicacion_id uuid not null default 'c71c5d6b-742e-47ca-a787-deab175472ed' references ubicaciones(id);

create or replace view stock_lotes_articulo as
select em.id as entrada_material_id,
  em.articulo_id,
  a.nombre,
  a.unidad,
  em.cantidad as cantidad_recibida,
  em.cantidad
    - coalesce((select sum(cp.cantidad) from consumo_produccion cp where cp.entrada_material_id = em.id), 0)
    - coalesce((select sum(cppf.cantidad) from consumo_produccion_pf cppf where cppf.entrada_material_id = em.id), 0)
    + coalesce((select sum(aj.cantidad) from ajustes_articulo aj where aj.entrada_material_id = em.id), 0)
    as stock_disponible,
  em.fecha_caducidad,
  alc.fecha as fecha_recepcion,
  alc.numero_albaran,
  prov.nombre_comercial as proveedor,
  em.ubicacion_id
from entrada_material em
  join articulos_compra a on a.id = em.articulo_id
  join albaranes_compra alc on alc.id = em.albaran_compra_id
  left join proveedores prov on prov.id = alc.proveedor_id;

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
  p.ubicacion_id
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
  p.ubicacion_id
from producciones_producto_final p
  join productos_finales pf on pf.id = p.producto_final_id
where p.estado = 'cerrada';
