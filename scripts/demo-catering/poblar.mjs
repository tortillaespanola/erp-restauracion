// CONTRATO_MULTITENANT.md, negocio demo "Demo Catering Basel" (Tarea de verificacion final /
// alta del segundo negocio real): puebla el negocio demo con un catalogo e historico
// transaccional realistas de un catering en Basilea -- proveedores, articulos, ingredientes,
// recetas, semielaborados, productos finales, clientes, y 8 semanas de actividad (1 semana de
// aprovisionamiento inicial + 7 semanas de operacion: compras, producciones, ventas, facturas
// y pagos).
//
// Decisiones de diseño (ver conversacion completa para el razonamiento):
// - Todo el contenido (nombres, notas, descripciones) en ingles -- audiencia internacional.
//   Los valores fijos de CHECK constraints (motivo_categoria, tipo_venta, etc.) son parte del
//   esquema, no contenido del negocio, y se quedan en español como en el resto del proyecto.
// - negocio_id explicito en CADA insert -- este script corre sin sesion de usuario real, no
//   puede confiar en ningun DEFAULT que dependa de negocio_actual() (regla de Tarea 6).
// - ubicacion_id tambien explicito siempre -- su DEFAULT sigue siendo el UUID fijo de negocio A
//   (Tarea 6 solo toco los DEFAULT de negocio_id, no el de otras FK), confiar en el hariia
//   apuntar produccion del negocio demo al almacen de negocio A.
// - Producciones en dos pasos (insert 'abierta' -> consumo -> UPDATE a 'cerrada') para que
//   calcular_fecha_caducidad_pf/semi calcule la caducidad sola, igual que en el flujo real.
// - previsiones_distribucion_pf deliberadamente vacio: lineas_albaran_venta.linea_pedido_id se
//   deja NULL, así el panel de "Producciones del dia" no arrastra nada de este historico (ver
//   conversacion: confirmado leyendo PedidosDelDia.jsx que su query principal filtra por
//   pedidos_venta.estado in ('pendiente','en_produccion') -- todo el historico se cierra a
//   'servido' al final de este script para que ese panel arranque limpio). Por el mismo motivo,
//   producciones_producto_final.pedido_id TAMPOCO se enlaza a su pedido_venta: hacerlo dispara
//   registrar_incidencia_reparto_pedido() (trigger en lineas_albaran_venta) en CADA venta,
//   porque compara ese pedido_id contra el que se deduciria de linea_pedido_id -- que siempre es
//   NULL aqui -- y los declara "distintos" sin que haya ningun desajuste real. Confirmado en la
//   practica: la primera ejecucion completa genero 46 incidencias de reparto falsas, una por
//   cada linea de venta, antes de quitar este enlace.
// - FIFO llevado a mano en JS (arrays de lotes con cantidad_restante), no en SQL -- mismo
//   criterio que usa el frontend real (confirmado: la UI tampoco asigna FIFO automatico).
// - Las recetas (receta_semielaborado/receta_producto_final) son estructuralmente reales y
//   consultables desde la pantalla de Recetas, pero el consumo real de cada produccion
//   historica NO reexplota la receta linea a linea -- consume cantidades razonables de los
//   mismos ingredientes de la receta, simplificacion deliberada para mantener el script
//   manejable (la tabla consumo_produccion(_pf) no esta obligada a coincidir 1:1 con
//   receta_semielaborado/receta_producto_final, son conceptos independientes en este esquema).
//
// Envuelto en una unica transaccion BEGIN...COMMIT (no ALTER de esquema, solo DML, aislado por
// negocio_id -- ver conversacion para el porque de no hacer un dry-run en ROLLBACK aparte:
// las columnas id son identity y no revierten su secuencia en un ROLLBACK).
import pg from 'pg'
import fs from 'fs'

const NEGOCIO_DCB = '0af92cc9-606c-472c-b035-92b9bb238ddd'
const USUARIO_DCB = 'd5a6696d-2d14-4ed6-a8d2-3fd38dc3382c'

const envContent = fs.readFileSync(new URL('../../frontend/.env.local', import.meta.url), 'utf8')
const connStr = envContent.match(/SUPABASE_DB_URL=(.+)/)[1].trim()
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
await client.connect()

