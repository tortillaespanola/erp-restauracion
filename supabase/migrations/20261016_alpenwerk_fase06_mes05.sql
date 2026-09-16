-- FASE 06 de AlpenWerk Möbel GmbH — MES 5: ESCALADO Y GRANDES PROYECTOS B2B (julio 2026)
-- Continúa desde el cierre de Mes 4. No modifica ninguna fila de Mes 1/2/3/4.
-- CORRECCIONES APLICADAS: multiplicaciones con * explícito (24*2, 56*4, 5*v_precio, etc.)
-- y variables sin espacios espurios.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
do $$
declare
v_neg uuid;
-- ubicaciones
v_loc_metal uuid; v_loc_wood uuid; v_loc_hw uuid;
v_loc_cut uuid; v_loc_mach uuid; v_loc_weld uuid; v_loc_sand uuid; v_loc_assy uuid; v_loc_fg uuid;
-- articulos_compra
v_art_mtl004 bigint; v_art_mtl003 bigint; v_art_mtl018 bigint; v_art_mtl007 bigint;
v_art_con001 bigint; v_art_wod003 bigint; v_art_wod010 bigint; v_art_wod020 bigint; 
v_art_brd001 bigint; v_art_hwr005 bigint;
-- semielaborados
v_sf_mtl001 bigint; v_sf_mtl005 bigint; v_sf_mtl006 bigint; v_sf_mtl009 bigint;
v_sf_mtl010 bigint; v_sf_mtl011 bigint;  v_sf_mtl014 bigint;
v_sf_asm001 bigint; v_sf_asm002 bigint;
v_sf_wod001 bigint; v_sf_wod005 bigint; v_sf_wda001 bigint; v_sf_str001 bigint;
v_sf_pnl004 bigint; v_sf_wda006 bigint; 
v_sf_mtl007 bigint; v_sf_mtl012 bigint; v_sf_wod004 bigint; v_sf_wod008 bigint;
-- productos_finales
v_pf_t001 bigint; v_precio_t001 numeric; v_pf_c001 bigint; v_precio_c001 numeric;
-- proveedores
v_prov_mtl_a bigint; v_prov_wod_a bigint; v_prov_con_a bigint; v_prov_hwr_b bigint; v_prov_brd_a bigint;
-- clientes (proyectos grandes, por nombre real)
v_cli_hotel bigint; v_cli_rest bigint; v_cli_office bigint;
-- scratch
v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint;
v_av bigint; v_fv bigint; v_pago bigint;
-- lotes
v_em_mtl004_a bigint; v_em_mtl004_b bigint; v_em_mtl003 bigint; v_em_mtl018 bigint; v_em_con001 bigint;
v_em_wod003 bigint; v_em_wod020 bigint; v_em_brd001 bigint; v_em_hwr005 bigint;
v_em_mtl007 bigint; v_em_wod010 bigint;
-- producciones cadena mesa
v_p_mtl001 bigint; v_p_mtl005 bigint; v_p_mtl006 bigint; v_p_mtl009 bigint;
v_p_mtl010 bigint; v_p_mtl011 bigint; v_p_mtl014 bigint;
v_p_asm001 bigint; v_p_asm002 bigint;
v_p_wod001 bigint; v_p_wod005 bigint; v_p_wda001 bigint; v_p_str001 bigint;
v_p_pf_t001 bigint;
-- producciones sustitución excepcional (mini-escenario aislado, igual que Mes 4)
v_p_pnl004 bigint; v_p_wda006 bigint;
-- producciones sillas
v_p_mtl007 bigint; v_p_mtl012 bigint; v_p_wod004 bigint; v_p_wod008 bigint; v_p_pf_c001 bigint;
-- pedidos de los 3 proyectos grandes
v_pv_hotel bigint; v_lpv_hotel_t bigint; v_lpv_hotel_c bigint;
v_pv_rest bigint; v_lpv_rest_t bigint; v_lpv_rest_c bigint;
v_pv_office bigint; v_lpv_office_t bigint; v_lpv_office_c bigint;
begin
select id into v_neg from negocios where codigo_corto = 'ALP';
if v_neg is null then raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.'; end if;
if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M5]%') then
raise notice 'Fase 06 Mes 5 ya fue sembrada anteriormente. Abortando sin cambios.'; return; end if;
if not exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M4]%') then
raise exception 'Mes 4 no existe todavía. Abortando.'; end if;

