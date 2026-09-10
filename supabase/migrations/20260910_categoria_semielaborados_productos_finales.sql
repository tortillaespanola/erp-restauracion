-- CONTRATO_GENERICO_CATALOGO.md, Fase 1: `semielaborados` y `productos_finales` nunca
-- tuvieron `categoria_id`, a diferencia de `ingredientes`/`articulos_compra` (NOT NULL desde
-- 20260814_categorias_articulo.sql). Se añade aquí para que las 4 tablas de catálogo sean
-- consistentes.
--
-- Nullable, sin default: hay filas existentes (13 semielaborados, 16 productos_finales a
-- 10-09-2026) sin categoría asignable automáticamente -- forzar NOT NULL exigiría inventar una
-- categoría "Sin clasificar" o bloquear la migración. Se asigna categoría manualmente desde el
-- frontend según se vaya revisando el catálogo. Backfill y posible paso a NOT NULL quedan como
-- contrato aparte (ver CONTRATO_GENERICO_CATALOGO.md, sección 7).
--
-- No toca ningún trigger existente (trg_sincronizar_unidad_texto_*, trg_calcular_fecha_caducidad_*)
-- -- categoria_id no interviene en ninguno.
--
-- Probado en transacción de prueba (BEGIN...ROLLBACK) antes de aplicar: confirmado que ambas
-- columnas no existían, que se crean como bigint nullable con FK a categorias_articulo, y que
-- las 13 + 16 filas existentes quedan con categoria_id NULL como se esperaba. Aplicado en firme
-- el 10-09-2026 vía conexión directa (SUPABASE_DB_URL), con confirmación explícita del usuario.

alter table semielaborados
  add column categoria_id bigint references categorias_articulo(id);

alter table productos_finales
  add column categoria_id bigint references categorias_articulo(id);
