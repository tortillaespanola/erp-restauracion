-- FASE 06 de AlpenWerk Möbel GmbH — MES 4: PROBLEMAS OPERATIVOS (junio 2026)
-- Continúa EXACTAMENTE desde el cierre validado de Mes 3 (mayo 2026). No modifica ninguna fila
-- de Mes 1/2/3 — las únicas referencias a datos de esos meses son SELECTs de solo lectura para
-- resolver IDs de lotes/facturas ya existentes (stock heredado, pago de continuidad sobre una
-- factura de Mes 3), nunca UPDATE/DELETE sobre esos meses.
--
-- MECANISMOS REALES AUDITADOS Y USADOS ESTE MES (ver PENDIENTES_MODELO.md y el código real de
-- cada trigger/función antes de escribir cualquier escenario — ninguno se asume, todos se leyeron):
--   1) Fallo de proveedor / cobertura vía Article Base (RM-MTL-004 / RM-MTL-029, misma
--      abstracción de ingrediente ya usada en Mes 2/3): pedido a Metal-A que nunca se sirve
--      (permanece 'pendiente') + pedido de cobertura a Metal-C, mezclado en un único lote de
--      producción de SF-MTL-001 vía dos artículos concretos distintos.
--   2) Recepción parcial (RM-MTL-013): mismo patrón ya usado en Mes 2 (pedido > primer envío),
--      con la segunda entrega llegando más tarde dentro del propio Mes 4.
--   3) Sustitución excepcional (motivo='sustitucion_excepcional' en consumo_produccion, columna
--      real desde 20260831_sustitucion_excepcional_consumo.sql): SF-WDA-006 sustituye RM-HWR-019
--      (agotado) por RM-HWR-005 en un montaje puntual.
--   4) Caducidad (fecha_caducidad en entrada_material + los 3 triggers AFTER CONSTRAINT DEFERRABLE
--      de 20260826_incidencias_caducidad_consumo_venta.sql — verificados en PENDIENTES_MODELO.md
--      #8 contra la base real, ya con una incidencia real existente, id 14): un lote de RM-PNT-001
--      caduca dentro de Mes 4 y se consume después de caducar en dos líneas de consumo separadas,
--      cada una dispara su propia fila en incidencias_stock_articulo (motivo='caducidad',
--      'pendiente' por defecto). Es EL MECANISMO REAL, VERIFICADO Y DISTINTO del de stock negativo
--      (evento_directo) que Mes 3 encontró no reproducible — no se reintenta ese aquí.
--   5) Incidencia abierta + cerrada (Escenario 10): las dos incidencias de caducidad de (4). Una
--      queda 'pendiente' (abierta); la otra se marca 'ignorado' (cerrada) en una segunda
--      transacción, porque el trigger que las genera es DEFERRABLE INITIALLY DEFERRED — la fila no
--      existe hasta el COMMIT de la primera transacción (mismo patrón ya usado en Mes 3).
--   6) Cancelación de producción (Escenario 9): NO existe estado='cancelada' en producciones_*
--      (confirmado: cero apariciones en todo el esquema). SÍ existe un mecanismo real de
--      cancelación para una producción todavía 'abierta' — Producciones.jsx:503-510,
--      `handleCancelar`, hace literalmente `supabase.from('producciones_semielaborado').delete()
--      .eq('id', id)`, confirmado por el copy de la UI ("Se revertirán los consumos ya
--      registrados"). Se reproduce aquí exactamente igual: INSERT en estado='abierta' + INSERT de
--      consumo + DELETE de la producción (cascada real ya corregida en
--      20260828_fix_cascade_incidencias_stock.sql). No es un mecanismo inventado.
--   7) tandas_produccion: confirmado en PENDIENTES_MODELO.md #12 que ningún camino de la UI
--      actual crea ya una fila nueva (huérfano desde la Vista Dinámica de Producción). A
--      diferencia de Mes 1-3, este mes NO se usa tandas_produccion en ninguna producción —
--      refleja con más fidelidad el estado actual real de la aplicación.
--   8) Rechazo de producción (Escenario 5): NO existe cantidad_rechazada/scrap/merma como campo
--      separado en producciones_producto_final (confirmado: cero columnas de ese tipo). Se
--      representa únicamente como cantidad_producida < cantidad_objetivo, con notas explicando la
--      causa — exactamente el límite que el propio prompt de Mes 4 pide documentar.
--
-- Ver la sección "E. LIMITACIONES DE MODELO" del informe de cierre para el resto de escenarios
-- (cancelación de PEDIDO ya existe vía estado='cancelado' en pedidos_venta, pero NO se usa este
-- mes porque el escenario pedido es cancelación de PRODUCCIÓN, no de pedido).

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
do $$
declare
v_neg uuid;
-- ubicaciones
v_loc_metal uuid; v_loc_wood uuid; v_loc_hw uuid;
v_loc_cut uuid; v_loc_mach uuid; v_loc_sand uuid; v_loc_assy uuid;
v_loc_fg uuid;
-- articulos_compra
v_art_mtl004 bigint; v_art_mtl029 bigint; v_art_mtl007 bigint; v_art_mtl013 bigint;
v_art_wod010 bigint; v_art_brd001 bigint; v_art_pnt001 bigint; v_art_hwr005 bigint; v_art_hwr019 bigint;
-- semielaborados
v_sf_mtl001 bigint; v_sf_mtl010 bigint; v_sf_pnl004 bigint; v_sf_wda006 bigint;
v_sf_mtl007 bigint; v_sf_mtl012 bigint; v_sf_wod004 bigint; v_sf_wod008 bigint;
-- productos_finales
v_pf_c001 bigint; v_precio_c001 numeric;
-- proveedores
v_prov_mtl_a bigint; v_prov_mtl_c bigint; v_prov_wod_a bigint; v_prov_pnt_a bigint;
v_prov_brd_a bigint; v_prov_hwr_b bigint;
-- clientes
v_cli_b2b bigint[];
-- lotes de Mes 3 (solo lectura, heredados)
v_em_mtl004_prev bigint; v_em_mtl029_prev bigint;
-- facturas de Mes 3 (solo lectura, para pago de continuidad)
v_fv3_009 bigint;
-- scratch
v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint;
v_av bigint; v_fv bigint; v_pago bigint;
-- lotes nuevos
v_em_mtl029_new bigint; v_em_mtl013_a bigint; v_em_mtl013_b bigint; v_em_pnt001 bigint;
v_em_brd001 bigint; v_em_hwr005 bigint; v_em_mtl007 bigint; v_em_wod010 bigint; v_em_mtl007_cancel bigint;
-- producciones
v_p_mtl001 bigint; v_p_mtl010 bigint; v_p_pnl004 bigint; v_p_wda006 bigint;
v_p_mtl007 bigint; v_p_mtl012 bigint; v_p_wod004 bigint; v_p_wod008 bigint; v_p_pf_c001 bigint;
v_p_mtl007_cancel bigint;
-- consumo (para poder distinguir las 2 líneas de pintura caducada en la 2a transacción)
v_cp_pnt_1 bigint; v_cp_pnt_2 bigint;
-- pedidos de venta nuevos
v_pv_a bigint; v_lpv_a bigint; v_pv_b bigint; v_lpv_b bigint;
begin
select id into v_neg from negocios where codigo_corto = 'ALP';
if v_neg is null then raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.'; end if;
if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M4]%') then
raise notice 'Fase 06 Mes 4 ya fue sembrada anteriormente. Abortando sin cambios.'; return; end if;
if not exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M3]%') then
raise exception 'Mes 3 no existe todavía. Abortando.'; end if;