-- 0. RESOLUCIÓN DE IDs
select id into v_loc_metal from ubicaciones where negocio_id=v_neg and nombre='RAW-METAL';
select id into v_loc_wood from ubicaciones where negocio_id=v_neg and nombre='RAW-WOOD';
select id into v_loc_hw from ubicaciones where negocio_id=v_neg and nombre='RAW-HARDWARE';
select id into v_loc_cut from ubicaciones where negocio_id=v_neg and nombre='CUT';
select id into v_loc_mach from ubicaciones where negocio_id=v_neg and nombre='MACHINING';
select id into v_loc_weld from ubicaciones where negocio_id=v_neg and nombre='WELDING';
select id into v_loc_sand from ubicaciones where negocio_id=v_neg and nombre='SANDING';
select id into v_loc_assy from ubicaciones where negocio_id=v_neg and nombre='ASSEMBLY';
select id into v_loc_fg from ubicaciones where negocio_id=v_neg and nombre='FINISHED-GOODS';

select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
select id into v_art_mtl003 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-003';
select id into v_art_mtl018 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-018';
select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
select id into v_art_con001 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-001';
select id into v_art_wod003 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-003';
select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
select id into v_art_wod020 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-020';
select id into v_art_brd001 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-001';
select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';

select id into v_sf_mtl001 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-001';
select id into v_sf_mtl005 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-005';
select id into v_sf_mtl006 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-006';
select id into v_sf_mtl009 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-009';
select id into v_sf_mtl010 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-010';
select id into v_sf_mtl011 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-011';
select id into v_sf_mtl014 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-014';
select id into v_sf_asm001 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-001';
select id into v_sf_asm002 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-002';
select id into v_sf_wod001 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-001';
select id into v_sf_wod005 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-005';
select id into v_sf_wda001 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-001';
select id into v_sf_str001 from semielaborados where negocio_id=v_neg and codigo='SF-STR-001';
select id into v_sf_pnl004 from semielaborados where negocio_id=v_neg and codigo='SF-PNL-004';
select id into v_sf_wda006 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-006';
select id into v_sf_mtl007 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-007';
select id into v_sf_mtl012 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-012';
select id into v_sf_wod004 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-004';
select id into v_sf_wod008 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-008';

select id, precio_venta into v_pf_t001, v_precio_t001 from productos_finales where negocio_id=v_neg and codigo='ALP-T001';
select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';

-- Proveedores
select ap.proveedor_id into v_prov_mtl_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004)
order by (ap.articulo_id=v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_wod_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_wod003)
order by (ap.articulo_id=v_art_wod003) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_con_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_con001)
order by (ap.articulo_id=v_art_con001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_brd_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_brd001)
order by (ap.articulo_id=v_art_brd001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_hwr_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr005) and ap.proveedor_id <> (
select ap2.proveedor_id from articulo_proveedor ap2 join articulos_compra a2 on a2.id=ap2.articulo_id
where ap2.negocio_id=v_neg and a2.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr005)
order by ap2.preferente desc nulls last, ap2.proveedor_id limit 1
)
order by ap.proveedor_id limit 1;

-- Clientes de los 3 proyectos grandes
select id into v_cli_hotel from clientes where negocio_id=v_neg and nombre='Hotel Vier Jahreszeiten Luzern';
select id into v_cli_rest from clientes where negocio_id=v_neg and nombre='Restaurant Rheinblick';
select id into v_cli_office from clientes where negocio_id=v_neg and nombre='Helvetia Workspace';
if v_cli_hotel is null or v_cli_rest is null or v_cli_office is null then
raise exception 'No se resolvió alguno de los 3 clientes de proyecto grande.';
end if;

