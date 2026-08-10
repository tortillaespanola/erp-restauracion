-- 3 triggers de aviso (no bloqueo) para caducidad de materia prima /
-- semielaborado / producto final consumida o vendida después de su
-- fecha_caducidad. Ver PENDIENTES_MODELO.md #8 -- decisión ya tomada:
-- aviso, no bloqueo, mismo criterio que evento_directo.
--
-- Cubre los 4 puntos de consumo/venta pedidos, mapeados a 6 ramas
-- concretas (2 por trigger):
--
--  (a) artículo -> semielaborado         : consumo_produccion, rama entrada_material_id
--  (a-generalización) semi -> semi        : consumo_produccion, rama produccion_origen_id
--  (b) artículo -> producto final         : consumo_produccion_pf, rama entrada_material_id
--  (c) semielaborado -> producto final    : consumo_produccion_pf, rama produccion_origen_id
--  (d) producto final -> venta            : lineas_albaran_venta, rama produccion_pf_id
--  (d) mercadería -> venta directa        : lineas_albaran_venta, rama entrada_material_id
--
-- Sin condición de tipo_produccion/tipo_venta en ninguno -- a diferencia
-- de los triggers hermanos de stock negativo (que sí se limitan a
-- evento_directo), la incoherencia de fecha se avisa siempre. Si
-- fecha_caducidad es null (no capturada), no se compara nada -- no es
-- nuestro problema marcarlo aquí.
--
-- Mismo punto de enganche que los triggers de incidencia de stock
-- negativo ya existentes (AFTER, CONSTRAINT TRIGGER, DEFERRABLE
-- INITIALLY DEFERRED) sobre las mismas tres tablas.
--
-- Caso real que lo motivó: WIP-MIXKZ-260032 (ya borrado por el usuario
-- desde la UI, sin backfill necesario -- verificado limpio, sin
-- huérfanos).
--
-- Probado en transacción antes de aplicar: los 6 casos generan
-- exactamente 1 incidencia con motivo='caducidad' cada uno, en la
-- tabla y vía de origen correctas; un caso de control (no caducado) no
-- genera ninguna; re-validadas (UPDATE no-op) las 255 filas reales
-- existentes en las tres tablas (140 consumo_produccion, 56
-- consumo_produccion_pf, 59 lineas_albaran_venta) sin ningún fallo y
-- sin generar ninguna incidencia retroactiva -- confirma que no queda
-- ningún otro caso real de materia prima/semielaborado/producto final
-- caducado en los datos actuales, más allá del ya conocido y borrado.

create or replace function public.registrar_incidencia_caducidad_consumo()
returns trigger
language plpgsql
as $$
declare
  v_fecha_destino date;
  v_fecha_caducidad date;
begin
  select fecha into v_fecha_destino from producciones_semielaborado where id = NEW.produccion_id;

  if NEW.entrada_material_id is not null then
    select fecha_caducidad into v_fecha_caducidad from entrada_material where id = NEW.entrada_material_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_articulo (entrada_material_id, consumo_produccion_id, motivo)
      values (NEW.entrada_material_id, NEW.id, 'caducidad');
    end if;
  elsif NEW.produccion_origen_id is not null then
    select fecha_caducidad into v_fecha_caducidad from producciones_semielaborado where id = NEW.produccion_origen_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_semielaborado (produccion_semielaborado_id, consumo_produccion_id, motivo)
      values (NEW.produccion_origen_id, NEW.id, 'caducidad');
    end if;
  end if;

  return NEW;
end;
$$;

create constraint trigger trg_registrar_incidencia_caducidad_consumo
after insert or update on consumo_produccion
deferrable initially deferred
for each row execute function registrar_incidencia_caducidad_consumo();

create or replace function public.registrar_incidencia_caducidad_consumo_pf()
returns trigger
language plpgsql
as $$
declare
  v_fecha_destino date;
  v_fecha_caducidad date;
begin
  select fecha into v_fecha_destino from producciones_producto_final where id = NEW.produccion_pf_id;

  if NEW.entrada_material_id is not null then
    select fecha_caducidad into v_fecha_caducidad from entrada_material where id = NEW.entrada_material_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_articulo (entrada_material_id, consumo_produccion_pf_id, motivo)
      values (NEW.entrada_material_id, NEW.id, 'caducidad');
    end if;
  elsif NEW.produccion_origen_id is not null then
    select fecha_caducidad into v_fecha_caducidad from producciones_semielaborado where id = NEW.produccion_origen_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_semielaborado (produccion_semielaborado_id, consumo_produccion_pf_id, motivo)
      values (NEW.produccion_origen_id, NEW.id, 'caducidad');
    end if;
  end if;

  return NEW;
end;
$$;

create constraint trigger trg_registrar_incidencia_caducidad_consumo_pf
after insert or update on consumo_produccion_pf
deferrable initially deferred
for each row execute function registrar_incidencia_caducidad_consumo_pf();

create or replace function public.registrar_incidencia_caducidad_venta()
returns trigger
language plpgsql
as $$
declare
  v_fecha_destino date;
  v_fecha_caducidad date;
begin
  select fecha into v_fecha_destino from albaranes_venta where id = NEW.albaran_venta_id;

  if NEW.produccion_pf_id is not null then
    select fecha_caducidad into v_fecha_caducidad from producciones_producto_final where id = NEW.produccion_pf_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_producto_final (produccion_pf_id, linea_albaran_venta_id, motivo)
      values (NEW.produccion_pf_id, NEW.id, 'caducidad');
    end if;
  elsif NEW.entrada_material_id is not null then
    select fecha_caducidad into v_fecha_caducidad from entrada_material where id = NEW.entrada_material_id;
    if v_fecha_caducidad is not null and v_fecha_caducidad < v_fecha_destino then
      insert into incidencias_stock_articulo (entrada_material_id, linea_albaran_venta_id, motivo)
      values (NEW.entrada_material_id, NEW.id, 'caducidad');
    end if;
  end if;

  return NEW;
end;
$$;

create constraint trigger trg_registrar_incidencia_caducidad_venta
after insert or update on lineas_albaran_venta
deferrable initially deferred
for each row execute function registrar_incidencia_caducidad_venta();