-- 0. RESOLUCIÓN DE IDs
select id into v_loc_metal from ubicaciones where negocio_id=v_neg and nombre='RAW-METAL';
select id into v_loc_wood from ubicaciones where negocio_id=v_neg and nombre='RAW-WOOD';
select id into v_loc_hw from ubicaciones where negocio_id=v_neg and nombre='RAW-HARDWARE';
select id into v_loc_cut from ubicaciones where negocio_id=v_neg and nombre='CUT';
select id into v_loc_mach from ubicaciones where negocio_id=v_neg and nombre='MACHINING';
select id into v_loc_sand from ubicaciones where negocio_id=v_neg and nombre='SANDING';
select id into v_loc_assy from ubicaciones where negocio_id=v_neg and nombre='ASSEMBLY';
select id into v_loc_fg from ubicaciones where negocio_id=v_neg and nombre='FINISHED-GOODS';

select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
select id into v_art_mtl029 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-029';
select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
select id into v_art_mtl013 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-013';
select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
select id into v_art_brd001 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-001';
select id into v_art_pnt001 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-001';
select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';
select id into v_art_hwr019 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-019';

select id into v_sf_mtl001 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-001';
select id into v_sf_mtl010 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-010';
select id into v_sf_pnl004 from semielaborados where negocio_id=v_neg and codigo='SF-PNL-004';
select id into v_sf_wda006 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-006';
select id into v_sf_mtl007 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-007';
select id into v_sf_mtl012 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-012';
select id into v_sf_wod004 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-004';
select id into v_sf_wod008 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-008';