raise notice 'IDs resueltos. Iniciando transacciones de Mes 5.';

-- 1. COMPRAS DE MES 5
-- Recepción parcial (100m -> 65m + 35m)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-07-01', '2026-07-03', 'pendiente', '[FASE06-M5] RECEPCION PARCIAL: pedido 100 m de tubo 40x40x2mm, primera entrega 65 m, quedan 35 m pendientes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl004, 100, 8.60, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0701', '2026-07-03', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl004, 65, 8.60, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_a;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0707', '2026-07-07', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl004, 35, 8.60, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_b;

-- Resto de materia prima de la cadena de mesas
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición tubo 30x30x2mm para proyectos grandes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl003, 70, 6.30, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0702', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl003, 70, 6.30, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl003;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición Article Base (RM-MTL-018)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl018, 3, 9.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0703', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl018, 3, 9.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl018;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_con_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición hilo de soldadura para proyectos grandes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_con001, 10, 12.30, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_con_a, 'LFS-CONA-0186', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_con001, 10, 12.30, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_con001;

-- Fallo de proveedor Wood-A + reposición urgente
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] SUPPLIER FAILURE: Wood-A no entregó este pedido de tablero de roble a tiempo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod003, 20, 46.00, v_neg) returning id into v_lp_tmp;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-07-08', '2026-07-10', 'pendiente', '[FASE06-M5] Reposición urgente de tablero de roble (cubre fallo de entrega anterior, sobrecoste)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod003, 20, 52.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0402', '2026-07-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod003, 20, 52.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod003;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición cantonera de roble para proyectos grandes', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod020, 95, 1.25, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0403', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod020, 95, 1.25, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod020;

-- Insumos sustitución excepcional
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_brd_a, '2026-07-01', '2026-07-04', 'pendiente', '[FASE06-M5] Restock tablero para montaje puntual', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_brd001, 3, 22.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_brd_a, 'LFS-BRDA-0032', '2026-07-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_brd001, 3, 22.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_brd001;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_hwr_b, '2026-07-01', '2026-07-04', 'pendiente', '[FASE06-M5] Restock tornillería alternativa (RM-HWR-005)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr005, 15, 0.17, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_hwr_b, 'LFS-HWRB-0014', '2026-07-04', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_hwr005, 15, 0.17, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_hwr005;

-- Materia prima de las sillas (56 uds)
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición tubo redondo 33.7x2 para sillas (56 uds, 3 proyectos)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 110, 6.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_mtl_a, 'LFS-MTLA-0705', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_mtl007, 110, 6.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007;

insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-07-01', '2026-07-06', 'pendiente', '[FASE06-M5] Reposición tablero de haya para asientos (56 uds)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod010, 10, 39.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0404', '2026-07-06', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod010, 10, 39.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010;

raise notice 'Compras Mes 5 completadas.';

-- 2. PRODUCCIÓN — CADENA COMPLETA DE MESAS ALP-T001 (24 mesas, 22 aceptadas)
-- Nivel 1
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl001, '2026-07-08', 'cerrada', 48, 48, v_loc_cut, v_neg) returning id into v_p_mtl001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_a, 48*1.20, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl005, '2026-07-08', 'cerrada', 48, 48, v_loc_cut, v_neg) returning id into v_p_mtl005;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl005, v_em_mtl004_b, 48*0.70, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl006, '2026-07-08', 'cerrada', 96, 96, v_loc_cut, v_neg) returning id into v_p_mtl006;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl006, v_em_mtl003, 96*0.70, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl009, '2026-07-08', 'cerrada', 96, 96, v_loc_cut, v_neg) returning id into v_p_mtl009;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl009, v_em_mtl018, 96*0.01, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod001, '2026-07-11', 'cerrada', 24, 24, v_loc_cut, v_neg) returning id into v_p_wod001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod001, v_em_wod003, 24*0.72, v_neg);

