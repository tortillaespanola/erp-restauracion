-- CONTRATO_MERMA_RECHAZO_PRODUCCION.md (P1-4 del roadmap Fase 06): registrar la merma/rechazo de
-- calidad de una producción completada (pieza defectuosa, medida incorrecta, rotura), hoy invisible
-- en el esquema -- o se ignora, o se fuerza cantidad_producida a la cifra ya neta, perdiendo el dato
-- de cuánto se intentó producir. Base para el cálculo de OEE (fuera de alcance aquí).
--
-- Auditoría de esquema (obligatoria según el contrato) antes de escribir esto:
-- - cantidad_producida (producciones_semielaborado / producciones_producto_final) ya es, HOY, la
--   cantidad "utilizable que entra a stock disponible" -- no existe columna de "total fabricado" ni
--   ningún trigger que dé de alta stock: stock_lotes_semielaborado (20260809/20260824) y
--   stock_lotes_producto_final (20260803) son VISTAS que restan consumo/ventas/ajustes directamente
--   de p.cantidad_producida, sin intermediario. check_stock_producto_final() (20260803) duplica la
--   misma fórmula para el trigger de bloqueo de venta. Esto coincide EXACTAMENTE con la definición del
--   propio contrato ("cantidad_producida = cantidad que realmente pasa a stock disponible"): no hace
--   falta tocar ninguna vista ni trigger -- cantidad_rechazada es un dato nuevo, aparte, que nunca ha
--   estado incluido en esas fórmulas y sigue sin estarlo.
-- - Ya existe una columna distinta de cantidad planificada: cantidad_objetivo (20260902 semielaborado,
--   20260911 producto final) -- numeric, nullable, sin CHECK de positividad (a propósito, ver su propio
--   comentario), "valor de referencia, no afecta a cantidad_producida ni a consumos". No es lo mismo
--   que "total ejecutado": es la cifra que el operador estimaba ANTES de empezar, no lo que de verdad
--   se fabricó. No se reutiliza para el CHECK de tope de esta migración (ver más abajo por qué).
-- - Sobre el CHECK "cantidad_rechazada <= cantidad_producida_total" que sugiere el contrato: el propio
--   contrato ya avisa de que el nombre exacto "depende de lo que confirme la auditoría... puede
--   requerir una columna nueva de cantidad total ejecutada si hoy cantidad_producida ya representa
--   solo lo utilizable". La auditoría confirma exactamente ese caso: cantidad_producida YA es solo lo
--   utilizable (punto anterior). Bajo el propio diseño que define el contrato en su sección "Objetivo"
--   ("la suma de ambas represente el total realmente ejecutado"), el total NO es una columna
--   independiente que cantidad_rechazada pueda superar -- es la suma cantidad_producida +
--   cantidad_rechazada, por construcción. No existe ningún valor contra el que ese CHECK pueda fallar
--   de forma no trivial sin inventar una tercera columna redundante (con su propio riesgo de
--   divergencia) que el contrato no pide en su sección "Objetivo". Se implementa por tanto solo
--   cantidad_rechazada >= 0 (protección real: nunca negativa) + motivo obligatorio si > 0. Documentado
--   aquí explícitamente porque es la clase de desviación de la letra del contrato que su propia nota de
--   "antes de empezar" pide resolver con auditoría, no asumir.
-- - No existe ninguna noción previa de "calidad"/"control de calidad"/"rechazo" estructurada en el
--   esquema -- el precedente más cercano es ajustes_producto_final (20260803, categoría controlada
--   'caducado'/'roto'/'evento_no_consumido'/'otro'), pero es un ajuste POSTERIOR al cierre (corrige
--   stock ya cerrado), no algo que se capture al completar la producción -- no se duplica ni se reusa,
--   son conceptos distintos (ajuste = corrección de stock ya existente; rechazo = parte de esta misma
--   tanda que nunca llega a stock).
-- - tandas_produccion (20260811) es una agrupación administrativa de pedidos/producciones para el
--   flujo POS (columnas: id, fecha, estado, negocio_id -- nada de cantidades), no una unidad de
--   producción individual y puede agrupar producciones de productos distintos -- el rechazo de calidad
--   es intrínsecamente por producción, igual que cantidad_producida/cantidad_objetivo, así que vive en
--   producciones_semielaborado/producciones_producto_final, no en tandas_produccion.
-- - Vistas/RPCs que suman cantidad_producida (previsiones_distribucion_pf en sus 4 versiones evolutivas
--   20260912/20260913/20260917/20260920, PedidosDelDia.jsx) siguen siendo correctas sin cambios: al no
--   tocar el significado de cantidad_producida, todas continúan representando exactamente lo mismo que
--   hoy (stock/disponibilidad real), sin sobreestimar por incluir rechazo.
-- - Flujo de cierre: ambos son un .update() directo desde el cliente (Producciones.jsx:993,
--   ProduccionProductosFinales.jsx:921) sobre estado 'abierta' -> 'cerrada', sin RPC -- mismo nivel de
--   confianza en frontend que el resto del proyecto (P0-1). El CHECK de motivo obligatorio a nivel de
--   base de datos es la única protección real; no hace falta una RPC nueva solo para esto.
-- - Edición posterior (rpc_editar_produccion_semielaborado/_producto_final, 20260731) no acepta hoy
--   p_cantidad_rechazada/p_motivo_rechazo -- fuera de alcance de este contrato (que solo habla de "al
--   completar una producción"); se deja sin tocar, igual que se dejó handleBorrarCerrada en P0-1.
--
-- Idempotente: columnas con ADD COLUMN IF NOT EXISTS, constraints comprobados antes de crearlos.
-- Aplicar a mano desde el SQL Editor del Dashboard de Supabase, probando antes en una transacción
-- BEGIN...ROLLBACK contra datos reales simulando el rol authenticated real (SET LOCAL
-- request.jwt.claim.role = 'authenticated' + SET LOCAL ROLE authenticated, en ese orden), como pide la
-- nota de calidad del contrato.

-- ============================================================
-- 1. Columnas de merma/rechazo + CHECKs.
-- ============================================================

alter table producciones_semielaborado add column if not exists cantidad_rechazada numeric not null default 0;
alter table producciones_semielaborado add column if not exists motivo_rechazo text;

alter table producciones_producto_final add column if not exists cantidad_rechazada numeric not null default 0;
alter table producciones_producto_final add column if not exists motivo_rechazo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_semi_rechazada_no_negativa') then
    alter table producciones_semielaborado add constraint chk_produccion_semi_rechazada_no_negativa
      check (cantidad_rechazada >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_semi_motivo_rechazo') then
    alter table producciones_semielaborado add constraint chk_produccion_semi_motivo_rechazo
      check (cantidad_rechazada = 0 or (motivo_rechazo is not null and btrim(motivo_rechazo) <> ''));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_pf_rechazada_no_negativa') then
    alter table producciones_producto_final add constraint chk_produccion_pf_rechazada_no_negativa
      check (cantidad_rechazada >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_produccion_pf_motivo_rechazo') then
    alter table producciones_producto_final add constraint chk_produccion_pf_motivo_rechazo
      check (cantidad_rechazada = 0 or (motivo_rechazo is not null and btrim(motivo_rechazo) <> ''));
  end if;
end $$;

-- ============================================================
-- 2. Stock / trigger de venta: sin cambios (ver auditoría arriba --
--    cantidad_producida ya es solo lo utilizable, cantidad_rechazada
--    nunca entra en esas fórmulas).
-- ============================================================

-- ============================================================
-- 3. Backfill: no aplica (como indica el contrato) -- no hay forma de
--    reconstruir qué parte de una producción histórica ya cerrada fue
--    rechazo. Todas las filas existentes quedan en cantidad_rechazada
--    = 0 por el DEFAULT, sin ningún cambio de comportamiento.
-- ============================================================

-- ============================================================
-- 4. Verificación post-migración sugerida (comentario, no ejecutable
--    en bloque). Ejecutar a mano en el SQL Editor tras aplicar,
--    simulando el rol authenticated real:
--
--   -- 1. update producciones_semielaborado set cantidad_rechazada = 1 where id = <una cerrada real>;
--   --    -- debe fallar (motivo obligatorio) sin motivo_rechazo.
--   -- 2. Repetir con motivo_rechazo = 'prueba' -- debe funcionar. Repetir con motivo_rechazo = '   '
--   --    (solo espacios) -- debe fallar igual que sin motivo (btrim vacío, no solo NULL).
--   -- 3. select stock_disponible from stock_lotes_semielaborado where produccion_id = <esa id>; --
--   --    confirmar que stock_disponible NO bajó por cantidad_rechazada (sigue reflejando solo
--   --    cantidad_producida menos consumo/ajustes, igual que antes de esta migración).
--   -- 4. update ... set cantidad_rechazada = -1 ...; -- debe fallar (no negativa).
--   -- 5. Repetir 1-4 con producciones_producto_final / stock_lotes_producto_final.
--   -- 6. Cerrar una producción nueva SIN indicar rechazo (cantidad_rechazada por defecto 0) -- debe
--   --    comportarse exactamente igual que antes de esta migración (regresión cero).
-- ============================================================
