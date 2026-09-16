-- FASE 06 de AlpenWerk Möbel GmbH — MES 6: FOTO DEL ESTADO ACTUAL (1-15 septiembre 2026)
-- Mes final de la simulación de 6 meses. Continúa desde el cierre de Mes 5. No modifica ninguna
-- fila de Mes 1/2/3/4/5.
-- A diferencia de los meses anteriores, el objetivo NO es cerrar un ciclo completo de operación,
-- sino dejar una FOTO realista de una empresa a media operación el 15/09/2026: compras abiertas
-- sin recibir del todo, producciones en curso ('abierta', sin cantidad_producida todavía, tal y
-- como hace realmente Producciones.jsx al "Iniciar producción"), pedidos de venta sin servir, una
-- mezcla de facturas pagadas/parciales/impagadas, y una incidencia nueva junto a la ya abierta de
-- Mes 4. Deliberadamente NO se completan las recepciones parciales ni se cierran las producciones
-- abiertas -- eso es justamente lo que hace que sea una foto de "ahora mismo", no un mes cerrado.
-- Reutiliza WIP real y antiguo de Mes 4: la producción de sillas de Mes 4 (2026-06-11) dejó 12
-- patas (SF-MTL-012) y 3 asientos (SF-WOD-008) sin consumir (produjo 80/80 y 20/20 a nivel de
-- semielaborado, pero el montaje final solo usó 17 de 20 sillas por el rechazo de calidad de aquel
-- mes) -- siguen disponibles y se usan aquí para una pequeña tanda final, demostrando "lotes viejos
-- y recientes conviviendo" sin inventar ni modificar nada de Mes 4.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351';
set local request.jwt.claim.role = 'authenticated';
do $$
declare
v_neg uuid;
-- ubicaciones
v_loc_metal uuid; v_loc_wood uuid; v_loc_hw uuid; v_loc_cut uuid; v_loc_fg uuid;
-- articulos_compra
v_art_mtl004 bigint; v_art_mtl007 bigint; v_art_mtl013 bigint; v_art_wod010 bigint;
v_art_pnt005 bigint; v_art_hwr005 bigint;
-- semielaborados / productos_finales
v_sf_mtl001 bigint; v_sf_mtl007 bigint; v_sf_mtl012 bigint; v_sf_wod004 bigint; v_sf_wod008 bigint;
v_pf_c001 bigint; v_precio_c001 numeric;
-- proveedores
v_prov_mtl_a bigint; v_prov_wod_a bigint; v_prov_pnt_a bigint; v_prov_hwr_b bigint;
-- clientes
v_cli_hotel bigint; v_cli_b2b bigint[];
-- lotes viejos de Mes 4 (solo lectura, WIP heredado)
v_p_mtl012_m4 bigint; v_p_wod008_m4 bigint;
-- scratch
v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint;
v_av bigint; v_fv bigint;
-- lotes nuevos
v_em_wod010 bigint; v_em_pnt005 bigint;
-- producciones
v_p_mtl007 bigint; v_p_wod004 bigint; v_p_mtl001 bigint; v_p_pf_c001 bigint;
-- pedidos de venta
v_pv_a bigint; v_lpv_a bigint; v_pv_b bigint; v_lpv_b bigint;
begin
select id into v_neg from negocios where codigo_corto = 'ALP';
if v_neg is null then raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.'; end if;
if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M6]%') then
raise notice 'Fase 06 Mes 6 ya fue sembrada anteriormente. Abortando sin cambios.'; return; end if;
if not exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M5]%') then
raise exception 'Mes 5 no existe todavía. Abortando.'; end if;

