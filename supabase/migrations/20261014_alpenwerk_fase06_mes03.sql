-- FASE 06 de AlpenWerk Möbel GmbH — MES 3: OPERACIÓN INDUSTRIAL NORMAL
-- Continúa EXACTAMENTE desde el cierre validado de Mes 2 (abril 2026).
-- CORRECCIONES APLICADAS:
-- 1. Tanda B ajustada: 6 sillas reales (no 12) por limitación de material en lote urgente
-- 2. Venta C004 ajustada: 4+2=6 unidades (no 4+3=7) para coincidir con la producción real
-- 3. Todas las multiplicaciones con * explícito
-- 4. Todas las palabras clave y variables sin espacios espurios

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
do $$
declare
v_neg uuid;
-- ubicaciones
v_loc_metal uuid; v_loc_wood uuid; v_loc_chem uuid; v_loc_hw uuid;
v_loc_cut uuid; v_loc_mach uuid; v_loc_weld uuid; v_loc_sand uuid; v_loc_assy uuid;
v_loc_fg uuid;
-- articulos_compra
v_art_mtl003 bigint; v_art_mtl004 bigint; v_art_mtl007 bigint; v_art_mtl013 bigint; v_art_mtl018 bigint;
v_art_mtl029 bigint;
v_art_wod003 bigint; v_art_wod010 bigint; v_art_wod020 bigint; v_art_brd001 bigint;
v_art_pnt001 bigint; v_art_pnt005 bigint;
v_art_hwr001 bigint; v_art_hwr005 bigint; v_art_hwr019 bigint;
v_art_con001 bigint; v_art_con019 bigint;
v_art_pkg001 bigint; v_art_pkg002 bigint;
-- semielaborados
v_sf_mtl001 bigint; v_sf_mtl005 bigint; v_sf_mtl006 bigint; v_sf_mtl007 bigint; v_sf_mtl008 bigint; v_sf_mtl009 bigint;
v_sf_mtl010 bigint; v_sf_mtl011 bigint; v_sf_mtl012 bigint; v_sf_mtl013 bigint; v_sf_mtl014 bigint;
v_sf_wod001 bigint; v_sf_wod004 bigint; v_sf_wod005 bigint; v_sf_wod008 bigint; v_sf_pnl004 bigint;
v_sf_asm001 bigint; v_sf_asm002 bigint; v_sf_asm005 bigint; v_sf_asm007 bigint;
v_sf_wda001 bigint; v_sf_wda006 bigint;
v_sf_str001 bigint; v_sf_str005 bigint;
-- productos_finales
v_pf_t001 bigint; v_pf_b001 bigint; v_pf_b002 bigint;
v_pf_c001 bigint; v_pf_c004 bigint;
v_pf_s001 bigint; v_pf_s002 bigint;
v_precio_t001 numeric; v_precio_c001 numeric; v_precio_c004 numeric;
v_precio_b001 numeric; v_precio_b002 numeric; v_precio_s001 numeric; v_precio_s002 numeric;
-- proveedores
v_prov_mtl_a bigint; v_prov_mtl_b bigint; v_prov_mtl_c bigint;
v_prov_wod_a bigint; v_prov_pnt_a bigint; v_prov_hwr_a bigint; v_prov_hwr_b bigint;
v_prov_con_a bigint; v_prov_con_b bigint; v_prov_pkg_a bigint;
-- clientes
v_cli_b2b bigint[]; v_cli_b2c bigint[];
-- pedidos heredados
v_pv_grande bigint; v_lpv_grande_t bigint; v_lpv_grande_c bigint;
v_pv_c004a bigint; v_lpv_c004a bigint;
v_pv_c004b bigint; v_lpv_c004b bigint;
v_pv_s001_a bigint; v_lpv_s001_a bigint;
v_pv_s001_b bigint; v_lpv_s001_b bigint;
v_pv_s001_c bigint; v_lpv_s001_c bigint;
v_pv_s001_d bigint; v_lpv_s001_d bigint;
v_pv_s002_a bigint; v_lpv_s002_a bigint;
v_pv_s002_b bigint; v_lpv_s002_b bigint;
v_pv_b002 bigint; v_lpv_b002 bigint;
v_pc_parcial_m2 bigint; v_lpc_parcial_m2 bigint;
v_fc8_id bigint;
v_em_hwr001_lote bigint;
-- scratch
v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint; v_em_tmp bigint; v_pago_tmp bigint;
v_av bigint; v_fv bigint; v_pago bigint; v_pv_tmp bigint; v_lpv_tmp bigint;
-- lotes nuevos
v_em_mtl004_a bigint; v_em_mtl004_b bigint; v_em_mtl003 bigint; v_em_mtl007 bigint; v_em_mtl007_short bigint; v_em_mtl013 bigint;
v_em_wod020 bigint; v_em_hwr019 bigint; v_em_wod003_new bigint; v_em_wod010_short bigint;
-- producciones (pool compartido)
v_p_mtl001 bigint; v_p_mtl005 bigint; v_p_mtl006 bigint; v_p_mtl008 bigint; v_p_mtl009 bigint;
v_p_wod001 bigint;
v_p_mtl010 bigint; v_p_mtl011 bigint; v_p_mtl013 bigint; v_p_mtl014 bigint; v_p_wod005 bigint; v_p_pnl004 bigint;
v_p_asm001 bigint; v_p_asm002 bigint; v_p_asm005 bigint; v_p_asm007 bigint; v_p_wda001 bigint; v_p_wda006 bigint;
v_p_str001 bigint; v_p_str005 bigint;
v_p_pf_t001 bigint; v_p_pf_b001 bigint; v_p_pf_b002 bigint; v_p_pf_s001 bigint; v_p_pf_s002 bigint;
-- producciones (sillas, 2 tandas)
v_p_mtl007_a bigint; v_p_wod004_a bigint; v_p_mtl012_a bigint; v_p_wod008_a bigint; v_p_pf_c001 bigint;
v_p_mtl007_b bigint; v_p_wod004_b bigint; v_p_mtl012_b bigint; v_p_wod008_b bigint; v_p_pf_c004 bigint;
v_tanda_compartida uuid; v_tanda_sillas_a uuid; v_tanda_sillas_b uuid;
begin
select id into v_neg from negocios where codigo_corto = 'ALP';
if v_neg is null then raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.'; end if;
if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M3]%') then
raise notice 'Fase 06 Mes 3 ya fue sembrada anteriormente. Abortando sin cambios.'; return; end if;
if not exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M2]%') then
raise exception 'Mes 2 no existe todavía. Abortando.'; end if;