select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';

-- Proveedores (mismo patrón de resolución por categoría ya usado en Mes 1-3)
select ap.proveedor_id into v_prov_mtl_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004)
order by (ap.articulo_id=v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_mtl_c from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl029)
order by (ap.articulo_id=v_art_mtl029) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_wod_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_wod010)
order by (ap.articulo_id=v_art_wod010) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_pnt_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_pnt001)
order by (ap.articulo_id=v_art_pnt001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_brd_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_brd001)
order by (ap.articulo_id=v_art_brd001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_hwr_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr019) and ap.proveedor_id <> (
  select ap2.proveedor_id from articulo_proveedor ap2 join articulos_compra a2 on a2.id=ap2.articulo_id
  where ap2.negocio_id=v_neg and a2.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr019)
  order by (ap2.articulo_id=v_art_hwr019) desc, ap2.preferente desc nulls last, ap2.proveedor_id limit 1
)
order by ap.proveedor_id limit 1;

select array_agg(id order by id) into v_cli_b2b from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;

-- Lotes heredados de Mes 3 (solo lectura — stock_disponible real confirmado en el cierre de Mes 3:
-- RM-MTL-004 15.0 m, RM-MTL-029 15.0 m)
select em.id into v_em_mtl004_prev from entrada_material em join albaranes_compra ac on ac.id=em.albaran_compra_id
where ac.numero_albaran='LFS-MTLA-0503' and em.negocio_id=v_neg;
select em.id into v_em_mtl029_prev from entrada_material em join albaranes_compra ac on ac.id=em.albaran_compra_id
where ac.numero_albaran='LFS-MTLC-0056' and em.negocio_id=v_neg;

-- Factura de Mes 3 (solo lectura — para el pago de continuidad, no se modifica la factura)
select id into v_fv3_009 from facturas_venta where negocio_id=v_neg and numero_factura='RE-ALP-2026-009';

raise notice 'IDs resueltos. Iniciando transacciones de Mes 4.';

-- ===========================================================================================
-- 1. COMPRAS DE MES 4
-- ===========================================================================================

-- Escenario 1 (FALLO DE PROVEEDOR): Metal-A nunca sirve este pedido. Queda 'pendiente' para
-- siempre, sin albarán ni entrada_material — un pedido real incumplido, no una simulación de
-- estado, tal y como pide el prompt ("delayed receipt / another supplier / shortage").
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-08', 'pendiente', '[FASE06-M4] SUPPLIER FAILURE: Metal-A no entregó este pedido de tubo 40x40x2mm en todo el mes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl004, 60, 8.70, v_neg) returning id into v_lp_tmp;

-- Escenario 3 (ARTICLE BASE): cobertura vía Metal-C con el artículo alternativo compatible.
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_c, '2026-06-02', '2026-06-09', 'pendiente', '[FASE06-M4] Cobertura Article Base ante fallo de Metal-A: tubo 40x40x2mm S235 vía RM-MTL-029', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl029, 30, 9.10, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_c, 'LFS-MTLC-0057', '2026-06-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl029, 30, 9.10, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl029_new;

-- Escenario 2 (RECEPCIÓN PARCIAL): pedido 40, primera entrega 25, quedan 15 pendientes; la
-- segunda entrega llega más tarde dentro del propio Mes 4.
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] RECEPCION PARCIAL: pedido 40 uds de pletina 40x5, primera entrega 25, quedan 15 pendientes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl013, 40, 4.50, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0601', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl013, 25, 4.50, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl013_a;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0615', '2026-06-18', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl013, 15, 4.50, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl013_b;

