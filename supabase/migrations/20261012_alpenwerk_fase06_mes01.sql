-- FASE 06 de AlpenWerk Möbel GmbH — MES 1: FOUNDATION
--
-- Simula el primer mes de actividad operativa real de AlpenWerk (marzo 2026):
-- compras -> recepción -> lotes -> producción semielaborada (cadena completa
-- de 6 niveles para la mesa insignia, mostrando trazabilidad total) ->
-- producción de producto final -> entrega -> factura -> cobro, más una
-- cartera de pedidos de venta en backlog que alimentará los meses 2-3.
--
-- Se ejecuta como un usuario autenticado real (no superusuario) para que los
-- triggers de negocio (generar_codigo(), negocio_actual(), auto-cálculo de
-- estado de pedidos) funcionen exactamente igual que si un operador hubiera
-- usado la aplicación. El usuario 'f19755c4-4e40-4d0f-8426-2a4b3ccc1351' ya
-- está vinculado a AlpenWerk en usuarios_negocios (Fase 01).
--
-- Idempotente: si ya existen pedidos de venta de AlpenWerk marcados
-- '[FASE06-M1]', no hace nada.

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
  v_art_mtl004 bigint; v_art_mtl003 bigint; v_art_mtl007 bigint; v_art_mtl018 bigint; v_art_mtl019 bigint;
  v_art_wod003 bigint; v_art_wod010 bigint; v_art_wod020 bigint;
  v_art_brd001 bigint; v_art_brd004 bigint;
  v_art_pnt001 bigint; v_art_pnt005 bigint;
  v_art_hwr001 bigint; v_art_hwr005 bigint;
  v_art_con001 bigint;
  v_art_pkg001 bigint; v_art_pkg002 bigint;

  -- semielaborados
  v_sf_mtl001 bigint; v_sf_mtl005 bigint; v_sf_mtl006 bigint; v_sf_mtl007 bigint; v_sf_mtl009 bigint;
  v_sf_mtl010 bigint; v_sf_mtl011 bigint; v_sf_mtl012 bigint; v_sf_mtl014 bigint;
  v_sf_wod001 bigint; v_sf_wod004 bigint; v_sf_wod005 bigint; v_sf_wod008 bigint;
  v_sf_asm001 bigint; v_sf_asm002 bigint; v_sf_wda001 bigint; v_sf_str001 bigint;

  -- productos_finales
  v_pf_t001 bigint; v_pf_t002 bigint; v_pf_t003 bigint;
  v_pf_c001 bigint; v_pf_c002 bigint; v_pf_c003 bigint; v_pf_c004 bigint; v_pf_c006 bigint;
  v_pf_b001 bigint; v_pf_b002 bigint;
  v_pf_s001 bigint; v_pf_s002 bigint; v_pf_s004 bigint;
  v_pf_bar001 bigint; v_pf_bar002 bigint;

  -- proveedores (resueltos dinámicamente vía articulo_proveedor, no por nombre)
  v_prov_mtl_a bigint; v_prov_mtl_b bigint;
  v_prov_wod_a bigint; v_prov_brd_a bigint; v_prov_pnt_a bigint;
  v_prov_hwr_a bigint; v_prov_con_a bigint; v_prov_pkg_a bigint;

  -- clientes (pools resueltos dinámicamente)
  v_cli_b2b bigint[]; v_cli_b2c bigint[];

  -- precios de venta (leídos del catálogo real)
  v_precio_t001 numeric; v_precio_c001 numeric;

  -- scratch reutilizable para inserts cuyo id no hace falta conservar
  v_pc_tmp bigint; v_lp_tmp bigint; v_ac_tmp bigint; v_em_tmp bigint;

  -- pedidos/albaranes de compra que sí necesito conservar (para agrupar en facturas)
  v_ac1 bigint; v_ac2 bigint; v_ac3 bigint; v_ac4 bigint; v_ac5 bigint; v_ac6 bigint;
  v_ac7 bigint; v_ac8 bigint; v_ac9 bigint; v_ac10 bigint; v_ac11 bigint; v_ac12 bigint;

  -- lotes (entrada_material) que sí se consumen en producción
  v_em_mtl004_a bigint; v_em_mtl003 bigint; v_em_mtl018 bigint; v_em_mtl007 bigint;
  v_em_wod003 bigint; v_em_wod010 bigint; v_em_wod020_a bigint; v_em_con001_a bigint;

  -- facturas y pagos de compra
  v_fc1 bigint; v_fc2 bigint; v_fc3 bigint; v_fc4 bigint; v_fc5 bigint; v_fc6 bigint; v_fc7 bigint; v_fc8 bigint;
  v_pago_prov bigint;

  -- producciones (semielaborado)
  v_p_mtl001 bigint; v_p_mtl005 bigint; v_p_mtl006 bigint; v_p_mtl007 bigint; v_p_mtl009 bigint;
  v_p_mtl010 bigint; v_p_mtl011 bigint; v_p_mtl012 bigint; v_p_mtl014 bigint;
  v_p_wod001 bigint; v_p_wod004 bigint; v_p_wod005 bigint; v_p_wod008 bigint;
  v_p_asm001 bigint; v_p_asm002 bigint; v_p_wda001 bigint; v_p_str001 bigint;

  -- producciones (producto final)
  v_p_pf_t001 bigint; v_p_pf_c001 bigint;

  -- tandas (agrupación puramente organizativa, sin efecto en la UI real — ver informe)
  v_tanda1 uuid; v_tanda2 uuid;

  -- pedidos de venta que sí se consumen aguas abajo
  v_pv1 bigint; v_pv2 bigint; v_pv3 bigint;
  v_lpv1 bigint; v_lpv2 bigint; v_lpv3 bigint;

  -- albaranes / facturas / pagos de venta
  v_av1 bigint; v_av2 bigint; v_av3 bigint;
  v_fv1 bigint; v_fv2 bigint; v_fv3 bigint;
  v_pago_cli1 bigint; v_pago_cli2 bigint;

