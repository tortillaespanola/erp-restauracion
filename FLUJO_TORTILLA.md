# Análisis del flujo operativo actual (compra → producción → venta)

Documento puramente diagnóstico, basado en el código real (`frontend/src/pages/*.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`) y el esquema real de Supabase (tablas, vistas y triggers). No contiene propuestas de diseño ni wireframes — eso va en un segundo documento.

**Nota de versión**: esta es una regeneración completa de un análisis anterior. Desde la última versión no se tocó ninguna pantalla — todo el trabajo fue de modelo de datos: `tipo_venta`/`evento_directo` + incidencias de stock en ventas, el mismo patrón `tipo_produccion`/`evento_directo` + incidencias en producción, caducidad y merma (`ajustes_producto_final`) en producto final, y `metodo_pago`/`sin_factura_prevista` en compras. **Hallazgo principal de esta versión**: las cuatro migraciones se aplicaron y funcionan correctamente a nivel de base de datos (verificado con pruebas reales), pero **ninguna de ellas tiene todavía un solo punto de entrada en la interfaz** — se confirma más abajo, campo por campo, con búsqueda exhaustiva en el código del frontend. El resultado es medible: 0 filas reales usan `evento_directo` en ventas o producción, 0 filas en las tres tablas de incidencias, 0 filas en `ajustes_producto_final`, 0 productos con `dias_caducidad_default` relleno. El modelo está listo; la operación diaria sigue funcionando exactamente igual que antes de estas cuatro tareas.

---

## Paso 1 — Pedido de ingredientes

*(Sin cambios desde la versión anterior.)*

- **Componente/página**: `PedidosCompra.jsx`, ruta `/pedidos-compra`.
- **Tablas leídas**: `pedidos_compra`, `proveedores`, `articulo_proveedor`.
- **Tablas escritas**: `pedidos_compra` (insert), `lineas_pedido_compra` (insert).
- **Triggers de BD**: `trg_generar_codigo_oc`, `actualizar_estado_pedido_compra`.
- **Clics/pantallas** (1 línea, proveedor con artículos ya vinculados): ≈ 5 interacciones.
- **Relación FK no aprovechada**: `pedidos_compra.fecha_entrega_prevista` se captura pero no se usa después.

---

## Paso 2 — Albarán de compra (llegada de ingredientes)

- **Componente/página**: `AlbaranesCompra.jsx`, ruta `/albaranes-compra`. Puede iniciarse también desde `PedidosCompra.jsx`.
- **Tablas leídas**: `albaranes_compra`, `proveedores`, `articulo_proveedor`, `articulos_compra`, `pedidos_compra`, `lineas_pedido_compra`; al editar: `consumo_produccion`, `consumo_produccion_pf`, `ajustes_articulo`.
- **Tablas escritas**: `albaranes_compra` (insert/update), `entrada_material` (insert/update/delete).
- **Triggers de BD**: `trg_generar_codigo_gr`, `trg_generar_lote_material`, `chk_albaranes_compra_origen`.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `albaranes_compra.metodo_pago` y `.sin_factura_prevista` existen en el esquema (verificado en vivo, con datos de los 7 registros históricos ya reclasificados manualmente por el usuario), pero `AlbaranesCompra.jsx` **no los lee ni los escribe en ningún sitio** — búsqueda exhaustiva en el archivo, cero coincidencias. Hoy no hay forma de marcar un albarán nuevo como pagado en efectivo sin factura desde la interfaz; solo existe vía SQL directo, como se hizo con el histórico.
- **Campos heredables no heredados que quedan**: sin cambios respecto a la versión anterior — sigue sin haber aviso de "llega tarde" ni comparación de precio pactado vs. precio del pedido.
- **Clics/pantallas**: sin cambios (≈ 4 clics "compra directa", ≈ 2 "desde pedido existente").
- **Relación FK ahora sí aprovechada**: `pedidos_compra` → `lineas_pedido_compra` sigue alimentando proveedor + líneas del albarán, sin cambios desde la versión anterior.

---

## Paso 3 — Semielaborados (mezclas)

### 3a. Definir la receta
*(Sin cambios.)* `Semielaborados.jsx`, ruta `/semielaborados`.

