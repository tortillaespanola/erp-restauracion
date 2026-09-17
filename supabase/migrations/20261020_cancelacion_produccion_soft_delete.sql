-- CONTRATO_AUDITORIA_CANCELACION_PRODUCCION.md (P0-1 del roadmap Fase 06): cancelar una producción
-- hoy ejecuta un DELETE puro sobre producciones_semielaborado/producciones_producto_final -- no
-- queda ningún rastro de que existió, cuándo se canceló, quién ni por qué.
--
-- Auditoría de esquema (obligatoria según el contrato) antes de escribir esto:
-- - Dos únicos flujos de cancelación, exactamente simétricos: Producciones.jsx (semielaborado) y
--   ProduccionProductosFinales.jsx (producto final), cada uno con handleCancelar() -- window.confirm
--   + .delete() directo desde el cliente sobre una producción con estado='abierta'. Ningún trigger
--   ni RPC borra hoy estas tablas (grep exhaustivo sobre supabase/migrations/*.sql: cero resultados).
-- - Hay un SEGUNDO flujo distinto en ambos archivos, handleBorrarCerrada() -- borra una producción ya
--   'cerrada' desde el historial (con aviso previo de cuántas filas de consumo_produccion(_pf)/
--   ajustes_* dependen de ella). Fuera del alcance literal de este contrato (que habla en todo
--   momento de "producción abierta" / "cancelar", nunca de borrar historial ya cerrado) -- se deja
--   completamente sin tocar. Por eso esta migración NO revoca DELETE sobre las tablas de producción
--   (revocarlo rompería ese segundo flujo, que sigue siendo una función legítima y no solicitada
--   aquí): el nuevo RPC de cancelación es el único cambio; el frontend simplemente deja de llamar a
--   .delete() en el flujo de cancelar, por convención de código, igual que ya pasa con
--   rpc_editar_produccion_semielaborado/_producto_final (20260731) sin que nada a nivel de RLS
--   impida un UPDATE/DELETE directo -- este proyecto ya asume ese nivel de confianza en el frontend
--   en todos los contratos anteriores.
-- - estado (producciones_semielaborado/producto_final): no hay CREATE TABLE en el repo (el esquema
--   base es anterior a la carpeta de migraciones) y ningún ALTER TABLE tracked añade un CHECK sobre
--   esta columna -- a diferencia de tandas_produccion.estado, que sí lo tiene (20260811). Valores
--   vistos en uso: 'abierta', 'cerrada'. El bloque 1 de abajo detecta en tiempo de ejecución si existe
--   un CHECK sobre estado (buscándolo por contenido, no por nombre, ya que no se puede asumir uno) y
--   lo extiende con 'cancelada', o crea uno nuevo si la columna era texto libre -- funciona en ambos
--   casos sin necesidad de confirmarlo a mano primero.
-- - Ningún trigger existente interfiere con la transición abierta -> cancelada:
--   trg_calcular_fecha_caducidad_pf (20260803) solo dispara en abierta -> cerrada;
--   trg_check_edicion_produccion_semielaborado/_pf (20260731) solo actúan si OLD.estado = 'cerrada'.
-- - Reversión de stock: hoy es completamente implícita vía cascada -- ninguna función explícita
--   revierte nada (grep de "revertir"/"revert" en supabase/migrations y frontend/src: cero
--   resultados). Cerca de 20 fórmulas de "disponible" en todo el proyecto (check_consumo_produccion,
--   check_consumo_produccion_pf, check_stock_producto_final, check_edicion_entrada_material,
--   stock_lotes_articulo, stock_lotes_semielaborado, y más) suman consumo_produccion/
--   consumo_produccion_pf SIN filtrar por el estado de la producción propietaria -- reescribir esa
--   condición en cada una habría sido un cambio de altísimo riesgo para un contrato P0-1. En vez de
--   eso, el RPC de cancelación borra explícitamente las filas de consumo_produccion(_pf) que
--   pertenecen a ESA producción (produccion_id / produccion_pf_id = la que se cancela) antes de
--   marcarla 'cancelada' -- replica exactamente lo que la cascada implícita ya hacía hoy, sin tocar
--   ninguna de esas ~20 fórmulas. Esto es seguro porque una producción 'abierta' nunca pudo haber
--   sido consumida por otra (check_consumo_produccion/_pf exigen producción de origen con
--   estado = 'cerrada' para poder consumirla, líneas 69/142 de 20260731) -- no hay dependientes aguas
--   abajo que perder al borrar sus propias líneas de consumo aguas arriba.
-- - stock_lotes_semielaborado / stock_lotes_producto_final ya filtran `where p.estado = 'cerrada'`
--   (20260809/20260824/20260803) -- una producción 'cancelada' queda excluida automáticamente sin
--   tocar ninguna vista, igual que ya sucede con 'abierta'.
-- - Patrón de auditoría ya establecido en el proyecto: ajustes_articulo/_semielaborado/_producto_final
--   usan user_id (uuid, FK a auth.users) + user_email (snapshot denormalizado, trigger BEFORE INSERT
--   security definer snapshot_user_email(), 20260907) porque `authenticated` no tiene SELECT sobre
--   auth.users. Se reutiliza el mismo patrón aquí para cancelada_por/cancelada_por_email, con un
--   trigger nuevo (no se puede reusar snapshot_user_email() tal cual: los nombres de columna son
--   distintos) que solo actúa en la transición hacia 'cancelada', nunca en otras ediciones.
--
-- Idempotente: columnas con ADD COLUMN IF NOT EXISTS, constraints comprobados antes de tocar nada,
-- CREATE OR REPLACE FUNCTION. Aplicar a mano desde el SQL Editor del Dashboard de Supabase, probando
-- antes en una transacción BEGIN...ROLLBACK contra datos reales simulando el rol authenticated real
-- (SET LOCAL request.jwt.claim.role = 'authenticated' + SET LOCAL ROLE authenticated, en ese orden --
-- ver memoria "Testear como authenticated" de este proyecto), como pide la nota de calidad del
-- contrato.

-- ============================================================
-- 1. Columnas de auditoría + vocabulario 'cancelada' en estado.
-- ============================================================

alter table producciones_semielaborado add column if not exists motivo_cancelacion text;
alter table producciones_semielaborado add column if not exists cancelada_por uuid references auth.users(id);
alter table producciones_semielaborado add column if not exists cancelada_por_email text;
alter table producciones_semielaborado add column if not exists cancelada_en timestamptz;

alter table producciones_producto_final add column if not exists motivo_cancelacion text;
alter table producciones_producto_final add column if not exists cancelada_por uuid references auth.users(id);
alter table producciones_producto_final add column if not exists cancelada_por_email text;
alter table producciones_producto_final add column if not exists cancelada_en timestamptz;

do $$
declare
  v_conname text;
  v_condef text;
  v_candidatos int;
begin
  select count(*) into v_candidatos
  from pg_constraint
  where conrelid = 'producciones_semielaborado'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%abierta%';

  if v_candidatos > 1 then
    raise warning 'producciones_semielaborado: % CHECK constraints mencionan "abierta" -- revisar a mano cuál es el de estado antes de continuar (se toma el primero por nombre).', v_candidatos;
  end if;

  select conname, pg_get_constraintdef(oid) into v_conname, v_condef
  from pg_constraint
  where conrelid = 'producciones_semielaborado'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%abierta%'
  order by conname
  limit 1;

  if v_conname is null then
    alter table producciones_semielaborado add constraint chk_producciones_semielaborado_estado
      check (estado in ('abierta', 'cerrada', 'cancelada'));
  elsif v_condef ilike '%cancelada%' then
    raise notice 'producciones_semielaborado: % ya incluye cancelada. Nada que hacer.', v_conname;
  else
    execute format('alter table producciones_semielaborado drop constraint %I', v_conname);
    alter table producciones_semielaborado add constraint chk_producciones_semielaborado_estado
      check (estado in ('abierta', 'cerrada', 'cancelada'));
  end if;

  select count(*) into v_candidatos
  from pg_constraint
  where conrelid = 'producciones_producto_final'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%abierta%';

  if v_candidatos > 1 then
    raise warning 'producciones_producto_final: % CHECK constraints mencionan "abierta" -- revisar a mano cuál es el de estado antes de continuar (se toma el primero por nombre).', v_candidatos;
  end if;

  select conname, pg_get_constraintdef(oid) into v_conname, v_condef
  from pg_constraint
  where conrelid = 'producciones_producto_final'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%abierta%'
  order by conname
  limit 1;

  if v_conname is null then
    alter table producciones_producto_final add constraint chk_producciones_producto_final_estado
      check (estado in ('abierta', 'cerrada', 'cancelada'));
  elsif v_condef ilike '%cancelada%' then
    raise notice 'producciones_producto_final: % ya incluye cancelada. Nada que hacer.', v_conname;
  else
    execute format('alter table producciones_producto_final drop constraint %I', v_conname);
    alter table producciones_producto_final add constraint chk_producciones_producto_final_estado
      check (estado in ('abierta', 'cerrada', 'cancelada'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_semi_motivo_cancelacion') then
    alter table producciones_semielaborado add constraint chk_produccion_semi_motivo_cancelacion
      check (estado <> 'cancelada' or motivo_cancelacion is not null);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_pf_motivo_cancelacion') then
    alter table producciones_producto_final add constraint chk_produccion_pf_motivo_cancelacion
      check (estado <> 'cancelada' or motivo_cancelacion is not null);
  end if;
end $$;

-- ============================================================
-- 2. Snapshot de email del usuario que cancela -- mismo patrón y
--    misma justificación que snapshot_user_email() (20260907),
--    pero acotado a la transición hacia 'cancelada'.
-- ============================================================

create or replace function public.snapshot_cancelacion_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.estado = 'cancelada' and OLD.estado is distinct from 'cancelada' and NEW.cancelada_por is not null then
    select email into NEW.cancelada_por_email from auth.users where id = NEW.cancelada_por;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_snapshot_cancelacion_email on producciones_semielaborado;
create trigger trg_snapshot_cancelacion_email before update on producciones_semielaborado
  for each row execute function snapshot_cancelacion_email();

drop trigger if exists trg_snapshot_cancelacion_email on producciones_producto_final;
create trigger trg_snapshot_cancelacion_email before update on producciones_producto_final
  for each row execute function snapshot_cancelacion_email();

-- ============================================================
-- 3. RPCs de cancelación -- sustituyen al DELETE. Motivo
--    obligatorio (además del CHECK, para dar un mensaje de error
--    claro antes de tocar nada); revierten el consumo propio de la
--    producción borrando sus líneas de consumo_produccion(_pf) (ver
--    justificación arriba); solo aplican sobre producciones
--    'abierta' (ni ya cerradas ni ya canceladas).
--
--    Efecto colateral heredado (no introducido aquí, ya pasaba con el DELETE anterior por el mismo
--    camino de cascada): incidencias_stock_articulo/_semielaborado que cuelguen de esas líneas de
--    consumo_produccion(_pf) vía consumo_produccion_id/consumo_produccion_pf_id (ON DELETE CASCADE,
--    20260828_fix_cascade_incidencias_stock.sql) se pierden al cancelar. Si en el roadmap posterior
--    (P1-4, OEE) hiciera falta auditar qué incidencias tenía una producción antes de cancelarla,
--    esto habría que revisarlo aparte -- fuera de alcance de este contrato.
-- ============================================================

create or replace function public.rpc_cancelar_produccion_semielaborado(p_id bigint, p_motivo text)
returns void
language plpgsql
as $$
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio';
  end if;

  if not exists (select 1 from producciones_semielaborado where id = p_id and estado = 'abierta') then
    raise exception 'La producción % no existe o no está abierta (solo se pueden cancelar producciones abiertas)', p_id;
  end if;

  delete from consumo_produccion where produccion_id = p_id;

  update producciones_semielaborado
  set estado = 'cancelada',
      motivo_cancelacion = btrim(p_motivo),
      cancelada_por = auth.uid(),
      cancelada_en = now()
  where id = p_id;
end;
$$;

grant execute on function public.rpc_cancelar_produccion_semielaborado(bigint, text) to authenticated;

create or replace function public.rpc_cancelar_produccion_producto_final(p_id bigint, p_motivo text)
returns void
language plpgsql
as $$
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio';
  end if;

  if not exists (select 1 from producciones_producto_final where id = p_id and estado = 'abierta') then
    raise exception 'La producción % no existe o no está abierta (solo se pueden cancelar producciones abiertas)', p_id;
  end if;

  delete from consumo_produccion_pf where produccion_pf_id = p_id;

  update producciones_producto_final
  set estado = 'cancelada',
      motivo_cancelacion = btrim(p_motivo),
      cancelada_por = auth.uid(),
      cancelada_en = now()
  where id = p_id;
end;
$$;

grant execute on function public.rpc_cancelar_produccion_producto_final(bigint, text) to authenticated;

-- ============================================================
-- 4. Backfill: no aplica (como indica el contrato) -- las
--    producciones ya borradas por DELETE no se pueden recuperar.
-- ============================================================

-- ============================================================
-- 5. Verificación post-migración sugerida (comentario, no
--    ejecutable en bloque). Ejecutar a mano en el SQL Editor tras
--    aplicar, simulando el rol authenticated real, contra una
--    producción de prueba:
--
--   -- 1. select public.rpc_cancelar_produccion_semielaborado(<id de una abierta real>, 'motivo de prueba');
--   -- 2. Confirmar: la fila sigue existiendo, estado = 'cancelada', motivo_cancelacion = 'motivo de
--   --    prueba', cancelada_por = el uuid simulado, cancelada_por_email = su email, cancelada_en no nulo.
--   -- 3. Confirmar que sus filas de consumo_produccion (si tenía) ya no existen.
--   -- 4. select public.rpc_cancelar_produccion_semielaborado(<el mismo id>, 'otra vez'); -- debe
--   --    fallar ("no existe o no está abierta"): no se puede cancelar dos veces.
--   -- 5. select public.rpc_cancelar_produccion_semielaborado(<id real>, ''); -- debe fallar
--   --    ("motivo... obligatorio").
--   -- 6. Repetir 1-5 con rpc_cancelar_produccion_producto_final sobre una producción de producto final.
-- ============================================================
