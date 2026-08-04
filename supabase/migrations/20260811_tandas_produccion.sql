-- tandas_produccion: ancla persistente para agrupar N pedidos de venta en
-- una única tanda de producción diaria (flujo POS de FLUJO_TORTILLA.md
-- Sección D / POS_CONTRATOS_PANTALLA.md). Sustituye la idea inicial de
-- pasar el conjunto de pedidos en memoria de sesión del navegador — el
-- flujo cruza dispositivos y turnos (almacén, cocina, entrega), así que
-- necesita estado en servidor.
--
-- Diseño acordado: FK directa (pedidos_venta.tanda_id), no tabla puente
-- N a N — la relación real es 1 a N (una tanda agrupa varios pedidos; un
-- pedido pertenece a una sola tanda), no hay caso hoy de un pedido
-- repartido entre tandas. Mismo patrón que ya usa el esquema
-- (producciones_producto_final.pedido_id, FK singular de hijo a padre).
--
-- Histórico existente: tanda_id queda NULL en las tres tablas, sin
-- backfill — no hay ninguna tanda real a la que asignar el histórico.

create table tandas_produccion (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id),
  created_at timestamptz not null default now()
);

alter table tandas_produccion enable row level security;

create policy "Acceso total temporal" on tandas_produccion for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

grant select, insert, update, delete on tandas_produccion to authenticated;

alter table pedidos_venta
  add column tanda_id uuid references tandas_produccion(id);

alter table producciones_semielaborado
  add column tanda_id uuid references tandas_produccion(id);

alter table producciones_producto_final
  add column tanda_id uuid references tandas_produccion(id);