-- 0. RESOLUCIÓN DE IDs
select id into v_loc_metal from ubicaciones where negocio_id=v_neg and nombre='RAW-METAL';
select id into v_loc_wood from ubicaciones where negocio_id=v_neg and nombre='RAW-WOOD';
select id into v_loc_chem from ubicaciones where negocio_id=v_neg and nombre='RAW-CHEMICAL';
select id into v_loc_hw from ubicaciones where negocio_id=v_neg and nombre='RAW-HARDWARE';
select id into v_loc_cut from ubicaciones where negocio_id=v_neg and nombre='CUT';
select id into v_loc_mach from ubicaciones where negocio_id=v_neg and nombre='MACHINING';
select id into v_loc_weld from ubicaciones where negocio_id=v_neg and nombre='WELDING';
select id into v_loc_sand from ubicaciones where negocio_id=v_neg and nombre='SANDING';
select id into v_loc_assy from ubicaciones where negocio_id=v_neg and nombre='ASSEMBLY';
select id into v_loc_fg from ubicaciones where negocio_id=v_neg and nombre='FINISHED-GOODS';

select id into v_art_mtl003 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-003';
select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
select id into v_art_mtl013 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-013';
select id into v_art_mtl018 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-018';
select id into v_art_mtl029 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-029';
select id into v_art_wod003 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-003';
select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
select id into v_art_wod020 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-020';
select id into v_art_brd001 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-001';
select id into v_art_pnt001 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-001';
select id into v_art_pnt005 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-005';
select id into v_art_hwr001 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-001';
select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';
select id into v_art_hwr019 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-019';
select id into v_art_con001 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-001';
select id into v_art_con019 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-019';
select id into v_art_pkg001 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-001';
select id into v_art_pkg002 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-002';

select id into v_sf_mtl001 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-001';
select id into v_sf_mtl005 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-005';
select id into v_sf_mtl006 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-006';
select id into v_sf_mtl007 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-007';
select id into v_sf_mtl008 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-008';
select id into v_sf_mtl009 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-009';
select id into v_sf_mtl010 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-010';
select id into v_sf_mtl011 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-011';
select id into v_sf_mtl012 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-012';
select id into v_sf_mtl013 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-013';
select id into v_sf_mtl014 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-014';
select id into v_sf_wod001 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-001';
select id into v_sf_wod004 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-004';
select id into v_sf_wod005 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-005';
select id into v_sf_wod008 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-008';
select id into v_sf_pnl004 from semielaborados where negocio_id=v_neg and codigo='SF-PNL-004';
select id into v_sf_asm001 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-001';
select id into v_sf_asm002 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-002';
select id into v_sf_asm005 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-005';
select id into v_sf_asm007 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-007';
select id into v_sf_wda001 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-001';
select id into v_sf_wda006 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-006';
select id into v_sf_str001 from semielaborados where negocio_id=v_neg and codigo='SF-STR-001';
select id into v_sf_str005 from semielaborados where negocio_id=v_neg and codigo='SF-STR-005';

