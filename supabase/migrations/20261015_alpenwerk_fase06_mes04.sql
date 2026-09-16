-- FASE 06 de AlpenWerk Möbel GmbH — MES 4: PROBLEMAS OPERATIVOS (junio 2026)
-- CORRECCIONES APLICADAS:
-- 1. Multiplicaciones con * explícito (17*4, 12*v_precio, etc.)
-- 2. Referencia correcta de lotes heredados (LFS-MTLA-0501 para RM-MTL-004)
-- 3. Producción Article Base ajustada a 39 uds (47.60m disponibles reales)
-- 4. Escenario 9 simplificado: producción abandonada sin consumos (evita error de trigger)
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
do $$
declare
v_neg uuid;
v_loc_metal uuid; v_loc_wood uuid; v_loc_hw uuid;
v_loc_cut uuid; v_loc_mach uuid; v_loc_sand uuid; v_loc_assy uuid; v_loc_fg uuid;
v_art_mtl004 bigint; v_art_mtl029 bigint; v_art_mtl007 bigint; v_art_mtl013 bigint;
v_art_wod010 bigint; v_art_brd001 bigint; v_art_pnt001 bigint; v_art_hwr005 bigint; v_art_hwr019 bigint;
v_sf_mtl001 bigint; v_sf_mtl010 bigint; v_sf_pnl004 bigint; v_sf_wda006 bigint;
v_sf_mtl007 bigint; v_sf_mtl012 bigint; v_sf_wod004 bigint; v_sf_wod008 bigint;
v_pf_c001 bigint; v_precio_c001 numeric;
v_prov_mtl_a bigint; v_prov_mtl_c bigint; v_prov_wod_a bigint; v_prov_pnt_a bigint;
v_prov_brd_a bigint; v_prov_hwr_b bigint;
v_cli_b2b bigint[];
v_em_mtl004_prev bigint; v_em_mtl029_prev bigint;
v_fv3_009 bigint;
v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint;
v_av bigint; v_fv bigint; v_pago bigint;
v_em_mtl029_new bigint; v_em_mtl013_a bigint; v_em_mtl013_b bigint; v_em_pnt001 bigint;
v_em_brd001 bigint; v_em_hwr005 bigint; v_em_mtl007 bigint; v_em_wod010 bigint;
v_p_mtl001 bigint; v_p_mtl010 bigint; v_p_pnl004 bigint; v_p_wda006 bigint;
v_p_mtl007 bigint; v_p_mtl012 bigint; v_p_wod004 bigint; v_p_wod008 bigint; v_p_pf_c001 bigint;
v_cp_pnt_1 bigint; v_cp_pnt_2 bigint;
v_pv_a bigint; v_lpv_a bigint; v_pv_b bigint; v_lpv_b bigint;
begin
select id into v_neg from negocios where codigo_corto = 'ALP';
if v_neg is null then raise exception 'AlpenWerk no existe.'; end if;
if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M4]%') then
raise notice 'Mes 4 ya sembrado. Abortando.'; return; end if;

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
) order by ap.proveedor_id limit 1;

select array_agg(id order by id) into v_cli_b2b from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;

-- Lotes heredados de Mes 3 (CORREGIDO: LFS-MTLA-0501 es RM-MTL-004, no LFS-MTLA-0503)
select em.id into v_em_mtl004_prev from entrada_material em join albaranes_compra ac on ac.id=em.albaran_compra_id
where ac.numero_albaran='LFS-MTLA-0501' and em.negocio_id=v_neg;
select em.id into v_em_mtl029_prev from entrada_material em join albaranes_compra ac on ac.id=em.albaran_compra_id
where ac.numero_albaran='LFS-MTLC-0056' and em.negocio_id=v_neg;
select id into v_fv3_009 from facturas_venta where negocio_id=v_neg and numero_factura='RE-ALP-2026-009';

-- 1. COMPRAS
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-08', 'pendiente', '[FASE06-M4] SUPPLIER FAILURE: Metal-A no entregó', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl004, 60, 8.70, v_neg);

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_c, '2026-06-02', '2026-06-09', 'pendiente', '[FASE06-M4] Cobertura Article Base vía RM-MTL-029', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl029, 30, 9.10, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_c, 'LFS-MTLC-0057', '2026-06-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl029, 30, 9.10, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl029_new;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] RECEPCION PARCIAL: pedido 40, entrega 25, quedan 15', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl013, 40, 4.50, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0601', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl013, 25, 4.50, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl013_a;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0615', '2026-06-18', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl013, 15, 4.50, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl013_b;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_pnt_a, '2026-06-01', '2026-06-02', 'pendiente', '[FASE06-M4] Restock barniz', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pnt001, 10, 16.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_pnt_a, 'LFS-PNTA-0201', '2026-06-02', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, fecha_caducidad, negocio_id) values (v_ac_tmp, v_art_pnt001, 10, 16.00, v_lp_tmp, v_loc_hw, '2026-06-20', v_neg) returning id into v_em_pnt001;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_brd_a, '2026-06-01', '2026-06-04', 'pendiente', '[FASE06-M4] Restock tablero', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_brd001, 2, 22.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_brd_a, 'LFS-BRDA-0031', '2026-06-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_brd001, 2, 22.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_brd001;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_hwr_b, '2026-06-01', '2026-06-04', 'pendiente', '[FASE06-M4] Restock tornillería RM-HWR-005', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr005, 20, 0.17, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_hwr_b, 'LFS-HWRB-0013', '2026-06-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr005, 20, 0.17, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_hwr005;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] Reposición tubo redondo para sillas', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 40, 6.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0602', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 40, 6.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-06-01', '2026-06-05', 'pendiente', '[FASE06-M4] Reposición tablero de haya', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod010, 4, 39.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0327', '2026-06-05', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod010, 4, 39.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010;

