-- Corrige dos pedidos con fecha_entrega_prevista mal tecleada (año
-- equivocado, anterior a la propia fecha de creación del pedido) — ya
-- aplicado en firme antes de esta migración, se documenta aquí por
-- trazabilidad, mismo patrón que la corrección de OV-260014 en
-- 20260817_fix_estado_pedido_venta.sql.
--
-- Detectado al investigar un reporte de "Pedidos.jsx no muestra todos los
-- pedidos" que resultó ser un problema de orden visual, no de datos
-- faltantes: con el 100% de los pedidos reales en estado servido/cancelado
-- (45+1 de 46), el criterio de orden de ea97ec2 (fecha_entrega_prevista
-- ascendente dentro del grupo) hacía que estas dos fechas mal tecleadas,
-- al ser las "más antiguas" de toda la tabla, se colaran en las dos
-- primeras posiciones del listado completo.
--
-- OV-260053 (id 78): fecha 2026-05-21, fecha_entrega_prevista tecleada
-- como 2022-05-22 (año 2022 en vez de 2026).
-- OV-260051 (id 76): fecha 2026-05-19, fecha_entrega_prevista tecleada
-- como 2025-05-20 (año 2025 en vez de 2026).
--
-- Confirmado con el usuario antes de aplicar: ambas debían ser 2026,
-- un día después de la fecha del pedido, coherente con el patrón del
-- resto de pedidos reales.

update pedidos_venta set fecha_entrega_prevista = '2026-05-22' where codigo_pedido = 'OV-260053';
update pedidos_venta set fecha_entrega_prevista = '2026-05-20' where codigo_pedido = 'OV-260051';