-- Escenario 7 (CADUCIDAD): lote de barniz con fecha_caducidad dentro de Mes 4.
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_pnt_a, '2026-06-01', '2026-06-02', 'pendiente', '[FASE06-M4] Restock barniz de acabado', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pnt001, 10, 16.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_pnt_a, 'LFS-PNTA-0201', '2026-06-02', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, fecha_caducidad, negocio_id) values (v_ac_tmp, v_art_pnt001, 10, 16.00, v_lp_tmp, v_loc_hw, '2026-06-20', v_neg) returning id into v_em_pnt001;

-- Insumos para el montaje SF-PNL-004 / SF-WDA-006 (sustitución excepcional, escenario 4)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_brd_a, '2026-06-01', '2026-06-04', 'pendiente', '[FASE06-M4] Restock tablero para montaje puntual', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_brd001, 2, 22.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_brd_a, 'LFS-BRDA-0031', '2026-06-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_brd001, 2, 22.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_brd001;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_hwr_b, '2026-06-01', '2026-06-04', 'pendiente', '[FASE06-M4] Restock tornillería alternativa (RM-HWR-005)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr005, 20, 0.17, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_hwr_b, 'LFS-HWRB-0013', '2026-06-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr005, 20, 0.17, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_hwr005;

-- Lote principal de sillas ALP-C001 del mes (sin sobresaltos de stock; la variante de este mes
-- está en el rechazo de la fase final de montaje, escenario 5, no en la materia prima)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] Reposición tubo redondo 33.7x2 para sillas', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 40, 6.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0602', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 40, 6.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] Reposición tablero de haya para asientos', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod010, 4, 39.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0327', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod010, 4, 39.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010;

-- Lote dedicado y aislado para la prueba de cancelación de producción (escenario 9): no afecta a
-- ningún otro cálculo del mes.
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] Lote aislado para prueba de producción abierta cancelada', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 5, 6.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0603', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 5, 6.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007_cancel;

raise notice 'Compras Mes 4 completadas.';

-- ===========================================================================================
-- 2. PRODUCCIÓN — CADENA ARTICLE BASE (SF-MTL-001 / SF-MTL-010)
-- ===========================================================================================
-- Planificado 55 uds (66.0 m necesarios a razón de 1.20 m/ud). Disponible real: 15 m del lote de
-- Mes 3 (RM-MTL-004, LFS-MTLA-0503) + 15 m del lote de Mes 3 (RM-MTL-029, LFS-MTLC-0056) + 30 m
-- del nuevo lote de cobertura (RM-MTL-029) = 60.0 m -> máximo real 50 uds. Varianza genuina por
-- falta de material (Metal-A incumplió), no evento_directo: el consumo nunca excede el disponible.
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl001, '2026-06-11', 'cerrada', 50, 55, v_loc_cut, v_neg) returning id into v_p_mtl001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_prev, 15, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl029_prev, 15, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl029_new, 30, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl010, '2026-06-12', 'cerrada', 50, 55, v_loc_mach, v_neg) returning id into v_p_mtl010;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 50, v_neg);
raise notice 'Producción Article Base Mes 4 completada: 50 de 55 planificadas (déficit por fallo de Metal-A, cubierto solo parcialmente vía RM-MTL-029).';

-- ===========================================================================================
-- 3. PRODUCCIÓN — SILLAS ALP-C001 (rechazo en montaje final, escenario 5)
-- ===========================================================================================
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl007, '2026-06-10', 'cerrada', 80, 80, v_loc_cut, v_neg) returning id into v_p_mtl007;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007, v_em_mtl007, 80*0.45, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl012, '2026-06-11', 'cerrada', 80, 80, v_loc_mach, v_neg) returning id into v_p_mtl012;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012, v_p_mtl007, 80, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod004, '2026-06-10', 'cerrada', 20, 20, v_loc_cut, v_neg) returning id into v_p_wod004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004, v_em_wod010, 20*0.16, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod008, '2026-06-11', 'cerrada', 20, 20, v_loc_sand, v_neg) returning id into v_p_wod008;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008, v_p_wod004, 20, v_neg);