// ---------- helpers ----------
async function ins(tabla, obj) {
  const cols = Object.keys(obj)
  const vals = Object.values(obj)
  const ph = cols.map((_, i) => `$${i + 1}`).join(',')
  const r = await client.query(`insert into ${tabla} (${cols.join(',')}) values (${ph}) returning *`, vals)
  return r.rows[0]
}
async function upd(tabla, id, obj) {
  const cols = Object.keys(obj)
  const vals = Object.values(obj)
  const set = cols.map((c, i) => `${c}=$${i + 1}`).join(',')
  const r = await client.query(`update ${tabla} set ${set} where id=$${cols.length + 1} returning *`, [...vals, id])
  return r.rows[0]
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function pick(arr, i) {
  return arr[i % arr.length]
}
// Inserta una fila de consumo_produccion/consumo_produccion_pf, sea el origen un lote de
// entrada_material o (si alguna receta futura encadenara semielaborado <- semielaborado) otra
// produccion ya cerrada -- las recetas actuales solo usan la primera rama, pero ambas quedan
// correctas por si se añade una receta semi<-semi.
async function insertarConsumo(tabla, campoDestino, destinoId, c) {
  const base = { [campoDestino]: destinoId, cantidad: c.cantidad, negocio_id: NEGOCIO_DCB }
  if (c.ref.entrada_material_id) return ins(tabla, { ...base, entrada_material_id: c.ref.entrada_material_id })
  return ins(tabla, { ...base, produccion_origen_id: c.ref.produccion_origen_id })
}

// Consume de una lista de lotes [{ref, fecha, restante, fechaCaducidad}] en orden FIFO (mas
// antiguo primero) -- pero un lote cuya fechaCaducidad ya paso respecto a fechaLimite (la fecha
// de la produccion/venta que lo consumiria) se SALTA, no se consume. Sin esto, un lote inicial
// de baja rotacion que nunca agota su cantidad por si solo queda como "el mas antiguo
// disponible" para siempre, y el FIFO lo seguiria usando semanas despues de caducado --
// confirmado en la practica (hasta 41 dias tarde) antes de este fix. Un lote saltado por
// caducidad simplemente no cuenta como stock disponible -- si no queda ningun lote fresco
// suficiente, la funcion lanza el mismo error de "stock insuficiente" que ya existia, señal
// correcta de que hace falta una compra/produccion mas reciente, no de agrandar el lote viejo.
function consumirFIFO(lotes, cantidadNecesaria, etiqueta, fechaLimite) {
  let falta = cantidadNecesaria
  const consumos = []
  for (const lote of lotes) {
    if (falta <= 0) break
    if (lote.restante <= 0) continue
    if (fechaLimite && lote.fechaCaducidad && lote.fechaCaducidad < fechaLimite) continue
    // El propio trigger de Postgres (check_consumo_produccion(_pf)/check_stock_producto_final)
    // rechaza consumir un lote cuya fecha es POSTERIOR a la fecha de destino -- confirmado en la
    // practica que hace falta replicar esta misma regla aqui: el orden de este script procesa
    // toda la compra de una semana (lunes Y jueves) antes que sus eventos de venta, asi que sin
    // este chequeo el array podia "ver" un lote de jueves como disponible para un evento de
    // miercoles anterior. Son triggers DEFERRABLE (se evaluan al COMMIT, no en cada INSERT), asi
    // que sin este chequeo el fallo aparecia tarde y confuso, al final del script.
    if (fechaLimite && lote.fecha > fechaLimite) continue
    const tomar = Math.min(lote.restante, falta)
    lote.restante -= tomar
    falta -= tomar
    consumos.push({ ref: lote.ref, cantidad: Number(tomar.toFixed(3)) })
  }
  if (falta > 0.001) {
    throw new Error(`Stock insuficiente (fresco) simulando "${etiqueta}" en ${fechaLimite}: faltan ${falta.toFixed(2)} unidades`)
  }
  return consumos
}

// Trackers de stock FIFO en memoria -- declarados arriba porque se usan (stockTotal) desde el
// punto de reposicion de compras, antes de que existiera la seccion 6 original.
const stockArticulo = {} // nombre -> [{ref:{entrada_material_id}, fecha, restante}]
const stockSemi = {} // nombre -> [{ref:{produccion_origen_id}, fecha, restante}]
const stockPF = {} // nombre -> [{produccion_pf_id, fecha, restante}]

try {
  await client.query('BEGIN')
  // generar_codigo() (Tarea 7) resuelve el negocio internamente via negocio_actual(), no toma
  // negocio_id de la fila que se esta insertando -- necesita una sesion real, igual que todas
  // las pruebas de este contrato (SET LOCAL ROLE solo no basta, hace falta el JWT simulado
  // completo). Todos los negocio_id explicitos del resto del script coinciden con lo que
  // negocio_actual() resuelve para USUARIO_DCB, asi que las policies RLS (ya activas al pasar a
  // rol authenticated) no bloquean nada.
  await client.query('SET LOCAL ROLE authenticated')
  await client.query(`SET LOCAL request.jwt.claim.sub = '${USUARIO_DCB}'`)
  await client.query(`SET LOCAL request.jwt.claim.role = 'authenticated'`)

  // ============================================================
  // 1. Catalogo maestro (unidades, categorias, ubicaciones, proveedores, clientes)
  // ============================================================
  console.log('=== 1. Catalogo maestro ===')

  const unidad = {}
  for (const u of [
    { codigo: 'kg', nombre: 'Kilogram', tipo: 'peso' },
    { codigo: 'l', nombre: 'Liter', tipo: 'volumen' },
    { codigo: 'ud', nombre: 'Unit', tipo: 'unidad' },
  ]) {
    const row = await ins('unidades_medida', { ...u, negocio_id: NEGOCIO_DCB })
    unidad[u.codigo] = row.id
  }

  const categoria = {}
  for (const c of [
    { nombre: 'Meat', acronimo: 'MEA' },
    { nombre: 'Fish', acronimo: 'FIS' },
    { nombre: 'Vegetables & Fruit', acronimo: 'VEG' },
    { nombre: 'Dairy', acronimo: 'DAI' },
    { nombre: 'Dry Goods & Pantry', acronimo: 'DRY' },
    { nombre: 'Beverages', acronimo: 'BEV' },
  ]) {
    const row = await ins('categorias_articulo', { ...c, negocio_id: NEGOCIO_DCB })
    categoria[c.nombre] = row.id
  }

  const ubicacion = {}
  for (const u of [
    { nombre: 'Central Warehouse Basel', tipo: 'almacen' },
    { nombre: 'Central Kitchen', tipo: 'centro_produccion' },
  ]) {
    const row = await ins('ubicaciones', { ...u, negocio_id: NEGOCIO_DCB })
    ubicacion[u.nombre] = row.id
  }

  const proveedor = {}
  for (const nombre of ['Basel Quality Meats', 'Basel Fresh Produce', 'Basel Dairy Co.', 'Basel Bakery Supply', 'Nordwest Beverages']) {
    const row = await ins('proveedores', { nombre_comercial: nombre, negocio_id: NEGOCIO_DCB })
    proveedor[nombre] = row.id
  }

  const cliente = {}
  for (const c of [
    { nombre: 'Novartis Basel', tipo: 'empresa' },
    { nombre: 'Roche Events', tipo: 'empresa' },
    { nombre: 'University of Basel', tipo: 'empresa' },
    { nombre: 'Meier Family Wedding', tipo: 'particular' },
    { nombre: 'Weber Private Event', tipo: 'particular' },
  ]) {
    const row = await ins('clientes', { ...c, negocio_id: NEGOCIO_DCB })
    cliente[c.nombre] = row.id
  }
  console.log('Unidades, categorias, ubicaciones, proveedores y clientes creados.')

  // ============================================================
  // 2. Articulos de compra + articulo_proveedor
  // ============================================================
  console.log('\n=== 2. Articulos de compra ===')

  const ARTICULOS_DEF = [
    ['Chicken Breast', 'Meat', 'kg', 'RM', 14.5, 'Basel Quality Meats'],
    ['Beef Sirloin', 'Meat', 'kg', 'RM', 32.0, 'Basel Quality Meats'],
    ['Salmon Fillet', 'Fish', 'kg', 'RM', 28.0, 'Basel Quality Meats'],
    ['Tomatoes', 'Vegetables & Fruit', 'kg', 'RM', 3.2, 'Basel Fresh Produce'],
    ['Onions', 'Vegetables & Fruit', 'kg', 'RM', 1.8, 'Basel Fresh Produce'],
    ['Potatoes', 'Vegetables & Fruit', 'kg', 'RM', 1.5, 'Basel Fresh Produce'],
    ['Garlic', 'Vegetables & Fruit', 'kg', 'RM', 6.0, 'Basel Fresh Produce'],
    ['Whole Milk', 'Dairy', 'l', 'RM', 1.6, 'Basel Dairy Co.'],
    ['Cheese', 'Dairy', 'kg', 'RM', 18.0, 'Basel Dairy Co.'],
    ['Heavy Cream', 'Dairy', 'l', 'RM', 6.5, 'Basel Dairy Co.'],
    ['Butter', 'Dairy', 'kg', 'RM', 9.8, 'Basel Dairy Co.'],
    ['Flour', 'Dry Goods & Pantry', 'kg', 'RM', 1.9, 'Basel Bakery Supply'],
    ['Rice', 'Dry Goods & Pantry', 'kg', 'RM', 3.4, 'Basel Bakery Supply'],
    ['Pasta', 'Dry Goods & Pantry', 'kg', 'RM', 2.6, 'Basel Bakery Supply'],
    ['Olive Oil', 'Dry Goods & Pantry', 'l', 'RM', 12.0, 'Basel Bakery Supply'],
    ['Mixed Spices', 'Dry Goods & Pantry', 'kg', 'AUX', 22.0, 'Basel Bakery Supply'],
    ['Black Pepper', 'Dry Goods & Pantry', 'kg', 'AUX', 35.0, 'Basel Bakery Supply'],
    ['Bread Rolls', 'Dry Goods & Pantry', 'ud', 'RM', 0.6, 'Basel Bakery Supply'],
    ['Baguette', 'Dry Goods & Pantry', 'ud', 'RM', 2.2, 'Basel Bakery Supply'],
    ['White Wine', 'Beverages', 'l', 'RM', 9.5, 'Nordwest Beverages'],
    ['Beer', 'Beverages', 'l', 'RM', 2.8, 'Nordwest Beverages'],
    ['Mineral Water', 'Beverages', 'l', 'RM', 0.9, 'Nordwest Beverages'],
  ]
  // Dias de caducidad orientativos por categoria (almacenamiento profesional refrigerado/al
  // vacio, no nevera domestica -- rangos realistas de cocina de catering), para
  // entrada_material.fecha_caducidad.
  const CADUCIDAD_DIAS_POR_CATEGORIA = {
    Meat: 12, Fish: 8, 'Vegetables & Fruit': 12, Dairy: 20, 'Dry Goods & Pantry': 180, Beverages: 365,
  }
  // Umbral de reposicion: no comprar mas de un articulo si ya queda stock por encima de este
  // nivel -- evita que un articulo de baja rotacion (ej. un ingrediente que solo usa una receta)
  // se sobre-compre semana tras semana y el lote mas antiguo quede "vivo" en el FIFO mucho mas
  // alla de su caducidad real (habria generado incidencias de caducidad falsas sin ningun
  // beneficio de realismo).
  // Solo cuenta como "stock disponible" los lotes que seguiran frescos en fechaReferencia --
  // un lote ya caducado (o a punto de estarlo) no debe evitar una reposicion nueva solo porque
  // numericamente todavia le queda `restante`, o el punto de reorden nunca se dispararia para
  // un articulo de baja rotacion con un lote viejo caducado sentado en el tracker.
  function stockTotal(nombre, fechaReferencia) {
    return stockArticulo[nombre].reduce((suma, l) => {
      if (fechaReferencia && l.fechaCaducidad && l.fechaCaducidad < fechaReferencia) return suma
      return suma + l.restante
    }, 0)
  }

  const articulo = {} // nombre -> { id, unidad, precio, categoria, proveedor }
  for (const [nombre, cat, u, tipoMat, precio, prov] of ARTICULOS_DEF) {
    const row = await ins('articulos_compra', {
      nombre, categoria_id: categoria[cat], unidad_id: unidad[u], tipo_material: tipoMat,
      precio_referencia: precio, negocio_id: NEGOCIO_DCB,
    })
    articulo[nombre] = { id: row.id, unidad: u, precio, categoria: cat, proveedor: prov }
    stockArticulo[nombre] = []
    await ins('articulo_proveedor', {
      articulo_id: row.id, proveedor_id: proveedor[prov], precio, preferente: true,
      referencia_proveedor: `${prov.split(' ')[0].toUpperCase()}-${row.id}`, negocio_id: NEGOCIO_DCB,
    })
  }
  console.log(`${ARTICULOS_DEF.length} articulos de compra creados, cada uno con su articulo_proveedor.`)

  // ============================================================
  // 3. Ingredientes + articulo_ingrediente
  // ============================================================
  console.log('\n=== 3. Ingredientes ===')
  const INGREDIENTES_DEF = ['Chicken Breast', 'Tomatoes', 'Onions', 'Garlic', 'Olive Oil', 'Cheese', 'Heavy Cream', 'White Wine', 'Flour', 'Potatoes']
  const ingrediente = {} // nombre articulo -> ingrediente_id
  for (const nombreArticulo of INGREDIENTES_DEF) {
    const a = articulo[nombreArticulo]
    const nombreIngrediente = nombreArticulo.replace(/s$/, '') // singular simple: Tomatoes->Tomatoe (aceptable, ver nota abajo)
    const row = await ins('ingredientes', {
      nombre: nombreIngrediente === 'Tomatoe' ? 'Tomato' : nombreIngrediente === 'Onione' ? 'Onion' : nombreIngrediente === 'Potatoe' ? 'Potato' : nombreIngrediente,
      categoria_id: categoria[a.categoria], unidad_id: unidad[a.unidad], negocio_id: NEGOCIO_DCB,
    })
    ingrediente[nombreArticulo] = row.id
    await ins('articulo_ingrediente', { articulo_id: a.id, ingrediente_id: row.id, negocio_id: NEGOCIO_DCB })
  }
  console.log(`${INGREDIENTES_DEF.length} ingredientes creados y vinculados a su articulo.`)

  // ============================================================
  // 4. Semielaborados + receta_semielaborado
  // ============================================================
  console.log('\n=== 4. Semielaborados ===')
  // dias de caducidad: 7 en los 6 -- uno de cada grupo de 3 solo se produce una vez por semana
  // (martes o viernes, ver seccion 8), asi que necesita seguir fresco hasta la produccion mas
  // tardia de esa misma semana (hasta el sabado) -- con 3-5 dias, la mitad de las producciones
  // de producto final tardias de la semana encontraban el lote ya caducado (confirmado en la
  // practica). 7 dias es razonable para una base/fondo refrigerado en cocina profesional.
  const SEMI_DEF = [
    ['Chicken Stock', 'l', 7, [['ingrediente', 'Chicken Breast', 2], ['ingrediente', 'Onions', 0.5]]],
    ['Bolognese Sauce', 'kg', 7, [['articulo', 'Beef Sirloin', 3], ['ingrediente', 'Tomatoes', 4]]],
    ['Paella Base', 'kg', 7, [['articulo', 'Rice', 5], ['ingrediente', 'Olive Oil', 0.5]]],
    ['Empanada Dough', 'kg', 7, [['ingrediente', 'Flour', 4], ['articulo', 'Butter', 1]]],
    ['Aioli', 'kg', 7, [['ingrediente', 'Olive Oil', 1], ['ingrediente', 'Garlic', 0.2]]],
    ['Vegetable Broth', 'l', 7, [['ingrediente', 'Onions', 1], ['ingrediente', 'Potatoes', 2]]],
  ]
  const semi = {} // nombre -> { id, unidad }
  for (const [nombre, u, diasCad, receta] of SEMI_DEF) {
    const row = await ins('semielaborados', { nombre, unidad_id: unidad[u], dias_caducidad_default: diasCad, negocio_id: NEGOCIO_DCB })
    semi[nombre] = { id: row.id, unidad: u }
    stockSemi[nombre] = []
    for (const [tipo, ref, cantidad] of receta) {
      const linea = { semielaborado_id: row.id, cantidad, negocio_id: NEGOCIO_DCB }
      if (tipo === 'articulo') linea.articulo_id = articulo[ref].id
      else linea.ingrediente_id = ingrediente[ref]
      await ins('receta_semielaborado', linea)
    }
  }
  console.log(`${SEMI_DEF.length} semielaborados creados con su receta.`)

  // ============================================================
  // 5. Productos finales + receta_producto_final
  // ============================================================
  console.log('\n=== 5. Productos finales ===')
  const PF_DEF = [
    ['Seafood Paella (tray)', 180, 2, [['semi', 'Paella Base', 2], ['articulo', 'Salmon Fillet', 1]]],
    ['Assorted Canapés', 120, 2, [['articulo', 'Cheese', 0.5], ['articulo', 'Baguette', 3]]],
    ['Beef Empanadas (dozen)', 60, 3, [['semi', 'Empanada Dough', 1.5], ['articulo', 'Beef Sirloin', 1]]],
    ['Caesar Salad (tray)', 70, 2, [['articulo', 'Tomatoes', 1], ['articulo', 'Cheese', 0.3]]],
    ['Bolognese Lasagna (tray)', 95, 3, [['semi', 'Bolognese Sauce', 2], ['articulo', 'Cheese', 0.5]]],
    ['Finger Food Menu', 150, 2, [['semi', 'Aioli', 0.3], ['articulo', 'Bread Rolls', 6]]],
    ['Apple Tart', 45, 3, [['articulo', 'Flour', 1], ['articulo', 'Butter', 0.4]]],
    ['Vegetarian Menu', 110, 3, [['semi', 'Vegetable Broth', 1], ['articulo', 'Rice', 1]]],
    ['Ham Croquettes', 55, 2, [['articulo', 'Whole Milk', 1], ['articulo', 'Flour', 0.5]]],
    ['Quiche Lorraine', 65, 3, [['articulo', 'Whole Milk', 0.5], ['articulo', 'Cheese', 0.4]]],
  ]
  const pf = {} // nombre -> { id, precio, receta }
  for (const [nombre, precio, diasCad, receta] of PF_DEF) {
    const row = await ins('productos_finales', { nombre, unidad_id: unidad.ud, precio_venta: precio, dias_caducidad_default: diasCad, negocio_id: NEGOCIO_DCB })
    pf[nombre] = { id: row.id, precio, receta, diasCad }
    stockPF[nombre] = []
    for (const [tipo, ref, cantidad] of receta) {
      const linea = { producto_final_id: row.id, cantidad, negocio_id: NEGOCIO_DCB }
      if (tipo === 'articulo') linea.articulo_id = articulo[ref].id
      else linea.ingrediente_semielaborado_id = semi[ref].id
      await ins('receta_producto_final', linea)
    }
  }
  console.log(`${PF_DEF.length} productos finales creados con su receta.`)

  // ============================================================
  // 6. Helper de consumo de receta (los trackers de stock ya se declararon al principio)
  // ============================================================
  // Consume un ingrediente/articulo de receta desde el pool que corresponda (articulo directo,
  // o ingrediente -- que comparte pool con su articulo vinculado -- o semi).
  function consumirIngredienteReceta(tipo, ref, cantidad, etiqueta, fechaLimite) {
    if (tipo === 'articulo' || tipo === 'ingrediente') {
      return { pool: 'articulo', consumos: consumirFIFO(stockArticulo[ref], cantidad, etiqueta, fechaLimite) }
    }
    return { pool: 'semi', consumos: consumirFIFO(stockSemi[ref], cantidad, etiqueta, fechaLimite) }
  }

  // ============================================================
  // 7. Semana 0: aprovisionamiento inicial (stock de partida)
  // ============================================================
  console.log('\n=== 7. Semana 0: aprovisionamiento inicial ===')
  const FECHA_INICIO_STOCK = '2026-07-13'

  const proveedoresUnicos = [...new Set(ARTICULOS_DEF.map((a) => a[5]))]
  for (const prov of proveedoresUnicos) {
    const articulosDeEsteProveedor = ARTICULOS_DEF.filter((a) => a[5] === prov)
    const pedido = await ins('pedidos_compra', {
      proveedor_id: proveedor[prov], fecha: FECHA_INICIO_STOCK, fecha_entrega_prevista: FECHA_INICIO_STOCK,
      notas: 'Initial stock-up order before opening', negocio_id: NEGOCIO_DCB,
    })
    const lineasIds = []
    for (const [nombre, , , , precio] of articulosDeEsteProveedor) {
      // Cantidad inicial modesta (no un colchon de varias semanas): solo lo razonable para
      // arrancar, igual que compraria un negocio real el dia antes de abrir. El resto de la
      // demanda la cubren las reposiciones semanales por punto de reorden (ver mas abajo) --
      // evita que un articulo de baja rotacion se quede con un lote inicial gigante envejeciendo
      // en el FIFO mucho mas alla de su caducidad real.
      const cantidad = articulo[nombre].unidad === 'ud' ? 150 : 22
      const linea = await ins('lineas_pedido_compra', {
        pedido_compra_id: pedido.id, articulo_id: articulo[nombre].id, cantidad, precio_unitario: precio, negocio_id: NEGOCIO_DCB,
      })
      lineasIds.push({ linea, nombre, cantidad })
    }
    const albaran = await ins('albaranes_compra', {
      proveedor_id: proveedor[prov], fecha: FECHA_INICIO_STOCK, tipo_origen: 'pedido', pedido_compra_id: pedido.id,
      metodo_pago: 'transferencia', negocio_id: NEGOCIO_DCB,
    })
    for (const { linea, nombre, cantidad } of lineasIds) {
      const diasCad = CADUCIDAD_DIAS_POR_CATEGORIA[articulo[nombre].categoria]
      const em = await ins('entrada_material', {
        albaran_compra_id: albaran.id, articulo_id: articulo[nombre].id, cantidad, precio: articulo[nombre].precio,
        fecha_caducidad: addDays(FECHA_INICIO_STOCK, diasCad), linea_pedido_compra_id: linea.id,
        ubicacion_id: ubicacion['Central Warehouse Basel'], negocio_id: NEGOCIO_DCB,
      })
      stockArticulo[nombre].push({ ref: { entrada_material_id: em.id }, fecha: FECHA_INICIO_STOCK, restante: cantidad, fechaCaducidad: addDays(FECHA_INICIO_STOCK, diasCad) })
    }
  }
  console.log(`Compra inicial hecha a los ${proveedoresUnicos.length} proveedores.`)

  const FECHA_SEMI_INICIAL = addDays(FECHA_INICIO_STOCK, 3)
  for (const [nombreSemi, unidadSemi, diasCadSemi, receta] of SEMI_DEF) {
    const cantidadProducida = 15
    const prod = await ins('producciones_semielaborado', {
      semielaborado_id: semi[nombreSemi].id, estado: 'abierta', fecha: FECHA_SEMI_INICIAL, tipo_produccion: 'planificada',
      ubicacion_id: ubicacion['Central Kitchen'], negocio_id: NEGOCIO_DCB,
    })
    const factor = cantidadProducida / 10 // escala la receta al tamaño del lote inicial
    for (const [tipo, ref, cantidadBase] of receta) {
      const cantidadNecesaria = Number((cantidadBase * factor).toFixed(2))
      const { consumos } = consumirIngredienteReceta(tipo, ref, cantidadNecesaria, `${nombreSemi} <- ${ref}`, FECHA_SEMI_INICIAL)
      for (const c of consumos) {
        await insertarConsumo('consumo_produccion', 'produccion_id', prod.id, c)
      }
    }
    await upd('producciones_semielaborado', prod.id, { estado: 'cerrada', cantidad_producida: cantidadProducida })
    stockSemi[nombreSemi].push({ ref: { produccion_origen_id: prod.id }, fecha: FECHA_SEMI_INICIAL, restante: cantidadProducida, fechaCaducidad: addDays(FECHA_SEMI_INICIAL, diasCadSemi) })
  }
  console.log(`${SEMI_DEF.length} semielaborados iniciales producidos y cerrados.`)

  // ============================================================
  // 8. Semanas 1-7: operacion normal
  // ============================================================
  console.log('\n=== 8. Semanas 1-7: compras, producciones, ventas, facturas y pagos ===')

  const nombresArticulos = Object.keys(articulo)
  const nombresPF = Object.keys(pf)
  const nombresClientes = Object.keys(cliente)

  const facturasGeneradas = [] // { facturaId, total, fecha, semanaIdx }

  for (let semanaIdx = 0; semanaIdx < 7; semanaIdx++) {
    const lunes = addDays('2026-07-20', semanaIdx * 7)
    const dias = { lun: lunes, mar: addDays(lunes, 1), mie: addDays(lunes, 2), jue: addDays(lunes, 3), vie: addDays(lunes, 4), sab: addDays(lunes, 5), dom: addDays(lunes, 6) }

    // --- Compras de reposicion ---
    // Los 3 proveedores de PERECEDEROS (carne/pescado, verdura/fruta, lacteos -- vida util
    // 8-20 dias) se compran TODAS las semanas, sin punto de reorden -- ninguna cocina real
    // espera a quedarse sin stock para pedir carne fresca. El punto de reorden (comprar solo si
    // ya hace falta) se reserva para los 2 proveedores de NO perecederos (secos/bebidas, vida
    // util 180-365 dias), donde sí tiene sentido comprar a granel y esperar. Sin esto, un
    // proveedor perecedero solo se visitaba cada 2-3 semanas por la rotacion simple, muy por
    // encima de la vida util de lo que vende -- confirmado en la practica: "stock insuficiente
    // (fresco)" repetido en semana 1 antes de este cambio.
    const PROVEEDORES_PERECEDEROS = ['Basel Quality Meats', 'Basel Fresh Produce', 'Basel Dairy Co.']
    const PROVEEDORES_NO_PERECEDEROS = ['Basel Bakery Supply', 'Nordwest Beverages']
    const UMBRAL_REORDEN = { kg: 22, l: 22, ud: 60 }
    const comprasLunes = [PROVEEDORES_PERECEDEROS[0], PROVEEDORES_PERECEDEROS[1]]
    const comprasJueves = [PROVEEDORES_PERECEDEROS[2], ...PROVEEDORES_NO_PERECEDEROS]
    for (const [dia, provsDelDia] of [[dias.lun, comprasLunes], [dias.jue, comprasJueves]]) {
    for (const prov of provsDelDia) {
      const esPerecedero = PROVEEDORES_PERECEDEROS.includes(prov)
      const candidatos = ARTICULOS_DEF.filter((a) => a[5] === prov)
      const aReponer = esPerecedero ? candidatos : candidatos.filter(([nombre]) => stockTotal(nombre, dia) < UMBRAL_REORDEN[articulo[nombre].unidad])
      if (aReponer.length === 0) continue

      const pedido = await ins('pedidos_compra', { proveedor_id: proveedor[prov], fecha: dia, fecha_entrega_prevista: dia, negocio_id: NEGOCIO_DCB })
      const albaran = await ins('albaranes_compra', { proveedor_id: proveedor[prov], fecha: dia, tipo_origen: 'pedido', pedido_compra_id: pedido.id, metodo_pago: 'transferencia', negocio_id: NEGOCIO_DCB })
      for (const [nombre, , , , precio] of aReponer) {
        const cantidad = articulo[nombre].unidad === 'ud' ? 150 : 26
        const linea = await ins('lineas_pedido_compra', { pedido_compra_id: pedido.id, articulo_id: articulo[nombre].id, cantidad, precio_unitario: precio, negocio_id: NEGOCIO_DCB })
        const diasCad = CADUCIDAD_DIAS_POR_CATEGORIA[articulo[nombre].categoria]
        const em = await ins('entrada_material', {
          albaran_compra_id: albaran.id, articulo_id: articulo[nombre].id, cantidad, precio,
          fecha_caducidad: addDays(dia, diasCad), linea_pedido_compra_id: linea.id,
          ubicacion_id: ubicacion['Central Warehouse Basel'], negocio_id: NEGOCIO_DCB,
        })
        stockArticulo[nombre].push({ ref: { entrada_material_id: em.id }, fecha: dia, restante: cantidad, fechaCaducidad: addDays(dia, diasCad) })
      }
    }
    }

    // --- Producciones de semielaborados: los 6 CADA semana (3 el martes, 3 el viernes), no una
    // rotacion de 2 -- con caducidad corta (3-5 dias) e independiente de la rotacion de
    // productos finales, una rotacion de "2 de 6 por semana" dejaba semanas enteras sin ningun
    // lote fresco del semielaborado que un producto final necesitaba justo esa semana
    // (confirmado en la practica: fallo real de "stock insuficiente (fresco)" antes de este
    // cambio). Reponer los 6 cada semana garantiza que cualquier producto final siempre tiene
    // un lote fresco de sus semielaborados, igual que haria una cocina real con su mise en place
    // semanal. ---
    for (const [dia, semisDelDia] of [[dias.mar, SEMI_DEF.slice(0, 3)], [dias.vie, SEMI_DEF.slice(3, 6)]]) {
      for (const [nombreSemi, , diasCadSemi, receta] of semisDelDia) {
        const cantidadProducida = 15
        const factor = cantidadProducida / 10
        const prod = await ins('producciones_semielaborado', {
          semielaborado_id: semi[nombreSemi].id, estado: 'abierta', fecha: dia, tipo_produccion: 'planificada',
          ubicacion_id: ubicacion['Central Kitchen'], negocio_id: NEGOCIO_DCB,
        })
        for (const [tipo, ref, cantidadBase] of receta) {
          const cantidadNecesaria = Number((cantidadBase * factor).toFixed(2))
          const { consumos } = consumirIngredienteReceta(tipo, ref, cantidadNecesaria, `${nombreSemi} <- ${ref}`, dia)
          for (const c of consumos) {
            await insertarConsumo('consumo_produccion', 'produccion_id', prod.id, c)
          }
        }
        await upd('producciones_semielaborado', prod.id, { estado: 'cerrada', cantidad_producida: cantidadProducida })
        stockSemi[nombreSemi].push({ ref: { produccion_origen_id: prod.id }, fecha: dia, restante: cantidadProducida, fechaCaducidad: addDays(dia, diasCadSemi) })
      }
    }

    // --- Eventos de venta (miercoles y domingo), cada uno con su pedido/produccion/albaran/factura ---
    for (const [diaEvento, diaProd, offset] of [[dias.mie, dias.mie, 0], [dias.dom, dias.sab, 1]]) {
      const nombreCliente = pick(nombresClientes, semanaIdx * 2 + offset)
      // indice base *4 (no *2): con 2 items por evento y 2 eventos/semana, avanzar de 4 en 4
      // mantiene los 4 huecos de la semana en indices distintos entre si -- avanzar de 2 en 2
      // hacia solapaba el ultimo item de un evento con el primero del otro, duplicando sin
      // querer la demanda de ese producto final esa semana (confirmado en la practica: "stock
      // insuficiente" recurrente en Paella Base antes de este cambio).
      const base = semanaIdx * 4 + offset * 2
      const itemsEvento = [pick(nombresPF, base), pick(nombresPF, base + 1)]
      const cantidadesPorItem = [4, 3] // 4 unidades del primer item del evento, 3 del segundo

      const pedido = await ins('pedidos_venta', {
        cliente_id: cliente[nombreCliente], fecha: addDays(diaEvento, -2), fecha_entrega_prevista: diaEvento,
        notas: `${nombreCliente} catering order`, negocio_id: NEGOCIO_DCB,
      })
      for (let i = 0; i < itemsEvento.length; i++) {
        await ins('lineas_pedido_venta', {
          pedido_id: pedido.id, producto_final_id: pf[itemsEvento[i]].id, cantidad: cantidadesPorItem[i],
          precio_unitario: pf[itemsEvento[i]].precio, negocio_id: NEGOCIO_DCB,
        })
      }

      // Producir cada item del evento (produccion cerrada el mismo dia o el dia anterior)
      const produccionesDelEvento = []
      for (let i = 0; i < itemsEvento.length; i++) {
        const nombrePF = itemsEvento[i]
        const cantidadNecesaria = cantidadesPorItem[i]
        const cantidadAProducir = cantidadNecesaria + 1 // pequeño margen, queda como stock sobrante realista
        // pedido_id NO se enlaza aqui a proposito: registrar_incidencia_reparto_pedido() (trigger
        // en lineas_albaran_venta) compara el pedido_id de la produccion contra el pedido_id que
        // se deduciria de linea_pedido_id -- como linea_pedido_id se deja NULL (ver nota mas
        // abajo sobre previsiones_distribucion_pf), esa comparacion daria "distinto" SIEMPRE y
        // generaria una incidencia de reparto en cada venta, sin ningun desajuste real. El pedido
        // sigue existiendo como registro de lo encargado (lineas_pedido_venta), solo no se
        // encadena a la produccion.
        const prod = await ins('producciones_producto_final', {
          producto_final_id: pf[nombrePF].id, estado: 'abierta', fecha: diaProd, tipo_produccion: 'planificada',
          ubicacion_id: ubicacion['Central Kitchen'], negocio_id: NEGOCIO_DCB,
        })
        for (const [tipo, ref, cantidadBase] of pf[nombrePF].receta) {
          const cantidadReceta = Number((cantidadBase * cantidadAProducir).toFixed(2))
          const { consumos } = consumirIngredienteReceta(tipo, ref, cantidadReceta, `${nombrePF} <- ${ref}`, diaProd)
          for (const c of consumos) {
            await insertarConsumo('consumo_produccion_pf', 'produccion_pf_id', prod.id, c)
          }
        }
        await upd('producciones_producto_final', prod.id, { estado: 'cerrada', cantidad_producida: cantidadAProducir })
        stockPF[nombrePF].push({ ref: { produccion_pf_id: prod.id }, fecha: diaProd, restante: cantidadAProducir, fechaCaducidad: addDays(diaProd, pf[nombrePF].diasCad) })
        produccionesDelEvento.push({ nombrePF, prodId: prod.id })
      }

      // Albaran de venta (evento directo) + sus lineas, consumiendo del stock de PF recien producido
      const albaran = await ins('albaranes_venta', {
        cliente_id: cliente[nombreCliente], fecha: diaEvento, tipo_venta: 'evento_directo',
        notas: `Catering service for ${nombreCliente}`, negocio_id: NEGOCIO_DCB,
      })
      let totalFactura = 0
      for (let i = 0; i < itemsEvento.length; i++) {
        const nombrePF = itemsEvento[i]
        const cantidad = cantidadesPorItem[i]
        const consumos = consumirFIFO(stockPF[nombrePF], cantidad, `venta ${nombrePF}`, diaEvento)
        for (const c of consumos) {
          await ins('lineas_albaran_venta', {
            albaran_venta_id: albaran.id, producto_final_id: pf[nombrePF].id, produccion_pf_id: c.ref.produccion_pf_id,
            cantidad: c.cantidad, precio_unitario: pf[nombrePF].precio, negocio_id: NEGOCIO_DCB,
          })
          totalFactura += c.cantidad * pf[nombrePF].precio
        }
      }

      // Factura de venta, vinculada al albaran
      const factura = await ins('facturas_venta', {
        cliente_id: cliente[nombreCliente], fecha: diaEvento, total: Number(totalFactura.toFixed(2)), negocio_id: NEGOCIO_DCB,
      })
      await ins('factura_venta_albaran', { factura_venta_id: factura.id, albaran_venta_id: albaran.id, negocio_id: NEGOCIO_DCB })
      facturasGeneradas.push({ facturaId: factura.id, total: Number(totalFactura.toFixed(2)), fecha: diaEvento, clienteId: cliente[nombreCliente], semanaIdx })

      // Cerrar el pedido de venta como servido (ver nota de diseño: sin linea_pedido_id no hay
      // trigger que lo haga solo, y ademas asi el historico entero arranca 'servido').
      await upd('pedidos_venta', pedido.id, { estado: 'servido' })
    }

    // --- Ajuste de stock ocasional (semanas pares) ---
    if (semanaIdx % 2 === 0) {
      const nombreArt = pick(nombresArticulos, semanaIdx)
      const lote = stockArticulo[nombreArt].find((l) => l.restante > 1)
      if (lote) {
        const cantidadAjuste = -1
        lote.restante += cantidadAjuste
        await ins('ajustes_articulo', {
          articulo_id: articulo[nombreArt].id, entrada_material_id: lote.ref.entrada_material_id,
          cantidad: cantidadAjuste, motivo: 'Spoiled during storage, discarded', fecha: dias.vie,
          user_id: USUARIO_DCB, negocio_id: NEGOCIO_DCB,
        })
      }
    }
  }
  console.log('7 semanas de operacion generadas.')

  // ============================================================
  // 9. Pagos: semanas 0-4 pagadas completas, semana 5 pago parcial, semana 6 pendiente
  // ============================================================
  console.log('\n=== 9. Pagos ===')
  for (const f of facturasGeneradas) {
    if (f.semanaIdx <= 4) {
      const pago = await ins('pagos', { cliente_id: f.clienteId, fecha: addDays(f.fecha, 3), monto: f.total, metodo: pick(['transferencia', 'twint', 'tarjeta', 'efectivo'], f.semanaIdx), negocio_id: NEGOCIO_DCB })
      await ins('pago_aplicacion', { pago_id: pago.id, factura_venta_id: f.facturaId, monto_aplicado: f.total, negocio_id: NEGOCIO_DCB })
    } else if (f.semanaIdx === 5) {
      const montoParcial = Number((f.total * 0.5).toFixed(2))
      const pago = await ins('pagos', { cliente_id: f.clienteId, fecha: addDays(f.fecha, 3), monto: montoParcial, metodo: 'transferencia', negocio_id: NEGOCIO_DCB })
      await ins('pago_aplicacion', { pago_id: pago.id, factura_venta_id: f.facturaId, monto_aplicado: montoParcial, negocio_id: NEGOCIO_DCB })
    }
    // semanaIdx === 6: sin pago, factura pendiente
  }
  console.log(`Pagos generados para ${facturasGeneradas.filter((f) => f.semanaIdx <= 5).length} de ${facturasGeneradas.length} facturas (semana 7 queda pendiente).`)

  await client.query('COMMIT')
  console.log('\n=== COMMIT hecho. Negocio demo poblado con exito. ===')
} catch (e) {
  console.error('\nFALLO, revirtiendo todo:', e.message)
  await client.query('ROLLBACK').catch(() => {})
  process.exitCode = 1
} finally {
  await client.end()
}
