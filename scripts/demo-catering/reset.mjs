// CONTRATO_MULTITENANT.md, negocio demo "Demo Catering Basel": borra TODOS los datos de
// negocio de este negocio_id (no toca `negocios`, `usuarios_negocios` ni `empresa_config` --
// el login y el negocio en si sobreviven entre resets) para poder regenerar un dataset limpio
// con poblar.mjs antes de cada demo, sin arrastrar datos de una ejecucion anterior.
//
// Orden inverso de dependencias (hijos antes que padres) para no chocar con ninguna FK.
// Requiere SUPABASE_DB_URL en frontend/.env.local (conexion directa de superusuario -- esto
// corre fuera de cualquier sesion de usuario real, igual que todas las migraciones de este
// contrato).
import pg from 'pg'
import fs from 'fs'

const NEGOCIO_DCB = '0af92cc9-606c-472c-b035-92b9bb238ddd'
// "Cliente demo" vive fuera del historico a proposito -- para crear pedidos nuevos en una demo
// en vivo sin mezclarlos con los clientes reales del catalogo (Novartis Basel, Roche Events,
// etc.). Debe sobrevivir a cualquier reset, igual que negocios/usuarios_negocios/empresa_config/
// el usuario de Auth -- excluido aqui por id conocido, no solo confiando en su negocio_id (que
// comparte con todo lo demas que SI se borra). Si esta fila se pierde alguna vez, hay que
// recrearla a mano y actualizar este id.
const CLIENTE_DEMO_ID = 117

const envContent = fs.readFileSync(new URL('../../frontend/.env.local', import.meta.url), 'utf8')
const connStr = envContent.match(/SUPABASE_DB_URL=(.+)/)[1].trim()
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
await client.connect()

const TABLAS_EN_ORDEN_INVERSO = [
  'incidencias_reparto_pedido',
  'incidencias_stock_articulo',
  'incidencias_stock_producto_final',
  'incidencias_stock_semielaborado',
  'pago_aplicacion',
  'pagos',
  'factura_venta_albaran',
  'facturas_venta',
  'factura_compra_albaran',
  'facturas_compra',
  'ajustes_producto_final',
  'ajustes_semielaborado',
  'ajustes_articulo',
  'previsiones_distribucion_pf',
  'lineas_albaran_venta',
  'albaranes_venta',
  'consumo_produccion_pf',
  'producciones_producto_final',
  'consumo_produccion',
  'producciones_semielaborado',
  'lineas_pedido_venta',
  'pedidos_venta',
  'entrada_material',
  'lineas_pedido_compra',
  'albaranes_compra',
  'pedidos_compra',
  'receta_producto_final',
  'receta_semielaborado',
  'productos_finales',
  'semielaborados',
  'articulo_ingrediente',
  'ingredientes',
  'articulo_proveedor',
  'articulos_compra',
  'clientes',
  'proveedores',
  'categorias_articulo',
  'unidades_medida',
  'tandas_produccion',
  'ubicaciones',
  'secuencias_lote',
  'facturas_venta_secuencia',
]

try {
  await client.query('BEGIN')
  for (const tabla of TABLAS_EN_ORDEN_INVERSO) {
    const sql = tabla === 'clientes'
      ? `delete from clientes where negocio_id = $1 and id <> $2`
      : `delete from ${tabla} where negocio_id = $1`
    const params = tabla === 'clientes' ? [NEGOCIO_DCB, CLIENTE_DEMO_ID] : [NEGOCIO_DCB]
    const r = await client.query(sql, params)
    if (r.rowCount > 0) console.log(`${tabla}: ${r.rowCount} filas borradas`)
  }
  await client.query('COMMIT')
  console.log('\nReset completo. negocios / usuarios_negocios / empresa_config intactos -- el login sigue funcionando. "Cliente demo" (id ' + CLIENTE_DEMO_ID + ') preservado.')
} catch (e) {
  console.error('FALLO, revirtiendo todo:', e.message)
  await client.query('ROLLBACK').catch(() => {})
  process.exitCode = 1
} finally {
  await client.end()
}
