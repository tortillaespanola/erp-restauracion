-- Fase C de unidades_medida (UI de Ingredientes/Artículos): el trigger de validación de
-- 20260923_unidades_medida.sql (trg_validar_unidad_articulo_ingrediente) solo se dispara en
-- INSERT/UPDATE sobre articulo_ingrediente -- editar unidad_id directamente en ingredientes o
-- articulos_compra, cuando ya están vinculados a una pareja con unidad distinta, no lo tocaba en
-- absoluto y dejaba el vínculo inconsistente en silencio. Trigger complementario: al cambiar
-- unidad_id en cualquiera de las dos tablas, comprueba sus vínculos existentes en
-- articulo_ingrediente y bloquea si alguno queda con unidades distintas.
create or replace function public.validar_cambio_unidad_vinculado()
returns trigger
language plpgsql
as $$
declare
  v_conflicto record;
begin
  if NEW.unidad_id = OLD.unidad_id then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'ingredientes' then
    select a.nombre into v_conflicto
    from articulo_ingrediente ai
    join articulos_compra a on a.id = ai.articulo_id
    where ai.ingrediente_id = NEW.id and a.unidad_id <> NEW.unidad_id
    limit 1;
    if found then
      raise exception 'No se puede cambiar la unidad de "%": está vinculado al artículo "%" con una unidad distinta -- desvincúlalo primero',
        NEW.nombre, v_conflicto.nombre;
    end if;
  elsif TG_TABLE_NAME = 'articulos_compra' then
    select i.nombre into v_conflicto
    from articulo_ingrediente ai
    join ingredientes i on i.id = ai.ingrediente_id
    where ai.articulo_id = NEW.id and i.unidad_id <> NEW.unidad_id
    limit 1;
    if found then
      raise exception 'No se puede cambiar la unidad de "%": está vinculado al ingrediente "%" con una unidad distinta -- desvincúlalo primero',
        NEW.nombre, v_conflicto.nombre;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger trg_validar_cambio_unidad_ingredientes
before update of unidad_id on ingredientes
for each row execute function validar_cambio_unidad_vinculado();

create trigger trg_validar_cambio_unidad_articulos
before update of unidad_id on articulos_compra
for each row execute function validar_cambio_unidad_vinculado();