### 3b. Producir la mezcla
- **Componente**: `Producciones.jsx`, ruta `/producciones`.
- **Tablas leídas**: `semielaborados`, `producciones_semielaborado`, `stock_semielaborados`; dentro de producción abierta: `receta_semielaborado`, `stock_lotes_articulo`, `stock_lotes_semielaborado`.
- **Tablas escritas**: `producciones_semielaborado` (insert/update), `consumo_produccion`.
- **Triggers de BD**: `trg_generar_lote_semi`, `check_consumo_produccion`, `check_edicion_produccion_semielaborado`.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `producciones_semielaborado.tipo_produccion` (`'planificada'` | `'evento_directo'`, default `'planificada'`) existe y su lógica de bloqueo condicional está probada (5 pruebas en verde, incluida edición RPC multilínea con dos lotes distintos), pero `Producciones.jsx` no tiene ningún control para elegirlo — búsqueda exhaustiva, cero coincidencias reales (el único `fecha_caducidad` que aparece en este archivo es el de `entrada_material`, campo distinto y anterior). Toda producción nueva se crea con el default `'planificada'`, exactamente el mismo comportamiento de bloqueo que existía antes de esta tarea. La tabla `incidencias_stock_semielaborado` tampoco tiene ninguna pantalla de lectura — no hay forma de consultarla salvo por SQL directo.
- **Campos heredables no heredados**: sin cambios — `receta_semielaborado.cantidad` sigue sin autorrellenar el consumo real.
- **Clics/pantallas**: ≈ 15 interacciones (sin cambios).

---

## Paso 4 — Producción (semielaborado → producto final)

### 4a. Definir la receta del producto final
- **Componente**: `ProductosFinales.jsx`, ruta `/productos`.
- **Tablas**: `productos_finales`, `receta_producto_final`, `articulos_compra`, `semielaborados`.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `productos_finales.dias_caducidad_default` (integer, nullable) existe en el esquema desde la migración de caducidad/merma, pero `ProductosFinales.jsx` no lo lee ni lo escribe — búsqueda exhaustiva, cero coincidencias. Confirmado también con datos reales: **0 de los productos finales existentes tiene este campo relleno**, así que el trigger que calcularía `fecha_caducidad` a partir de él (`calcular_fecha_caducidad_pf()`) nunca se ha disparado con un valor real fuera de pruebas en `ROLLBACK`.

### 4b. Producir el producto final
- **Componente**: `ProduccionProductosFinales.jsx`, ruta `/produccion-productos`.
- **Tablas leídas**: `productos_finales`, `producciones_producto_final`, `stock_productos_finales`; dentro de producción: `receta_producto_final`, `stock_lotes_articulo`, `stock_lotes_semielaborado`.
- **Tablas escritas**: `producciones_producto_final` (insert/update), `consumo_produccion_pf`.
- **Triggers de BD**: `trg_generar_lote_pf`, `actualizar_estado_pedido_por_produccion`, validación de fecha/stock.
- **Campos nuevos esta versión, sin punto de entrada todavía**:
  - `producciones_producto_final.tipo_produccion` (mismo patrón que 3b): sin control en pantalla, todas las producciones nuevas quedan en `'planificada'`.
  - `producciones_producto_final.fecha_caducidad`: columna presente, calculable automáticamente si `dias_caducidad_default` estuviera relleno (no lo está, ver 4a), y en teoría editable a mano después — pero no hay ningún input en el formulario que la muestre o permita tocarla. El único `fecha_caducidad` visible en este archivo es, de nuevo, el de `entrada_material` (caducidad de materia prima, no del producto terminado).
  - **`ajustes_producto_final`** (tabla completa para registrar merma con `motivo_categoria`/`motivo_detalle`): no existe ningún formulario ni botón en ninguna pantalla del sistema que inserte en esta tabla. Confirmado con datos reales: **0 filas** en la tabla. La fórmula de disponible ya la resta (`stock_lotes_producto_final`, `check_stock_producto_final`), pero como nunca se escribe nada en ella, el término de merma en la fórmula siempre suma cero en la práctica actual.
- **Campos heredables no heredados**: sin cambios — receta y sugerencia de cantidad desde el pedido siguen sin resolverse.
- **Clics/pantallas**: ≈ 15 interacciones (sin cambios).

---

## Paso 5 — Alta de producto final en stock