begin
  select id into v_neg from negocios where codigo_corto = 'ALP';
  if v_neg is null then
    raise exception 'AlpenWerk (codigo_corto=ALP) no existe. Abortando.';
  end if;

  if exists (select 1 from pedidos_venta where negocio_id = v_neg and notas like '%[FASE06-M1]%') then
    raise notice 'Fase 06 Mes 1 ya fue sembrada anteriormente para AlpenWerk. Abortando sin cambios.';
    return;
  end if;

  -- ===========================================================================================
  -- 0. RESOLUCIÓN DE IDs (ubicaciones, artículos, semielaborados, productos, clientes/proveedores)
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

  select id into v_art_mtl004 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-004';
  select id into v_art_mtl003 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-003';
  select id into v_art_mtl007 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-007';
  select id into v_art_mtl018 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-018';
  select id into v_art_mtl019 from articulos_compra where negocio_id=v_neg and codigo='RM-MTL-019';
  select id into v_art_wod003 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-003';
  select id into v_art_wod010 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-010';
  select id into v_art_wod020 from articulos_compra where negocio_id=v_neg and codigo='RM-WOD-020';
  select id into v_art_brd001 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-001';
  select id into v_art_brd004 from articulos_compra where negocio_id=v_neg and codigo='RM-BRD-004';
  select id into v_art_pnt001 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-001';
  select id into v_art_pnt005 from articulos_compra where negocio_id=v_neg and codigo='RM-PNT-005';
  select id into v_art_hwr001 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-001';
  select id into v_art_hwr005 from articulos_compra where negocio_id=v_neg and codigo='RM-HWR-005';
  select id into v_art_con001 from articulos_compra where negocio_id=v_neg and codigo='RM-CON-001';
  select id into v_art_pkg001 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-001';
  select id into v_art_pkg002 from articulos_compra where negocio_id=v_neg and codigo='RM-PKG-002';

  if v_art_mtl004 is null or v_art_con001 is null then
    raise exception 'Catálogo de artículos de compra incompleto para AlpenWerk. Abortando.';
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
  select id into v_sf_asm002 from semielaborados where negocio_id=v_neg and codigo='SF-ASM-002';
  select id into v_sf_wda001 from semielaborados where negocio_id=v_neg and codigo='SF-WDA-001';
  select id into v_sf_str001 from semielaborados where negocio_id=v_neg and codigo='SF-STR-001';

  select id, precio_venta into v_pf_t001, v_precio_t001 from productos_finales where negocio_id=v_neg and codigo='ALP-T001';
  select id into v_pf_t002 from productos_finales where negocio_id=v_neg and codigo='ALP-T002';
  select id into v_pf_t003 from productos_finales where negocio_id=v_neg and codigo='ALP-T003';
  select id, precio_venta into v_pf_c001, v_precio_c001 from productos_finales where negocio_id=v_neg and codigo='ALP-C001';
  select id into v_pf_c002 from productos_finales where negocio_id=v_neg and codigo='ALP-C002';
  select id into v_pf_c003 from productos_finales where negocio_id=v_neg and codigo='ALP-C003';
  select id into v_pf_c004 from productos_finales where negocio_id=v_neg and codigo='ALP-C004';
  select id into v_pf_c006 from productos_finales where negocio_id=v_neg and codigo='ALP-C006';
  select id into v_pf_b001 from productos_finales where negocio_id=v_neg and codigo='ALP-B001';
  select id into v_pf_b002 from productos_finales where negocio_id=v_neg and codigo='ALP-B002';
  select id into v_pf_s001 from productos_finales where negocio_id=v_neg and codigo='ALP-S001';
  select id into v_pf_s002 from productos_finales where negocio_id=v_neg and codigo='ALP-S002';
  select id into v_pf_s004 from productos_finales where negocio_id=v_neg and codigo='ALP-S004';
  select id into v_pf_bar001 from productos_finales where negocio_id=v_neg and codigo='ALP-BAR001';
  select id into v_pf_bar002 from productos_finales where negocio_id=v_neg and codigo='ALP-BAR002';

  -- Proveedor real de cada artículo clave, resuelto por CATEGORÍA (no por el artículo exacto):
  -- Fase 05 dejó 40 artículos sin ningún proveedor propio, así que anclar la búsqueda al artículo
  -- de referencia podía devolver null. Cualquier proveedor que sirva a ALGÚN artículo de la misma
  -- categoría es una elección real y válida (los pools de Fase 05 son por categoría); se prioriza
  -- el que sí sirve el artículo exacto y, dentro de ese empate, el marcado preferente.
  select ap.proveedor_id into v_prov_mtl_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_mtl004)
    order by (ap.articulo_id = v_art_mtl004) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_wod_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_wod003)
    order by (ap.articulo_id = v_art_wod003) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_brd_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_brd001)
    order by (ap.articulo_id = v_art_brd001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_pnt_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_pnt001)
    order by (ap.articulo_id = v_art_pnt001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_hwr_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_hwr001)
    order by (ap.articulo_id = v_art_hwr001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_con_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_con001)
    order by (ap.articulo_id = v_art_con001) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;
  select ap.proveedor_id into v_prov_pkg_a
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_pkg002)
    order by (ap.articulo_id = v_art_pkg002) desc, ap.preferente desc nulls last, ap.proveedor_id limit 1;

  -- segundo proveedor de la misma categoría del metal, distinto de v_prov_mtl_a (homologación de
  -- un proveedor alternativo para RM-MTL-004, real aunque no haya vendido ese SKU exacto antes).
  select ap.proveedor_id into v_prov_mtl_b
    from articulo_proveedor ap join articulos_compra a on a.id = ap.articulo_id
    where ap.negocio_id = v_neg
      and a.categoria_id = (select categoria_id from articulos_compra where id = v_art_mtl004)
      and ap.proveedor_id <> v_prov_mtl_a
    order by (ap.articulo_id = v_art_mtl004) desc, ap.proveedor_id limit 1;

  if v_prov_mtl_a is null or v_prov_mtl_b is null or v_prov_wod_a is null or v_prov_brd_a is null
     or v_prov_pnt_a is null or v_prov_hwr_a is null or v_prov_con_a is null or v_prov_pkg_a is null then
    raise exception 'No se encontraron proveedores suficientes en articulo_proveedor (Fase 05) para los artículos clave. Abortando. (mtl_a=%, mtl_b=%, wod_a=%, brd_a=%, pnt_a=%, hwr_a=%, con_a=%, pkg_a=%)',
      v_prov_mtl_a, v_prov_mtl_b, v_prov_wod_a, v_prov_brd_a, v_prov_pnt_a, v_prov_hwr_a, v_prov_con_a, v_prov_pkg_a;
  end if;

  select array_agg(id order by id) into v_cli_b2b
    from (select id from clientes where negocio_id=v_neg and tipo='empresa' order by id limit 7) s;
  select array_agg(id order by id) into v_cli_b2c
    from (select id from clientes where negocio_id=v_neg and tipo='particular' order by id limit 3) s;

  if array_length(v_cli_b2b,1) < 7 or array_length(v_cli_b2c,1) < 3 then
    raise exception 'AlpenWerk no tiene suficientes clientes sembrados (Fase 05). Abortando.';
  end if;

  raise notice 'AlpenWerk negocio_id=%, mesa flagship=SF-STR-001 (id %), silla=ALP-C001 (id %)', v_neg, v_sf_str001, v_pf_c001;

  -- ===========================================================================================
  -- 1. COMPRAS: 11 pedidos + 1 compra directa -> 12 albaranes -> 21 lotes
  -- ===========================================================================================

  -- PO1: Metal-A, 2026-03-02 -> recepción 2026-03-09 (tubo 40x40x2, tubo 30x30x2, tubo redondo 33.7x2)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_a, '2026-03-02', '2026-03-09', 'pendiente', '[FASE06-M1] Reposición inicial de tubo estructural', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl004, 40, 8.50, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_a, 'LFS-MTLA-0301', '2026-03-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac1;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac1, v_art_mtl004, 40, 8.50, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl004_a;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl003, 30, 6.20, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac1, v_art_mtl003, 30, 6.20, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl003;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl007, 20, 5.80, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac1, v_art_mtl007, 20, 5.80, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl007;

  -- PO2: Metal-B (SEGUNDO proveedor compatible para el mismo artículo RM-MTL-004)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_b, '2026-03-04', '2026-03-11', 'pendiente', '[FASE06-M1] Segundo proveedor homologado para tubo 40x40x2, cobertura de riesgo', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl004, 15, 8.70, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_b, 'LFS-MTLB-1103', '2026-03-11', v_pc_tmp, 'pedido', v_neg) returning id into v_ac2;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac2, v_art_mtl004, 15, 8.70, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- PO3: Metal-A, chapa para la platina de anclaje
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_mtl_a, '2026-03-16', '2026-03-20', 'pendiente', '[FASE06-M1] Chapa para mecanizado', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl018, 4, 22.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_mtl_a, 'LFS-MTLA-0316', '2026-03-20', v_pc_tmp, 'pedido', v_neg) returning id into v_ac3;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac3, v_art_mtl018, 4, 22.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_mtl018;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_mtl019, 3, 28.00, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac3, v_art_mtl019, 3, 28.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- PO4: Wood-A, tablero de roble, tablero de haya, cantoneras
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_wod_a, '2026-03-03', '2026-03-10', 'pendiente', '[FASE06-M1] Madera para sobres de mesa y asientos', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod003, 15, 45.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_wod_a, 'LFS-WODA-0210', '2026-03-10', v_pc_tmp, 'pedido', v_neg) returning id into v_ac4;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac4, v_art_wod003, 15, 45.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod003;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod010, 6, 38.00, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac4, v_art_wod010, 6, 38.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod010;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod020, 60, 1.20, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac4, v_art_wod020, 60, 1.20, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_wod020_a;

  -- PO5: Wood-A, reposición de cantonera (2º lote del mismo artículo, distinta fecha)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_wod_a, '2026-03-23', '2026-03-27', 'pendiente', '[FASE06-M1] Reposición de canto de roble', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_wod020, 40, 1.25, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_wod_a, 'LFS-WODA-0322', '2026-03-27', v_pc_tmp, 'pedido', v_neg) returning id into v_ac5;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac5, v_art_wod020, 40, 1.25, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_tmp;

  -- PO6: Boards-A, MDF y contrachapado (stock de catálogo, sin consumo este mes)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_brd_a, '2026-03-05', '2026-03-12', 'pendiente', '[FASE06-M1] Tableros para próximos meses', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_brd001, 20, 18.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_brd_a, 'LFS-BRDA-0221', '2026-03-12', v_pc_tmp, 'pedido', v_neg) returning id into v_ac6;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac6, v_art_brd001, 20, 18.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_brd004, 10, 24.00, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac6, v_art_brd004, 10, 24.00, v_lp_tmp, v_loc_wood, v_neg) returning id into v_em_tmp;

  -- PO7: Paint-A (stock de catálogo, sin consumo este mes)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_pnt_a, '2026-03-06', '2026-03-13', 'pendiente', '[FASE06-M1] Acabados', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pnt001, 20, 15.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_pnt_a, 'LFS-PNTA-0198', '2026-03-13', v_pc_tmp, 'pedido', v_neg) returning id into v_ac7;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac7, v_art_pnt001, 20, 15.00, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pnt005, 15, 9.50, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac7, v_art_pnt005, 15, 9.50, v_lp_tmp, v_loc_chem, v_neg) returning id into v_em_tmp;

  -- PO8: Hardware-A (stock de catálogo, sin consumo este mes)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_hwr_a, '2026-03-09', '2026-03-16', 'pendiente', '[FASE06-M1] Tornillería general', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_hwr001, 500, 0.08, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_hwr_a, 'LFS-HWRA-0455', '2026-03-16', v_pc_tmp, 'pedido', v_neg) returning id into v_ac8;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac8, v_art_hwr001, 500, 0.08, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_hwr005, 200, 0.15, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac8, v_art_hwr005, 200, 0.15, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

  -- PO9: Consumables-A, hilo de soldadura
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_con_a, '2026-03-02', '2026-03-09', 'pendiente', '[FASE06-M1] Hilo de soldadura MIG', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_con001, 25, 12.00, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_con_a, 'LFS-CONA-0177', '2026-03-09', v_pc_tmp, 'pedido', v_neg) returning id into v_ac9;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac9, v_art_con001, 25, 12.00, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_con001_a;

  -- PO10: Consumables-A, reposición (2º lote)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_con_a, '2026-03-17', '2026-03-24', 'pendiente', '[FASE06-M1] Reposición hilo de soldadura', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_con001, 15, 12.20, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_con_a, 'LFS-CONA-0183', '2026-03-24', v_pc_tmp, 'pedido', v_neg) returning id into v_ac10;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac10, v_art_con001, 15, 12.20, v_lp_tmp, v_loc_metal, v_neg) returning id into v_em_tmp;

  -- PO11: Packaging-A (stock de catálogo, sin consumo este mes)
  insert into pedidos_compra (proveedor_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_prov_pkg_a, '2026-03-10', '2026-03-17', 'pendiente', '[FASE06-M1] Embalaje', v_neg)
    returning id into v_pc_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pkg002, 100, 2.10, v_neg) returning id into v_lp_tmp;
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, pedido_compra_id, tipo_origen, negocio_id)
    values (v_prov_pkg_a, 'LFS-PKGA-0092', '2026-03-17', v_pc_tmp, 'pedido', v_neg) returning id into v_ac11;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac11, v_art_pkg002, 100, 2.10, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;
  insert into lineas_pedido_compra (pedido_compra_id, articulo_id, cantidad, precio_unitario, negocio_id)
    values (v_pc_tmp, v_art_pkg001, 50, 1.40, v_neg) returning id into v_lp_tmp;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, linea_pedido_compra_id, ubicacion_id, negocio_id)
    values (v_ac11, v_art_pkg001, 50, 1.40, v_lp_tmp, v_loc_hw, v_neg) returning id into v_em_tmp;

  -- Compra directa (sin pedido previo, pago en efectivo, sin factura prevista): tornillería urgente
  insert into albaranes_compra (proveedor_id, numero_albaran, fecha, tipo_origen, metodo_pago, sin_factura_prevista, negocio_id)
    values (v_prov_hwr_a, null, '2026-03-30', 'compra_directa', 'efectivo', true, v_neg) returning id into v_ac12;
  insert into entrada_material (albaran_compra_id, articulo_id, cantidad, precio, ubicacion_id, negocio_id)
    values (v_ac12, v_art_hwr005, 30, 0.16, v_loc_hw, v_neg) returning id into v_em_tmp;

  raise notice 'Compras Mes 1: 11 pedidos, 12 albaranes, 21 lotes creados.';

  -- ===========================================================================================
  -- 2. FACTURACIÓN Y PAGOS DE COMPRA
  -- ===========================================================================================

  -- Metal-A: agrupa PO1 + PO3
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_mtl_a, '2026-03-21', 40*8.50 + 30*6.20 + 20*5.80 + 4*22.00 + 3*28.00, v_neg) returning id into v_fc1;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc1, v_ac1, v_neg);
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc1, v_ac3, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_mtl_a, '2026-03-25', 814.00, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc1, 814.00, v_neg);

  -- Metal-B
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_mtl_b, '2026-03-12', 15*8.70, v_neg) returning id into v_fc2;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc2, v_ac2, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_mtl_b, '2026-03-18', 130.50, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc2, 130.50, v_neg);

  -- Wood-A: agrupa PO4 + PO5
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_wod_a, '2026-03-28', 15*45.00 + 6*38.00 + 60*1.20 + 40*1.25, v_neg) returning id into v_fc3;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc3, v_ac4, v_neg);
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc3, v_ac5, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_wod_a, '2026-03-31', 1025.00, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc3, 1025.00, v_neg);

  -- Boards-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_brd_a, '2026-03-13', 20*18.00 + 10*24.00, v_neg) returning id into v_fc4;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc4, v_ac6, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_brd_a, '2026-03-20', 600.00, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc4, 600.00, v_neg);

  -- Paint-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_pnt_a, '2026-03-14', 20*15.00 + 15*9.50, v_neg) returning id into v_fc5;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc5, v_ac7, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_pnt_a, '2026-03-19', 442.50, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc5, 442.50, v_neg);

  -- Hardware-A
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_hwr_a, '2026-03-17', 500*0.08 + 200*0.15, v_neg) returning id into v_fc6;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc6, v_ac8, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_hwr_a, '2026-03-24', 70.00, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc6, 70.00, v_neg);

  -- Consumables-A: agrupa PO9 + PO10, PAGO PARCIAL (queda saldo pendiente hacia Mes 2)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_con_a, '2026-03-25', 25*12.00 + 15*12.20, v_neg) returning id into v_fc7;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc7, v_ac9, v_neg);
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc7, v_ac10, v_neg);
  insert into pagos (proveedor_id, fecha, monto, metodo, negocio_id) values (v_prov_con_a, '2026-03-31', 300.00, 'transferencia', v_neg) returning id into v_pago_prov;
  insert into pago_aplicacion (pago_id, factura_compra_id, monto_aplicado, negocio_id) values (v_pago_prov, v_fc7, 300.00, v_neg);
  -- total factura = 300+183=483.00, pagado 300.00 -> saldo pendiente 183.00

  -- Packaging-A: factura SIN PAGAR (queda pendiente hacia Mes 2)
  insert into facturas_compra (proveedor_id, fecha, total, negocio_id)
    values (v_prov_pkg_a, '2026-03-19', 100*2.10 + 50*1.40, v_neg) returning id into v_fc8;
  insert into factura_compra_albaran (factura_compra_id, albaran_compra_id, negocio_id) values (v_fc8, v_ac11, v_neg);
  -- nota: v_ac12 (compra directa) tiene sin_factura_prevista=true, deliberadamente nunca se factura.

  raise notice 'Compras Mes 1: 8 facturas de proveedor, 7 pagos registrados (1 parcial, 1 factura sin pagar, 1 albarán sin factura prevista).';

  -- ===========================================================================================
  -- 3. PRODUCCIÓN — CADENA COMPLETA DE LA MESA INSIGNIA (6 niveles, trazabilidad total)
  --    RM-MTL-004/RM-MTL-003/RM-MTL-018 + RM-WOD-003 + RM-CON-001 + RM-WOD-020
  --    -> SF-MTL-* / SF-WOD-* (nivel 1, corte)
  --    -> SF-MTL-010/011/014 / SF-WOD-005 (nivel 2, mecanizado/lijado)
  --    -> SF-ASM-001/002, SF-WDA-001 (nivel 3, soldadura/montaje madera)
  --    -> SF-STR-001 (nivel 4, ensamblaje estructural)
  --    -> ALP-T001 (producto final)
  -- ===========================================================================================

  insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-03-23', 'cerrada', v_neg) returning id into v_tanda1;
  insert into tandas_produccion (fecha, estado, negocio_id) values ('2026-03-26', 'cerrada', v_neg) returning id into v_tanda2;

  -- Nivel 1 (corte), 2026-03-23
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl001, '2026-03-23', 'cerrada', 4, 4, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl001;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl001, v_em_mtl004_a, 4*1.20, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl005, '2026-03-23', 'cerrada', 4, 4, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl005;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl005, v_em_mtl004_a, 4*0.70, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl006, '2026-03-23', 'cerrada', 8, 8, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl006;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl006, v_em_mtl003, 8*0.70, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl009, '2026-03-23', 'cerrada', 8, 8, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl009;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl009, v_em_mtl018, 8*0.01, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod001, '2026-03-23', 'cerrada', 2, 2, v_loc_cut, v_tanda1, v_neg) returning id into v_p_wod001;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod001, v_em_wod003, 2*0.72, v_neg);

  -- Nivel 1 (corte) — cadena de la silla, 2026-03-23
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl007, '2026-03-23', 'cerrada', 12, 12, v_loc_cut, v_tanda1, v_neg) returning id into v_p_mtl007;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_mtl007, v_em_mtl007, 12*0.45, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod004, '2026-03-23', 'cerrada', 4, 4, v_loc_cut, v_tanda1, v_neg) returning id into v_p_wod004;
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wod004, v_em_wod010, 4*0.16, v_neg);

  -- Nivel 2 (mecanizado/lijado), 2026-03-24
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl010, '2026-03-24', 'cerrada', 4, 4, v_loc_mach, v_tanda1, v_neg) returning id into v_p_mtl010;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl010, v_p_mtl001, 4, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl011, '2026-03-24', 'cerrada', 8, 8, v_loc_mach, v_tanda1, v_neg) returning id into v_p_mtl011;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl011, v_p_mtl006, 8, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl014, '2026-03-24', 'cerrada', 8, 8, v_loc_mach, v_tanda1, v_neg) returning id into v_p_mtl014;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl014, v_p_mtl009, 8, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod005, '2026-03-24', 'cerrada', 2, 2, v_loc_sand, v_tanda1, v_neg) returning id into v_p_wod005;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod005, v_p_wod001, 2, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_mtl012, '2026-03-24', 'cerrada', 12, 12, v_loc_mach, v_tanda1, v_neg) returning id into v_p_mtl012;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_mtl012, v_p_mtl007, 12, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wod008, '2026-03-24', 'cerrada', 4, 4, v_loc_sand, v_tanda1, v_neg) returning id into v_p_wod008;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wod008, v_p_wod004, 4, v_neg);

  -- Nivel 3 (soldadura / montaje madera), 2026-03-25
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_asm001, '2026-03-25', 'cerrada', 8, 8, v_loc_weld, v_tanda2, v_neg) returning id into v_p_asm001;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm001, v_p_mtl011, 8, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_asm002, '2026-03-25', 'cerrada', 2, 2, v_loc_weld, v_tanda2, v_neg) returning id into v_p_asm002;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl010, 2*2, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl005, 2*2, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_asm001, 2*4, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_asm002, v_p_mtl014, 2*4, v_neg);
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_asm002, v_em_con001_a, 2*0.35, v_neg);

  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_wda001, '2026-03-25', 'cerrada', 2, 2, v_loc_assy, v_tanda2, v_neg) returning id into v_p_wda001;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_wda001, v_p_wod005, 2, v_neg);
  insert into consumo_produccion (produccion_id, entrada_material_id, cantidad, negocio_id) values (v_p_wda001, v_em_wod020_a, 2*3.60, v_neg);

  -- Nivel 4 (ensamblaje estructural), 2026-03-26
  insert into producciones_semielaborado (semielaborado_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, tanda_id, negocio_id)
    values (v_sf_str001, '2026-03-26', 'cerrada', 2, 2, v_loc_assy, v_tanda2, v_neg) returning id into v_p_str001;
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_asm002, 2, v_neg);
  insert into consumo_produccion (produccion_id, produccion_origen_id, cantidad, negocio_id) values (v_p_str001, v_p_wda001, 2, v_neg);

  raise notice 'Producción Mes 1 (semielaborado): 17 lotes cerrados, cadena de 4 niveles trazada hasta materia prima.';

  -- ===========================================================================================
  -- 4. PRODUCCIÓN DE PRODUCTO FINAL
  -- ===========================================================================================

  -- Mesa: se fabrica solo 1 (de las 2 que pedirá el Pedido de Venta 1) — la 2ª queda pendiente para Mes 2.
  -- pedido_id se enlaza más abajo tras crear el pedido de venta.

  -- Sillas: 3 unidades (2 para el pedido B2B, 1 para venta B2C)
  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
    values (v_pf_c001, '2026-03-27', 'cerrada', 3, 3, v_loc_fg, v_neg) returning id into v_p_pf_c001;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_mtl012, 3*4, v_neg);
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_c001, v_p_wod008, 3*1, v_neg);

  insert into producciones_producto_final (producto_final_id, fecha, estado, cantidad_producida, cantidad_objetivo, ubicacion_id, negocio_id)
    values (v_pf_t001, '2026-03-30', 'cerrada', 1, 1, v_loc_fg, v_neg) returning id into v_p_pf_t001;
  insert into consumo_produccion_pf (produccion_pf_id, produccion_origen_id, cantidad, negocio_id) values (v_p_pf_t001, v_p_str001, 1, v_neg);

  raise notice 'Producción Mes 1 (producto final): 2 lotes cerrados (1 mesa, 3 sillas). Total producciones del mes = 19.';

  -- ===========================================================================================
  -- 5. VENTAS: 18 pedidos de venta (3 con ciclo completo, 15 en cartera/backlog)
  -- ===========================================================================================

  -- O1: hotel B2B — 2 mesas, se entrega y factura solo 1 (cumplimiento parcial, sigue abierto en Mes 2)
  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_cli_b2b[1], '2026-03-03', '2026-03-31', 'pendiente', '[FASE06-M1] Pedido inicial de mesas', v_neg) returning id into v_pv1;
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    values (v_pv1, v_pf_t001, 2, v_precio_t001, v_neg) returning id into v_lpv1;

  -- vincula la producción de la mesa a este pedido (columna real, ver informe: activa el estado 'en_produccion')
  update producciones_producto_final set pedido_id = v_pv1 where id = v_p_pf_t001;

  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    values (v_cli_b2b[1], '2026-03-31', 'DN-ALP-260001', 'pedido_planificado', v_neg) returning id into v_av1;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av1, v_pf_t001, v_p_pf_t001, 1, v_precio_t001, v_lpv1, v_neg);

  insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[1], '2026-03-31', v_precio_t001, v_neg) returning id into v_fv1;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv1, v_av1, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[1], '2026-03-31', 400.00, 'transferencia', v_neg) returning id into v_pago_cli1;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago_cli1, v_fv1, 400.00, v_neg);
  -- factura 750.00, cobrado 400.00 -> saldo pendiente 350.00 hacia Mes 2

  -- O2: B2B — 2 sillas, ciclo completo y cobrado
  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_cli_b2b[2], '2026-03-20', '2026-03-28', 'pendiente', '[FASE06-M1] Pedido de sillas', v_neg) returning id into v_pv2;
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    values (v_pv2, v_pf_c001, 2, v_precio_c001, v_neg) returning id into v_lpv2;

  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    values (v_cli_b2b[2], '2026-03-27', 'DN-ALP-260002', 'pedido_planificado', v_neg) returning id into v_av2;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av2, v_pf_c001, v_p_pf_c001, 2, v_precio_c001, v_lpv2, v_neg);

  insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2b[2], '2026-03-28', 2*v_precio_c001, v_neg) returning id into v_fv2;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv2, v_av2, v_neg);
  insert into pagos (cliente_id, fecha, monto, metodo, negocio_id) values (v_cli_b2b[2], '2026-03-29', 2*v_precio_c001, 'tarjeta', v_neg) returning id into v_pago_cli2;
  insert into pago_aplicacion (pago_id, factura_venta_id, monto_aplicado, negocio_id) values (v_pago_cli2, v_fv2, 2*v_precio_c001, v_neg);

  -- O3: B2C walk-in — 1 silla, entregada y facturada, SIN COBRAR (queda pendiente hacia Mes 2)
  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id)
    values (v_cli_b2c[1], '2026-03-25', '2026-03-28', 'pendiente', '[FASE06-M1] Venta directa de silla', v_neg) returning id into v_pv3;
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    values (v_pv3, v_pf_c001, 1, v_precio_c001, v_neg) returning id into v_lpv3;

  insert into albaranes_venta (cliente_id, fecha, numero_albaran, tipo_venta, negocio_id)
    values (v_cli_b2c[1], '2026-03-27', 'DN-ALP-260003', 'pedido_planificado', v_neg) returning id into v_av3;
  insert into lineas_albaran_venta (albaran_venta_id, producto_final_id, produccion_pf_id, cantidad, precio_unitario, linea_pedido_id, negocio_id)
    values (v_av3, v_pf_c001, v_p_pf_c001, 1, v_precio_c001, v_lpv3, v_neg);

  insert into facturas_venta (cliente_id, fecha, total, negocio_id) values (v_cli_b2c[1], '2026-03-28', v_precio_c001, v_neg) returning id into v_fv3;
  insert into factura_venta_albaran (factura_venta_id, albaran_venta_id, negocio_id) values (v_fv3, v_av3, v_neg);
  -- deliberadamente sin pago: factura impagada hacia Mes 2

  raise notice 'Ventas Mes 1 (ciclo completo): 3 pedidos, 3 albaranes, 3 facturas, 2 pagos (1 parcial, 1 completo, 1 factura sin cobrar).';

  -- Backlog: 15 pedidos de venta más, sin producción/entrega todavía (demanda acumulada para Mes 2-3)
  insert into pedidos_venta (cliente_id, fecha, fecha_entrega_prevista, estado, notas, negocio_id) values
    (v_cli_b2b[3], '2026-03-04', '2026-04-10', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[4], '2026-03-05', '2026-04-11', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[5], '2026-03-09', '2026-04-14', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[6], '2026-03-11', '2026-04-16', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[7], '2026-03-13', '2026-04-18', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2c[2], '2026-03-16', '2026-04-01', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2c[3], '2026-03-18', '2026-04-03', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[1], '2026-03-19', '2026-04-20', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[2], '2026-03-23', '2026-04-22', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[3], '2026-03-24', '2026-04-24', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[4], '2026-03-25', '2026-04-27', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[5], '2026-03-26', '2026-04-29', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[6], '2026-03-27', '2026-04-30', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[7], '2026-03-30', '2026-05-04', 'pendiente', '[FASE06-M1] Backlog', v_neg),
    (v_cli_b2b[1], '2026-03-31', '2026-05-05', 'pendiente', '[FASE06-M1] Backlog con servicio adicional', v_neg);

  -- líneas del backlog (una línea de producto por pedido, en el mismo orden que los 15 inserts anteriores)
  insert into lineas_pedido_venta (pedido_id, producto_final_id, cantidad, precio_unitario, negocio_id)
    select pv.id, x.producto_final_id, x.cantidad, pf.precio_venta, v_neg
    from (
      select row_number() over (order by pv.id) as rn, pv.id
      from pedidos_venta pv
      where pv.negocio_id = v_neg and pv.notas like '[FASE06-M1] Backlog%'
    ) pv
    join (values
      (1, v_pf_b001, 1), (2, v_pf_s001, 3), (3, v_pf_c002, 2), (4, v_pf_t002, 1), (5, v_pf_bar001, 1),
      (6, v_pf_c003, 1), (7, v_pf_s002, 2), (8, v_pf_b002, 1), (9, v_pf_c004, 4), (10, v_pf_t003, 1),
      (11, v_pf_s004, 2), (12, v_pf_bar002, 1), (13, v_pf_c006, 3), (14, v_pf_s001, 1), (15, v_pf_c002, 1)
    ) as x(rn, producto_final_id, cantidad) on x.rn = pv.rn
    join productos_finales pf on pf.id = x.producto_final_id;

  -- línea de servicio en texto libre para el último pedido del backlog (variedad de tipos de línea)
  insert into lineas_pedido_venta (pedido_id, descripcion, cantidad, precio_unitario, negocio_id)
    select pv.id, 'Instalación y montaje en sitio', 1, 90.00, v_neg
    from pedidos_venta pv
    where pv.negocio_id = v_neg and pv.notas = '[FASE06-M1] Backlog con servicio adicional';

  raise notice 'Ventas Mes 1 (backlog): 15 pedidos adicionales creados, todos en estado pendiente, demanda acumulada para Mes 2.';
  raise notice 'FASE 06 MES 1 sembrada correctamente para AlpenWerk (negocio_id=%).', v_neg;
end $$;

commit;
