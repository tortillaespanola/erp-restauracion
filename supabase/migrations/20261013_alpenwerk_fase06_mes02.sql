-- FASE 06 de AlpenWerk Möbel GmbH — MES 2: GROWTH
--
-- Continúa EXACTAMENTE desde el cierre validado de Mes 1 (marzo 2026). No se
-- toca ninguna fila de Mes 1: todo lo de este mes se referencia por lookup
-- (codigo_pedido, vistas de stock, etc.), nunca por UPDATE/DELETE sobre datos
-- de Mes 1. Abril 2026.
--
-- Escenarios obligatorios de esta fase: Article Base genuino (RM-MTL-004 /
-- RM-MTL-029, y como bonus RM-CON-001 / RM-CON-019), una recepción parcial
-- real, una sustitución de proveedor real, clientes repetidos, progreso de
-- la cartera de Mes 1 hacia entrega/factura/cobro, y continuidad de los
-- saldos abiertos de Mes 1 (350 / 220 en clientes, 183 / 280 en proveedores).
--
-- Se ejecuta como sesión autenticada real (igual que Mes 1).
--
-- Idempotente: si ya existen pedidos de venta de AlpenWerk marcados
-- '[FASE06-M2]', no hace nada.

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
  v_art_mtl003 bigint; v_art_mtl004 bigint; v_art_mtl007 bigint; v_art_mtl018 bigint;
  v_art_mtl029 bigint;
  v_art_wod003 bigint; v_art_wod010 bigint; v_art_wod020 bigint; v_art_brd004 bigint;
  v_art_pnt001 bigint; v_art_pnt005 bigint; v_art_pnt009 bigint;
  v_art_hwr001 bigint; v_art_hwr005 bigint;
  v_art_con001 bigint; v_art_con019 bigint;
  v_art_pkg001 bigint; v_art_pkg002 bigint; v_art_pkg004 bigint;

  -- semielaborados
  v_sf_mtl001 bigint; v_sf_mtl005 bigint; v_sf_mtl006 bigint; v_sf_mtl007 bigint; v_sf_mtl009 bigint;
  v_sf_mtl010 bigint; v_sf_mtl011 bigint; v_sf_mtl012 bigint; v_sf_mtl014 bigint;
  v_sf_wod001 bigint; v_sf_wod004 bigint; v_sf_wod005 bigint; v_sf_wod008 bigint;
  v_sf_asm001 bigint; v_sf_asm005 bigint; v_sf_wda001 bigint; v_sf_str001 bigint;

  -- productos_finales
  v_pf_t001 bigint; v_pf_b001 bigint; v_pf_b002 bigint;
  v_pf_c001 bigint; v_pf_c002 bigint; v_pf_c003 bigint; v_pf_c004 bigint; v_pf_c006 bigint;
  v_pf_t002 bigint; v_pf_t003 bigint; v_pf_s001 bigint; v_pf_s002 bigint; v_pf_s004 bigint;
  v_pf_bar001 bigint; v_pf_bar002 bigint;
  v_precio_t001 numeric; v_precio_c001 numeric; v_precio_c002 numeric; v_precio_c003 numeric;
  v_precio_c006 numeric; v_precio_b001 numeric;

  -- proveedores (mismos que Mes 1 + nuevos, todos resueltos por categoría, nunca por nombre)
  v_prov_mtl_a bigint; v_prov_mtl_b bigint; v_prov_mtl_c bigint;
  v_prov_wod_a bigint; v_prov_pnt_a bigint; v_prov_hwr_a bigint; v_prov_hwr_b bigint;
  v_prov_con_a bigint; v_prov_con_b bigint; v_prov_pkg_a bigint;

  -- clientes: reutilizamos exactamente el mismo pool determinista que Mes 1
  v_cli_b2b bigint[]; v_cli_b2c bigint[];

  -- pedidos de Mes 1 que progresan este mes (resueltos por codigo_pedido, nunca hardcodeados)
  v_pv_o1 bigint; v_lpv_o1 bigint;
  v_pv_bench bigint; v_lpv_bench bigint;
  v_pv_c002 bigint; v_lpv_c002 bigint;
  v_pv_c003 bigint; v_lpv_c003 bigint;
  v_pv_c006 bigint; v_lpv_c006 bigint;
  v_fv1_id bigint; v_fv3_id bigint; v_fc7_id bigint; v_fc8_id bigint;

  -- stock heredado de Mes 1 (resuelto vía las vistas reales, nunca por variable recordada)
  v_p_str001_spare bigint; v_p_wod008_spare bigint;
  v_em_mtl007_m1 bigint; v_em_wod010_m1 bigint;

  -- scratch
  v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint; v_em_tmp bigint; v_pago_tmp bigint;

  -- lotes nuevos de Mes 2 que sí se consumen en producción
  v_em_mtl004_b2 bigint; v_em_mtl003_b2 bigint; v_em_mtl018_b2 bigint;
  v_em_wod003_b2 bigint; v_em_wod020_b2 bigint; v_em_con001_b2 bigint;

  -- facturas/pagos de compra nuevos
  v_fc bigint;

  -- producciones nuevas
  v_p_pf_t001_2 bigint;
  v_p_mtl007 bigint; v_p_mtl012 bigint; v_p_wod004 bigint; v_p_wod008 bigint;
  v_p_pf_c002 bigint; v_p_pf_c003 bigint; v_p_pf_c006 bigint;
  v_p_mtl001 bigint; v_p_mtl005 bigint; v_p_mtl006 bigint; v_p_mtl009 bigint; v_p_wod001 bigint;
  v_p_mtl010 bigint; v_p_mtl011 bigint; v_p_mtl014 bigint; v_p_wod005 bigint;
  v_p_asm001 bigint; v_p_asm005 bigint; v_p_wda001 bigint;
  v_p_pf_b001 bigint;

  v_tanda1 uuid; v_tanda2 uuid;

  -- ventas nuevas
  v_av bigint; v_fv bigint; v_pago bigint;

