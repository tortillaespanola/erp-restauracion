-- CONTRATO_STOCK_NEGATIVO_INCIDENCIAS.md (P0-2 del roadmap Fase 06): auditoría de esquema
-- (obligatoria según el contrato) reveló que el problema real es distinto de lo que asumía el
-- contrato -- no es un bug accidental, sino una asimetría en un diseño ya existente.
--
-- Lo que YA existe y funciona (no se toca aquí, decisión validada con el usuario):
-- - check_consumo_produccion() / check_consumo_produccion_pf() (20260805): ya distinguen
--   tipo_produccion. 'planificada' (default, prácticamente toda la operativa real) bloquea con
--   RAISE EXCEPTION a propósito (comentario de esa migración: "el bloqueo... solo aplica a
--   producción planificada"). 'evento_directo' ya permite stock negativo y ya genera incidencia
--   en incidencias_stock_articulo/incidencias_stock_semielaborado vía
--   registrar_incidencia_stock_negativo_consumo(_pf). El "bug" que detectó la Fase 06 (Mes 3, 0
--   incidencias) es RAISE EXCEPTION actuando como está diseñado sobre una producción planificada
--   normal, no un fallo del trigger de incidencias. Se preserva sin cambios.
-- - CierreTanda.jsx ya implementa, a nivel de aplicación (no trigger), un patrón equivalente para
--   el lado de venta de producto final: capa cada línea a `min(pedido, stock_disponible)` (nunca
--   excede stock real) y registra el déficit como incidencia aparte en
--   incidencias_stock_producto_final -- ya cubre ese caso sin necesitar cambios aquí.
--
-- El gap real encontrado: check_stock_producto_final() (rama producto_final, vía
-- lineas_albaran_venta.produccion_pf_id) SÍ tiene el carve-out de tipo_venta='evento_directo'
-- desde 20260804, y registrar_incidencia_stock_negativo_pf() SÍ la cubre -- pero la rama de
-- MERCADERÍA (venta directa de artículo, vía entrada_material_id) no tiene ninguna de las dos
-- cosas: bloquea siempre, incondicionalmente, sin importar tipo_venta, y no genera incidencia.
-- Asimetría entre las dos ramas de la misma función/tabla. Esta migración cierra exactamente esa
-- asimetría, replicando en la rama de mercadería lo que ya existe en la rama de producto final --
-- mismo patrón de dos vías (producción / mercadería) que ya usa
-- registrar_incidencia_caducidad_venta() (20260826) para el caso de caducidad en
-- incidencias_stock_articulo.
--
-- tipo_venta='evento_directo' es hoy inalcanzable desde la UI (MEJORAS_UI_PENDIENTES.md #19,
-- confirmado también para tipo_produccion: cero resultados en frontend/src) -- fuera de alcance
-- de este contrato exponer ese selector. Este fix es de paridad a nivel de base de datos/API,
-- reachable hoy vía RPC/Supabase directo aunque no desde ningún formulario todavía.
--
-- No hay módulo "Incidencias" en el frontend (auditado: cero páginas leen
-- incidencias_stock_articulo/_producto_final/_semielaborado, solo CierreTanda.jsx las escribe) --
-- a diferencia de lo que asumía la sección "Frontend" del contrato. No se construye aquí por estar
-- fuera del alcance acordado (solo cierre del gap SQL de mercadería).
--
-- Backfill: no aplica (igual que indica el contrato) -- no hay stock negativo histórico en la
-- rama de mercadería porque hasta ahora era imposible de alcanzar (bloqueo incondicional).
--
-- Idempotente: CREATE OR REPLACE FUNCTION. Aplicar a mano desde el SQL Editor del Dashboard de
-- Supabase. IMPORTANTE: probar antes en una transacción BEGIN...ROLLBACK contra datos reales,
-- como pide el contrato -- y, dado que el INSERT nuevo en incidencias_stock_articulo corre bajo
-- la policy RLS `using (auth.role() = 'authenticated')` (ninguna de las dos funciones es SECURITY
-- DEFINER), la prueba debe simular el rol authenticated real, no solo el superusuario del SQL
-- Editor: `SET LOCAL ROLE authenticated;` no basta, hace falta también
-- `SET LOCAL request.jwt.claim.role = 'authenticated';` (ver memoria "Testear como authenticated"
-- de este proyecto) para no obtener un falso positivo de 0 filas insertadas por RLS.

-- ============================================================
-- 1. check_stock_producto_final(): v_tipo_venta se calcula una sola
--    vez al principio (antes solo se calculaba dentro de la rama de
--    producto final) y la rama de mercadería gana el mismo carve-out
--    de evento_directo que ya tenía la rama de producto final.
-- ============================================================

create or replace function public.check_stock_producto_final()
returns trigger
language plpgsql
as $$
declare
  disponible numeric;
  v_tipo_venta text;
  v_fecha_destino date;
  v_fecha_origen date;
begin
  if NEW.descripcion is not null then
    return NEW;
  end if;

  select fecha, tipo_venta into v_fecha_destino, v_tipo_venta from albaranes_venta where id = NEW.albaran_venta_id;

  if NEW.produccion_pf_id is not null then
    select p.fecha, p.cantidad_producida - coalesce(sum(v.cantidad), 0)
        + coalesce((select sum(a.cantidad) from ajustes_producto_final a where a.produccion_pf_id = p.id), 0)
    into v_fecha_origen, disponible
    from producciones_producto_final p
    left join lineas_albaran_venta v
      on v.produccion_pf_id = p.id
      and v.id is distinct from NEW.id
    where p.id = NEW.produccion_pf_id
    group by p.id, p.cantidad_producida, p.fecha;

    if disponible is null then
      raise exception 'La producción indicada no existe o no está cerrada';
    end if;

    if v_fecha_origen > v_fecha_destino then
      raise exception 'No se puede vender un lote de producción con fecha % en un albarán con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
    end if;

    if NEW.cantidad > disponible and v_tipo_venta is distinct from 'evento_directo' then
      raise exception 'Stock insuficiente: solo hay % unidades disponibles en ese lote de producción', disponible;
    end if;
  else
    select alc.fecha, em.cantidad
      - coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(v.cantidad) from lineas_albaran_venta v where v.entrada_material_id = NEW.entrada_material_id and v.id is distinct from NEW.id), 0)
      + coalesce((select sum(cantidad) from ajustes_articulo where entrada_material_id = NEW.entrada_material_id), 0)
    into v_fecha_origen, disponible
    from entrada_material em
    join albaranes_compra alc on alc.id = em.albaran_compra_id
    where em.id = NEW.entrada_material_id;

    if disponible is null then
      raise exception 'El lote de artículo indicado no existe';
    end if;

    if v_fecha_origen > v_fecha_destino then
      raise exception 'No se puede vender un lote de artículo con fecha de recepción % en un albarán con fecha % (el origen es posterior al destino)', v_fecha_origen, v_fecha_destino;
    end if;

    if NEW.cantidad > disponible and v_tipo_venta is distinct from 'evento_directo' then
      raise exception 'Stock insuficiente: solo hay % unidades disponibles en ese lote de artículo', disponible;
    end if;
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- 2. registrar_incidencia_stock_negativo_pf(): gana la rama de
--    mercadería (antes solo cubría produccion_pf_id, devolviendo NEW
--    sin más si era mercadería). Mismo patrón dual ya usado por
--    registrar_incidencia_caducidad_venta() (20260826) sobre la misma
--    tabla lineas_albaran_venta.
-- ============================================================

