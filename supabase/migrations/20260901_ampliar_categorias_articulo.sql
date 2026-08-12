-- Amplía las categorías de materia prima, a petición directa del propietario.
--
-- "Cocina" se renombra a "Condimentos y Básicos" (mismo id=3, mismo
-- acronimo='COC') -- es la misma categoría real (aceite, sal, pimienta,
-- azúcar, azafrán, pimentón...), solo más descriptiva; no se toca el
-- acronimo para no invalidar los códigos de artículo ya generados con
-- prefijo COC- (AOVE SPAIN, AOVE CE).
--
-- 3 categorías nuevas, sin artículos todavía (se darán de alta a mano en
-- Articulos.jsx cuando corresponda): Carnes, Pescados y Mariscos, y
-- Cereales/Legumbres/Pan y Pasta (arroz, pasta, pan, legumbres).
--
-- Verduras, Lácteos y Ovoproductos y Packaging quedan sin cambios.

update categorias_articulo set nombre = 'Condimentos y Básicos' where nombre = 'Cocina';

insert into categorias_articulo (nombre, acronimo) values
  ('Carnes', 'CAR'),
  ('Pescados y Mariscos', 'PYM'),
  ('Cereales, Legumbres, Pan y Pasta', 'CLP');
