-- Permite desactivar un cliente sin borrarlo (ej. cliente de muestra que no
-- fructificó), conservando intacto su histórico de pedidos/albaranes/facturas.
--
-- El filtro por "activo" se aplica solo en el desplegable de cliente al crear
-- un pedido nuevo (Pedidos.jsx) — los pedidos ya existentes de un cliente
-- desactivado siguen mostrando su nombre con normalidad (esa consulta no
-- filtra por activo).

alter table clientes add column activo boolean not null default true;