-- 0. RESOLUCIÓN DE IDs
select id into v_loc_metal from ubicaciones where negocio_id=v_neg and nombre='RAW-METAL';
select id into v_loc_wood from ubicaciones where negocio_id=v_neg and nombre='RAW-WOOD';
select id into v_loc_hw from ubicaciones where negocio_id=v_neg and nombre='RAW-HARDWARE';
select id into v_loc_cut from ubicaciones where negocio_id=v_neg and nombre='CUT';
select id into v_loc_fg from ubicaciones where negocio_id=v_neg and nombre='FINISHED-GOODS';
select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
select id into v_art_mtl013 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-013';
select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
select id into v_art_pnt005 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-005';
select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';
select id into v_sf_mtl001 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-001';
select id into v_sf_mtl007 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-007';
select id into v_sf_mtl012 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-012';
select id into v_sf_wod004 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-004';
select id into v_sf_wod008 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-008';
select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';
select ap.proveedor_id into v_prov_mtl_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004)
order by (ap.articulo_id=v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_wod_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_wod010)
order by (ap.articulo_id=v_art_wod010) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_pnt_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_pnt005)
order by (ap.articulo_id=v_art_pnt005) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
select ap.proveedor_id into v_prov_hwr_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr005) and ap.proveedor_id <> (
select ap2.proveedor_id from articulo_proveedor ap2 join articulos_compra a2 on a2.id=ap2.articulo_id
where ap2.negocio_id=v_neg and a2.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr005)
order by ap2.preferente desc nulls last, ap2.proveedor_id limit 1
)
order by ap.proveedor_id limit 1;
select id into v_cli_hotel from clientes where negocio_id=v_neg and nombre='Hotel Vier Jahreszeiten Luzern';
select array_agg(id order by id) into v_cli_b2b from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;
-- WIP real y antiguo de Mes 4 (solo lectura): 80 patas / 20 asientos producidos, solo 17 sillas
-- montadas -> quedan 12 patas + 3 asientos sin tocar desde entonces.
select id into v_p_mtl012_m4 from producciones_semielaborado where negocio_id=v_neg and semielaborado_id=v_sf_mtl012 and fecha='2026-06-11' and cantidad_producida=80 order by id limit 1;
select id into v_p_wod008_m4 from producciones_semielaborado where negocio_id=v_neg and semielaborado_id=v_sf_wod008 and fecha='2026-06-11' and cantidad_producida=20 order by id limit 1;
if v_p_mtl012_m4 is null or v_p_wod008_m4 is null then
raise exception 'No se resolvió el WIP heredado de Mes 4 (mtl012=%, wod008=%)', v_p_mtl012_m4, v_p_wod008_m4;
end if;
raise notice 'IDs resueltos. Iniciando transacciones de Mes 6.';

-- ===========================================================================================
-- 1. COMPRAS — 3 PEDIDOS ABIERTOS, DELIBERADAMENTE SIN CERRAR (foto del 15/09)
-- ===========================================================================================
-- Retraso de proveedor en curso (fecha de entrega prevista ya pasada al 15/09, sin albarán).
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_mtl_a, '2026-09-01', '2026-09-08', 'pendiente', '[FASE06-M6] Retraso de proveedor en curso: tubo redondo 33.7x2 todavía no recibido a fecha de la foto (15/09)', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_mtl007, 40, 6.00, v_neg) returning id into v_lp_tmp;
-- Recepción parcial en curso, deliberadamente sin completar (foto de un pedido a medio recibir).
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_wod_a, '2026-09-01', '2026-09-08', 'pendiente', '[FASE06-M6] RECEPCION PARCIAL EN CURSO: pedido 8 m2 de tablero de haya, entregados 5 m2, quedan 3 m2 pendientes a fecha de la foto', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_wod010, 8, 39.00, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_wod_a, 'LFS-WODA-0901', '2026-09-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id) values (v_ac_tmp, v_art_wod010, 5, 39.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010;
-- Lote pequeño de barniz con fecha_caducidad dentro de la ventana del mes (caduca el 14/09).
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_pnt_a, '2026-09-10', '2026-09-11', 'pendiente', '[FASE06-M6] Restock barniz, lote pequeño', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_pnt005, 4, 9.70, v_neg) returning id into v_lp_tmp;
insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id) values (v_prov_pnt_a, 'LFS-PNTA-0301', '2026-09-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, fecha_caducidad, negocio_id) values (v_ac_tmp, v_art_pnt005, 4, 9.70, v_lp_tmp, v_loc_hw, '2026-09-14', v_neg) returning id into v_em_pnt005;
-- Pedido recién hecho, sin drama, todavía dentro de plazo (fecha_entrega_prevista posterior al 15/09).
insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_prov_hwr_b, '2026-09-12', '2026-09-19', 'pendiente', '[FASE06-M6] Restock rutinario de tornillería, dentro de plazo', v_neg) returning id into v_pc_tmp;
insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id) values (v_pc_tmp, v_art_hwr005, 30, 0.17, v_neg) returning id into v_lp_tmp;
raise notice 'Compras Mes 6 completadas: 3 pedidos abiertos (1 con retraso, 1 parcial en curso, 1 dentro de plazo).';