-- 2. PRODUCCIÓN ARTICLE BASE (39 uds, no 50, por stock real disponible: 7.60+10+30=47.60m)
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl001, '2026-06-11', 'cerrada', 39, 45, v_loc_cut, v_neg) returning id into v_p_mtl001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_prev, 7.60, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl029_prev, 10.00, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl029_new, 29.20, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl010, '2026-06-12', 'cerrada', 39, 45, v_loc_mach, v_neg) returning id into v_p_mtl010;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 39, v_neg);

-- 3. PRODUCCIÓN SILLAS (rechazo: 17 de 20)
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

insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_pf_c001, '2026-06-15', 'cerrada', 17, 20, 'Rechazo QC: 2 uniones soldadas defectuosas + 1 asiento dañado', v_loc_fg, v_neg) returning id into v_p_pf_c001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012, 17*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008, 17*1, v_neg);

-- 4. SUSTITUCIÓN EXCEPCIONAL + CADUCIDAD
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_pnl004, '2026-06-24', 'cerrada', 2, 2, v_loc_cut, v_neg) returning id into v_p_pnl004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_pnl004, v_em_brd001, 2*0.40, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wda006, '2026-06-25', 'cerrada', 2, 2, v_loc_assy, v_neg) returning id into v_p_wda006;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda006, v_p_pnl004, 2, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, motivo, nota, negocio_id)
values (v_p_wda006, v_em_hwr005, 2*4, 'sustitucion_excepcional', 'RM-HWR-019 agotado, se usó RM-HWR-005 temporalmente', v_neg);

insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, nota, negocio_id)
values (v_p_wda006, v_em_pnt001, 0.30, 'aplicación 1 de barniz (lote caducado 2026-06-20)', v_neg) returning id into v_cp_pnt_1;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, nota, negocio_id)
values (v_p_wda006, v_em_pnt001, 0.30, 'aplicación 2 de barniz / retoque (lote caducado 2026-06-20)', v_neg) returning id into v_cp_pnt_2;

-- 5. ESCENARIO 9 SIMPLIFICADO: Producción abandonada (sin consumos, no rompe triggers)
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_sf_mtl007, '2026-06-10', 'abierta', 6, '[FASE06-M4] Producción planificada pero abandonada antes de consumir material (simula cancelación)', v_loc_cut, v_neg);

-- 6. AJUSTE DE STOCK
insert into ajustes_articulo (articulo_id, entrada_material_id, cantidad, motivo, fecha, negocio_id)
values (v_art_hwr005, v_em_hwr005, -3, 'Recuento físico junio: 3 unidades RM-HWR-005 no localizadas', '2026-06-26', v_neg);

-- 7. VENTAS (cumplimiento parcial)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_b2b[3], '2026-06-16', '2026-06-20', 'pendiente', '[FASE06-M4] Pedido sillas, entrega completa', v_neg) returning id into v_pv_a;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_a, v_pf_c001, 12, v_precio_c001, v_neg) returning id into v_lpv_a;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[3], '2026-06-16', 'DN-ALP-260022', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 12, v_precio_c001, v_lpv_a, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[3], '2026-06-16', 12*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[3], '2026-06-19', 12*v_precio_c001, 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 12*v_precio_c001, v_neg);

insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_b2b[5], '2026-06-16', '2026-06-22', 'pendiente', '[FASE06-M4] Pedido sillas, cumplimiento parcial', v_neg) returning id into v_pv_b;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_b, v_pf_c001, 8, v_precio_c001, v_neg) returning id into v_lpv_b;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[5], '2026-06-22', 'DN-ALP-260023', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 5, v_precio_c001, v_lpv_b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[5], '2026-06-22', 5*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[5], '2026-06-27', round(5*v_precio_c001*0.5,2), 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;

-- 8. PAGO CONTINUIDAD MES 3
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
select cliente_id, '2026-06-29', 1000.00, 'transferencia', v_neg from facturas_venta where id = v_fv3_009 returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv3_009, 1000.00, v_neg);

raise notice 'FASE 06 MES 4 completada.';
end $$;
commit;

-- Segunda transacción: cierre de incidencia de caducidad
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