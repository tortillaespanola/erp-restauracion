-- Parametriza las unidades de ingredientes/artículos de compra, hoy texto libre sin pantalla de
-- configuración -- causa real detectada al construir el subtotal de Stock en Nivel 1 de la futura
-- página Inventario: 2 de las 15 parejas de articulo_ingrediente tenían la misma unidad física
-- escrita distinto (AOVE: 'l' vs 'L'; ZZ_Tomate Triturado: 'k' vs 'kg'), sin ningún mecanismo que lo
-- impidiera. Catálogo de 3 unidades confirmado contra los valores reales existentes (auditoría de
-- sesión: 5 strings distintos en total en ambas columnas, mapean limpios a estas 3, sin ambigüedad).
--
-- Decisión de alcance (confirmada explícitamente): esta migración NO dropea la columna de texto
-- libre `unidad` de `ingredientes`/`articulos_compra` -- 80 ocurrencias de `.unidad` repartidas en
-- 12 archivos del frontend (grep contra frontend/src/pages), más las vistas stock_articulos y
-- stock_lotes_articulo, dependen hoy de que esa columna exista y sea texto. Dropearla ahora
-- rompería la app en producción antes de que cada pantalla se migre. En su lugar: `unidad_id`
-- (FK) pasa a ser la fuente de verdad real desde ya (el trigger de validación de
-- articulo_ingrediente corre sobre ella), y un trigger espejo mantiene `unidad` (texto)
-- sincronizada automáticamente desde `unidades_medida.codigo` cada vez que `unidad_id` cambia --
-- así los 12 archivos existentes y las 2 vistas siguen funcionando exactamente igual que hoy, sin
-- tocar ni una línea de ese código. Dropear `unidad` (texto) y migrar esos 12 archivos a leer
-- `unidad_id` queda como deuda técnica controlada, pendiente para cuando se toque cada pantalla --
-- no es tarea de esta migración.
-- negocio_id + RLS: mismo patrón que el resto de tablas de catálogo del proyecto (ver
-- categorias_articulo), no un caso especial "global sin RLS" que no existe en ningún otro sitio
-- del esquema.
create table unidades_medida (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  nombre text not null,
  tipo text not null check (tipo in ('peso', 'volumen', 'unidad')),
  negocio_id uuid not null default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid references negocios(id),
  created_at timestamptz default now()
);

alter table unidades_medida enable row level security;

create policy "Acceso total temporal" on unidades_medida
  for all
  using (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid)
  with check (auth.role() = 'authenticated' and negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

insert into unidades_medida (codigo, nombre, tipo) values
  ('kg', 'Kilogramo', 'peso'),
  ('l', 'Litro', 'volumen'),
  ('ud', 'Unidad', 'unidad');

alter table ingredientes add column unidad_id bigint references unidades_medida(id);
alter table articulos_compra add column unidad_id bigint references unidades_medida(id);

-- Mapeo de los 5 strings reales existentes (auditoría de sesión, sin ambigüedad): kg->kg, k->kg,
-- l->l, L->l, ud->ud.
update ingredientes set unidad_id = (
  select id from unidades_medida where codigo = case
    when ingredientes.unidad in ('kg', 'k') then 'kg'
    when ingredientes.unidad in ('l', 'L') then 'l'
    when ingredientes.unidad = 'ud' then 'ud'
  end
);

update articulos_compra set unidad_id = (
  select id from unidades_medida where codigo = case
    when articulos_compra.unidad in ('kg', 'k') then 'kg'
    when articulos_compra.unidad in ('l', 'L') then 'l'
    when articulos_compra.unidad = 'ud' then 'ud'
  end
);

-- Verificación explícita de que el mapeo no dejó ningún NULL -- no se asume por la auditoría
-- previa, se comprueba en el momento de aplicar.
do $$
declare
  v_null_ingredientes int;
  v_null_articulos int;
begin
  select count(*) into v_null_ingredientes from ingredientes where unidad_id is null;
  select count(*) into v_null_articulos from articulos_compra where unidad_id is null;
  if v_null_ingredientes > 0 or v_null_articulos > 0 then
    raise exception 'unidades_medida: mapeo incompleto -- % ingredientes y % articulos_compra quedaron con unidad_id NULL tras el backfill',
      v_null_ingredientes, v_null_articulos;
  end if;
end $$;

alter table ingredientes alter column unidad_id set not null;
alter table articulos_compra alter column unidad_id set not null;

-- Trigger espejo: mantiene `unidad` (texto) sincronizada desde `unidad_id` -- unidad_id es la
-- fuente de verdad desde ahora, `unidad` (texto) queda como compatibilidad transparente para el
-- código que todavía no se migró.
create or replace function public.sincronizar_unidad_texto()
returns trigger
language plpgsql
as $$
begin
  select codigo into NEW.unidad from unidades_medida where id = NEW.unidad_id;
  return NEW;
end;
$$;

create trigger trg_sincronizar_unidad_texto_ingredientes
before insert or update of unidad_id on ingredientes
for each row execute function sincronizar_unidad_texto();

create trigger trg_sincronizar_unidad_texto_articulos
before insert or update of unidad_id on articulos_compra
for each row execute function sincronizar_unidad_texto();

-- Trigger de validación: articulo_ingrediente solo puede vincular un artículo y un ingrediente que
-- compartan unidad_id -- comparación explícita con IS NULL + <>, no IS NOT DISTINCT FROM (evita el
-- error ya cometido en esta misma sesión con ese operador: aquí NO se quiere tratar NULL=NULL como
-- "coinciden" -- un ingrediente o artículo sin unidad_id asignada (no debería poder pasar tras el
-- NOT NULL de arriba, pero la validación es defensiva) debe bloquear la vinculación, no dejarla
-- pasar en silencio).
create or replace function public.validar_unidad_articulo_ingrediente()
returns trigger
language plpgsql
as $$
declare
  v_unidad_ingrediente bigint;
  v_unidad_articulo bigint;
begin
  select unidad_id into v_unidad_ingrediente from ingredientes where id = NEW.ingrediente_id;
  select unidad_id into v_unidad_articulo from articulos_compra where id = NEW.articulo_id;

  if v_unidad_ingrediente is null or v_unidad_articulo is null or v_unidad_ingrediente <> v_unidad_articulo then
    raise exception 'articulo_ingrediente: no se puede vincular articulo_id=% (unidad_id=%) con ingrediente_id=% (unidad_id=%) -- las unidades no coinciden',
      NEW.articulo_id, v_unidad_articulo, NEW.ingrediente_id, v_unidad_ingrediente;
  end if;

  return NEW;
end;
$$;

create trigger trg_validar_unidad_articulo_ingrediente
before insert or update on articulo_ingrediente
for each row execute function validar_unidad_articulo_ingrediente();

grant select, insert, update on unidades_medida to authenticated;