select id, precio_venta into v_pf_t001, v_precio_t001 from productos_finales where negocio_id=v_neg and codigo='ALP-T001';
select id, precio_venta into v_pf_b001, v_precio_b001 from productos_finales where negocio_id=v_neg and codigo='ALP-B001';
select id, precio_venta into v_pf_b002, v_precio_b002 from productos_finales where negocio_id=v_neg and codigo='ALP-B002';
select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';
select id, precio_venta into v_pf_c004, v_precio_c004 from productos_finales where negocio_id=v_neg and codigo='ALP-C004';
select id, precio_venta into v_pf_s001, v_precio_s001 from productos_finales where negocio_id=v_neg and codigo='ALP-S001';
select id, precio_venta into v_pf_s002, v_precio_s002 from productos_finales where negocio_id=v_neg and codigo='ALP-S002';

-- Proveedores
select ap.proveedor_id into v_prov_mtl_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004)
order by (ap.articulo_id=v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_mtl_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004) and ap.proveedor_id <> v_prov_mtl_a
order by (ap.articulo_id=v_art_mtl004) desc, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_mtl_c from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004) and ap.proveedor_id not in (v_prov_mtl_a, v_prov_mtl_b)
order by ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_wod_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_wod003)
order by (ap.articulo_id=v_art_wod003) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_pnt_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_pnt001)
order by (ap.articulo_id=v_art_pnt001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_hwr_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr001)
order by (ap.articulo_id=v_art_hwr001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_hwr_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr001) and ap.proveedor_id <> v_prov_hwr_a
order by ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_con_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_con001)
order by (ap.articulo_id=v_art_con001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_con_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_con001) and ap.proveedor_id <> v_prov_con_a
order by ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_pkg_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_pkg002)
order by (ap.articulo_id=v_art_pkg002) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;

select array_agg(id order by id) into v_cli_b2b from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;
select array_agg(id order by id) into v_cli_b2c from (select id from clientes where negocio_id=v_neg and tipo='particular' order by id limit 3) s;

-- Lookups de pedidos heredados
select p.id, l.id into v_pv_grande, v_lpv_grande_t from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.notas like '%Pedido grande%' and l.producto_final_id=v_pf_t001;
select l.id into v_lpv_grande_c from lineas_pedido_venta l where l.pedido_id=v_pv_grande and l.producto_final_id=v_pf_c001;
select p.id, l.id into v_pv_c004a, v_lpv_c004a from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260012' and l.producto_final_id=v_pf_c004;
select p.id, l.id into v_pv_c004b, v_lpv_c004b from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.notas='[FASE06-M2] Backlog' and l.producto_final_id=v_pf_c004;
select p.id, l.id into v_pv_s001_a, v_lpv_s001_a from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260005' and l.producto_final_id=v_pf_s001;
select p.id, l.id into v_pv_s001_b, v_lpv_s001_b from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260017' and l.producto_final_id=v_pf_s001;
select p.id, l.id into v_pv_b002, v_lpv_b002 from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260011' and l.producto_final_id=v_pf_b002;
select p.id, l.id into v_pv_s002_a, v_lpv_s002_a from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260010' and l.producto_final_id=v_pf_s002;
select p.id, l.id into v_pv_s001_c, v_lpv_s001_c from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.notas='[FASE06-M2] Backlog' and l.producto_final_id=v_pf_s001 and l.cantidad=2;
select p.id, l.id into v_pv_s001_d, v_lpv_s001_d from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.notas='[FASE06-M2] Backlog' and l.producto_final_id=v_pf_s001 and l.cantidad=1;
select p.id, l.id into v_pv_s002_b, v_lpv_s002_b from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.notas='[FASE06-M2] Backlog' and l.producto_final_id=v_pf_s002;

select pc.id, lpc.id into v_pc_parcial_m2, v_lpc_parcial_m2 from pedidos_compra pc join lineas_pedido_compra lpc on lpc.pedido_compra_id=pc.id where pc.negocio_id=v_neg and pc.notas like '%RECEPCION PARCIAL%';
select id into v_fc8_id from facturas_compra where negocio_id=v_neg and codigo_interno='PI-260008';
select id into v_em_hwr001_lote from entrada_material where negocio_id=v_neg and articulo_id=v_art_hwr001 order by id limit 1;

raise notice 'IDs resueltos. Iniciando transacciones de Mes 3.';

