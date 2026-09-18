-- CONTRATO_AJUSTES_RECHAZO_CLIENTE.md, Fase 1: impide crear un ajuste de producto final con
-- origen_rechazo='cliente' sin linea_pedido_origen_id -- el hueco que dejó pasar el ajuste #11
-- (CONTRATO_PROPAGACION_RECHAZOS.md solo añadió la columna, nunca la exigió).

-- Paso previo obligatorio (no automatizable, ver contrato "Fuera de alcance"): los 2 ajustes
-- históricos que hoy violan la regla, resueltos manualmente antes de activar el constraint --
-- auditados uno a uno contra lineas_albaran_venta, no adivinados.
--
-- #11 (lote FG-ALP-C001-260005, produccion_pf_id=459): ese lote se envió en un único albarán
-- (id 597) a una única línea de pedido (610) -- sin ambigüedad, se completa directamente.
update ajustes_producto_final
set linea_pedido_origen_id = 610
where id = 11;

-- #10 (lote de producción 457): ese lote se repartió entre 4 líneas de albarán de 3 pedidos de 3
-- clientes distintos (Hotel Vier Jahreszeiten Luzern, Restaurant Rheinblick, Helvetia Workspace) --
-- no hay ningún dato que diga cuál de los tres rechazó la unidad. Decisión del negocio (no
-- inventada): se quita origen_rechazo en vez de asignar un pedido al azar -- el ajuste de stock
-- (-1 ud) se conserva tal cual, solo deja de contar como "rechazo de cliente" formal.
update ajustes_producto_final
set origen_rechazo = null
where id = 10;

alter table ajustes_producto_final
  add constraint chk_ajuste_rechazo_cliente_requiere_linea
  check (origen_rechazo is distinct from 'cliente' or linea_pedido_origen_id is not null);