-- ===========================================================================================
-- 2. PRODUCCIÓN — 2 EN CURSO ('abierta'), 1 PEQUEÑA CON VARIANZA, 1 CIERRE DE WIP ANTIGUO
-- ===========================================================================================
-- En curso: corte de patas, todavía sin cantidad_producida (igual que el INSERT real de
-- "Iniciar producción" en Producciones.jsx: sin tanda_id, sin cantidad_producida hasta el cierre).
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_mtl007, '2026-09-05', 'abierta', 40, v_loc_cut, v_neg) returning id into v_p_mtl007;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id)
select v_p_mtl007, entrada_material_id, 40*0.45, v_neg from stock_lotes_articulo where articulo_id=v_art_mtl007 and stock_disponible>=40*0.45 order by fecha_recepcion limit 1;
-- En curso: corte de asientos, con el lote parcial recién llegado este mismo mes.
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_objetivo, ubicacion_id, negocio_id)
values (v_sf_wod004, '2026-09-10', 'abierta', 8, v_loc_cut, v_neg) returning id into v_p_wod004;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004, v_em_wod010, 5*0.16, v_neg);
-- Pequeña tanda cerrada con varianza (1 unidad rechazada por corte irregular).
insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_sf_mtl001, '2026-09-06', 'cerrada', 5, 6, 'Rechazo: 1 pieza con corte irregular fuera de tolerancia.', v_loc_cut, v_neg) returning id into v_p_mtl001;
insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id)
select v_p_mtl001, entrada_material_id, 6*1.20, v_neg from stock_lotes_articulo where articulo_id=v_art_mtl004 and stock_disponible>=6*1.20 order by fecha_recepcion limit 1;
-- Cierre de WIP antiguo de Mes 4: 3 sillas finales usando las 12 patas + 3 asientos que quedaron
-- sin montar desde el 11/06/2026 -- lote "viejo" conviviendo con los lotes "recientes" de este mes.
insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, notas, ubicacion_id, negocio_id)
values (v_pf_c001, '2026-09-15', 'cerrada', 3, 3, 'Cierre de semielaborado sobrante de Mes 4 (12 patas SF-MTL-012 + 3 asientos SF-WOD-008 sin montar desde el 11/06/2026).', v_loc_fg, v_neg) returning id into v_p_pf_c001;
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012_m4, 3*4, v_neg);
insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008_m4, 3*1, v_neg);
-- Escenario (CADUCIDAD -> nueva incidencia, además de la ya abierta de Mes 4): retoque de barniz
-- aplicado después de que el lote caducara (14/09), en la misma producción del 15/09.
insert into consumo_produccion_pf (produccion_pf_id, entrada_material_id, cantidad, nota, negocio_id)
values (v_p_pf_c001, v_em_pnt005, 0.20, 'retoque de barniz en el montaje final (lote caducado el 2026-09-14)', v_neg);
raise notice 'Producción Mes 6 completada: 2 en curso (sin cerrar), 1 varianza (5/6), 1 cierre de WIP antiguo (3 sillas) con nueva incidencia de caducidad.';

-- ===========================================================================================
-- 3. AJUSTE DE STOCK
-- ===========================================================================================
insert into ajustes_articulo (articulo_id, entrada_material_id, cantidad, motivo, fecha, negocio_id)
select v_art_mtl013, id, -2, 'Recuento físico de septiembre: 2 unidades de pletina 40x5 no localizadas', '2026-09-13', v_neg
from entrada_material where articulo_id=v_art_mtl013 and negocio_id=v_neg order by id limit 1;
raise notice 'Ajuste de stock Mes 6: -2 unidades de RM-MTL-013.';

-- ===========================================================================================
-- 4. VENTAS — PEDIDOS ABIERTOS (foto del 15/09)
-- ===========================================================================================
-- Pedido A: nuevo pedido de cliente repetido, planificado pero SIN producción todavía asociada
-- (no existe ningún estado "planificada, no iniciada" propio en producciones_* -- la ausencia de
-- cualquier fila en producciones_producto_final referenciando este pedido es, en este modelo, la
-- única forma real de representar "aún no empezada").
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_hotel, '2026-09-05', '2026-09-25', 'pendiente', '[FASE06-M6] Nuevo pedido de seguimiento del Hotel Vier Jahreszeiten Luzern (6 sillas), producción todavía no iniciada', v_neg) returning id into v_pv_a;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_a, v_pf_c001, 6, v_precio_c001, v_neg) returning id into v_lpv_a;
-- Pedido B: 5 sillas pedidas, solo 3 disponibles (el cierre de WIP antiguo del punto 2); entrega
-- parcial real, quedan 2 pendientes. Factura sin cobrar todavía (emitida el mismo 15/09).
insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
values (v_cli_b2b[2], '2026-09-03', '2026-09-16', 'pendiente', '[FASE06-M6] Pedido de sillas, entrega parcial por disponibilidad limitada', v_neg) returning id into v_pv_b;
insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id) values (v_pv_b, v_pf_c001, 5, v_precio_c001, v_neg) returning id into v_lpv_b;
insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id) values (v_cli_b2b[2], '2026-09-15', 'DN-ALP-260028', 'pedido_planificado', v_neg) returning id into v_av;
insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id) values (v_av, v_pf_c001, v_p_pf_c001, 3, v_precio_c001, v_lpv_b, v_neg);
insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[2], '2026-09-15', 3*v_precio_c001, v_neg) returning id into v_fv;
insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
raise notice 'Ventas Mes 6 completadas: pedido A sin iniciar producción (6 sillas), pedido B parcial (3 de 5, factura reciente sin cobrar todavía).';
raise notice 'FASE 06 MES 6 (foto del 15/09/2026) sembrada correctamente para AlpenWerk (negocio_id=%). FIN DE LA SIMULACIÓN DE 6 MESES.', v_neg;
end $$;
commit;