begin
  select id into v_neg from negocios where codigo_corto = 'ALP';
  if v_neg is null then
    raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.';
  end if;

  if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M2]%') then
    raise notice 'Fase 06 Mes 2 ya fue sembrada anteriormente para AlpenWerk. Abortando sin cambios.';
    return;
  end if;

  if not exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M1]%') then
    raise exception 'Mes 1 no existe todavía. Abortando: Mes 2 no puede empezar sin Mes 1.';
  end if;

  -- ===========================================================================================
  -- 0. RESOLUCIÓN DE IDs
  -- ===========================================================================================
  select id into v_loc_metal from ubicaciones where negocio_id=v_neg and nombre='RAW-METAL';
  select id into v_loc_wood  from ubicaciones where negocio_id=v_neg and nombre='RAW-WOOD';
  select id into v_loc_chem  from ubicaciones where negocio_id=v_neg and nombre='RAW-CHEMICAL';
  select id into v_loc_hw    from ubicaciones where negocio_id=v_neg and nombre='RAW-HARDWARE';
  select id into v_loc_cut   from ubicaciones where negocio_id=v_neg and nombre='CUT';
  select id into v_loc_mach  from ubicaciones where negocio_id=v_neg and nombre='MACHINING';
  select id into v_loc_weld  from ubicaciones where negocio_id=v_neg and nombre='WELDING';
  select id into v_loc_sand  from ubicaciones where negocio_id=v_neg and nombre='SANDING';
  select id into v_loc_assy  from ubicaciones where negocio_id=v_neg and nombre='ASSEMBLY';
  select id into v_loc_fg    from ubicaciones where negocio_id=v_neg and nombre='FINISHED-GOODS';

  select id into v_art_mtl003 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-003';
  select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
  select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
  select id into v_art_mtl018 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-018';
  select id into v_art_mtl029 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-029';
  select id into v_art_wod003 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-003';
  select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
  select id into v_art_wod020 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-020';
  select id into v_art_brd004 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-004';
  select id into v_art_pnt001 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-001';
  select id into v_art_pnt005 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-005';
  select id into v_art_pnt009 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-009';
  select id into v_art_hwr001 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-001';
  select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';
  select id into v_art_con001 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-001';
  select id into v_art_con019 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-019';
  select id into v_art_pkg001 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-001';
  select id into v_art_pkg002 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-002';
  select id into v_art_pkg004 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-004';

  if v_art_mtl029 is null or v_art_con019 is null then
    raise exception 'Article Base de Fase 05 incompleto (RM-MTL-029/RM-CON-019 no encontrados). Abortando.';
  end if;

  select id into v_sf_mtl001 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-001';
  select id into v_sf_mtl005 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-005';
  select id into v_sf_mtl006 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-006';
  select id into v_sf_mtl007 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-007';
  select id into v_sf_mtl009 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-009';
  select id into v_sf_mtl010 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-010';
  select id into v_sf_mtl011 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-011';
  select id into v_sf_mtl012 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-012';
  select id into v_sf_mtl014 from semielaborados where negocio_id=v_neg and codigo='SF-MTL-014';
  select id into v_sf_wod001 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-001';
  select id into v_sf_wod004 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-004';
  select id into v_sf_wod005 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-005';
  select id into v_sf_wod008 from semielaborados where negocio_id=v_neg and codigo='SF-WOD-008';
  select id into v_sf_asm001 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-001';
  select id into v_sf_asm005 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-005';
  select id into v_sf_wda001 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-001';
  select id into v_sf_str001 from semielaborados where negocio_id=v_neg and codigo='SF-STR-001';

  select id, precio_venta into v_pf_t001, v_precio_t001 from productos_finales where negocio_id=v_neg and codigo='ALP-T001';
  select id into v_pf_t002 from productos_finales where negocio_id=v_neg and codigo='ALP-T002';
  select id into v_pf_t003 from productos_finales where negocio_id=v_neg and codigo='ALP-T003';
  select id, precio_venta into v_pf_b001, v_precio_b001 from productos_finales where negocio_id=v_neg and codigo='ALP-B001';
  select id into v_pf_b002 from productos_finales where negocio_id=v_neg and codigo='ALP-B002';
  select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';
  select id, precio_venta into v_pf_c002, v_precio_c002 from productos_finales where negocio_id=v_neg and codigo='ALP-C002';
  select id, precio_venta into v_pf_c003, v_precio_c003 from productos_finales where negocio_id=v_neg and codigo='ALP-C003';
  select id into v_pf_c004 from productos_finales where negocio_id=v_neg and codigo='ALP-C004';
  select id, precio_venta into v_pf_c006, v_precio_c006 from productos_finales where negocio_id=v_neg and codigo='ALP-C006';
  select id into v_pf_s001 from productos_finales where negocio_id=v_neg and codigo='ALP-S001';
  select id into v_pf_s002 from productos_finales where negocio_id=v_neg and codigo='ALP-S002';
  select id into v_pf_s004 from productos_finales where negocio_id=v_neg and codigo='ALP-S004';
  select id into v_pf_bar001 from productos_finales where negocio_id=v_neg and codigo='ALP-BAR001';
  select id into v_pf_bar002 from productos_finales where negocio_id=v_neg and codigo='ALP-BAR002';

  -- proveedores por categoría (mismo patrón robusto que Mes 1)
  select ap.proveedor_id into v_prov_mtl_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004)
    order by (ap.articulo_id=v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_mtl_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_mtl004) and ap.proveedor_id<>v_prov_mtl_a
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
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_hwr001) and ap.proveedor_id<>v_prov_hwr_a
    order by ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_con_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_con001)
    order by (ap.articulo_id=v_art_con001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_con_b from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_con001) and ap.proveedor_id<>v_prov_con_a
    order by ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_pkg_a from articulo_proveedor ap join articulos_compra a on a.id=ap.articulo_id
    where ap.negocio_id=v_neg and a.categoria_id=(select categoria_id from articulos_compra where id=v_art_pkg002)
    order by (ap.articulo_id=v_art_pkg002) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;

  if v_prov_mtl_a is null or v_prov_mtl_b is null or v_prov_mtl_c is null or v_prov_wod_a is null
     or v_prov_pnt_a is null or v_prov_hwr_a is null or v_prov_hwr_b is null
     or v_prov_con_a is null or v_prov_con_b is null or v_prov_pkg_a is null then
    raise exception 'No hay suficientes proveedores por categoría para Mes 2. Abortando.';
  end if;

  -- MISMO pool determinista de clientes que Mes 1 (misma consulta => mismos ids)
  select array_agg(id order by id) into v_cli_b2b from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;
  select array_agg(id order by id) into v_cli_b2c from (select id from clientes where negocio_id=v_neg and tipo='particular' order by id limit 3) s;

  -- pedidos de Mes 1 que progresan este mes, resueltos por codigo_pedido (nunca hardcodeados)
  select p.id, l.id into v_pv_o1, v_lpv_o1 from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260001';
  select p.id, l.id into v_pv_bench, v_lpv_bench from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260004';
  select p.id, l.id into v_pv_c002, v_lpv_c002 from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260006';
  select p.id, l.id into v_pv_c003, v_lpv_c003 from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260009';
  select p.id, l.id into v_pv_c006, v_lpv_c006 from pedidos_venta p join lineas_pedido_venta l on l.pedido_id=p.id where p.negocio_id=v_neg and p.codigo_pedido='OV-260016';

  if v_pv_o1 is null or v_pv_bench is null or v_pv_c002 is null or v_pv_c003 is null or v_pv_c006 is null then
    raise exception 'No se encontraron los pedidos de Mes 1 esperados (OV-260001/004/006/009/016). Abortando.';
  end if;

  select id into v_fv1_id from facturas_venta where negocio_id=v_neg and numero_factura='RE-ALP-2026-001';
  select id into v_fv3_id from facturas_venta where negocio_id=v_neg and numero_factura='RE-ALP-2026-003';
  select id into v_fc7_id from facturas_compra where negocio_id=v_neg and codigo_interno='PI-260007';
  select id into v_fc8_id from facturas_compra where negocio_id=v_neg and codigo_interno='PI-260008';

  if v_fv1_id is null or v_fv3_id is null or v_fc7_id is null or v_fc8_id is null then
    raise exception 'No se encontraron las facturas abiertas de Mes 1 esperadas. Abortando.';
  end if;

  -- stock heredado de Mes 1, resuelto vía las vistas reales de stock (nunca por variable recordada)
  select produccion_id into v_p_str001_spare from stock_lotes_semielaborado
    where semielaborado_id=v_sf_str001 and stock_disponible>0 order by fecha limit 1;
  select produccion_id into v_p_wod008_spare from stock_lotes_semielaborado
    where semielaborado_id=v_sf_wod008 and stock_disponible>0 order by fecha limit 1;
  select entrada_material_id into v_em_mtl007_m1 from stock_lotes_articulo
    where articulo_id=v_art_mtl007 and stock_disponible>0 order by fecha_recepcion limit 1;
  select entrada_material_id into v_em_wod010_m1 from stock_lotes_articulo
    where articulo_id=v_art_wod010 and stock_disponible>0 order by fecha_recepcion limit 1;

  if v_p_str001_spare is null or v_p_wod008_spare is null or v_em_mtl007_m1 is null or v_em_wod010_m1 is null then
    raise exception 'No se encontró el stock heredado de Mes 1 esperado (SF-STR-001/SF-WOD-008/RM-MTL-007/RM-WOD-010). Abortando.';
  end if;

  raise notice 'AlpenWerk negocio_id=%. Mes 1 cerrado y localizado correctamente. Comenzando Mes 2.', v_neg;

  -- ===========================================================================================
  -- 1. COMPRAS DE MES 2: crecimiento, Article Base, recepción parcial, sustitución de proveedor
  -- ===========================================================================================

  -- Restock normal de tubo estructural (Metal-A)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_a, '2026-04-01', '2026-04-08', 'pendiente', '[FASE06-M2] Reposición mensual de tubo', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl004, 30, 8.55, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_a, 'LFS-MTLA-0410', '2026-04-08', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_mtl004, 30, 8.55, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_b2;

  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_a, '2026-04-01', '2026-04-08', 'pendiente', '[FASE06-M2] Reposición mensual de tubo 30x30 y chapa', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl003, 20, 6.25, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_a, 'LFS-MTLA-0411', '2026-04-08', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_mtl003, 20, 6.25, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl003_b2;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl018, 4, 22.20, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_mtl018, 4, 22.20, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl018_b2;

  -- Metal-B: segunda fuente ya homologada, restock de tubo
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_b, '2026-04-03', '2026-04-10', 'pendiente', '[FASE06-M2] Restock proveedor alternativo', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl004, 15, 8.75, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_b, 'LFS-MTLB-1104', '2026-04-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_mtl004, 15, 8.75, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- === SUSTITUCIÓN DE PROVEEDOR (Article Base) ===
  -- Metal-A no puede servir este pedido en abril (rotura de stock del molino): se queda
  -- 'pendiente' sin ningún albarán este mes. AlpenWerk cubre la misma necesidad conceptual
  -- de "tubo 40x40x2mm S235" comprando el artículo compatible RM-MTL-029 a un proveedor
  -- distinto (Metal-C), homologado en Fase 05 como Article Base junto a RM-MTL-004.
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_a, '2026-04-06', '2026-04-13', 'pendiente', '[FASE06-M2] SUSTITUCION: Metal-A no pudo servir este pedido en abril (rotura de stock del molino) — cubierto vía Article Base con RM-MTL-029', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl004, 15, 8.60, v_neg) returning id into v_lp_tmp;
  -- (sin albarán: Metal-A confirmó por email que no podía entregar este mes)

  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_c, '2026-04-07', '2026-04-14', 'pendiente', '[FASE06-M2] SUSTITUCION: cobertura de tubo 40x40x2mm S235 vía Article Base (RM-MTL-029) ante rotura de Metal-A', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl029, 15, 8.90, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_c, 'LFS-MTLC-0055', '2026-04-14', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_mtl029, 15, 8.90, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- === RECEPCIÓN PARCIAL ===
  -- Se piden 25 m2 de tablero de roble; el proveedor solo puede entregar 16 m2 en este envío.
  -- El pedido queda 'pendiente' por los 9 m2 restantes (se completará en un mes futuro).
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_wod_a, '2026-04-02', '2026-04-09', 'pendiente', '[FASE06-M2] RECEPCION PARCIAL: pedidos 25 m2, entregados 16 m2, quedan 9 m2 pendientes', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod003, 25, 46.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_wod_a, 'LFS-WODA-0323', '2026-04-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_wod003, 16, 46.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod003_b2;
  -- pedido queda en 'pendiente' automáticamente (16 < 25), tal como hace el trigger real

  -- Restock normal de cantonera y tablero de haya (Wood-A)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_wod_a, '2026-04-05', '2026-04-12', 'pendiente', '[FASE06-M2] Restock canto de roble y tablero de haya', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod020, 50, 1.22, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_wod_a, 'LFS-WODA-0324', '2026-04-12', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_wod020, 50, 1.22, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod020_b2;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_brd004, 8, 24.50, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_brd004, 8, 24.50, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_tmp;

  -- Consumables-A: restock hilo de soldadura
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_con_a, '2026-04-04', '2026-04-11', 'pendiente', '[FASE06-M2] Restock hilo de soldadura', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_con001, 20, 12.10, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_con_a, 'LFS-CONA-0184', '2026-04-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_con001, 20, 12.10, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_con001_b2;

  -- Consumables-B (nuevo proveedor): SEGUNDO Article Base genuino — hilo de soldadura RM-CON-019
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_con_b, '2026-04-15', '2026-04-22', 'pendiente', '[FASE06-M2] Nuevo proveedor homologado, Article Base hilo de soldadura', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_con019, 15, 12.60, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_con_b, 'LFS-CONB-0021', '2026-04-22', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_con019, 15, 12.60, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- Hardware-A: restock
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_hwr_a, '2026-04-09', '2026-04-16', 'pendiente', '[FASE06-M2] Restock tornillería', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_hwr001, 300, 0.08, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_hwr_a, 'LFS-HWRA-0456', '2026-04-16', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_hwr001, 300, 0.08, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

  -- Hardware-B (nuevo proveedor): "additional suppliers"
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_hwr_b, '2026-04-17', '2026-04-24', 'pendiente', '[FASE06-M2] Nuevo proveedor de tornillería', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_hwr005, 150, 0.16, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_hwr_b, 'LFS-HWRB-0011', '2026-04-24', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_hwr005, 150, 0.16, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

  -- Paint-A: restock (3 líneas)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_pnt_a, '2026-04-08', '2026-04-15', 'pendiente', '[FASE06-M2] Restock acabados', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pnt001, 15, 15.20, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_pnt_a, 'LFS-PNTA-0199', '2026-04-15', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pnt001, 15, 15.20, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pnt005, 10, 9.60, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pnt005, 10, 9.60, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pnt009, 8, 18.00, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pnt009, 8, 18.00, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;

  -- Packaging-A: restock (3 líneas)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_pkg_a, '2026-04-11', '2026-04-18', 'pendiente', '[FASE06-M2] Restock embalaje', v_neg) returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pkg002, 80, 2.12, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_pkg_a, 'LFS-PKGA-0093', '2026-04-18', v_pc_tmp, 'pedido', v_neg) returning id into v_ac_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pkg002, 80, 2.12, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pkg001, 40, 1.42, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pkg001, 40, 1.42, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pkg004, 60, 0.35, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac_tmp, v_art_pkg004, 60, 0.35, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

  raise notice 'Compras Mes 2: nuevos pedidos y albaranes creados (ver conteos en validación).';

  -- ===========================================================================================
  -- 2. FACTURACIÓN Y PAGOS DE COMPRA — nuevas facturas + continuidad de saldos de Mes 1
  -- ===========================================================================================

  -- Metal-A (agrupa los 2 albaranes de restock de este mes)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    select v_prov_mtl_a, '2026-04-20',
      (select sum(cantidad*precio) from entrada_material where id in (v_em_mtl004_b2, v_em_mtl003_b2, v_em_mtl018_b2)), v_neg
    returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, albaran_compra_id, v_neg from entrada_material where id in (v_em_mtl004_b2, v_em_mtl003_b2, v_em_mtl018_b2)
    group by albaran_compra_id;
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id)
    select v_prov_mtl_a, '2026-04-25', total, 'transferencia', v_neg from facturas_compra where id=v_fc returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id)
    select v_pago_tmp, v_fc, total, v_neg from facturas_compra where id=v_fc;

  -- Metal-B
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_mtl_b, '2026-04-15', 15*8.75, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-MTLB-1104';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_mtl_b, '2026-04-20', 131.25, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 131.25, v_neg);

  -- Metal-C (proveedor de sustitución): pagado en su totalidad
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_mtl_c, '2026-04-18', 15*8.90, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-MTLC-0055';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_mtl_c, '2026-04-24', 133.50, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 133.50, v_neg);

  -- Wood-A (agrupa recepción parcial + restock)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_wod_a, '2026-04-19', 16*46.00 + 50*1.22 + 8*24.50, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran in ('LFS-WODA-0323','LFS-WODA-0324');
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id)
    select v_prov_wod_a, '2026-04-26', total, 'transferencia', v_neg from facturas_compra where id=v_fc returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id)
    select v_pago_tmp, v_fc, total, v_neg from facturas_compra where id=v_fc;

  -- Consumables-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_con_a, '2026-04-13', 20*12.10, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-CONA-0184';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_con_a, '2026-04-18', 242.00, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 242.00, v_neg);

  -- Consumables-B (nuevo, Article Base): pagado
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_con_b, '2026-04-24', 15*12.60, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-CONB-0021';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_con_b, '2026-04-29', 189.00, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 189.00, v_neg);

  -- Hardware-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_hwr_a, '2026-04-18', 300*0.08, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-HWRA-0456';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_hwr_a, '2026-04-23', 24.00, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 24.00, v_neg);

  -- Hardware-B (nuevo): factura SIN PAGAR este mes (variedad, sigue a Mes 3)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_hwr_b, '2026-04-26', 150*0.16, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-HWRB-0011';

  -- Paint-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_pnt_a, '2026-04-17', 15*15.20 + 10*9.60 + 8*18.00, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-PNTA-0199';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id)
    select v_prov_pnt_a, '2026-04-22', total, 'transferencia', v_neg from facturas_compra where id=v_fc returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id)
    select v_pago_tmp, v_fc, total, v_neg from facturas_compra where id=v_fc;

  -- Packaging-A: PAGO PARCIAL (variedad)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id) values (v_prov_pkg_a, '2026-04-20', 80*2.12 + 40*1.42 + 60*0.35, v_neg) returning id into v_fc;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id)
    select v_fc, ac.id, v_neg from albaranes_compra ac where ac.negocio_id=v_neg and ac.numero_albaran='LFS-PKGA-0093';
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_pkg_a, '2026-04-27', 150.00, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc, 150.00, v_neg);

  -- === CONTINUIDAD DE SALDOS ABIERTOS DE MES 1 (solo INSERT de pagos nuevos, nada se modifica) ===
  -- PI-260007 (Consumables-A, saldo 183.00): se salda por completo este mes.
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_con_a, '2026-04-05', 183.00, 'transferencia', v_neg) returning id into v_pago_tmp;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_tmp, v_fc7_id, 183.00, v_neg);
  -- PI-260008 (Packaging-A, saldo 280.00): sigue SIN PAGAR, continúa hacia Mes 3 (variedad deliberada).

  raise notice 'Facturación y pagos de compra Mes 2 completados, incluida la continuidad del saldo de PI-260007.';

  -- ===========================================================================================
  -- 3. PRODUCCIÓN MES 2
  -- ===========================================================================================

  insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-04-13', 'cerrada', v_neg) returning id into v_tanda1;
  insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-04-20', 'cerrada', v_neg) returning id into v_tanda2;

  -- --- 3a. Cierre de la 2ª mesa de OV-260001, a partir del SF-STR-001 sobrante de Mes 1 ---
  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id)
    values (v_pf_t001, '2026-04-14', 'cerrada', 1, 1, v_loc_fg, v_pv_o1, v_neg) returning id into v_p_pf_t001_2;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_t001_2, v_p_str001_spare, 1, v_neg);

  -- --- 3b. Lote de sillas compartiendo el mismo pool de componentes (SF-MTL-012 / SF-WOD-008) ---
  --     Reutiliza el SF-WOD-008 sobrante de Mes 1 (stock heredado, ver v_p_wod008_spare).
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl007, '2026-04-13', 'cerrada', 24, 24, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl007;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007, v_em_mtl007_m1, 24*0.45, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod004, '2026-04-13', 'cerrada', 5, 5, v_loc_cut, v_tanda1, v_neg) returning id into v_p_wod004;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004, v_em_wod010_m1, 5*0.16, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl012, '2026-04-14', 'cerrada', 24, 24, v_loc_mach, v_tanda1, v_neg) returning id into v_p_mtl012;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012, v_p_mtl007, 24, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod008, '2026-04-14', 'cerrada', 5, 5, v_loc_sand, v_tanda1, v_neg) returning id into v_p_wod008;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008, v_p_wod004, 5, v_neg);

  -- Sillas finales: 3 SKUs distintos consumiendo del mismo pool de piezas (componente compartido)
  -- SF-WOD-008 disponible: 1 sobrante de Mes 1 (v_p_wod008_spare, solo 1 unidad) + 5 nuevas
  -- (v_p_wod008). ALP-C002 consume 1 de cada lote para agotar exactamente el sobrante de Mes 1;
  -- el resto de la demanda (1+3=4) sale íntegramente del lote nuevo.
  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
    values (v_pf_c002, '2026-04-15', 'cerrada', 2, 2, v_loc_fg, v_neg) returning id into v_p_pf_c002;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c002, v_p_mtl012, 2*4, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c002, v_p_wod008_spare, 1, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c002, v_p_wod008, 1, v_neg);

  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
    values (v_pf_c003, '2026-04-15', 'cerrada', 1, 1, v_loc_fg, v_neg) returning id into v_p_pf_c003;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c003, v_p_mtl012, 1*4, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c003, v_p_wod008, 1, v_neg);

  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id)
    values (v_pf_c006, '2026-04-15', 'cerrada', 3, 3, v_loc_fg, v_pv_c006, v_neg) returning id into v_p_pf_c006;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c006, v_p_mtl012, 3*4, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c006, v_p_wod008, 3, v_neg);
  -- SF-MTL-012 consumido: 2*4+1*4+3*4=24 (exacto); SF-WOD-008 consumido: 1(sobrante)+1+1+3(nuevo)=6 (1 spare + 5 nuevos, exacto)

  -- --- 3c. Banco (ALP-B001), mismo patrón de cadena que la mesa de Mes 1 (componente compartido) ---
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl001, '2026-04-16', 'cerrada', 2, 2, v_loc_cut, v_tanda2, v_neg) returning id into v_p_mtl001;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_b2, 2*1.20, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl005, '2026-04-16', 'cerrada', 2, 2, v_loc_cut, v_tanda2, v_neg) returning id into v_p_mtl005;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl005, v_em_mtl004_b2, 2*0.70, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl006, '2026-04-16', 'cerrada', 4, 4, v_loc_cut, v_tanda2, v_neg) returning id into v_p_mtl006;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl006, v_em_mtl003_b2, 4*0.70, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl009, '2026-04-16', 'cerrada', 4, 4, v_loc_cut, v_tanda2, v_neg) returning id into v_p_mtl009;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl009, v_em_mtl018_b2, 4*0.01, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod001, '2026-04-16', 'cerrada', 1, 1, v_loc_cut, v_tanda2, v_neg) returning id into v_p_wod001;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod001, v_em_wod003_b2, 1*0.72, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl010, '2026-04-17', 'cerrada', 2, 2, v_loc_mach, v_tanda2, v_neg) returning id into v_p_mtl010;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 2, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl011, '2026-04-17', 'cerrada', 4, 4, v_loc_mach, v_tanda2, v_neg) returning id into v_p_mtl011;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl011, v_p_mtl006, 4, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl014, '2026-04-17', 'cerrada', 4, 4, v_loc_mach, v_tanda2, v_neg) returning id into v_p_mtl014;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl014, v_p_mtl009, 4, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod005, '2026-04-17', 'cerrada', 1, 1, v_loc_sand, v_tanda2, v_neg) returning id into v_p_wod005;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod005, v_p_wod001, 1, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_asm001, '2026-04-18', 'cerrada', 4, 4, v_loc_weld, v_tanda2, v_neg) returning id into v_p_asm001;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm001, v_p_mtl011, 4, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_asm005, '2026-04-18', 'cerrada', 1, 1, v_loc_weld, v_tanda2, v_neg) returning id into v_p_asm005;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl010, 2, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl005, 2, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_asm001, 4, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm005, v_p_mtl014, 4, v_neg);
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_asm005, v_em_con001_b2, 0.35, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wda001, '2026-04-18', 'cerrada', 1, 1, v_loc_assy, v_tanda2, v_neg) returning id into v_p_wda001;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda001, v_p_wod005, 1, v_neg);
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wda001, v_em_wod020_b2, 3.60, v_neg);

  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, pedido_id, negocio_id)
    values (v_pf_b001, '2026-04-20', 'cerrada', 1, 1, v_loc_fg, v_pv_bench, v_neg) returning id into v_p_pf_b001;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_b001, v_p_asm005, 1, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_b001, v_p_wda001, 1, v_neg);

  raise notice 'Producción Mes 2 completada: cierre de la 2ª mesa, lote de sillas (3 SKU) y banco, todos con trazabilidad completa.';

  -- ===========================================================================================
  -- 4. VENTAS MES 2: progreso de la cartera de Mes 1 + nuevos pedidos
  -- ===========================================================================================

  -- --- O1 (OV-260001): entrega de la 2ª mesa, factura nueva, pago completo + liquidación del saldo de Mes 1 ---
  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    select cliente_id, '2026-04-14', 'DN-ALP-260004', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_o1 returning id into v_av;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av, v_pf_t001, v_p_pf_t001_2, 1, v_precio_t001, v_lpv_o1, v_neg);
  insert into facturas_venta (cliente_id, fecha, total, negocio_id)
    select cliente_id, '2026-04-14', v_precio_t001, v_neg from pedidos_venta where id=v_pv_o1 returning id into v_fv;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-15', v_precio_t001, 'transferencia', v_neg from pedidos_venta where id=v_pv_o1 returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, v_precio_t001, v_neg);

  -- Liquidación del saldo abierto de Mes 1 (factura RE-ALP-2026-001, 350.00 pendientes) — solo INSERT, nunca se toca la factura original
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-16', 350.00, 'transferencia', v_neg from facturas_venta where id=v_fv1_id returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv1_id, 350.00, v_neg);

  -- Liquidación del saldo abierto de Mes 1 (factura RE-ALP-2026-003, 220.00 pendientes)
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-10', 220.00, 'tarjeta', v_neg from facturas_venta where id=v_fv3_id returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv3_id, 220.00, v_neg);

  -- --- OV-260004 (banco): entrega completa, factura, pago completo ---
  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    select cliente_id, '2026-04-21', 'DN-ALP-260005', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_bench returning id into v_av;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av, v_pf_b001, v_p_pf_b001, 1, v_precio_b001, v_lpv_bench, v_neg);
  insert into facturas_venta (cliente_id, fecha, total, negocio_id)
    select cliente_id, '2026-04-21', v_precio_b001, v_neg from pedidos_venta where id=v_pv_bench returning id into v_fv;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-22', v_precio_b001, 'transferencia', v_neg from pedidos_venta where id=v_pv_bench returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, v_precio_b001, v_neg);

  -- --- OV-260006 (2x ALP-C002, cliente repetido): entrega completa, factura, pago completo ---
  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    select cliente_id, '2026-04-16', 'DN-ALP-260006', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_c002 returning id into v_av;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av, v_pf_c002, v_p_pf_c002, 2, v_precio_c002, v_lpv_c002, v_neg);
  insert into facturas_venta (cliente_id, fecha, total, negocio_id)
    select cliente_id, '2026-04-16', 2*v_precio_c002, v_neg from pedidos_venta where id=v_pv_c002 returning id into v_fv;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-17', 2*v_precio_c002, 'tarjeta', v_neg from pedidos_venta where id=v_pv_c002 returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago, v_fv, 2*v_precio_c002, v_neg);

  -- --- OV-260009 (1x ALP-C003): entrega completa, factura, SIN COBRAR (variedad, sigue a Mes 3) ---
  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    select cliente_id, '2026-04-16', 'DN-ALP-260007', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_c003 returning id into v_av;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av, v_pf_c003, v_p_pf_c003, 1, v_precio_c003, v_lpv_c003, v_neg);
  insert into facturas_venta (cliente_id, fecha, total, negocio_id)
    select cliente_id, '2026-04-17', v_precio_c003, v_neg from pedidos_venta where id=v_pv_c003 returning id into v_fv;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);

  -- --- OV-260016 (3x ALP-C006): entrega completa, factura, PAGO PARCIAL ---
  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    select cliente_id, '2026-04-16', 'DN-ALP-260008', 'pedido_planificado', v_neg from pedidos_venta where id=v_pv_c006 returning id into v_av;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av, v_pf_c006, v_p_pf_c006, 3, v_precio_c006, v_lpv_c006, v_neg);
  insert into facturas_venta (cliente_id, fecha, total, negocio_id)
    select cliente_id, '2026-04-17', 3*v_precio_c006, v_neg from pedidos_venta where id=v_pv_c006 returning id into v_fv;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv, v_av, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id)
    select cliente_id, '2026-04-24', round(3*v_precio_c006*0.5, 2), 'transferencia', v_neg from pedidos_venta where id=v_pv_c006 returning id into v_pago;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id)
    select v_pago, v_fv, monto, v_neg from pagos where id=v_pago;

  raise notice 'Ventas Mes 2 (progreso de cartera de Mes 1): 5 pedidos avanzados a entrega/factura, saldos de Mes 1 liquidados.';

  -- --- Nuevos pedidos de Mes 2: pedido grande de cliente en crecimiento + repetidor + variedad ---
  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values
    (v_cli_b2b[3], '2026-04-02', '2026-05-15', 'pendiente', '[FASE06-M2] Pedido grande: proyecto de expansión de sala', v_neg) returning id into v_pv_o1;
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    select v_pv_o1, v_pf_t001, 4, v_precio_t001, v_neg;
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    select v_pv_o1, v_pf_c001, 8, v_precio_c001, v_neg;

  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values
    (v_cli_b2b[2], '2026-04-18', '2026-05-20', 'pendiente', '[FASE06-M2] Backlog, cliente repetido', v_neg),
    (v_cli_b2b[1], '2026-04-08', '2026-05-08', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[4], '2026-04-09', '2026-05-09', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[5], '2026-04-10', '2026-05-11', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[6], '2026-04-13', '2026-05-13', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[7], '2026-04-14', '2026-05-14', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2c[1], '2026-04-15', '2026-05-01', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2c[2], '2026-04-16', '2026-05-02', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2c[3], '2026-04-17', '2026-05-03', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[3], '2026-04-20', '2026-05-20', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[4], '2026-04-21', '2026-05-21', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[5], '2026-04-22', '2026-05-22', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[6], '2026-04-23', '2026-05-23', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[7], '2026-04-24', '2026-05-24', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[1], '2026-04-27', '2026-05-27', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[2], '2026-04-28', '2026-05-28', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2c[1], '2026-04-29', '2026-05-05', 'pendiente', '[FASE06-M2] Backlog', v_neg),
    (v_cli_b2b[3], '2026-04-30', '2026-05-30', 'pendiente', '[FASE06-M2] Backlog', v_neg);

  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    select pv.id, x.producto_final_id, x.cantidad, pf.precio_venta, v_neg
    from (
      select row_number() over (order by pv.id) as rn, pv.id
      from pedidos_venta pv
      where pv.negocio_id = v_neg and pv.notas like '[FASE06-M2] Backlog%'
    ) pv
    join (values
      (1, v_pf_c002, 2), (2, v_pf_s001, 2), (3, v_pf_t002, 1), (4, v_pf_bar001, 1),
      (5, v_pf_c004, 3), (6, v_pf_b002, 1), (7, v_pf_c001, 1), (8, v_pf_s002, 1),
      (9, v_pf_c003, 2), (10, v_pf_t003, 1), (11, v_pf_s004, 1), (12, v_pf_bar002, 1),
      (13, v_pf_c006, 2), (14, v_pf_c001, 2), (15, v_pf_b002, 1), (16, v_pf_c002, 1),
      (17, v_pf_c001, 1), (18, v_pf_s001, 1)
    ) as x(rn, producto_final_id, cantidad) on x.rn = pv.rn
    join productos_finales pf on pf.id = x.producto_final_id;

  raise notice 'Ventas Mes 2 (nuevos): 1 pedido grande + 17 pedidos de backlog creados, todos pendientes.';
  raise notice 'FASE 06 MES 2 sembrada correctamente para AlpenWerk (negocio_id=%).', v_neg;
end $$;

commit;