-- 1. COMPRAS DE MES 3
-- Completa recepción parcial Mes 2
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
select proveedor_id, 'LFS-WODA-0323B', '2026-05-09', id, 'pedido', v_neg from pedidos_compra where id=v_pc_parcial_m2 returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
values (v_ac_tmp, v_art_wod003, 9, 46.00, v_lpc_parcial_m2, v_loc_wood, v_neg) returning id into v_em_tmp;

-- Lotes grandes Mes 3
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_a, '2026-05-01', '2026-05-08', 'pendiente', '[FASE06-M3] Reposición tubo 40x40x2', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl004, 90, 8.60, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0501', '2026-05-08', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl004, 90, 8.60, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_a;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_a, '2026-05-01', '2026-05-08', 'pendiente', '[FASE06-M3] Reposición tubo 30x30x2', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl003, 55, 6.30, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0502', '2026-05-08', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl003, 55, 6.30, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl003;

-- Lote principal sillas (Tanda A)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_a, '2026-05-01', '2026-05-08', 'pendiente', '[FASE06-M3] Reposición tubo redondo 33.7x2', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 40, 5.90, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0503', '2026-05-08', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 40, 5.90, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007;

-- Lote pequeño y deliberadamente insuficiente para Tanda B (15m)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_a, '2026-05-06', '2026-05-12', 'pendiente', '[FASE06-M3] Reposición urgente y parcial de tubo redondo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 15, 6.10, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0505', '2026-05-12', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 15, 6.10, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007_short;

-- Primera compra RM-MTL-013
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_a, '2026-05-03', '2026-05-10', 'pendiente', '[FASE06-M3] Primera compra de pletina 40x5', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl013, 25, 4.40, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0504', '2026-05-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl013, 25, 4.40, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl013;

-- Metal-B / Metal-C
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_b, '2026-05-02', '2026-05-09', 'pendiente', '[FASE06-M3] Restock proveedor alternativo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl004, 10, 8.80, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_b, 'LFS-MTLB-1105', '2026-05-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl004, 10, 8.80, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_b;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_mtl_c, '2026-05-02', '2026-05-09', 'pendiente', '[FASE06-M3] Restock Article Base (RM-MTL-029)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl029, 10, 8.95, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_c, 'LFS-MTLC-0056', '2026-05-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl029, 10, 8.95, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

-- Wood-A
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_wod_a, '2026-05-02', '2026-05-09', 'pendiente', '[FASE06-M3] Restock cantonera y tablero de roble', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod020, 70, 1.25, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0325', '2026-05-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod020, 70, 1.25, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod020;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod003, 15, 46.50, v_neg) returning id into v_lp_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod003, 15, 46.50, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod003_new;

-- Lote pequeño deliberadamente insuficiente de RM-WOD-010 (1 m2)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_wod_a, '2026-05-06', '2026-05-12', 'pendiente', '[FASE06-M3] Reposición urgente y parcial de tablero de haya', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod010, 1, 39.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0326', '2026-05-12', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod010, 1, 39.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010_short;

-- Consumables, Hardware, Paint, Packaging
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_con_a, '2026-05-03', '2026-05-10', 'pendiente', '[FASE06-M3] Restock hilo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_con001, 15, 12.30, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_con_a, 'LFS-CONA-0185', '2026-05-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_con001, 15, 12.30, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_con_b, '2026-05-04', '2026-05-11', 'pendiente', '[FASE06-M3] Restock Article Base hilo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_con019, 10, 12.70, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_con_b, 'LFS-CONB-0022', '2026-05-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_con019, 10, 12.70, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_hwr_a, '2026-05-03', '2026-05-10', 'pendiente', '[FASE06-M3] Pasadores y tornillería', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr019, 60, 0.22, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_hwr_a, 'LFS-HWRA-0457', '2026-05-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr019, 60, 0.22, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_hwr019;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr001, 200, 0.08, v_neg) returning id into v_lp_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr001, 200, 0.08, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_hwr_b, '2026-05-04', '2026-05-11', 'pendiente', '[FASE06-M3] Restock tornillería', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr005, 100, 0.17, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_hwr_b, 'LFS-HWRB-0012', '2026-05-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr005, 100, 0.17, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_pnt_a, '2026-05-04', '2026-05-11', 'pendiente', '[FASE06-M3] Restock acabados', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pnt001, 15, 15.40, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_pnt_a, 'LFS-PNTA-0200', '2026-05-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_pnt001, 15, 15.40, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pnt005, 10, 9.70, v_neg) returning id into v_lp_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_pnt005, 10, 9.70, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_prov_pkg_a, '2026-05-05', '2026-05-12', 'pendiente', '[FASE06-M3] Restock embalaje', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pkg002, 100, 2.15, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_pkg_a, 'LFS-PKGA-0094', '2026-05-12', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_pkg002, 100, 2.15, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pkg001, 50, 1.45, v_neg) returning id into v_lp_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_pkg001, 50, 1.45, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