-- Escenario 5 (RECHAZO): 20 sillas planificadas, 17 aceptadas. No existe cantidad_rechazada en
-- producciones_producto_final (confirmado por auditoría) -- se representa exclusivamente como
-- cantidad_producida < cantidad_objetivo, con la causa documentada en notas.
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_pf_c001, '2026-06-15', 'cerrada', 17, 20, 'Rechazo en control de calidad final: 2 uniones soldadas defectuosas + 1 asiento dañado en montaje. No representable como cantidad rechazada separada (columna inexistente en el modelo actual) -- documentado como varianza planificado/producido.', v_loc_fg, v_neg) returning id into v_p_pf_c001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012, 17*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008, 17*1, v_neg);
raise notice 'Producción de sillas Mes 4 completada: 17 de 20 aceptadas (12 patas y 3 asientos sobrantes quedan como semielaborado disponible).';

-- ===========================================================================================
-- 4. PRODUCCIÓN — SUSTITUCIÓN EXCEPCIONAL + CONSUMO DE MATERIAL CADUCADO
-- ===========================================================================================
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_pnl004, '2026-06-24', 'cerrada', 2, 2, v_loc_cut, v_neg) returning id into v_p_pnl004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_pnl004, v_em_brd001, 2*0.40, v_neg);

-- Escenario 4 (SUSTITUCIÓN EXCEPCIONAL): RM-HWR-019 agotado en el momento del montaje;
-- RM-HWR-005 es técnicamente compatible (misma familia de tornillería) y se usa temporalmente.
-- motivo='sustitucion_excepcional' es una columna real (chk_consumo_produccion_motivo,
-- 20260831_sustitucion_excepcional_consumo.sql); check_consumo_produccion nunca valida que el
-- lote consumido pertenezca al articulo_id de la receta, así que esto no requiere ningún bypass.
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wda006, '2026-06-25', 'cerrada', 2, 2, v_loc_assy, v_neg) returning id into v_p_wda006;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda006, v_p_pnl004, 2, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, motivo, nota, negocio_id)
values (v_p_wda006, v_em_hwr005, 2*4, 'sustitucion_excepcional', 'RM-HWR-019 agotado en el momento del montaje; se usó RM-HWR-005 (tornillería compatible) de forma temporal', v_neg);

-- Escenario 7 + 10 (CADUCIDAD -> INCIDENCIA): el lote de barniz (fecha_caducidad='2026-06-20')
-- se aplica en dos manos, ambas después de caducar. check_consumo_produccion no bloquea -- la
-- caducidad es un aviso, no un bloqueo (PENDIENTES_MODELO.md #8) -- y cada línea dispara de forma
-- independiente (CONSTRAINT TRIGGER "for each row") registrar_incidencia_caducidad_consumo(),
-- generando una fila en incidencias_stock_articulo (motivo='caducidad') cada una.
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, nota, negocio_id)
values (v_p_wda006, v_em_pnt001, 0.30, 'aplicación 1 de barniz (lote caducado el 2026-06-20)', v_neg) returning id into v_cp_pnt_1;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, nota, negocio_id)
values (v_p_wda006, v_em_pnt001, 0.30, 'aplicación 2 de barniz / retoque (lote caducado el 2026-06-20)', v_neg) returning id into v_cp_pnt_2;
raise notice 'Sustitución excepcional y consumo de material caducado Mes 4 completados.';

-- ===========================================================================================
-- 5. ESCENARIO 9 — CANCELACIÓN DE PRODUCCIÓN
-- ===========================================================================================
-- No existe estado='cancelada' en producciones_semielaborado (confirmado por auditoría del
-- esquema real). SÍ existe un mecanismo real para una producción todavía 'abierta':
-- Producciones.jsx:503-510 (handleCancelar) hace un DELETE liso sobre producciones_semielaborado,
-- confirmado por su propio texto de confirmación ("Se revertirán los consumos ya registrados").
-- Se reproduce aquí exactamente: abrir, consumir, cancelar. tanda_id se omite (nullable, igual
-- que en el INSERT real del frontend) y cantidad_producida se omite igual que en el flujo real
-- de "Iniciar producción" (solo se rellena al cerrar).
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl007, '2026-06-10', 'abierta', 6, v_loc_cut, v_neg) returning id into v_p_mtl007_cancel;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007_cancel, v_em_mtl007_cancel, 3*0.45, v_neg);
delete from producciones_semielaborado where id = v_p_mtl007_cancel;
raise notice 'Escenario 9 (cancelación de producción) completado: producción abierta creada, consumida y cancelada (DELETE con cascada real, sin dejar rastro de estado -- limitación documentada en el informe).';

