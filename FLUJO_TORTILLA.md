# Análisis del flujo operativo actual (compra → producción → venta)

Documento puramente diagnóstico, basado en el código real (`frontend/src/pages/*.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`) y el esquema real de Supabase (tablas, vistas y triggers, verificados en vivo). No contiene propuestas de diseño ni wireframes — eso va en un segundo documento.

**Nota de versión**: esta regeneración incorpora dos migraciones de infraestructura y una nueva entidad, ninguna con punto de entrada en pantalla todavía: (1) `negocio_id` particionado en las 32 tablas del esquema (`20260807_negocio_id_particion.sql`) — RLS ya exige `negocio_id` además de `authenticated`, con un único valor posible hoy, así que el comportamiento observable no cambió en nada; (2) la entidad `ubicaciones` (`20260808_ubicaciones.sql`, Capa 1: tabla con jerarquía y 4 tipos); (3) `ubicacion_id` vinculado a `entrada_material`, `producciones_semielaborado` y `producciones_producto_final` (`20260809_ubicaciones_stock_capa2.sql`, Capa 2), con el histórico entero apuntando por defecto a una única fila "Ubicación principal" (tipo `almacen`). Ningún trigger de validación cambió, ninguna vista agregada cambió, y no se tocó ni una línea de frontend — ver `UBICACIONES_DIAGNOSTICO.md` y `PENDIENTES_MODELO.md` para el rationale completo de cada decisión. Además, esta versión añade una sección nueva (D) que documenta el flujo operativo diario real tal como lo describe el usuario, distinto de la descripción pantalla-por-pantalla de los Pasos 1-7.

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
- **Campo nuevo esta versión, sin punto de entrada todavía**: `entrada_material.ubicacion_id` existe desde la Capa 2 de ubicaciones (NOT NULL, default a "Ubicación principal"), pero `AlbaranesCompra.jsx` no lo lee ni lo escribe — búsqueda exhaustiva en el archivo, cero coincidencias. Cada lote nuevo se sigue creando en la única ubicación que existe hoy; no hay ningún selector que permitiría elegir otra aunque el catálogo de `ubicaciones` ya soporta más de una.
- **Campo de la versión anterior, sigue sin punto de entrada**: `albaranes_compra.metodo_pago` y `.sin_factura_prevista` siguen sin leerse ni escribirse en `AlbaranesCompra.jsx`.
- **Campos heredables no heredados que quedan**: sin cambios respecto a la versión anterior — sigue sin haber aviso de "llega tarde" ni comparación de precio pactado vs. precio del pedido.
- **Clics/pantallas**: sin cambios (≈ 4 clics "compra directa", ≈ 2 "desde pedido existente").
- **Relación FK ahora sí aprovechada**: `pedidos_compra` → `lineas_pedido_compra` sigue alimentando proveedor + líneas del albarán, sin cambios desde la versión anterior.

---

## Paso 3 — Semielaborados (mezclas)

### 3a. Definir la receta
*(Sin cambios.)* `Semielaborados.jsx`, ruta `/semielaborados`. Receta real actual del único semielaborado (`Mezcla`, `kg`): 0.500 kg cebolla + 0.800 kg patata + 0.350 kg huevina + 0.100 l aceite de oliva virgen extra (`receta_semielaborado`, verificado en vivo).

### 3b. Producir la mezcla
- **Componente**: `Producciones.jsx`, ruta `/producciones`.
- **Tablas leídas**: `semielaborados`, `producciones_semielaborado`, `stock_semielaborados`; dentro de producción abierta: `receta_semielaborado`, `stock_lotes_articulo`, `stock_lotes_semielaborado`.
- **Tablas escritas**: `producciones_semielaborado` (insert/update), `consumo_produccion`.
- **Triggers de BD**: `trg_generar_lote_semi`, `check_consumo_produccion`, `check_edicion_produccion_semielaborado`.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `producciones_semielaborado.ubicacion_id` existe (NOT NULL, default a "Ubicación principal"), pero no hay ningún control en el formulario para elegir otra. Además, `stock_lotes_articulo` y `stock_lotes_semielaborado` ya devuelven `ubicacion_id` como columna (Capa 2), pero el desplegable de selección de lote en este archivo no la muestra ni la usa para filtrar — sigue listando lotes solo por fecha/caducidad/stock disponible.
- **Campo de la versión anterior, sigue sin punto de entrada**: `producciones_semielaborado.tipo_produccion` (`'planificada'`/`'evento_directo'`) sigue sin selector; toda producción nueva queda en `'planificada'` por default. `incidencias_stock_semielaborado` sigue sin pantalla de lectura.
- **Campos heredables no heredados**: sin cambios — `receta_semielaborado.cantidad` sigue sin autorrellenar el consumo real, y no está parametrizada por cuántas unidades se van a producir (ver Sección D).
- **Clics/pantallas**: con la receta real de 4 ingredientes (antes se estimaba con 3), la cifra sube ligeramente: iniciar (~3) + registrar consumo × 4 ingredientes (~3 cada uno) + cerrar (~3) ≈ 18 interacciones.

