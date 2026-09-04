-- CONTRATO_PAGOS_VENTA.md, Bloque 2: modelo de datos del módulo de Pagos de Venta.
--
-- `pagos` es el hecho de que el cliente pagó algo; `pago_aplicacion` es la tabla puente que
-- resuelve a qué documento(s) se aplica ese pago (sección 2 del contrato). Ningún saldo se
-- persiste en ningún lado -- se calcula siempre al vuelo (Bloque 3), mismo criterio ya aplicado a
-- facturas_venta.total en CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md.
--
-- anulada en pagos, añadida ya en este bloque (no en uno aparte) porque el propio contrato pide
-- crearla aquí para que el Bloque 5/7 no necesite otra migración -- mismo patrón que
-- facturas_venta.anulada: sin edición, sin borrado físico, solo apagado simple con rastro de
-- auditoría (sección 6 y 7 del contrato).
create table pagos (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references clientes(id),
  fecha date not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo text not null check (metodo in ('efectivo', 'twint', 'tarjeta', 'transferencia')),
  anulada boolean not null default false,
  notas text,
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid references negocios(id),
  created_at timestamptz not null default now()
);

-- CHECK exactamente-uno (sección 2 del contrato): ni los dos FK nulos ni los dos presentes a la
-- vez -- una aplicación siempre resuelve a un único documento, factura O albarán, nunca ambos ni
-- ninguno. Mismo criterio de "un solo destino por fila" que factura_venta_albaran, pero ahí el
-- destino ya era fijo (factura); aquí puede ser cualquiera de los dos tipos de documento.
create table pago_aplicacion (
  id bigint generated always as identity primary key,
  pago_id bigint not null references pagos(id),
  factura_venta_id bigint references facturas_venta(id),
  albaran_venta_id bigint references albaranes_venta(id),
  monto_aplicado numeric(12,2) not null check (monto_aplicado > 0),
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid references negocios(id),
  created_at timestamptz not null default now(),
  constraint pago_aplicacion_exactamente_un_documento check (
    (factura_venta_id is not null and albaran_venta_id is null) or
    (factura_venta_id is null and albaran_venta_id is not null)
  )
);

alter table pagos enable row level security;
create policy "Acceso total temporal" on pagos for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
grant select, insert, update on pagos to authenticated;

alter table pago_aplicacion enable row level security;
create policy "Acceso total temporal" on pago_aplicacion for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);
-- Sin `update`/`delete`: una fila de pago_aplicacion, igual que factura_venta_albaran, no se
-- corrige ni se borra -- si un pago se registró mal, se anula el pago entero (columna `anulada`
-- en `pagos`), sus aplicaciones quedan intactas como rastro de auditoría y dejan de contar en los
-- cálculos de saldo (Bloque 3/7). Solo insert (alta) y select (cálculo de saldo, listado).
grant select, insert on pago_aplicacion to authenticated;