create or replace function public.registrar_incidencia_stock_negativo_pf()
returns trigger
language plpgsql
as $$
declare
  v_tipo_venta text;
  v_disponible numeric;
begin
  select tipo_venta into v_tipo_venta from albaranes_venta where id = NEW.albaran_venta_id;
  if v_tipo_venta is distinct from 'evento_directo' then
    return NEW;
  end if;

  if NEW.produccion_pf_id is not null then
    select p.cantidad_producida - coalesce(sum(v.cantidad), 0)
        + coalesce((select sum(a.cantidad) from ajustes_producto_final a where a.produccion_pf_id = p.id), 0)
    into v_disponible
    from producciones_producto_final p
    left join lineas_albaran_venta v on v.produccion_pf_id = p.id
    where p.id = NEW.produccion_pf_id
    group by p.id, p.cantidad_producida;

    if v_disponible < 0 then
      insert into incidencias_stock_producto_final (produccion_pf_id, linea_albaran_venta_id, cantidad_negativa, motivo)
      values (NEW.produccion_pf_id, NEW.id, abs(v_disponible), 'stock_negativo');
    end if;
  elsif NEW.entrada_material_id is not null then
    select em.cantidad
      - coalesce((select sum(cantidad) from consumo_produccion where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(cantidad) from consumo_produccion_pf where entrada_material_id = NEW.entrada_material_id), 0)
      - coalesce((select sum(v.cantidad) from lineas_albaran_venta v where v.entrada_material_id = NEW.entrada_material_id), 0)
      + coalesce((select sum(cantidad) from ajustes_articulo where entrada_material_id = NEW.entrada_material_id), 0)
    into v_disponible
    from entrada_material em
    where em.id = NEW.entrada_material_id;

    if v_disponible < 0 then
      insert into incidencias_stock_articulo (entrada_material_id, linea_albaran_venta_id, cantidad_negativa, motivo)
      values (NEW.entrada_material_id, NEW.id, abs(v_disponible), 'stock_negativo');
    end if;
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- 3. Verificación post-migración sugerida (comentario, no ejecutable
--    en bloque -- el contrato pide un script de comprobación, no un
--    backfill). Ejecutar a mano en el SQL Editor tras aplicar, contra
--    un artículo/lote de prueba real:
--
--   -- 1. Crear un albarán de venta con tipo_venta='evento_directo'.
--   -- 2. Insertar una línea de mercadería (entrada_material_id) con
--   --    cantidad > stock_disponible de ese lote (ver stock_lotes_articulo).
--   -- 3. Confirmar: el insert NO lanza excepción, y aparece una fila
--   --    nueva en incidencias_stock_articulo con motivo='stock_negativo',
--   --    linea_albaran_venta_id = la línea creada, y cantidad_negativa
--   --    = exactamente el déficit.
--   -- 4. Repetir con tipo_venta='pedido_planificado' (o sin especificar,
--   --    el default) y confirmar que SIGUE bloqueando con RAISE EXCEPTION
--   --    como antes (sin regresión del comportamiento que se preserva).
-- ============================================================