-- ===========================================================================================
-- 6. ESCENARIO 8 — AJUSTE DE STOCK POR INVENTARIO FÍSICO
-- ===========================================================================================
insert into ajustes_articulo (articulo_id, entrada_material_id, cantidad, motivo, fecha, negocio_id)
values (v_art_hwr005, v_em_hwr005, -3, 'Recuento físico de junio: 3 unidades de RM-HWR-005 no localizadas (extravío en almacén), de un lote de 20 recibido el 04/06', '2026-06-26', v_neg);
raise notice 'Ajuste de stock Mes 4: -3 unidades de RM-HWR-005.';

-- ===========================================================================================
-- 7. VENTAS MES 4 — CUMPLIMIENTO PARCIAL (escenario 6, causado por el rechazo del punto 3)
-- ===========================================================================================
-- Pedido A: 12 sillas, disponibilidad completa (12 de 17 aceptadas), servido en su totalidad.
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_b2b[3], '2026-06-16', '2026-06-20', 'pendiente', '[FASE06-M4] Pedido de sillas, entrega completa', v_neg) returning id into v_pv_a;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_a, v_pf_c001, 12, v_precio_c001, v_neg) returning id into v_lpv_a;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[3], '2026-06-16', 'DN-ALP-260022', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 12, v_precio_c001, v_lpv_a, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[3], '2026-06-16', 12*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[3], '2026-06-19', 12*v_precio_c001, 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 12*v_precio_c001, v_neg);

-- Pedido B: 8 sillas pedidas, solo 5 disponibles tras servir el Pedido A (17-12=5) -- cumplimiento
-- parcial real, no manipulación manual del estado (actualizar_estado_pedido_por_servicio decide
-- el estado real a partir de la cobertura, no se toca la columna estado a mano).
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_b2b[5], '2026-06-16', '2026-06-22', 'pendiente', '[FASE06-M4] Pedido de sillas, cumplimiento parcial por rechazo de calidad en producción', v_neg) returning id into v_pv_b;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_b, v_pf_c001, 8, v_precio_c001, v_neg) returning id into v_lpv_b;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[5], '2026-06-22', 'DN-ALP-260023', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 5, v_precio_c001, v_lpv_b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[5], '2026-06-22', 5*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[5], '2026-06-27', round(5*v_precio_c001*0.5,2), 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;
raise notice 'Ventas Mes 4 completadas: Pedido A servido en su totalidad (12/12), Pedido B parcial (5/8, quedan 3 pendientes).';

-- ===========================================================================================
-- 8. ESCENARIO 11 — CONTINUIDAD FINANCIERA SOBRE FACTURA DE MES 3
-- ===========================================================================================
-- Nueva fila de pago/aplicación sobre una factura YA EXISTENTE de Mes 3 (RE-ALP-2026-009,
-- PARCIAL, saldo 1760.00 al cierre de Mes 3). No se modifica la factura ni ninguna fila de
-- Mes 3 -- es una continuación legítima de su ciclo de vida, exactamente lo que el prompt permite.
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
select cliente_id, '2026-06-29', 1000.00, 'transferencia', v_neg from facturas_venta where id = v_fv3_009 returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv3_009, 1000.00, v_neg);
raise notice 'Pago de continuidad Mes 4 sobre factura de Mes 3 (RE-ALP-2026-009): 1000.00 CHF, saldo restante 760.00 CHF.';

raise notice 'FASE 06 MES 4 sembrada correctamente para AlpenWerk (negocio_id=%).', v_neg;
end $$;
commit;

-- ===========================================================================================
-- Segunda transacción: cierre de UNA de las dos incidencias de caducidad (la de "retoque"),
-- dejando la otra 'pendiente' (abierta). Igual que en Mes 3: registrar_incidencia_caducidad_consumo
-- es DEFERRABLE INITIALLY DEFERRED, así que la fila en incidencias_stock_articulo no existe hasta
-- el COMMIT de la transacción anterior -- un UPDATE en la misma transacción sería un no-op
-- silencioso. Se localiza por el texto de la nota de su línea de consumo (identificador
-- determinista, no un id hardcoded).
-- ===========================================================================================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
update incidencias_stock_articulo isa
set estado = 'ignorado'
from consumo_produccion cp
where isa.consumo_produccion_id = cp.id
  and cp.nota ilike '%retoque%';
commit;