-- Pago PI-260008
insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_pkg_a, '2026-05-05', 280.00, 'transferencia', v_neg) returning id into v_pago_tmp;
insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc8_id, 280.00, v_neg);
raise notice 'Compras Mes 3 completadas.';

-- 2. PRODUCCIÓN — POOL COMPARTIDO
insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-05-11', 'cerrada', v_neg) returning id into v_tanda_compartida;

-- Nivel 1
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl001, '2026-05-12', 'cerrada', 36, 36, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_mtl001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_a, 36*1.20, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl005, '2026-05-12', 'cerrada', 56, 56, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_mtl005;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl005, v_em_mtl004_a, 56*0.70, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl006, '2026-05-12', 'cerrada', 72, 72, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_mtl006;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl006, v_em_mtl003, 72*0.70, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl009, '2026-05-12', 'cerrada', 72, 72, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_mtl009;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_mtl009, entrada_material_id, 72*0.01, v_neg from stock_lotes_articulo where articulo_id=v_art_mtl018 and stock_disponible>=72*0.01 order by fecha_recepcion limit 1;
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod001, '2026-05-12', 'cerrada', 18, 18, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_wod001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod001, v_em_wod003_new, 18*0.72, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl008, '2026-05-12', 'cerrada', 40, 40, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_mtl008;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl008, v_em_mtl013, 40*0.50, v_neg);

-- Nivel 2
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl010, '2026-05-13', 'cerrada', 36, 36, v_loc_mach, v_tanda_compartida, v_neg) returning id into v_p_mtl010;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 36, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl011, '2026-05-13', 'cerrada', 72, 72, v_loc_mach, v_tanda_compartida, v_neg) returning id into v_p_mtl011;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl011, v_p_mtl006, 72, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl014, '2026-05-13', 'cerrada', 72, 72, v_loc_mach, v_tanda_compartida, v_neg) returning id into v_p_mtl014;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl014, v_p_mtl009, 72, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod005, '2026-05-13', 'cerrada', 18, 18, v_loc_sand, v_tanda_compartida, v_neg) returning id into v_p_wod005;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod005, v_p_wod001, 18, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl013, '2026-05-13', 'cerrada', 40, 40, v_loc_mach, v_tanda_compartida, v_neg) returning id into v_p_mtl013;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl013, v_p_mtl008, 40, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_pnl004, '2026-05-13', 'cerrada', 10, 10, v_loc_cut, v_tanda_compartida, v_neg) returning id into v_p_pnl004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_pnl004, entrada_material_id, 10*0.40, v_neg from stock_lotes_articulo where articulo_id=v_art_brd001 and stock_disponible>=10*0.40 order by fecha_recepcion limit 1;

-- Nivel 3
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_asm001, '2026-05-14', 'cerrada', 72, 72, v_loc_weld, v_tanda_compartida, v_neg) returning id into v_p_asm001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm001, v_p_mtl011, 72, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_asm002, '2026-05-14', 'cerrada', 12, 12, v_loc_weld, v_tanda_compartida, v_neg) returning id into v_p_asm002;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl010, 12*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl005, 12*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_asm001, 12*4, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl014, 12*4, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_asm002, entrada_material_id, 12*0.35, v_neg from stock_lotes_articulo where articulo_id=v_art_con001 and stock_disponible>=12*0.35 order by fecha_recepcion limit 1;
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_asm005, '2026-05-14', 'cerrada', 6, 6, v_loc_weld, v_tanda_compartida, v_neg) returning id into v_p_asm005;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl010, 6*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl005, 6*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_asm001, 6*4, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl014, 6*4, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_asm005, entrada_material_id, 6*0.35, v_neg from stock_lotes_articulo where articulo_id=v_art_con001 and stock_disponible>=6*0.35 order by fecha_recepcion limit 1;
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_asm007, '2026-05-14', 'cerrada', 10, 10, v_loc_weld, v_tanda_compartida, v_neg) returning id into v_p_asm007;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm007, v_p_mtl013, 10*4, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm007, v_p_mtl005, 10*2, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_asm007, entrada_material_id, 10*0.20, v_neg from stock_lotes_articulo where articulo_id=v_art_con001 and stock_disponible>=10*0.20 order by fecha_recepcion limit 1;
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wda001, '2026-05-14', 'cerrada', 18, 18, v_loc_assy, v_tanda_compartida, v_neg) returning id into v_p_wda001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda001, v_p_wod005, 18, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wda001, v_em_wod020, 18*3.60, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wda006, '2026-05-14', 'cerrada', 10, 10, v_loc_assy, v_tanda_compartida, v_neg) returning id into v_p_wda006;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda006, v_p_pnl004, 10, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wda006, v_em_hwr019, 10*4, v_neg);

