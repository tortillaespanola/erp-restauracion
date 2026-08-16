-- Traslado del mismo patrón de 20260902_cantidad_objetivo_produccion_semielaborado.sql a Producto
-- final (CONTRATO_VISTA_DINAMICA_PRODUCCION.md, sección "Traslado provisional de patrón — Producto
-- final"): valor de referencia/planificación, editable libremente en la tarjeta de "Producción en
-- curso", independiente de `tanda_id`/`pedido_id` (el vínculo al pedido de origen no se toca ni se
-- sustituye por este número). Mismo criterio de ausencia de CHECK de positividad -- la validación
-- ">0" vive en el frontend, igual que cantidad_producida.
alter table producciones_producto_final add column cantidad_objetivo numeric;