*(Sin cambios.)* Automático al cerrar la producción del Paso 4. Vista calculada (`stock_productos_finales`, `stock_lotes_producto_final`), ahora con el término de merma incorporado a la fórmula pero sin datos reales que lo alimenten (ver Paso 4b).

---

## Paso 6 — Albarán de venta a un cliente concreto

- **Componente/página**: `AlbaranesVenta.jsx`, ruta `/albaranes-venta`. Puede iniciarse desde `Pedidos.jsx`.
- **Tablas leídas**: `clientes`, `productos_finales`, `articulos_compra`, `stock_lotes_producto_final`, `stock_lotes_articulo`; si viene de un pedido: `pedidos_venta` + `lineas_pedido_venta`.
- **Tablas escritas**: `albaranes_venta`, `lineas_albaran_venta`.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `albaranes_venta.tipo_venta` (`'pedido_planificado'` | `'evento_directo'`, default `'pedido_planificado'`) existe y su lógica de bloqueo condicional está probada, pero `AlbaranesVenta.jsx` no tiene ningún control para elegirlo — búsqueda exhaustiva, cero coincidencias. Todo albarán nuevo se crea con el default, así que el bloqueo por stock insuficiente sigue aplicando siempre, sin excepción, exactamente igual que antes de esta tarea — el escenario real que motivó el cambio (venta en showcooking que nunca debe bloquearse) **sigue bloqueándose hoy en producción** porque no hay forma de marcar el albarán como evento desde la pantalla. La tabla `incidencias_stock_producto_final` tampoco tiene pantalla de lectura.
- **Campos heredables no heredados — sigue siendo la asimetría más notable del sistema**: sin cambios — `lineas_pedido_venta.precio_unitario`/`.cantidad` siguen sin heredarse al construir el albarán de venta.
- **Clics/pantallas**: sin cambios (≈ 6 interacciones por línea viniendo de un pedido).

---

## Paso 7 — Factura de venta

*(Sin cambios.)*

- **Componente/página**: `FacturasVenta.jsx`, ruta `/facturas-venta`.
- **Tablas**: `facturas_venta`, `clientes`, `factura_venta_albaran`, `albaranes_venta`, `lineas_albaran_venta`.
- **Campos heredables no heredados**: el total sigue sin verse mientras se seleccionan los albaranes.
- **Clics/pantallas**: ≈ 5-6 interacciones.

---

## A) Cuellos de botella priorizados

Esta versión añade una categoría nueva de cuello de botella que no existía en la anterior: **funcionalidad de modelo ya construida y probada, pero completamente inaccesible desde la interfaz**. No es una redundancia de tecleo — es una ausencia total de punto de entrada. Se prioriza por delante de los cuellos de botella habituales porque, a diferencia de ellos, no representa "más clics de los necesarios" sino "la funcionalidad, hoy, no se puede usar en absoluto sin SQL directo".

| # | Cuello de botella | Dónde ocurre | Frecuencia | Coste por ocurrencia | Impacto |
|---|---|---|---|---|---|
| 1 | `tipo_venta`/`tipo_produccion = 'evento_directo'` no se puede seleccionar desde ninguna pantalla — todo queda en `'planificada'`/`'pedido_planificado'` por default | Pasos 3b, 4b, 6 | Total (100% de lo creado desde la última tarea) | El caso de negocio que motivó la tarea (venta/consumo en showcooking sin bloqueo) sigue sin poder ejecutarse hoy | **Muy alto** — el bloqueo que se pidió relajar contextualmente sigue aplicando siempre en la práctica |
| 2 | Las tres tablas de incidencias de stock negativo no tienen ninguna pantalla de lectura | Consecuencia directa de #1 (aunque se resolviera #1, no habría dónde ver el resultado) | — | Solo consultable por SQL directo | **Alto** |
| 3 | `ajustes_producto_final` (merma) no tiene formulario — 0 filas reales | Paso 4b | Total | El término de merma en la fórmula de disponible nunca refleja la realidad | **Alto** |
| 4 | `dias_caducidad_default` no se puede rellenar desde `ProductosFinales.jsx` — 0 productos lo tienen | Paso 4a | Total | `fecha_caducidad` nunca se calcula automáticamente en producción real | **Medio-alto** |
| 5 | `metodo_pago`/`sin_factura_prevista` no se pueden marcar al crear un albarán de compra nuevo — solo se corrigió el histórico por SQL | Paso 2 | Todo albarán `compra_directa` nuevo | El mismo vacío que motivó esta tarea (efectivo sin factura, indistinguible de "factura pendiente") se repetirá desde el primer albarán nuevo que se cree | **Alto** — la tarea resolvió el histórico pero no evita que el problema vuelva a aparecer |
| 6 | La cantidad orientativa de la receta no rellena el campo de cantidad al registrar consumo | Pasos 3b y 4b | Muy alta | 1 tecleo evitable por ingrediente | **Alto** — el hallazgo más repetido del ciclo normal |
| 7 | El precio y la cantidad pactados en un Pedido de venta no se heredan al Albarán de venta | Paso 6 | Media | 2 tecleos evitables + riesgo de precio distinto sin aviso | **Alto** |
| 8 | Encadenamiento manual entre cierre de producción de semielaborado y su consumo en producto final | Paso 3→4 | Alta | Cambio completo de pantalla | **Alto** |
| 9 | Vincular proveedor↔artículo con precio sigue siendo obligatorio solo para compra directa de un artículo nunca vinculado | Paso 2 | Baja-media | Cambio de pantalla | **Medio** |
| 10 | El total de la factura no es visible mientras se seleccionan los albaranes | Paso 7 | Media-baja | Decisión "a ciegas" | **Medio** |

