-- Mismo bug que ya se corrigió en incidencias_reparto_pedido
-- (20260815_fix_cascade_incidencias_reparto_pedido.sql), pero sin
-- corregir en sus 3 tablas hermanas: incidencias_stock_producto_final,
-- incidencias_stock_articulo, incidencias_stock_semielaborado.
--
-- Las FKs "de origen" de estas 3 tablas (la línea/producción/consumo/
-- lote que motivó el aviso) se crearon sin ON DELETE CASCADE, así que
-- borrar cualquier registro que tenga una incidencia enganchada (de
-- stock negativo o de caducidad, ambas solo informativas/no bloqueantes)
-- falla con "violates foreign key constraint ..._fkey". Reproducido en
-- real con el albarán DN-260079 (línea 138, incidencia id 6 por
-- caducidad del lote de producción 105).
--
-- Mismo criterio que el fix anterior: si se borra el padre, la
-- incidencia (log informativo) no tiene sentido sin él, así que se
-- borra en cascada con él. No se toca negocio_id (no es una operación
-- real borrar un negocio) ni ninguna otra columna.

alter table incidencias_stock_producto_final
  drop constraint incidencias_stock_producto_final_linea_albaran_venta_id_fkey,
  add constraint incidencias_stock_producto_final_linea_albaran_venta_id_fkey
    foreign key (linea_albaran_venta_id) references lineas_albaran_venta(id) on delete cascade;

alter table incidencias_stock_producto_final
  drop constraint incidencias_stock_producto_final_produccion_pf_id_fkey,
  add constraint incidencias_stock_producto_final_produccion_pf_id_fkey
    foreign key (produccion_pf_id) references producciones_producto_final(id) on delete cascade;

alter table incidencias_stock_articulo
  drop constraint incidencias_stock_articulo_linea_albaran_venta_id_fkey,
  add constraint incidencias_stock_articulo_linea_albaran_venta_id_fkey
    foreign key (linea_albaran_venta_id) references lineas_albaran_venta(id) on delete cascade;

alter table incidencias_stock_articulo
  drop constraint incidencias_stock_articulo_consumo_produccion_id_fkey,
  add constraint incidencias_stock_articulo_consumo_produccion_id_fkey
    foreign key (consumo_produccion_id) references consumo_produccion(id) on delete cascade;

alter table incidencias_stock_articulo
  drop constraint incidencias_stock_articulo_consumo_produccion_pf_id_fkey,
  add constraint incidencias_stock_articulo_consumo_produccion_pf_id_fkey
    foreign key (consumo_produccion_pf_id) references consumo_produccion_pf(id) on delete cascade;

alter table incidencias_stock_articulo
  drop constraint incidencias_stock_articulo_entrada_material_id_fkey,
  add constraint incidencias_stock_articulo_entrada_material_id_fkey
    foreign key (entrada_material_id) references entrada_material(id) on delete cascade;

alter table incidencias_stock_semielaborado
  drop constraint incidencias_stock_semielaborad_produccion_semielaborado_id_fkey,
  add constraint incidencias_stock_semielaborad_produccion_semielaborado_id_fkey
    foreign key (produccion_semielaborado_id) references producciones_semielaborado(id) on delete cascade;

alter table incidencias_stock_semielaborado
  drop constraint incidencias_stock_semielaborado_consumo_produccion_id_fkey,
  add constraint incidencias_stock_semielaborado_consumo_produccion_id_fkey
    foreign key (consumo_produccion_id) references consumo_produccion(id) on delete cascade;

alter table incidencias_stock_semielaborado
  drop constraint incidencias_stock_semielaborado_consumo_produccion_pf_id_fkey,
  add constraint incidencias_stock_semielaborado_consumo_produccion_pf_id_fkey
    foreign key (consumo_produccion_pf_id) references consumo_produccion_pf(id) on delete cascade;