---

## Paso 4 — Producción (semielaborado → producto final)

### 4a. Definir la receta del producto final
- **Componente**: `ProductosFinales.jsx`, ruta `/productos`.
- **Tablas**: `productos_finales`, `receta_producto_final`, `articulos_compra`, `semielaborados`.
- **Receta real actual**: el único producto final (`Tortilla Española`) consume 2.000 kg de `Mezcla` por unidad de receta — no consume ningún artículo de compra directamente, solo el semielaborado (`receta_producto_final`, verificado en vivo, 1 fila).
- **Campo de la versión anterior, sigue sin punto de entrada**: `productos_finales.dias_caducidad_default` sigue sin leerse ni escribirse en `ProductosFinales.jsx` — 0 productos lo tienen relleno.

### 4b. Producir el producto final
- **Componente**: `ProduccionProductosFinales.jsx`, ruta `/produccion-productos`.
- **Tablas leídas**: `productos_finales`, `producciones_producto_final`, `stock_productos_finales`; dentro de producción: `receta_producto_final`, `stock_lotes_articulo`, `stock_lotes_semielaborado`.
- **Tablas escritas**: `producciones_producto_final` (insert/update), `consumo_produccion_pf`.
- **Triggers de BD**: `trg_generar_lote_pf`, `actualizar_estado_pedido_por_produccion`, validación de fecha/stock.
- **Campo nuevo esta versión, sin punto de entrada todavía**: `producciones_producto_final.ubicacion_id` existe (NOT NULL, default a "Ubicación principal"), mismo caso que 3b — sin selector, y `stock_lotes_producto_final` ya expone `ubicacion_id` sin que ningún consumidor la use.
- **Campos de la versión anterior, siguen sin punto de entrada**:
  - `producciones_producto_final.tipo_produccion`: sin control en pantalla, todas las producciones nuevas quedan en `'planificada'`.
  - `producciones_producto_final.fecha_caducidad`: sigue sin ningún input en el formulario.
  - `ajustes_producto_final`: sigue sin ningún formulario ni botón. 0 filas.
- **Campos heredables no heredados**: sin cambios.
- **Clics/pantallas**: con la receta real de 1 ingrediente (la Mezcla), iniciar (~3) + registrar consumo × 1 (~3) + cerrar (~3) ≈ 9 interacciones.

---

## Paso 5 — Alta de producto final en stock

*(Sin cambios de comportamiento.)* Automático al cerrar la producción del Paso 4. Vista calculada (`stock_productos_finales`, `stock_lotes_producto_final`); esta última ya expone `ubicacion_id` desde la Capa 2 (columna aditiva, sin cambiar cardinalidad), pero `stock_productos_finales` (la vista agregada que sí consume el frontend) sigue sumando global sin distinguir ubicación — decisión deliberada de esta capa, ver `PENDIENTES_MODELO.md` #2.

---

## Paso 6 — Albarán de venta a un cliente concreto

- **Componente/página**: `AlbaranesVenta.jsx`, ruta `/albaranes-venta`. Puede iniciarse desde `Pedidos.jsx`.
- **Tablas leídas**: `clientes`, `productos_finales`, `articulos_compra`, `stock_lotes_producto_final`, `stock_lotes_articulo`; si viene de un pedido: `pedidos_venta` + `lineas_pedido_venta`.
- **Tablas escritas**: `albaranes_venta`, `lineas_albaran_venta`.
- **Campo de la versión anterior, sigue sin punto de entrada**: `albaranes_venta.tipo_venta` (`'pedido_planificado'`/`'evento_directo'`) sigue sin selector; el bloqueo por stock insuficiente sigue aplicando siempre. `incidencias_stock_producto_final` sigue sin pantalla de lectura.
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

