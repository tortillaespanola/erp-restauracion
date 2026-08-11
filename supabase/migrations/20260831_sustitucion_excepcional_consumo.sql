-- Entrada #9 de MEJORAS_UI_PENDIENTES.md: permitir, excepcionalmente,
-- consumir un artículo/semielaborado distinto al que fija la receta de
-- esa línea (caso real: Caja Grande sustituyendo a Caja Pequeña por
-- agotamiento de stock — no son fungibles como Huevina/Huevina Premium,
-- por eso no se resuelve con ingrediente_id, ver #5).
--
-- El backend (check_consumo_produccion / check_consumo_produccion_pf) ya
-- permite esto sin ningún cambio — nunca ha validado que el lote
-- consumido pertenezca al articulo_id de la receta. El único bloqueo
-- era de frontend (filtro estricto en cargarIngredientesConLotes).
--
-- motivo: se rellena automáticamente por el frontend (valor fijo, no
-- tecleado) cuando el lote elegido no coincide con la receta — señal
-- fiable para poder contar sustituciones después, no depende de que el
-- usuario se acuerde de indicarlo.
-- nota: texto libre opcional, para que el usuario explique el porqué si
-- quiere (mismo espíritu que ajustes_producto_final.motivo_detalle).

alter table consumo_produccion add column motivo text;
alter table consumo_produccion add column nota text;
alter table consumo_produccion add constraint chk_consumo_produccion_motivo
  check (motivo is null or motivo = 'sustitucion_excepcional');

alter table consumo_produccion_pf add column motivo text;
alter table consumo_produccion_pf add column nota text;
alter table consumo_produccion_pf add constraint chk_consumo_produccion_pf_motivo
  check (motivo is null or motivo = 'sustitucion_excepcional');

-- Las RPC de edición de producción cerrada también insertan líneas de
-- consumo nuevas (vía "+ Añadir líneas") — deben poder recibir motivo/nota
-- igual que el insert directo de una producción abierta. Misma firma,
-- solo se leen dos claves más (opcionales) del jsonb de cada línea.

create or replace function public.rpc_editar_produccion_semielaborado(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb,
  p_fecha_caducidad date default null
)
returns void
language plpgsql
as $$
declare
  v_linea jsonb;
begin
  if not exists (select 1 from producciones_semielaborado where id = p_id and estado = 'cerrada') then
    raise exception 'La producción % no existe o no está cerrada', p_id;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    if coalesce((v_linea->>'_deleted')::boolean, false) then
      delete from consumo_produccion where id = (v_linea->>'id')::bigint and produccion_id = p_id;
    elsif v_linea->>'id' is not null then
      update consumo_produccion
      set cantidad = (v_linea->>'cantidad')::numeric
      where id = (v_linea->>'id')::bigint and produccion_id = p_id;
    else
      insert into consumo_produccion (produccion_id, entrada_material_id, produccion_origen_id, cantidad, motivo, nota)
      values (
        p_id,
        (v_linea->>'entrada_material_id')::bigint,
        (v_linea->>'produccion_origen_id')::bigint,
        (v_linea->>'cantidad')::numeric,
        v_linea->>'motivo',
        v_linea->>'nota'
      );
    end if;
  end loop;

  update producciones_semielaborado
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas, fecha_caducidad = p_fecha_caducidad
  where id = p_id;
end;
$$;

create or replace function public.rpc_editar_produccion_producto_final(
  p_id bigint,
  p_fecha date,
  p_cantidad_producida numeric,
  p_notas text,
  p_lineas jsonb,
  p_fecha_caducidad date default null
)
returns void
language plpgsql
as $$
declare
  v_linea jsonb;
begin
  if not exists (select 1 from producciones_producto_final where id = p_id and estado = 'cerrada') then
    raise exception 'La producción % no existe o no está cerrada', p_id;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    if coalesce((v_linea->>'_deleted')::boolean, false) then
      delete from consumo_produccion_pf where id = (v_linea->>'id')::bigint and produccion_pf_id = p_id;
    elsif v_linea->>'id' is not null then
      update consumo_produccion_pf
      set cantidad = (v_linea->>'cantidad')::numeric
      where id = (v_linea->>'id')::bigint and produccion_pf_id = p_id;
    else
      insert into consumo_produccion_pf (produccion_pf_id, entrada_material_id, produccion_origen_id, cantidad, motivo, nota)
      values (
        p_id,
        (v_linea->>'entrada_material_id')::bigint,
        (v_linea->>'produccion_origen_id')::bigint,
        (v_linea->>'cantidad')::numeric,
        v_linea->>'motivo',
        v_linea->>'nota'
      );
    end if;
  end loop;

  update producciones_producto_final
  set fecha = p_fecha, cantidad_producida = p_cantidad_producida, notas = p_notas, fecha_caducidad = p_fecha_caducidad
  where id = p_id;
end;
$$;
