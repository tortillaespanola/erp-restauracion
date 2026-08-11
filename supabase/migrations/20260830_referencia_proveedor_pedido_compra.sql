-- Entrada #4 de MEJORAS_UI_PENDIENTES.md: referencia/número que el
-- proveedor da a NUESTRO pedido al confirmarlo — distinta de
-- albaranes_compra.numero_albaran (referencia del proveedor, pero a
-- nivel de albarán/entrega) y de articulo_proveedor.referencia_proveedor
-- (SKU del proveedor para un artículo, no de un pedido). Mismo patrón
-- que numero_albaran: texto libre, nullable.
--
-- Caso real que la motiva: episodio OV-260002/OC-260005 (Hogashop,
-- commit 9e69efb) — un pedido duplicado por error que no se pudo
-- detectar hasta revisar manualmente un albarán ya vinculado. Con este
-- campo, dos pedidos con la misma referencia del proveedor habría sido
-- la señal de duplicado.

alter table pedidos_compra add column referencia_proveedor text;