| # | Cuello de botella | Dónde ocurre | Frecuencia | Coste por ocurrencia | Impacto |
|---|---|---|---|---|---|
| 1 | `tipo_venta`/`tipo_produccion = 'evento_directo'` no se puede seleccionar desde ninguna pantalla — todo queda en `'planificada'`/`'pedido_planificado'` por default | Pasos 3b, 4b, 6 | Total | El caso de negocio que motivó la tarea (venta/consumo en showcooking sin bloqueo) sigue sin poder ejecutarse hoy | **Muy alto** |
| 2 | Las tres tablas de incidencias de stock negativo no tienen ninguna pantalla de lectura | Consecuencia directa de #1 | — | Solo consultable por SQL directo | **Alto** |
| 3 | `ajustes_producto_final` (merma) no tiene formulario — 0 filas reales | Paso 4b | Total | El término de merma en la fórmula de disponible nunca refleja la realidad | **Alto** |
| 4 | `dias_caducidad_default` no se puede rellenar desde `ProductosFinales.jsx` — 0 productos lo tienen | Paso 4a | Total | `fecha_caducidad` nunca se calcula automáticamente en producción real | **Medio-alto** |
| 5 | `metodo_pago`/`sin_factura_prevista` no se pueden marcar al crear un albarán de compra nuevo | Paso 2 | Todo albarán `compra_directa` nuevo | Se repite el vacío que motivó la tarea | **Alto** |
| 6 | `ubicacion_id` existe en las tres tablas de lote y en las tres vistas por-lote, pero ningún formulario permite elegir ni ver la ubicación — **nuevo esta versión** | Pasos 2, 3b, 4b, 5 | Total (100% de lo creado desde la Capa 2) | El catálogo de `ubicaciones` (Capa 1) ya distingue `almacen`/`centro_produccion`/`punto_venta`/`evento`, pero hoy el 100% del histórico y de lo nuevo cae en una única "Ubicación principal" — no hay forma de registrar dónde ocurre físicamente nada, ni de que importe | **Medio** — deliberadamente inerte en esta capa, no es un defecto sino un límite de alcance ya documentado |
| 7 | La cantidad orientativa de la receta no rellena el campo de cantidad al registrar consumo, y no está parametrizada por cuántas unidades se producen | Pasos 3b y 4b | Muy alta | Cálculo manual de proporciones, ver Sección D | **Alto** |
| 8 | El precio y la cantidad pactados en un Pedido de venta no se heredan al Albarán de venta | Paso 6 | Media | 2 tecleos evitables + riesgo de precio distinto sin aviso | **Alto** |
| 9 | Encadenamiento manual entre cierre de producción de semielaborado y su consumo en producto final | Paso 3→4 | Alta | Cambio completo de pantalla | **Alto** |
| 10 | Vincular proveedor↔artículo con precio sigue siendo obligatorio solo para compra directa de un artículo nunca vinculado | Paso 2 | Baja-media | Cambio de pantalla | **Medio** |
| 11 | El total de la factura no es visible mientras se seleccionan los albaranes | Paso 7 | Media-baja | Decisión "a ciegas" | **Medio** |
| 12 | No existe ninguna vista/pantalla que agregue las necesidades de materia prima de varios pedidos del mismo día — **nuevo esta versión, ver Sección D** | Entre Pasos 1 y 3b | Diaria | Cálculo manual, sin ayuda de ninguna pantalla, de cuánta materia prima comprar/pesar sumando pedidos | **Muy alto** — es el primer paso de cada jornada real |

---

## B) Datos disponibles no utilizados

**Backend construido sin ninguna interfaz (ni de lectura ni de escritura):**

- **`ubicacion_id`** (`entrada_material`, `producciones_semielaborado`, `producciones_producto_final`, y las vistas `stock_lotes_articulo`/`_semielaborado`/`_producto_final`) — **nuevo esta versión**. Columna y FK completas, `NOT NULL` con default; sin ningún selector en ningún formulario. 100% de las filas (histórico y nuevas) apuntan a la única fila que existe en `ubicaciones` ("Ubicación principal", tipo `almacen`) — no hay ninguna fila de tipo `centro_produccion` creada todavía, así que el modelo no distingue hoy "almacén" de "cocina" ni a nivel de dato.
- **`negocio_id`** (las 32 tablas del esquema) — **nuevo esta versión**. Particionamiento estructural puro, sin ninguna superficie de usuario (no hay selector de negocio, no hay segundo negocio, `AuthGate.jsx` no lee ningún claim de organización). No es "funcionalidad sin punto de entrada" en el mismo sentido que el resto de esta lista — no está pensado para tener uno todavía.
- **`albaranes_venta.tipo_venta`**, **`producciones_semielaborado.tipo_produccion`**, **`producciones_producto_final.tipo_produccion`**: sin selector en ningún formulario. 0 filas reales con valor distinto del default.
- **`incidencias_stock_producto_final`**, **`incidencias_stock_articulo`**, **`incidencias_stock_semielaborado`**: sin ninguna pantalla que las liste. 0 filas.
- **`ajustes_producto_final`**: sin formulario. 0 filas.
- **`productos_finales.dias_caducidad_default`**: sin input. 0 productos con valor.
- **`producciones_producto_final.fecha_caducidad`**: sin ningún campo visible.
- **`albaranes_compra.metodo_pago`** / **`.sin_factura_prevista`**: sin ningún control para los albaranes nuevos.

