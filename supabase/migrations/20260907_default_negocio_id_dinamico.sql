-- CONTRATO_MULTITENANT.md, Tarea 6: las 42 tablas particionadas por negocio_id (Tarea 2)
-- seguian con `default 'a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00'::uuid` -- el UUID fijo original,
-- sin relacion con negocio_actual() (Tarea 1). Un INSERT sin negocio_id explicito caeria
-- siempre en ese negocio, sin importar el negocio real del usuario que lo ejecuta -- correcto
-- solo mientras existiera un unico negocio.
--
-- Verificado antes de aplicar esto (sin tocarlo aun):
-- 1. Las 42 tienen exactamente el mismo default fijo, confirmado contra pg_attrdef en vivo.
-- 2. negocio_actual() sin membresia falla con una excepcion visible (P0001), nunca un
--    negocio_id nulo o silencioso -- probado insertando como un usuario huerfano.
-- 3. No hay ningun proceso sin sesion de usuario real (sin service_role en frontend, sin
--    supabase/functions, sin pg_cron, sin scripts sueltos) que inserte en estas 42 tablas hoy.
--    Los INSERT automaticos via trigger (consumo_produccion, consumo_produccion_pf,
--    incidencias_stock_*, incidencias_reparto_pedido, previsiones_distribucion_pf) corren
--    siempre dentro de la misma transaccion que la accion del usuario autenticado que los
--    dispara -- auth.uid() es una variable de sesion, no se pierde por estar dentro de un
--    trigger ni por SECURITY DEFINER. Probado especificamente sobre una tabla en cascada
--    (incidencias_reparto_pedido, disparada por un INSERT en lineas_albaran_venta via
--    trg_registrar_incidencia_reparto_pedido): la fila insertada automaticamente por el
--    trigger, sin que este especificara negocio_id, aterrizo con el negocio_id correcto del
--    usuario que disparo la cascada -- mismo comportamiento que en articulos_compra.
--    Advertencia para el futuro (no un caso existente): cualquier migracion o script nuevo que
--    inserte en estas 42 tablas sin sesion de usuario real (como corren las migraciones, con
--    psql/superusuario) debe pasar negocio_id explicito de ahora en adelante -- confiar en el
--    default ya no vale fuera de una sesion autenticada real.
--
-- Generado por script (DO block), mismo array auditable que la migracion de Tarea 2 -- no se
-- toca NOT NULL ni ninguna otra propiedad de la columna, solo el DEFAULT.
do $$
declare
  t text;
  tablas text[] := array[
    'ajustes_articulo','ajustes_producto_final','ajustes_semielaborado','albaranes_compra',
    'albaranes_venta','articulo_ingrediente','articulo_proveedor','articulos_compra',
    'categorias_articulo','clientes','consumo_produccion','consumo_produccion_pf',
    'empresa_config','entrada_material','factura_compra_albaran','factura_venta_albaran',
    'facturas_compra','facturas_venta','incidencias_reparto_pedido','incidencias_stock_articulo',
    'incidencias_stock_producto_final','incidencias_stock_semielaborado','ingredientes',
    'lineas_albaran_venta','lineas_pedido_compra','lineas_pedido_venta','pago_aplicacion',
    'pagos','pedidos_compra','pedidos_venta','previsiones_distribucion_pf',
    'producciones_producto_final','producciones_semielaborado','productos_finales',
    'proveedores','receta_producto_final','receta_semielaborado','secuencias_lote',
    'semielaborados','tandas_produccion','ubicaciones','unidades_medida'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table %I alter column negocio_id set default negocio_actual()', t);
  end loop;
end $$;
