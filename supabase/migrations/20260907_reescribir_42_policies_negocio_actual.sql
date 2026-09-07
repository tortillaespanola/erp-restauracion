-- CONTRATO_MULTITENANT.md, Tarea 2: sustituir el UUID fijo por negocio_actual() en las 42
-- policies "Acceso total temporal" que ya particionan el esquema por negocio_id (ver
-- 20260807_negocio_id_particion.sql). No se toca ninguna otra cosa -- ni GRANT, ni RLS on/off,
-- ni el resto de la condición.
--
-- (select auth.role()) y (select negocio_actual()), ambos envueltos en select: son funciones
-- sin argumentos, no correlacionadas con la fila -- sin envolver, Postgres puede re-evaluarlas
-- fila a fila; envueltas se resuelven como InitPlan, una sola vez por consulta. Verificado con
-- EXPLAIN ANALYZE antes de aplicar esto en firme (ver feedback_test_rls_authenticated.md para
-- el patrón de prueba): el plan "antes" mostraba ambas funciones dentro del Filter; el plan
-- "después" muestra dos InitPlan separados, cada uno con loops=1.
--
-- Se mantiene "auth.role() = 'authenticated' and" delante -- no se sustituye por
-- negocio_actual() como única puerta, para no cambiar el comportamiento de denegación
-- silenciosa (RLS) frente a un hipotético rol no autenticado por el error ruidoso que
-- lanzaría negocio_actual() en su lugar (hoy no hay ninguna ruta que use el rol anon, pero no
-- se cambia ese comportamiento sin que se pida explícitamente).
--
-- Generado por script (DO block), no 42 ALTER POLICY escritos a mano -- mismo criterio que ya
-- sugería el propio contrato para minimizar el riesgo de error humano copiando 42 veces. El
-- array se escribe a mano una vez, no se genera dinámicamente desde information_schema, para
-- que sirva de lista auditable de qué se tocó.
--
-- Probado exhaustivamente en BEGIN...ROLLBACK antes de aplicar esto en firme: transparencia
-- total hoy (mismos conteos exactos, en 7 tablas de dominios distintos, antes y después),
-- aislamiento cruzado limpio contra un negocio B ficticio (0 filas visibles en las 7 tablas
-- muestreadas), y el EXPLAIN ANALYZE ya mencionado.
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
    execute format(
      'alter policy %I on %I using ((select auth.role()) = ''authenticated'' and negocio_id = (select negocio_actual())) with check ((select auth.role()) = ''authenticated'' and negocio_id = (select negocio_actual()))',
      'Acceso total temporal', t
    );
  end loop;
end $$;
