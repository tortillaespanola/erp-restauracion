-- Añade fecha_caducidad a producciones_semielaborado, mismo patrón ya
-- usado en producto final (dias_caducidad_default a nivel de tipo +
-- fecha_caducidad calculada al cerrar, editable después).
--
-- Motivo: caso real confirmado (WIP-MIXKZ-260032, ya borrado desde la UI
-- por el usuario) de materia prima consumida ya caducada sin ningún
-- aviso -- ver PENDIENTES_MODELO.md #8 y #9. Sin fecha_caducidad en
-- semielaborado, no hay forma de detectar el caso simétrico
-- "semielaborado caducado consumido en producto final" ni de mostrar
-- aviso en el desplegable de consumo. Primer paso de un diseño más
-- amplio (incidencias de caducidad en los 4 puntos de consumo/venta),
-- que se aplica en migraciones separadas a continuación.
--
-- Probado en transacción antes de aplicar: cierre con
-- dias_caducidad_default calcula fecha_caducidad correctamente; cierre
-- sin dias_caducidad_default deja fecha_caducidad en null sin error;
-- editar fecha_caducidad manualmente después de cerrada no se ve
-- pisado por el trigger (solo actúa en la transición abierta->cerrada);
-- la vista stock_lotes_semielaborado expone la columna nueva sin
-- afectar los datos reales existentes (todos en null hasta que se
-- configure dias_caducidad_default o se edite a mano).

alter table semielaborados add column dias_caducidad_default integer;
alter table producciones_semielaborado add column fecha_caducidad date;

create or replace function public.calcular_fecha_caducidad_semi()
returns trigger
language plpgsql
as $$
declare
  v_dias integer;
begin
  if OLD.estado = 'abierta' and NEW.estado = 'cerrada' and NEW.fecha_caducidad is null then
    select dias_caducidad_default into v_dias from semielaborados where id = NEW.semielaborado_id;
    if v_dias is not null then
      NEW.fecha_caducidad := NEW.fecha + v_dias;
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_calcular_fecha_caducidad_semi
before update on producciones_semielaborado
for each row execute function calcular_fecha_caducidad_semi();

create or replace view stock_lotes_semielaborado as
select p.id as produccion_id,
  p.semielaborado_id,
  s.nombre,
  s.unidad,
  p.cantidad_producida,
  p.cantidad_producida
    - coalesce((select sum(cp.cantidad) from consumo_produccion cp where cp.produccion_origen_id = p.id), 0)
    - coalesce((select sum(cppf.cantidad) from consumo_produccion_pf cppf where cppf.produccion_origen_id = p.id), 0)
    + coalesce((select sum(aj.cantidad) from ajustes_semielaborado aj where aj.produccion_id = p.id), 0)
    as stock_disponible,
  p.fecha,
  p.ubicacion_id,
  p.codigo_lote,
  p.fecha_caducidad
from producciones_semielaborado p
  join semielaborados s on s.id = p.semielaborado_id
where p.estado = 'cerrada';