-- Nivel 4
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_str001, '2026-05-15', 'cerrada', 12, 12, v_loc_assy, v_tanda_compartida, v_neg) returning id into v_p_str001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_asm002, 12, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_wda001, 12, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_str005, '2026-05-15', 'cerrada', 10, 10, v_loc_assy, v_tanda_compartida, v_neg) returning id into v_p_str005;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str005, v_p_asm007, 10, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str005, v_p_wda006, 10, v_neg);

-- Finales
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id) values (v_pf_t001, '2026-05-18', 'cerrada', 12, 12, v_loc_fg, v_pv_grande, v_neg) returning id into v_p_pf_t001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_t001, v_p_str001, 12, v_neg);
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id) values (v_pf_b001, '2026-05-18', 'cerrada', 5, 5, v_loc_fg, v_neg) returning id into v_p_pf_b001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_b001, v_p_asm005, 5, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) select v_p_pf_b001, produccion_id, 5, v_neg from stock_lotes_semielaborado where semielaborado_id=v_sf_wda001 and stock_disponible>=5 order by fecha limit 1;
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id) values (v_pf_b002, '2026-05-18', 'cerrada', 1, 1, v_loc_fg, v_pv_b002, v_neg) returning id into v_p_pf_b002;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_b002, v_p_asm005, 1, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) select v_p_pf_b002, produccion_id, 1, v_neg from stock_lotes_semielaborado where semielaborado_id=v_sf_wda001 and stock_disponible>=1 order by fecha limit 1;
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id) values (v_pf_s001, '2026-05-18', 'cerrada', 7, 7, v_loc_fg, v_neg) returning id into v_p_pf_s001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_s001, v_p_str005, 7, v_neg);
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id) values (v_pf_s002, '2026-05-18', 'cerrada', 3, 3, v_loc_fg, v_pv_s002_a, v_neg) returning id into v_p_pf_s002;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_s002, v_p_str005, 3, v_neg);
raise notice 'Producción compartida Mes 3 completada.';

-- 3. PRODUCCIÓN — DOS TANDAS DE SILLAS (CORREGIDO: Tanda B = 6 sillas por limitación de material)
insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-05-12', 'cerrada', v_neg) returning id into v_tanda_sillas_a;
insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-05-13', 'cerrada', v_neg) returning id into v_tanda_sillas_b;

-- Tanda A (20 sillas)
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl007, '2026-05-12', 'cerrada', 80, 80, v_loc_cut, v_tanda_sillas_a, v_neg) returning id into v_p_mtl007_a;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007_a, v_em_mtl007, 80*0.45, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod004, '2026-05-12', 'cerrada', 20, 20, v_loc_cut, v_tanda_sillas_a, v_neg) returning id into v_p_wod004_a;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) select v_p_wod004_a, entrada_material_id, 20*0.16, v_neg from stock_lotes_articulo where articulo_id=v_art_wod010 order by fecha_recepcion limit 1;
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl012, '2026-05-13', 'cerrada', 80, 80, v_loc_mach, v_tanda_sillas_a, v_neg) returning id into v_p_mtl012_a;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012_a, v_p_mtl007_a, 80, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod008, '2026-05-13', 'cerrada', 20, 20, v_loc_sand, v_tanda_sillas_a, v_neg) returning id into v_p_wod008_a;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008_a, v_p_wod004_a, 20, v_neg);
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id) values (v_pf_c001, '2026-05-14', 'cerrada', 20, 20, v_loc_fg, v_pv_grande, v_neg) returning id into v_p_pf_c001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012_a, 20*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008_a, 20*1, v_neg);

-- Tanda B (CORREGIDA: 6 sillas reales por limitación de material)
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl007, '2026-05-13', 'cerrada', 24, 48, v_loc_cut, v_tanda_sillas_b, v_neg) returning id into v_p_mtl007_b;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007_b, v_em_mtl007_short, 24*0.45, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod004, '2026-05-13', 'cerrada', 6, 12, v_loc_cut, v_tanda_sillas_b, v_neg) returning id into v_p_wod004_b;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004_b, v_em_wod010_short, 6*0.16, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_mtl012, '2026-05-14', 'cerrada', 24, 48, v_loc_mach, v_tanda_sillas_b, v_neg) returning id into v_p_mtl012_b;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012_b, v_p_mtl007_b, 24, v_neg);
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id) values (v_sf_wod008, '2026-05-14', 'cerrada', 6, 12, v_loc_sand, v_tanda_sillas_b, v_neg) returning id into v_p_wod008_b;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008_b, v_p_wod004_b, 6, v_neg);
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id) values (v_pf_c004, '2026-05-15', 'cerrada', 6, 12, 'Varianza de producción: planificadas 12, producidas 6 por limitación de material en lote urgente (RM-WOD-010)', v_loc_fg, v_neg) returning id into v_p_pf_c004;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c004, v_p_mtl012_b, 6*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c004, v_p_wod008_b, 6*1, v_neg);
raise notice 'Producción de sillas Mes 3 completada: Tanda A (20) y Tanda B (6 reales por limitación de material).';

