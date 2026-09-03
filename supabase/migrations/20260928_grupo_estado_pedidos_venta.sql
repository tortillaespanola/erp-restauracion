-- BLOQUE 4 (CONTRATO_UX_PEDIDOS_VENTA.md): pedidos_venta.estado es texto libre sin orden alfabético
-- útil para el listado -- pendiente/en_producción/servido/cancelado no agrupan "activo vs cerrado"
-- si se ordena por nombre. El orden por defecto de la pantalla de Pedidos (activos primero, cerrados
-- al fondo, hoy calculado en cliente con GRUPO_ESTADO) necesita traducirse a un .order() de servidor
-- para ser coherente con la paginación por .range() -- de ahí esta columna generada, que replica
-- exactamente GRUPO_ESTADO de Pedidos.jsx.
--
-- Columna GENERATED (no se escribe nunca a mano): Postgres la recalcula sola en cada INSERT/UPDATE
-- de `estado`, así que no puede desincronizarse.
alter table pedidos_venta
  add column grupo_estado smallint generated always as (
    case when estado in ('servido', 'cancelado') then 1 else 0 end
  ) stored;

comment on column pedidos_venta.grupo_estado is
  '0 = activo (pendiente/en_producción), 1 = cerrado (servido/cancelado) -- espejo de GRUPO_ESTADO en Pedidos.jsx, solo para ordenar en servidor.';
