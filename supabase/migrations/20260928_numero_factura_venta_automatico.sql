-- BLOQUE 1 (CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md): numeración automática y secuencial de
-- facturas de venta, formato RE-{año}-{secuencial de 3 dígitos, overflow natural a 4+ vía lpad}.
--
-- A diferencia de generar_codigo('OV') (usado en pedidos_venta/pedidos_compra), que NO reinicia
-- nunca -- es un contador global que sigue subiendo aunque cambie el año --, este SÍ reinicia a
-- 001 cada año natural. Por eso no se reutiliza esa función: se usa una tabla contador propia,
-- una fila por año, para poder resetear de forma atómica y segura ante inserciones concurrentes
-- (INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING es atómico fila por fila en Postgres).
--
-- El año se toma de NEW.fecha (fecha de la factura), no de la fecha de inserción en BD -- una
-- factura fechada en diciembre 2026 pero insertada ya en enero 2027 debe numerarse como 2026.

create table facturas_venta_secuencia (
  anio integer primary key,
  ultimo_numero integer not null default 0
);

alter table facturas_venta_secuencia enable row level security;
create policy "Acceso total temporal" on facturas_venta_secuencia for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update on facturas_venta_secuencia to authenticated;

create or replace function public.trg_generar_numero_factura_venta()
returns trigger
language plpgsql
as $$
declare
  v_anio integer := extract(year from coalesce(NEW.fecha, current_date))::int;
  v_siguiente integer;
begin
  insert into facturas_venta_secuencia (anio, ultimo_numero)
  values (v_anio, 1)
  on conflict (anio) do update set ultimo_numero = facturas_venta_secuencia.ultimo_numero + 1
  returning ultimo_numero into v_siguiente;

  -- Bloqueada sin excepción (sección 1 del contrato): se sobreescribe SIEMPRE, incluso si el
  -- cliente llegara a mandar algo en numero_factura -- nunca se respeta un valor manual.
  NEW.numero_factura := 'RE-' || v_anio || '-' || lpad(v_siguiente::text, 3, '0');
  return NEW;
end;
$$;

create trigger trg_numero_factura_venta
before insert on facturas_venta
for each row execute function trg_generar_numero_factura_venta();