-- 4. AJUSTE DE STOCK
insert into ajustes_articulo (articulo_id, entrada_material_id, cantidad, motivo, fecha, negocio_id) values (v_art_hwr001, v_em_hwr001_lote, -20, 'Inventario físico de mayo: 20 unidades de tornillo dañadas por humedad en almacén', '2026-05-20', v_neg);
raise notice 'Ajuste de stock Mes 3: -20 unidades de RM-HWR-001.';

-- 5. VENTAS MES 3
-- Pedido grande
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-19', 'DN-ALP-260009', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_grande returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 4, v_precio_t001, v_lpv_grande_t, v_neg);
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 8, v_precio_c001, v_lpv_grande_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-19', 4*v_precio_t001 + 8*v_precio_c001, v_neg from pedidos_venta where id=v_pv_grande returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-22', 3000.00, 'transferencia', v_neg from pedidos_venta where id=v_pv_grande returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 3000.00, v_neg);

-- OV-260012 (4 C004)
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-19', 'DN-ALP-260010', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_c004a returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c004, v_p_pf_c004, 4, v_precio_c004, v_lpv_c004a, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-19', 4*v_precio_c004, v_neg from pedidos_venta where id=v_pv_c004a returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-20', 4*v_precio_c004, 'tarjeta', v_neg from pedidos_venta where id=v_pv_c004a returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 4*v_precio_c004, v_neg);

-- CORREGIDO: v_pv_c004b ahora vende 2 C004 (no 3), porque solo se produjeron 6 en total
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-19', 'DN-ALP-260011', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_c004b returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c004, v_p_pf_c004, 2, v_precio_c004, v_lpv_c004b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-19', 2*v_precio_c004, v_neg from pedidos_venta where id=v_pv_c004b returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);

-- 4 pedidos S001
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260012', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s001_a returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s001, v_p_pf_s001, 3, v_precio_s001, v_lpv_s001_a, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', 3*v_precio_s001, v_neg from pedidos_venta where id=v_pv_s001_a returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-23', 3*v_precio_s001, 'transferencia', v_neg from pedidos_venta where id=v_pv_s001_a returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 3*v_precio_s001, v_neg);

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260013', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s001_b returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s001, v_p_pf_s001, 1, v_precio_s001, v_lpv_s001_b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', v_precio_s001, v_neg from pedidos_venta where id=v_pv_s001_b returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260014', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s001_c returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s001, v_p_pf_s001, 2, v_precio_s001, v_lpv_s001_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', 2*v_precio_s001, v_neg from pedidos_venta where id=v_pv_s001_c returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-27', round(2*v_precio_s001*0.5,2), 'transferencia', v_neg from pedidos_venta where id=v_pv_s001_c returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260015', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s001_d returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s001, v_p_pf_s001, 1, v_precio_s001, v_lpv_s001_d, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', v_precio_s001, v_neg from pedidos_venta where id=v_pv_s001_d returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-24', v_precio_s001, 'tarjeta', v_neg from pedidos_venta where id=v_pv_s001_d returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, v_precio_s001, v_neg);

-- 2 pedidos S002
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260016', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s002_a returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s002, v_p_pf_s002, 2, v_precio_s002, v_lpv_s002_a, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', 2*v_precio_s002, v_neg from pedidos_venta where id=v_pv_s002_a returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-26', 2*v_precio_s002, 'transferencia', v_neg from pedidos_venta where id=v_pv_s002_a returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 2*v_precio_s002, v_neg);

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-20', 'DN-ALP-260017', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_s002_b returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_s002, v_p_pf_s002, 1, v_precio_s002, v_lpv_s002_b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-21', v_precio_s002, v_neg from pedidos_venta where id=v_pv_s002_b returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);

-- OV-260011
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) select cliente_id, '2026-05-19', 'DN-ALP-260018', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_b002 returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_b002, v_p_pf_b002, 1, v_precio_b002, v_lpv_b002, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) select cliente_id, '2026-05-19', v_precio_b002, v_neg from pedidos_venta where id=v_pv_b002 returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) select cliente_id, '2026-05-20', v_precio_b002, 'transferencia', v_neg from pedidos_venta where id=v_pv_b002 returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, v_precio_b002, v_neg);
raise notice 'Ventas Mes 3 (cartera heredada) completadas.';