---

## B) Datos disponibles no utilizados

**Backend construido sin ninguna interfaz (ni de lectura ni de escritura) — categoría nueva esta versión:**

- **`albaranes_venta.tipo_venta`**, **`producciones_semielaborado.tipo_produccion`**, **`producciones_producto_final.tipo_produccion`**: columnas y lógica de bloqueo condicional completas; sin selector en ningún formulario. 0 filas reales con valor distinto del default.
- **`incidencias_stock_producto_final`**, **`incidencias_stock_articulo`**, **`incidencias_stock_semielaborado`**: tablas completas con `estado` ampliable; sin ninguna pantalla que las liste. 0 filas (consecuencia directa de lo anterior — nunca se ha dado el caso que las poblaría).
- **`ajustes_producto_final`**: tabla completa con motivo controlado + detalle libre; sin formulario. 0 filas.
- **`productos_finales.dias_caducidad_default`**: columna presente; sin input en `ProductosFinales.jsx`. 0 productos con valor.
- **`producciones_producto_final.fecha_caducidad`**: columna presente, calculable automáticamente o editable a mano; sin ningún campo visible en `ProduccionProductosFinales.jsx`.
- **`albaranes_compra.metodo_pago`** / **`.sin_factura_prevista`**: columnas presentes, histórico ya reclasificado manualmente por SQL; sin ningún control en `AlbaranesCompra.jsx` para los albaranes nuevos.

**Datos capturados pero no reutilizados aguas abajo (categoría de la versión anterior, sin cambios):**

- **`receta_semielaborado.cantidad`** y **`receta_producto_final.cantidad`**: no autorrellenan el consumo real (Pasos 3b y 4b).
- **`lineas_pedido_venta.precio_unitario`** y **`.cantidad`**: no se usan al construir el albarán de venta (Paso 6) — a diferencia de `lineas_pedido_compra`, que sí se usa.
- **`pedidos_compra.fecha_entrega_prevista`**: sin aviso de retraso ni comparación con la recepción real.
- **`articulo_proveedor.referencia_proveedor`**: se captura una vez y no reaparece.
- **`articulo_proveedor.precio`** (histórico pactado): se usa para autorrellenar, no para avisar de desviación.
- **`articulo_proveedor.preferente`**: no preselecciona proveedor por defecto.
- **`pedidos_venta`/`lineas_pedido_venta`** en `AlbaranesVenta.jsx`: el pedido activo solo enlaza, no filtra/prioriza qué mostrar primero.
- **Histórico de producciones cerradas**: no sugiere `cantidad_producida` habitual ni lotes usados la última vez.
- **`clientes.direccion`** / **`clientes.cif`**: solo se inyectan en el PDF, no se muestran antes de guardar.
- **`lineas_albaran_venta`** (importe/contenido) en `FacturasVenta.jsx`: no se muestra al listar "Albaranes a incluir".
