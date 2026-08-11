-- Entrada #3 de MEJORAS_UI_PENDIENTES.md: aviso (no bloqueo) cuando una
-- producción de producto final se desvía de la fecha_entrega_prevista
-- del pedido al que está vinculada (producciones_producto_final.pedido_id
-- es un enlace blando de trazabilidad, no reserva dura).
--
-- Dos casos distintos, ambos aviso (no bloqueo) — mismo criterio ya usado
-- para las incidencias de caducidad de consumo/venta (Partes 1-4):
--
--   A) caducidad_antes_entrega: la fecha_caducidad de la producción es
--      anterior a la fecha_entrega_prevista del pedido — se entregaría al
--      cliente algo ya caducado. Grave, pero bloquear el cierre de la
--      producción no arregla nada (el lote ya existe con esa caducidad
--      real); el usuario puede tener contexto legítimo (replanificación,
--      aceptación del cliente, o el aviso mismo sirve para detectar que
--      fecha_entrega_prevista está mal tecleada).
--
--   B) retraso_produccion: la producción empezó después de la
--      fecha_entrega_prevista del pedido. NO es una imposibilidad lógica
--      (a diferencia de chk_pedidos_venta_fecha_entrega_coherente, que sí
--      protege la coherencia de una sola fila) — es un retraso real de
--      entrega, caso normal de negocio. Confirmado con un caso real:
--      producción #50 (FG-TEKZ-260004, fecha 2026-04-16) vinculada al
--      pedido OV-260013 (fecha_entrega_prevista 2026-04-15), entregada en
--      DN-260016 ese mismo 2026-04-16 — un día tarde, sin ambigüedad de
--      vínculo blando (única producción de ese pedido). Bloquear este
--      caso habría hecho imposible registrar lo que realmente pasó.
--
-- Ambos casos reutilizan incidencias_stock_producto_final (mismo
-- produccion_pf_id, mismo estado/nota ya disponibles) con motivos nuevos,
-- distintos de 'caducidad' (que señala un hecho retrospectivo ya
-- consumado: se vendió/consumió algo ya caducado) — estos dos son avisos
-- prospectivos sobre la propia producción frente a su pedido.

-- ============================================================
-- 1. linea_albaran_venta_id deja de ser obligatoria: los motivos nuevos
--    no vienen de ninguna línea de venta, solo de la producción misma.
-- ============================================================

alter table incidencias_stock_producto_final
  alter column linea_albaran_venta_id drop not null;

alter table incidencias_stock_producto_final
  drop constraint incidencias_stock_producto_final_motivo_check,
  add constraint incidencias_stock_producto_final_motivo_check
    check (motivo in ('stock_negativo', 'caducidad', 'caducidad_antes_entrega', 'retraso_produccion'));

-- ============================================================
-- 2. Trigger: compara la producción contra la fecha_entrega_prevista de
--    su pedido vinculado, si tiene uno. Con guarda anti-duplicados (no
--    se repite la incidencia en ediciones posteriores que no cambien la
--    condición ya detectada) — necesario porque
--    rpc_editar_produccion_producto_final puede volver a guardar la
--    misma producción varias veces.
-- ============================================================

create or replace function public.registrar_incidencia_pedido_produccion_pf()
returns trigger
language plpgsql
as $$
declare
  v_fecha_entrega date;
begin
  if NEW.pedido_id is null then
    return NEW;
  end if;

  select fecha_entrega_prevista into v_fecha_entrega from pedidos_venta where id = NEW.pedido_id;
  if v_fecha_entrega is null then
    return NEW;
  end if;

  -- Caso B: la producción empezó después de la fecha prometida de entrega.
  if NEW.fecha > v_fecha_entrega then
    if not exists (
      select 1 from incidencias_stock_producto_final
      where produccion_pf_id = NEW.id and motivo = 'retraso_produccion'
    ) then
      insert into incidencias_stock_producto_final (produccion_pf_id, motivo, nota)
      values (
        NEW.id,
        'retraso_produccion',
        format('Producción iniciada el %s, posterior a la fecha_entrega_prevista (%s) del pedido vinculado', NEW.fecha, v_fecha_entrega)
      );
    end if;
  end if;

  -- Caso A: el lote caducará antes de la fecha prometida de entrega.
  if NEW.fecha_caducidad is not null and NEW.fecha_caducidad < v_fecha_entrega then
    if not exists (
      select 1 from incidencias_stock_producto_final
      where produccion_pf_id = NEW.id and motivo = 'caducidad_antes_entrega'
    ) then
      insert into incidencias_stock_producto_final (produccion_pf_id, motivo, nota)
      values (
        NEW.id,
        'caducidad_antes_entrega',
        format('Fecha de caducidad (%s) anterior a la fecha_entrega_prevista (%s) del pedido vinculado', NEW.fecha_caducidad, v_fecha_entrega)
      );
    end if;
  end if;

  return NEW;
end;
$$;

create constraint trigger trg_registrar_incidencia_pedido_produccion_pf
after insert or update on producciones_producto_final
deferrable initially deferred
for each row execute function registrar_incidencia_pedido_produccion_pf();

-- ============================================================
-- 3. Revalidación retroactiva (UPDATE no-op, mismo patrón que las
--    incidencias de caducidad de consumo/venta): fuerza el trigger sobre
--    las 36 producciones ya vinculadas a un pedido, para no dejar casos
--    reales ya existentes (como la #50) sin su incidencia.
-- ============================================================

update producciones_producto_final set fecha = fecha where pedido_id is not null;