**Datos capturados pero no reutilizados aguas abajo:**

- **`receta_semielaborado.cantidad`** y **`receta_producto_final.cantidad`**: no autorrellenan el consumo real, y no están parametrizadas por cuántas unidades se van a producir — ver Sección D para el efecto concreto sobre el flujo diario.
- **`lineas_pedido_venta.precio_unitario`** y **`.cantidad`**: no se usan al construir el albarán de venta.
- **`pedidos_compra.fecha_entrega_prevista`**: sin aviso de retraso ni comparación con la recepción real.
- **`articulo_proveedor.referencia_proveedor`**: se captura una vez y no reaparece.
- **`articulo_proveedor.precio`** (histórico pactado): se usa para autorrellenar, no para avisar de desviación.
- **`articulo_proveedor.preferente`**: no preselecciona proveedor por defecto.
- **`pedidos_venta`/`lineas_pedido_venta`** en `AlbaranesVenta.jsx`: el pedido activo solo enlaza, no filtra/prioriza qué mostrar primero.
- **Histórico de producciones cerradas**: no sugiere `cantidad_producida` habitual ni lotes usados la última vez.
- **`clientes.direccion`** / **`clientes.cif`**: solo se inyectan en el PDF, no se muestran antes de guardar.
- **`lineas_albaran_venta`** (importe/contenido) en `FacturasVenta.jsx`: no se muestra al listar "Albaranes a incluir".

---

## C) Nota sobre `stock_articulos` (código muerto)

La vista `stock_articulos` no tiene ningún consumidor en `frontend/src` (grep exhaustivo, cero coincidencias) — no es un vacío nuevo de esta versión, pero se documenta aquí y en `PENDIENTES_MODELO.md` #2 porque afecta directamente a si merece la pena extenderla (p. ej. agrupándola por ubicación) en capas futuras si nadie la lee hoy.

---

## D) Flujo operativo diario real (agregado por pedidos)

A diferencia de los Pasos 1-7 (que documentan cada pantalla de forma aislada), esta sección sigue el patrón de trabajo real de un día cualquiera, tal como lo describe el usuario: varios pedidos de venta se dan de alta por la mañana (ejemplo real usado aquí: 1 tortilla para el cliente A, 2 para el cliente B, 3 para el cliente C — 6 unidades en total), y a partir de ahí se ejecuta una única secuencia física de compra→pesaje→cocina→producción que los sirve a todos a la vez. El objetivo declarado es operar esto con pantallas tipo POS, no con los formularios tradicionales descritos arriba.

### Las 7 fases y qué las soporta hoy

| # | Fase | Tablas/entidades que la soportan hoy | Pantalla | Ubicación física real | ¿Vinculada a `ubicacion_id` hoy? |
|---|---|---|---|---|---|
| 1 | Agregación de pedidos del día | `pedidos_venta`, `lineas_pedido_venta` | `Pedidos.jsx` (`/pedidos`) | N/A — es un compromiso comercial, no ocurre en ningún lugar físico | No aplica; ningún pedido tiene ni debería tener `ubicacion_id` |
| 2 | Picking en almacén (coger los artículos) | Ninguna tabla ni pantalla propia | — | Almacén (`ubicaciones.tipo = 'almacen'`) | No — no hay ningún registro de esta acción como tal; se funde con la fase 5 |
| 3 | Pesaje de los artículos | Ninguna tabla ni pantalla propia | — | Almacén | No — el número pesado y el número consumido (fase 5) son el mismo dato, sin registro intermedio; si difieren, no queda rastro |
| 4 | Traslado a cocina | Ninguna — no existe concepto de "traspaso" en el modelo actual (explícitamente Capa 3/4 futura) | — | Entre almacén y centro de producción | No — `ubicacion_id` del lote de `entrada_material` no cambia al moverse físicamente; sigue apuntando a "Ubicación principal" antes y después |
| 5 | Producción de la mezcla | `producciones_semielaborado` (fila abierta), `consumo_produccion` (una línea por ingrediente), lee `receta_semielaborado` | `Producciones.jsx` (`/producciones`) | Centro de producción (cocina) | `producciones_semielaborado.ubicacion_id` existe (Capa 2) pero apunta por defecto a "Ubicación principal" — **la misma fila que usa `entrada_material`**, tipo `almacen`; no existe todavía ninguna fila de tipo `centro_produccion`, así que el modelo no distingue almacén de cocina ni a nivel de dato |
| 6 | Pesaje de la mezcla | Mismo `producciones_semielaborado.cantidad_producida`, introducido al cerrar la producción (mismo formulario que la fase 5, no una pantalla aparte) | `Producciones.jsx` | Centro de producción | Igual que la fase 5 |
| 7 | Producción del producto final | `producciones_producto_final`, `consumo_produccion_pf` (consume de la producción de semielaborado ya cerrada), lee `receta_producto_final` | `ProduccionProductosFinales.jsx` (`/produccion-productos`), puede iniciarse desde `Pedidos.jsx` (botón "Producir" por línea de pedido — un pedido a la vez) | Centro de producción | Igual que la fase 5: `ubicacion_id` existe, apunta a "Ubicación principal", sin distinguir cocina de almacén |

