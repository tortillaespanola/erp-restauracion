-- Preparación estructural para un futuro multi-negocio (sin activarlo).
-- Contexto: auditoría de UBICACIONES_DIAGNOSTICO.md detectó que ninguna
-- tabla tiene columna de propietario y que las 32 policies RLS existentes
-- dan "acceso total a cualquier autenticado" (patrón "Acceso total
-- temporal" repetido en cada migración anterior). No hay caso real de
-- segundo negocio todavía, pero el histórico es pequeño ahora y crece con
-- cada tarea nueva — más barato particionar hoy que retrofitear después.
--
-- Alcance explícito de esta migración:
--   1. Tabla `negocios` con una única fila (el negocio actual).
--   2. `negocio_id uuid not null default '<uuid del negocio actual>'
--      references negocios(id)` en las 32 tablas existentes — el default
--      asigna el histórico entero sin tocar ninguna fila a mano y hace que
--      todo insert nuevo del frontend (que no fija negocio_id) quede
--      correcto sin cambiar ni una línea de frontend/src.
--   3. Cada policy "Acceso total temporal" pasa a exigir además
--      negocio_id = '<mismo uuid>' — con un único valor posible por ahora,
--      el comportamiento observable no cambia en nada.
--
-- Explícitamente FUERA de alcance (fase futura, cuando exista el caso
-- real): login/selector de negocio en el frontend, más de una fila en
-- `negocios`, y cualquier uso de auth.jwt()/current_setting() para elegir
-- el negocio dinámicamente.

create table negocios (
  id uuid primary key,
  nombre text not null,
  created_at timestamptz not null default now()
);

insert into negocios (id, nombre) values ('a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00', 'Negocio principal');

alter table "ajustes_articulo" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "ajustes_producto_final" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "ajustes_semielaborado" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "albaranes_compra" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "albaranes_venta" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "articulo_proveedor" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "articulos_compra" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "clientes" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "consumo_produccion" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "consumo_produccion_pf" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "empresa_config" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "entrada_material" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "factura_compra_albaran" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "factura_venta_albaran" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "facturas_compra" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "facturas_venta" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "incidencias_stock_articulo" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "incidencias_stock_producto_final" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "incidencias_stock_semielaborado" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "lineas_albaran_venta" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "lineas_pedido_compra" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "lineas_pedido_venta" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "pedidos_compra" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "pedidos_venta" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "producciones_producto_final" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "producciones_semielaborado" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "productos_finales" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "proveedores" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "receta_producto_final" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "receta_semielaborado" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "secuencias_lote" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);
alter table "semielaborados" add column negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00' references negocios(id);

alter policy "Acceso total temporal" on "ajustes_articulo" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "ajustes_producto_final" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "ajustes_semielaborado" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "albaranes_compra" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "albaranes_venta" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "articulo_proveedor" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "articulos_compra" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "clientes" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "consumo_produccion" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "consumo_produccion_pf" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "empresa_config" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "entrada_material" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "factura_compra_albaran" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "factura_venta_albaran" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "facturas_compra" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "facturas_venta" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "incidencias_stock_articulo" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "incidencias_stock_producto_final" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "incidencias_stock_semielaborado" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "lineas_albaran_venta" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "lineas_pedido_compra" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "lineas_pedido_venta" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "pedidos_compra" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "pedidos_venta" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "producciones_producto_final" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "producciones_semielaborado" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "productos_finales" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "proveedores" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "receta_producto_final" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "receta_semielaborado" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "secuencias_lote" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
alter policy "Acceso total temporal" on "semielaborados" using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid) with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

alter table negocios enable row level security;
create policy "Lectura del propio negocio" on negocios for select
  using (auth.role() = 'authenticated' and id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
grant select on negocios to authenticated;
