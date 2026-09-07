-- CONTRATO_MULTITENANT.md, Tarea 7: secuencias_lote tenia el mismo problema que resolvimos en
-- facturas_venta_secuencia (Tarea 4) -- PRIMARY KEY (clave) global, no (negocio_id, clave) --
-- pero con mucho mas radio de impacto: la usan 8 triggers distintos (pedidos de venta y de
-- compra, albaranes de compra y venta, facturas de compra, y los 3 lotes de produccion/materia
-- prima), no solo un tipo de documento.
--
-- Hallazgo durante la investigacion (igual que el trigger legado de Tarea 4): de esos 8
-- triggers, solo 2 (trg_codigo_ov, trg_codigo_oc) estaban versionados en el repo. Los otros 6 --
-- y la propia funcion generar_codigo() -- solo vivian en la base de datos. Esta migracion los
-- trae a control de versiones tal como estan hoy en produccion (sin cambios de comportamiento,
-- salvo en trg_numero_albaran_venta, ver mas abajo).
--
-- Decision sobre el formato visible (paralela a la de Tarea 4): de las 8 rutas, solo
-- albaranes_venta (prefijo DN-) sale de la empresa -- confirmado que
-- frontend/src/lib/generarAlbaranVentaPdf.js imprime numero_albaran en el PDF que se entrega al
-- cliente. Las otras 7 (OV-, OC-, GR-, PI-, FG-, WIP-, RM-/AUX-) son puramente internas, nunca
-- se exportan ni se imprimen para un tercero -- confirmado revisando el frontend, no asumido.
-- Por eso DN- recibe el mismo tratamiento que RE- (reutiliza negocios.codigo_corto, negocio A
-- sin segmento por continuidad, cualquier negocio nuevo obligado a llevarlo via la constraint ya
-- existente de Tarea 4) y el resto se queda con aislamiento interno puro, sin cambio de formato.

-- ============================================================
-- 1. secuencias_lote: clave compuesta (negocio_id, clave)
-- ============================================================
alter table secuencias_lote drop constraint secuencias_lote_pkey;
alter table secuencias_lote add primary key (negocio_id, clave);

-- ============================================================
-- 2. generar_codigo() reescrita -- negocio_actual() interno, no se toca ningun caller
-- ============================================================
-- Se resuelve el negocio DENTRO de la funcion (no pasando negocio_id como parametro nuevo)
-- para no tener que tocar los 8 triggers que la llaman -- todas las tablas llamantes son de las
-- 42, su propio DEFAULT en negocio_id ya resuelve negocio_actual() antes de que el trigger
-- BEFORE INSERT corra (Tarea 6), asi que la sesion ya tiene el negocio correcto en todo momento.
create or replace function public.generar_codigo(prefijo text, codigo_articulo text default null)
returns text
language plpgsql
as $$
declare
  anio text := to_char(current_date, 'YY');
  v_negocio uuid := negocio_actual();
  v_clave text;
  siguiente int;
begin
  if codigo_articulo is not null then
    v_clave := prefijo || '-' || codigo_articulo || '-' || anio;
  else
    v_clave := prefijo || '-' || anio;
  end if;

  insert into secuencias_lote (negocio_id, clave, ultimo_numero) values (v_negocio, v_clave, 1)
  on conflict (negocio_id, clave) do update set ultimo_numero = secuencias_lote.ultimo_numero + 1
  returning ultimo_numero into siguiente;

  return v_clave || lpad(siguiente::text, 4, '0');
end;
$$;

-- ============================================================
-- 3. Versionar los 6 triggers/funciones que hoy solo viven en la base de datos
--    (sin cambio de comportamiento -- se traen tal cual estan en produccion)
-- ============================================================
create or replace function public.trg_codigo_gr()
returns trigger
language plpgsql
as $$
begin
  NEW.codigo_interno := generar_codigo('GR');
  return NEW;
end;
$$;

drop trigger if exists trg_generar_codigo_gr on albaranes_compra;
create trigger trg_generar_codigo_gr before insert on albaranes_compra
  for each row execute function trg_codigo_gr();

create or replace function public.trg_codigo_pi()
returns trigger
language plpgsql
as $$
begin
  NEW.codigo_interno := generar_codigo('PI');
  return NEW;
end;
$$;

drop trigger if exists trg_generar_codigo_pi on facturas_compra;
create trigger trg_generar_codigo_pi before insert on facturas_compra
  for each row execute function trg_codigo_pi();

create or replace function public.trg_lote_pf()
returns trigger
language plpgsql
as $$
declare cod text;
begin
  select codigo into cod from productos_finales where id = NEW.producto_final_id;
  NEW.codigo_lote := generar_codigo('FG', coalesce(cod, 'XXX'));
  return NEW;
end;
$$;

drop trigger if exists trg_generar_lote_pf on producciones_producto_final;
create trigger trg_generar_lote_pf before insert on producciones_producto_final
  for each row execute function trg_lote_pf();

create or replace function public.trg_lote_material()
returns trigger
language plpgsql
as $$
declare
  cod text;
  tipo text;
begin
  select codigo, tipo_material into cod, tipo from articulos_compra where id = NEW.articulo_id;
  NEW.codigo_lote := generar_codigo(coalesce(tipo, 'RM'), coalesce(cod, 'XXX'));
  return NEW;
end;
$$;

drop trigger if exists trg_generar_lote_material on entrada_material;
create trigger trg_generar_lote_material before insert on entrada_material
  for each row execute function trg_lote_material();

create or replace function public.trg_lote_semi()
returns trigger
language plpgsql
as $$
declare cod text;
begin
  select codigo into cod from semielaborados where id = NEW.semielaborado_id;
  NEW.codigo_lote := generar_codigo('WIP', coalesce(cod, 'XXX'));
  return NEW;
end;
$$;

drop trigger if exists trg_generar_lote_semi on producciones_semielaborado;
create trigger trg_generar_lote_semi before insert on producciones_semielaborado
  for each row execute function trg_lote_semi();

-- ============================================================
-- 4. trg_numero_albaran_venta(): unico de los 6 con cambio de comportamiento --
--    segmento condicional de negocio en DN-, igual criterio que RE- en Tarea 4.
-- ============================================================
create or replace function public.trg_numero_albaran_venta()
returns trigger
language plpgsql
as $$
declare
  v_codigo_corto text;
begin
  if NEW.numero_albaran is null then
    select codigo_corto into v_codigo_corto from negocios where id = NEW.negocio_id;
    if v_codigo_corto is null then
      NEW.numero_albaran := generar_codigo('DN');
    else
      NEW.numero_albaran := generar_codigo('DN-' || v_codigo_corto);
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_generar_numero_albaran_venta on albaranes_venta;
create trigger trg_generar_numero_albaran_venta before insert on albaranes_venta
  for each row execute function trg_numero_albaran_venta();
