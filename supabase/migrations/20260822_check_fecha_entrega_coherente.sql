-- CHECK constraint: fecha_entrega_prevista no puede ser anterior a fecha,
-- en pedidos_venta y pedidos_compra. A diferencia de otras validaciones
-- de esta sesión, no hay ningún caso de uso legítimo para este dato: un
-- pedido no puede preverse entregado antes de haberse creado.
--
-- Motivado por dos casos reales encontrados con este problema en
-- pedidos_venta (OV-260060 id=85, OV-260062 id=87), corregidos por
-- separado antes de esta migración tras confirmar con el usuario qué
-- campo estaba mal tecleado en cada caso (para OV-260060, la fecha de
-- entrega ya coincidía con el albarán real que lo sirvió — la fecha del
-- pedido era la errónea). Sin este CHECK, el problema ya se había
-- repetido una vez después de una corrección manual anterior
-- (20260821_fix_fecha_entrega_prevista_typos.sql, sin validación
-- añadida) — de ahí que la validación en frontend no baste por sí sola.
--
-- Probado antes de aplicar: el CHECK no rechaza ningún dato real
-- existente en ninguna de las dos tablas (transacción de prueba con
-- ROLLBACK), y sí bloquea una violación deliberada.

alter table pedidos_venta
  add constraint chk_pedidos_venta_fecha_entrega_coherente
  check (fecha_entrega_prevista is null or fecha_entrega_prevista >= fecha);

alter table pedidos_compra
  add constraint chk_pedidos_compra_fecha_entrega_coherente
  check (fecha_entrega_prevista is null or fecha_entrega_prevista >= fecha);