-- Nivel 2
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl010, '2026-07-09', 'cerrada', 48, 48, v_loc_mach, v_neg) returning id into v_p_mtl010;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 48, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl011, '2026-07-09', 'cerrada', 96, 96, v_loc_mach, v_neg) returning id into v_p_mtl011;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl011, v_p_mtl006, 96, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl014, '2026-07-09', 'cerrada', 96, 96, v_loc_mach, v_neg) returning id into v_p_mtl014;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl014, v_p_mtl009, 96, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod005, '2026-07-12', 'cerrada', 24, 24, v_loc_sand, v_neg) returning id into v_p_wod005;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod005, v_p_wod001, 24, v_neg);

-- Nivel 3
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_asm001, '2026-07-10', 'cerrada', 96, 96, v_loc_weld, v_neg) returning id into v_p_asm001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm001, v_p_mtl011, 96, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_asm002, '2026-07-11', 'cerrada', 24, 24, v_loc_weld, v_neg) returning id into v_p_asm002;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl010, 24*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl005, 24*2, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_asm001, 24*4, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl014, 24*4, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_asm002, v_em_con001, 24*0.35, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wda001, '2026-07-13', 'cerrada', 24, 24, v_loc_assy, v_neg) returning id into v_p_wda001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda001, v_p_wod005, 24, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wda001, v_em_wod020, 24*3.60, v_neg);

-- Nivel 4
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_str001, '2026-07-14', 'cerrada', 24, 24, v_loc_assy, v_neg) returning id into v_p_str001;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_asm002, 24, v_neg);
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_wda001, 24, v_neg);

-- Final: 22 de 24 mesas aceptadas (varianza)
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_pf_t001, '2026-07-16', 'cerrada', 22, 24, 'Rechazo en control de calidad final: 2 mesas con defecto de acabado en la superficie.', v_loc_fg, v_neg) returning id into v_p_pf_t001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_t001, v_p_str001, 22, v_neg);

raise notice 'Producción de mesas Mes 5 completada: 22 de 24 planificadas.';

-- 3. PRODUCCIÓN — SILLAS ALP-C001 (56 uds)
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl007, '2026-07-08', 'cerrada', 224, 224, v_loc_cut, v_neg) returning id into v_p_mtl007;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007, v_em_mtl007, 224*0.45, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl012, '2026-07-09', 'cerrada', 224, 224, v_loc_mach, v_neg) returning id into v_p_mtl012;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012, v_p_mtl007, 224, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod004, '2026-07-08', 'cerrada', 56, 56, v_loc_cut, v_neg) returning id into v_p_wod004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004, v_em_wod010, 56*0.16, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod008, '2026-07-09', 'cerrada', 56, 56, v_loc_sand, v_neg) returning id into v_p_wod008;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008, v_p_wod004, 56, v_neg);

insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_pf_c001, '2026-07-16', 'cerrada', 56, 56, v_loc_fg, v_neg) returning id into v_p_pf_c001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012, 56*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008, 56*1, v_neg);

raise notice 'Producción de sillas Mes 5 completada: 56 de 56.';

-- 4. SUSTITUCIÓN EXCEPCIONAL
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_pnl004, '2026-07-18', 'cerrada', 3, 3, v_loc_cut, v_neg) returning id into v_p_pnl004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_pnl004, v_em_brd001, 3*0.40, v_neg);

insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wda006, '2026-07-19', 'cerrada', 3, 3, v_loc_weld, v_neg) returning id into v_p_wda006;
insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda006, v_p_pnl004, 3, v_neg);
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, motivo, nota, negocio_id)
values (v_p_wda006, v_em_hwr005, 3*4, 'sustitucion_excepcional', 'RM-HWR-019 agotado en el momento del montaje; se usó RM-HWR-005 temporalmente', v_neg);

raise notice 'Sustitución excepcional Mes 5 completada.';

-- 5. AJUSTE DE STOCK
insert into ajustes_articulo (articulo_id, entrada_material_id, cantidad, motivo, fecha, negocio_id)
values (v_art_wod020, v_em_wod020, -6, 'Recuento físico de julio: 6 m de cantonera de roble no localizados (mermas de corte no registradas)', '2026-07-20', v_neg);