-- Nuevos pedidos (3 clientes repetidos)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_cli_b2b[2], '2026-05-18', '2026-05-25', 'pendiente', '[FASE06-M3] Cliente repetido: nuevo pedido de mesas y sillas', v_neg) returning id into v_pv_tmp;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_tmp, v_pf_t001, 3, v_precio_t001, v_neg) returning id into v_lpv_tmp;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[2], '2026-05-25', 'DN-ALP-260019', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 3, v_precio_t001, v_lpv_tmp, v_neg);
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_tmp, v_pf_c001, 6, v_precio_c001, v_neg) returning id into v_lpv_tmp;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 6, v_precio_c001, v_lpv_tmp, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[2], '2026-05-26', 3*v_precio_t001+6*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[2], '2026-05-28', 3*v_precio_t001+6*v_precio_c001, 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 3*v_precio_t001+6*v_precio_c001, v_neg);

insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_cli_b2b[1], '2026-05-18', '2026-05-25', 'pendiente', '[FASE06-M3] Cliente repetido: nuevo pedido de mesas y sillas', v_neg) returning id into v_pv_tmp;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_tmp, v_pf_t001, 3, v_precio_t001, v_neg) returning id into v_lpv_tmp;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[1], '2026-05-25', 'DN-ALP-260020', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 3, v_precio_t001, v_lpv_tmp, v_neg);
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_tmp, v_pf_c001, 6, v_precio_c001, v_neg) returning id into v_lpv_tmp;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 6, v_precio_c001, v_lpv_tmp, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[1], '2026-05-26', 3*v_precio_t001+6*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);

insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values (v_cli_b2b[3], '2026-05-18', '2026-05-25', 'pendiente', '[FASE06-M3] Cliente repetido: nuevo pedido de bancos', v_neg) returning id into v_pv_tmp;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_tmp, v_pf_b001, 5, v_precio_b001, v_neg) returning id into v_lpv_tmp;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[3], '2026-05-25', 'DN-ALP-260021', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_b001, v_p_pf_b001, 5, v_precio_b001, v_lpv_tmp, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[3], '2026-05-26', 5*v_precio_b001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[3], '2026-05-29', round(5*v_precio_b001*0.5,2), 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;
raise notice 'Ventas Mes 3 (nuevos) completadas.';

-- Backlog adicional (15 pedidos)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values
(v_cli_b2b[4], '2026-05-02', '2026-06-05', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[5], '2026-05-04', '2026-06-06', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[6], '2026-05-05', '2026-06-08', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[7], '2026-05-06', '2026-06-09', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2c[1], '2026-05-07', '2026-05-25', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2c[2], '2026-05-08', '2026-05-26', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2c[3], '2026-05-09', '2026-05-27', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[1], '2026-05-11', '2026-06-12', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[2], '2026-05-13', '2026-06-14', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[3], '2026-05-15', '2026-06-16', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[4], '2026-05-19', '2026-06-19', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[5], '2026-05-21', '2026-06-21', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[6], '2026-05-25', '2026-06-25', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[7], '2026-05-27', '2026-06-27', 'pendiente', '[FASE06-M3] Backlog', v_neg),
(v_cli_b2b[1], '2026-05-29', '2026-06-29', 'pendiente', '[FASE06-M3] Backlog', v_neg);

insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
select pv.id, x.producto_final_id, x.cantidad, pf.precio_venta, v_neg
from (select row_number() over (order by pv.id) as rn, pv.id from pedidos_venta pv where pv.negocio_id = v_neg and pv.notas = '[FASE06-M3] Backlog') pv
join (values
(1, v_pf_c001, 2), (2, v_pf_t001, 1), (3, v_pf_c004, 3), (4, v_pf_b001, 1),
(5, v_pf_s001, 1), (6, v_pf_c001, 1), (7, v_pf_s002, 2), (8, v_pf_c004, 2),
(9, v_pf_t001, 1), (10, v_pf_b002, 1), (11, v_pf_c001, 4), (12, v_pf_s001, 1),
(13, v_pf_t001, 2), (14, v_pf_c004, 1), (15, v_pf_b001, 2)
) as x(rn, producto_final_id, cantidad) on x.rn = pv.rn
join productos_finales pf on pf.id = x.producto_final_id;
raise notice 'Ventas Mes 3 (backlog nuevo) completadas.';
raise notice 'FASE 06 MES 3 sembrada correctamente para AlpenWerk (negocio_id=%).', v_neg;
end $$;
commit;