### La fase sin ningún soporte de agregación

Ninguna fase tiene agregación entre pedidos — pero el motivo es más profundo que "falta una pantalla". Confirmado con la receta real (`receta_semielaborado`: Mezcla = 0.500 kg cebolla + 0.800 kg patata + 0.350 kg huevina + 0.100 l aceite; `receta_producto_final`: Tortilla Española = 2.000 kg de Mezcla): estos valores de `cantidad` son números fijos "orientativos" — no están parametrizados por cuántas unidades se van a producir (ya documentado como bottleneck #7 más arriba). No existe en ningún sitio del sistema la operación aritmética "receta × unidades pedidas", ni siquiera para un solo pedido — así que sumar varios pedidos del día es un paso que hoy no tiene ninguna base sobre la que construirse, no es solo una pantalla que falta.

En la práctica, con los 3 pedidos del ejemplo (1+2+3 = 6 tortillas), el usuario tiene que calcular a mano, sin ayuda de ninguna pantalla:
- Mezcla necesaria: 6 × 2.000 kg = 12 kg.
- Materia prima para esa Mezcla: 12 × (0.500, 0.800, 0.350, 0.100) = 6.0 kg cebolla, 9.6 kg patata, 4.2 kg huevina, 1.2 l aceite.

Grep exhaustivo de patrones de agregación (`sum`/`reduce`/`group`) en `frontend/src`: todos los usos existentes sirven para totalizar líneas *ya registradas* (importe de un albarán, cuánto de un pedido ya se ha servido/recibido) — ninguno suma cantidades de receta a través de varios pedidos pendientes. Es, literalmente, la primera cosa que hay que hacer cada día y la única que no tiene ningún soporte, ni parcial.

### Clics/pantallas para completar la secuencia diaria completa

Estimación de principio a fin para el ejemplo de 3 pedidos (1+2+3 tortillas), asumiendo que se produce un único lote de Mezcla y un único lote de Tortilla Española que después se reparte entre los 3 albaranes de venta (posible hoy: `lineas_albaran_venta.produccion_pf_id` no limita una producción a un solo albarán):

| Fase | Pantalla | Interacciones |
|---|---|---|
| 1. Alta de 3 pedidos de venta | `Pedidos.jsx` | 3 × ≈5 (cliente, producto, cantidad, fecha, guardar) = **15** |
| 2-4. Picking, pesaje, traslado | — | **0** (sin representación digital) |
| 5-6. Producción de mezcla + pesaje | `Producciones.jsx` | iniciar (~3) + 4 consumos (~3 c/u) + cerrar (~3) = **18** |
| 7. Producción de producto final | `ProduccionProductosFinales.jsx` | iniciar (~3) + 1 consumo (~3) + cerrar (~3) = **9** |
| Entrega a los 3 clientes (albaranes de venta, fuera de las 7 fases pero necesaria para cerrar el día) | `AlbaranesVenta.jsx` | 3 × ≈6 (viniendo de pedido) = **18** |
| **Total** | **4 pantallas distintas** | **≈ 60 interacciones** |

Ninguna de las ≈60 interacciones informa, en ningún momento, cuánta materia prima hace falta comprar o pesar antes de empezar — ese cálculo ocurre por completo fuera del sistema.
