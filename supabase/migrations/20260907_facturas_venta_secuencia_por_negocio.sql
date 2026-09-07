-- CONTRATO_MULTITENANT.md, Tarea 4: facturas_venta_secuencia era un contador global por año
-- (anio -> ultimo_numero) -- con dos negocios facturando en paralelo, compartirian la misma
-- numeracion correlativa, contablemente inaceptable. Se particiona por negocio_id, igual que
-- las 42 tablas de la Tarea 2, pero esta tabla nacio despues de esa migracion y nunca entro en
-- su array -- por eso seguia con RLS sin filtro de negocio y sin columna negocio_id propia.
--
-- Verificado antes de escribir esto (ver conversacion): 17 facturas reales de negocio A,
-- numeradas RE-2026-001..017 (una anulada, numero no liberado) -- negocio A debe continuar
-- desde 17, no reiniciar. Confirmado con datos reales, no supuesto.
--
-- Decision sobre el formato visible (no solo la clave interna): dos negocios sin identificador
-- propio en el numero podrian producir el mismo texto "RE-2026-001" sobre el papel -- aceptable
-- solo si ambos negocios son la misma entidad fiscal, cosa que hoy no se puede descartar. Se
-- añade un codigo corto por negocio en el numero visible para las facturas NUEVAS. El negocio A
-- se queda para siempre en su formato actual sin segmento -- no solo las 17 ya emitidas, sino
-- tambien las futuras -- porque la garantia de no-colision no depende de que A cambie: depende
-- de que CUALQUIER OTRO negocio este obligado a llevar codigo_corto (constraint mas abajo). Un
-- negocio nuevo nunca puede coincidir con A (A es el unico sin segmento) ni con otro negocio
-- nuevo (codigo_corto es UNIQUE).

-- ============================================================
-- 1. codigo_corto en negocios
-- ============================================================
alter table negocios add column codigo_corto text unique;

-- 2 a 4 letras/digitos en mayuscula -- corto pero no forzado a una longitud fija.
alter table negocios add constraint negocios_codigo_corto_formato_check
  check (codigo_corto is null or codigo_corto ~ '^[A-Z0-9]{2,4}$');

-- Excepcion nominal al UUID real de negocio A -- mismo patron ya usado en el proyecto para
-- excepciones historicas de un solo caso conocido (ver Tarea 6). Cualquier negocio nuevo queda
-- bloqueado por esta constraint si se intenta crear sin codigo_corto.
alter table negocios add constraint negocios_codigo_corto_legado_check
  check (codigo_corto is not null or id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid);

-- ============================================================
-- 2. facturas_venta_secuencia: negocio_id + clave compuesta
-- ============================================================
alter table facturas_venta_secuencia add column negocio_id uuid references negocios(id);

update facturas_venta_secuencia set negocio_id = 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid
  where anio = 2026;

alter table facturas_venta_secuencia alter column negocio_id set not null;
alter table facturas_venta_secuencia drop constraint facturas_venta_secuencia_pkey;
alter table facturas_venta_secuencia add primary key (negocio_id, anio);

-- ============================================================
-- 3. RLS de facturas_venta_secuencia -- nunca habia tenido filtro de negocio_id
-- ============================================================
drop policy "Acceso total temporal" on facturas_venta_secuencia;
create policy "Acceso total temporal" on facturas_venta_secuencia for all
  using ((select auth.role()) = 'authenticated' and negocio_id = (select negocio_actual()))
  with check ((select auth.role()) = 'authenticated' and negocio_id = (select negocio_actual()));

-- ============================================================
-- 4. Funcion generadora reescrita
-- ============================================================
-- Se usa NEW.negocio_id, no una nueva llamada a negocio_actual(): facturas_venta ya es una de
-- las 42 tablas, su propio DEFAULT en negocio_id ya resuelve negocio_actual() (Tarea 6) ANTES
-- de que este trigger BEFORE INSERT se ejecute (los DEFAULT se aplican antes que los triggers).
-- Leer NEW.negocio_id ata el contador al negocio real de la fila, sin una segunda consulta a la
-- sesion redundante con la primera.
create or replace function public.trg_generar_numero_factura_venta()
returns trigger
language plpgsql
as $$
declare
  v_anio integer := extract(year from coalesce(NEW.fecha, current_date))::int;
  v_codigo_corto text;
  v_siguiente integer;
begin
  select codigo_corto into v_codigo_corto from negocios where id = NEW.negocio_id;

  insert into facturas_venta_secuencia (negocio_id, anio, ultimo_numero)
  values (NEW.negocio_id, v_anio, 1)
  on conflict (negocio_id, anio) do update set ultimo_numero = facturas_venta_secuencia.ultimo_numero + 1
  returning ultimo_numero into v_siguiente;

  -- coalesce(v_codigo_corto || '-', ''): negocio A (codigo_corto NULL) mantiene el formato
  -- exacto de siempre; cualquier otro negocio lleva su segmento, garantizado no-NULL por la
  -- constraint de arriba.
  NEW.numero_factura := 'RE-' || coalesce(v_codigo_corto || '-', '') || v_anio || '-' || lpad(v_siguiente::text, 3, '0');
  return NEW;
end;
$$;

-- ============================================================
-- 5. Trigger y funcion legados -- hallazgo durante las pruebas de esta misma tarea
-- ============================================================
-- No versionados en ningun archivo de migracion anterior (solo vivian en la base de datos).
-- Su resultado (NEW.numero_factura = generar_codigo('SI')) siempre quedaba sobrescrito por el
-- trigger de arriba -- confirmado que ninguna otra tabla ni funcion los usa. No eran solo
-- codigo muerto: al facturar un negocio que no es A, generar_codigo('SI') intenta un UPDATE
-- sobre la fila compartida 'SI-26' de secuencias_lote (PRIMARY KEY (clave), global, sin
-- particionar -- fuera del alcance de esta tarea) que pertenece a negocio A, y la RLS de la
-- Tarea 2 bloquea ese UPDATE para cualquier otro negocio -- rompia la creacion de facturas para
-- todo negocio que no fuera A. Se elimina aqui porque sin quitarlo, esta misma tarea no
-- funciona; el arreglo de fondo de secuencias_lote queda fuera de alcance.
drop trigger trg_generar_numero_factura_venta on facturas_venta;
drop function trg_numero_factura_venta();

-- ============================================================
-- 6. negocios: policy de lectura -- segundo hallazgo durante las pruebas de esta tarea
-- ============================================================
-- "Lectura del propio negocio" seguia comparando contra el UUID fijo de negocio A, nunca
-- actualizada en la Tarea 2 porque negocios no tiene columna negocio_id (es el propio negocio,
-- no algo que pertenece a uno) -- quedo fuera del criterio de busqueda de esa auditoria. El
-- efecto real: la funcion del punto 4 no podia leer el codigo_corto de ningun negocio que no
-- fuera A (0 filas visibles bajo RLS), y caia en silencio al formato sin segmento -- exactamente
-- la colision que esta tarea existe para evitar, sin ningun error que lo delatara. Confirmado
-- via grep literal del UUID sobre pg_policies en todo el esquema: este era el unico caso
-- restante, no hay mas.
drop policy "Lectura del propio negocio" on negocios;
create policy "Lectura del propio negocio" on negocios for select
  using ((select auth.role()) = 'authenticated' and id = (select negocio_actual()));