raise notice 'Ajuste de stock Mes 5: -6 m de RM-WOD-020.';

-- 6. PROYECTOS GRANDES — VENTAS
-- Proyecto 1: Hotel (8/10 mesas, 24/24 sillas, 2 envíos)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_hotel, '2026-07-01', '2026-07-25', 'pendiente', '[FASE06-M5] Proyecto grande: ampliación Hotel Vier Jahreszeiten Luzern (10 mesas + 24 sillas)', v_neg) returning id into v_pv_hotel;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_hotel, v_pf_t001, 10, v_precio_t001, v_neg) returning id into v_lpv_hotel_t;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_hotel, v_pf_c001, 24, v_precio_c001, v_neg) returning id into v_lpv_hotel_c;

-- Envío 1: 5 mesas + 16 sillas
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_hotel, '2026-07-17', 'DN-ALP-260024', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 5, v_precio_t001, v_lpv_hotel_t, v_neg);
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 16, v_precio_c001, v_lpv_hotel_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_hotel, '2026-07-17', 5*v_precio_t001 + 16*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_hotel, '2026-07-21', 5*v_precio_t001 + 16*v_precio_c001, 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 5*v_precio_t001 + 16*v_precio_c001, v_neg);

-- Envío 2: 3 mesas + 8 sillas (pago parcial)
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_hotel, '2026-07-28', 'DN-ALP-260025', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 3, v_precio_t001, v_lpv_hotel_t, v_neg);
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 8, v_precio_c001, v_lpv_hotel_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_hotel, '2026-07-28', 3*v_precio_t001 + 8*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_hotel, '2026-07-31', round((3*v_precio_t001 + 8*v_precio_c001)*0.5,2), 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;

-- Proyecto 2: Restaurant (6 mesas + 16 sillas, pago parcial)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_rest, '2026-07-01', '2026-07-22', 'pendiente', '[FASE06-M5] Proyecto grande: Restaurant Rheinblick (6 mesas + 16 sillas)', v_neg) returning id into v_pv_rest;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_rest, v_pf_t001, 6, v_precio_t001, v_neg) returning id into v_lpv_rest_t;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_rest, v_pf_c001, 16, v_precio_c001, v_neg) returning id into v_lpv_rest_c;

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_rest, '2026-07-22', 'DN-ALP-260026', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 6, v_precio_t001, v_lpv_rest_t, v_neg);
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 16, v_precio_c001, v_lpv_rest_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_rest, '2026-07-22', 6*v_precio_t001 + 16*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_rest, '2026-07-26', round((6*v_precio_t001 + 16*v_precio_c001)*0.5,2), 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;

-- Proyecto 3: Office (8 mesas + 16 sillas, pagado)
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_office, '2026-07-01', '2026-07-24', 'pendiente', '[FASE06-M5] Proyecto grande: Helvetia Workspace, mobiliario de oficina (8 mesas como escritorios + 16 sillas)', v_neg) returning id into v_pv_office;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_office, v_pf_t001, 8, v_precio_t001, v_neg) returning id into v_lpv_office_t;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_office, v_pf_c001, 16, v_precio_c001, v_neg) returning id into v_lpv_office_c;

insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_office, '2026-07-24', 'DN-ALP-260027', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_t001, v_p_pf_t001, 8, v_precio_t001, v_lpv_office_t, v_neg);
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 16, v_precio_c001, v_lpv_office_c, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_office, '2026-07-24', 8*v_precio_t001 + 16*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_office, '2026-07-27', 8*v_precio_t001 + 16*v_precio_c001, 'transferencia', v_neg) returning id into v_pago;
insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 8*v_precio_t001 + 16*v_precio_c001, v_neg);

raise notice 'Ventas de proyectos grandes Mes 5 completadas.';
raise notice 'FASE 06 MES 5 sembrada correctamente para AlpenWerk (negocio_id=%).', v_neg;
end $$;
commit;