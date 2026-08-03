-- Ubicaciones — Capa 1 de un modelo más amplio (stock por ubicación,
-- traspasos, POS) que se construirá en capas posteriores. Esta migración
-- es solo la tabla en sí: no toca entrada_material, producciones_semielaborado,
-- producciones_producto_final ni ninguna vista de stock (eso es Capa 2), y
-- no modela nada de servicio en sala/mesas/comandas (sin caso real todavía).
--
-- Basado en UBICACIONES_DIAGNOSTICO.md: hoy no existe ningún concepto de
-- lugar físico interno, así que esto parte de cero, sin nada que reconciliar.
--
-- Sigue el mismo patrón de partición ya aplicado en 20260807_negocio_id_particion.sql:
-- negocio_id con el mismo uuid fijo por default, y la misma policy
-- "Acceso total temporal" (auth.role() = 'authenticated' AND negocio_id = ...).
--
-- Decisión consciente (confirmada con el usuario antes de aplicar): el tipo
-- 'evento' no recibe campos propios (p. ej. fecha_inicio/fecha_fin) en esta
-- capa. Se resolverá en Capa 3/4 cuando exista el caso real de traspaso o
-- POS que lo exija.

create table ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('almacen', 'centro_produccion', 'punto_venta', 'evento')),
  ubicacion_padre_id uuid references ubicaciones(id),
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id),
  activa boolean not null default true,
  notas text,
  created_at timestamptz not null default now()
);

alter table ubicaciones enable row level security;

create policy "Acceso total temporal" on ubicaciones for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

grant select, insert, update, delete on ubicaciones to authenticated;
