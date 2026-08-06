-- incidencias_reparto_pedido.linea_albaran_venta_id no tenía ON DELETE
-- CASCADE hacia lineas_albaran_venta — impedía borrar un albarán de venta
-- histórico si tenía alguna incidencia de reparto registrada
-- ("update or delete on table lineas_albaran_venta violates foreign key
-- constraint incidencias_reparto_pedido_linea_albaran_venta_id_fkey").
--
-- Mismo criterio que ya usa el resto del esquema para relaciones
-- hijo->padre de trazabilidad (ver lineas_pedido_venta.pedido_id,
-- articulo_ingrediente.articulo_id): si se borra el padre, el registro de
-- incidencia (que es solo un log informativo, no bloqueante) no tiene
-- sentido sin su línea de albarán, así que se borra en cascada con ella.

alter table incidencias_reparto_pedido
  drop constraint incidencias_reparto_pedido_linea_albaran_venta_id_fkey,
  add constraint incidencias_reparto_pedido_linea_albaran_venta_id_fkey
    foreign key (linea_albaran_venta_id) references lineas_albaran_venta(id) on delete cascade;
