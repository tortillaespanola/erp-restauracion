# Mejoras de UI pendientes (post-histórico)

Documento separado de `PENDIENTES_MODELO.md` a propósito: aquí no hay ninguna decisión de esquema pendiente — los datos ya existen (o están a una columna aditiva de existir), es una cuestión de qué se muestra en pantalla, no de cómo se modela. Mezclar deuda de interfaz con decisiones de modelo dificultaría el seguimiento de ambas.

Todas las entradas son mejoras de comodidad o huecos sin uso real todavía, sin prisa.

## 1. Desplegables de selección de lote: campos disponibles no mostrados

Verificado en las tres pantallas que ofrecen selector de lote — **no es el mismo componente reutilizado, como se suponía**: hay dos implementaciones independientes del label, con distinto nivel de detalle.

- `Producciones.jsx:401-402` y `ProduccionProductosFinales.jsx:396-397` — **idénticas entre sí** — ya muestran, para lotes de artículo: `proveedor` y `fecha_caducidad`, además de `numero_albaran`, `fecha_recepcion` y `stock_disponible`.
- `AjustesStock.jsx:175-176` — implementación propia, más pobre — solo `numero_albaran`, `fecha_recepcion` y `stock_disponible`. Es la única de las tres que se quedó atrás; no es que "probablemente se reutilice", es que nunca se sincronizó con el label que ya existía en las otras dos.

**Campos concretos, por pantalla y tipo de lote:**

| Pantalla | Tipo de lote | Añadir | Origen del dato |
|---|---|---|---|
| `AjustesStock.jsx` | Artículo | `proveedor`, `fecha_caducidad` | Ya expuestos por la vista `stock_lotes_articulo` — solo falta usarlos en el label, copiando lo que ya hacen `Producciones.jsx`/`ProduccionProductosFinales.jsx`. Cambio de frontend puro, sin tocar el modelo. |
| Las 3 pantallas | Artículo | `notas` (de `entrada_material.notas`) | **No disponible todavía** — `stock_lotes_articulo` no expone esta columna. Haría falta añadirla a la vista primero (columna aditiva, mismo patrón que `ubicacion_id` en la Capa 2 de ubicaciones) antes de poder mostrarla en ningún sitio. |
| ~~Las 3 pantallas~~ | ~~Semielaborado~~ | ~~`codigo_lote`~~ | ✅ **Implementado** — ver nota abajo. |
| Las 3 pantallas | Semielaborado | `notas` (de `producciones_semielaborado.notas`) | **No disponible todavía** — mismo caso que `notas` de artículo: falta añadirla a `stock_lotes_semielaborado` primero. |

**✅ `codigo_lote` de semielaborado y producto final — implementado, en las cuatro pantallas.** Añadido a `stock_lotes_semielaborado` y `stock_lotes_producto_final` (migración `20260820_codigo_lote_stock_lotes.sql`, mismo patrón aditivo que `ubicacion_id`) y al label de `AjustesStock.jsx` (semielaborado y producto final), `Producciones.jsx` y `ProduccionProductosFinales.jsx` (rama de consumo de semielaborado), y `AlbaranesVenta.jsx:478` (desplegable de lote de producto final al vender — detectado como hallazgo nuevo al verificar el alcance completo del fix original, corregido en la misma sesión en vez de dejarlo solo documentado). Motivado por colisiones reales confirmadas contra datos existentes, no solo teóricas: `stock_lotes_semielaborado` produccion_id 45/46 y `stock_lotes_producto_final` produccion_id 61/62 y 66/67 (mismo `producto_final_id`/`semielaborado_id`, misma `fecha`, mismo `stock_disponible` — etiqueta idéntica antes del fix).

Probado en runtime real contra esos cuatro lotes exactos en las cuatro pantallas: ahora cada uno muestra su `codigo_lote` real (`WIP-MIXKZ-260015`/`260016`, `FG-TEKZ24-260003`/`260004`/`260007`/`260008`) y se distinguen sin ambigüedad. En `AlbaranesVenta.jsx` no hay hoy ningún lote de producto final con `stock_disponible > 0` (los 29 lotes cerrados están a 0 — todo vendido/consumido), así que no hay ninguna colisión visible en el desplegable real ahora mismo; verificado en su lugar que el label calcula correctamente contra esos mismos cuatro lotes reales (ej. produccion_id 61 → `"FG-TEKZ24-260003 · Producción 2026-04-29 · 0.000 disp."`).

`proveedor`/`fecha_caducidad` de artículo en `AjustesStock.jsx` y `notas` (artículo y semielaborado) siguen sin implementar — sin cambios en este commit.

## 2. Vista viva de stock, con enlace a ajuste rápido

Hoy el stock (artículos, semielaborados, productos finales) solo es visible dentro de los desplegables de producción — no hay ninguna pantalla de lectura propia donde consultarlo de un vistazo. Relacionado con el hallazgo ya documentado en `PENDIENTES_MODELO.md` #2: `stock_articulos` no tiene ningún consumidor en el frontend hoy.

Propuesta: una vista viva de stock con enlace directo a `AjustesStock.jsx` con el lote preseleccionado, para poder ajustar sin tener que volver a buscar el lote a mano.

Incluye también la idea de un ajuste rápido ("kill") para limpiar stock antiguo sin consumo por error de pesaje — no hace falta modelo nuevo, el mecanismo de ajustes con motivo ya existe; es solo UI. Diseñar con alguna fricción mínima intencional (confirmación, motivo obligatorio) para que un clic accidental no borre stock real.

No implementado — solo la idea recogida, para cuando se aborde.

## 3. Aviso visual (no bloqueo) cuando la fecha de producción se aleja de la fecha de entrega prevista del pedido

Útil para detectar errores de tecleo (poner la fecha actual por error) sin penalizar retrasos reales de producción, que son normales — por eso aviso, no bloqueo.

Mismo patrón ya aplicado a `pedidos_compra.fecha_entrega_prevista`: capturada, no usada en ningún sitio (ver `FLUJO_TORTILLA.md`, "Relación FK no aprovechada" del Paso 1). Probablemente conviene resolver ambos casos juntos cuando se aborde, en vez de por separado — son la misma idea (fecha prevista vs. fecha real, aviso de desviación) aplicada a dos flujos distintos.

No implementado — solo la idea recogida, para cuando se aborde.

## 4. Referencia del proveedor a nivel de pedido — no existe ningún campo hoy

Referencia del proveedor a nivel de PEDIDO (número/confirmación que el proveedor da al aceptar nuestro `pedido_compra`) — verificado con certeza contra el esquema real: no existe ningún campo hoy. `pedidos_compra` solo tiene `codigo_pedido` (nuestro, autogenerado por `trg_codigo_oc`) y `notas` (texto libre genérico).

Distinto de dos campos que ya existen y que podrían confundirse con este:

- `albaranes_compra.numero_albaran` — ya existe, ya es del proveedor (label real en el formulario: "Nº albarán del proveedor"), pero cubre la referencia a nivel de **albarán/entrega**, no de pedido.
- `articulo_proveedor.referencia_proveedor` — es el SKU del proveedor para un artículo concreto en su catálogo, no la referencia de un pedido.

Cambio pequeño: columna de texto libre nullable en `pedidos_compra`, mismo patrón que `numero_albaran`.

**Caso real que la motiva** (sube su prioridad relativa frente a otros pendientes menores de este documento): el episodio de `OC-260002`/`OC-260005` (Hogashop, ver commit `9e69efb`) — un pedido duplicado por error que quedó pendiente sin forma de detectarlo hasta revisar manualmente. Con este campo, la referencia de confirmación del proveedor habría permitido detectar el duplicado antes (dos pedidos con la misma referencia del proveedor sería la señal), en vez de descubrirlo al revisar un albarán ya vinculado.

No implementado — solo la idea recogida, para cuando se aborde.

## 5. `ProduccionProductosFinales.jsx` no reconoce líneas de receta por `ingrediente_id`

**Ya resuelto, no tocar de nuevo:**
- `Producciones.jsx` — `cargarIngredientesConLotes()` ya reconoce líneas con `ingrediente_id` (resuelve lotes vía `articulo_ingrediente`, antepone el nombre del artículo al label del lote).
- Gestión de ingredientes y artículos vinculados — pantalla `Ingredientes.jsx` ya existe (alta, vinculación/desvinculación con `confirm()`).
- Definición de líneas de receta por ingrediente — `Semielaborados.jsx` y `ProductosFinales.jsx` ya tienen el tercer radio "Ingrediente" junto a "Artículo de compra"/"Otro semielaborado".

**Sigue abierto:** `ProduccionProductosFinales.jsx` (consumo de `receta_producto_final`) **no** tiene el mismo reconocimiento de `ingrediente_id` que `Producciones.jsx` — su `cargarIngredientesConLotes()` sigue filtrando el desplegable de consumo estrictamente por `articulo_id` (`.eq('articulo_id', linea.articulo_id)`), sin la rama que resuelve lotes para líneas con `ingrediente_id`.

No es urgente hoy: la receta real de Tortilla no usa `ingrediente_id` todavía (solo `Mezcla`, un semielaborado, lo usa para su línea de Huevina). Pero si en el futuro se edita una línea de `receta_producto_final` para usar `ingrediente_id`, haría falta el mismo cambio que ya se hizo en `Producciones.jsx` — si no, esa línea no ofrecería ningún lote para consumir.

No implementado — solo el diagnóstico, para cuando se aborde (o para cuando una receta real de producto final necesite `ingrediente_id`, lo que llegue antes).

## 6. Formato de compra vs. unidad de consumo — caso real: aceite de oliva (litros vs. kg)

El aceite de oliva se compra y consume en litros, pero se pesa en báscula al consumir (kg reales). Para la carga de histórico actual se asume densidad 1:1 (litros = kg) por simplicidad — introduce un error real de ~8-9% frente a la densidad real del aceite (~0.91-0.92 kg/l).

No bloquea el histórico actual: es una aproximación consciente y documentada, no un error sin detectar.

**Cuándo retomarlo**: cuando se aborde el caso general de formato de compra vs. unidad de consumo (no encontrado como pendiente ya documentado en ningún sitio — ni aquí ni en `PENDIENTES_MODELO.md` — pese a haberse mencionado antes; si existe una decisión de diseño previa sobre esto, no quedó escrita), incluir densidad como campo de `articulos_compra` (o específico de este caso) para poder convertir correctamente entre litros comprados y kg consumidos.

No implementado — solo la aproximación documentada, para cuando se aborde.

## 7. Formato de fecha: input nativo dependiente de locale + falta de formateo en pantalla/PDF

**Problema original (input):** los inputs `<input type="date">` nativos dependen del idioma/locale configurado en el navegador de cada máquina, no del sistema operativo. Si el navegador tiene el idioma en inglés (US), el orden de los campos cambia a mm/dd en vez de dd/mm, causando confusión al introducir fechas manualmente.

**Solución propuesta para el input:** sustituir los inputs de fecha nativos por un componente de fecha personalizado en React (ej. `react-datepicker`), que controle el formato dd/mm/aaaa de forma fija desde el código, independiente de la configuración de cada máquina/navegador.

**Hallazgo real, más amplio (grep exhaustivo hecho al intentar centralizar el formato de fecha):** hoy **NO existe ningún formateo de fecha en ningún sitio** — todas las fechas se muestran en ISO crudo (`2026-04-23`), no en dd/mm/aaaa ni en ningún otro formato. No es un caso de formato disperso que consolidar en un helper; es que no hay formato en absoluto todavía. **29 sitios en 9 archivos:**

| Archivo | Sitios |
|---|---|
| `AjustesStock.jsx` | 3 |
| `Producciones.jsx` | 5 |
| `ProduccionProductosFinales.jsx` | 5 |
| `Pedidos.jsx` | 2 |
| `PedidosCompra.jsx` | 2 |
| `FacturasVenta.jsx` | 3 |
| `FacturasCompra.jsx` | 3 |
| `AlbaranesCompra.jsx` | 2 |
| `AlbaranesVenta.jsx` | 3 |
| `lib/generarPdf.js` | 1 |

Incluye `lib/generarPdf.js` — el punto donde se imprime la fecha en los PDF de factura/albarán ya entregados a clientes reales, no solo pantallas internas (`FacturasVenta.jsx` y `AlbaranesVenta.jsx` solo pasan el dato en crudo hasta ahí, el formateo real ocurriría en ese único punto).

**Por eso este cambio no es un refactor invisible**: migrar cambia lo que ve el usuario en pantalla y lo que aparece en documentos oficiales ya entregados a clientes — no es solo reorganizar código existente.

**Cuándo se aborde**: crear un helper centralizado (`lib/formatFecha.js`) con un formato fijo por defecto (dd/mm/aaaa), sin configurabilidad desde `Configuracion.jsx` todavía (eso es una iteración futura sobre el mismo helper). Priorizar primero `generarPdf.js` y las pantallas de cara a cliente (facturas, albaranes) sobre los labels de desplegable de lote (los más numerosos pero menos críticos). El selector de idioma para abreviatura de mes y la configurabilidad desde `Configuracion.jsx` quedan fuera hasta que exista esa base.

**Prioridad:** baja/media para el problema del input nativo (se soluciona a nivel de navegador); a revisar la prioridad real del formateo de pantalla/PDF cuando se aborde, dado el volumen (29 sitios) y que toca documentos ya entregados a clientes.

**Fase:** revisar durante Layers 1 y 2 (UI/UX).

No implementado — solo el diagnóstico y el inventario completo, para cuando se aborde.

## 8. `AlbaranesCompra.jsx`: reasignar retroactivamente un albarán `compra_directa` a un pedido existente

Hoy no hay forma de, tras crear un albarán como `compra_directa`, vincularlo a posteriori a un `pedido_compra_id` (cambiar `tipo_origen` a `'pedido'`). Surgió al revisar un caso real que resultó no serlo (el albarán en cuestión ya estaba bien vinculado); el pedido duplicado que lo motivaba (`OC-260005`) se borró directamente. Queda el diseño ya pensado, sin implementar, para cuando aparezca un caso real:

**Dónde**: en el modal "Editar albarán", solo cuando el albarán editado tiene `tipo_origen = 'compra_directa'` — un `<Select>` "Vincular a pedido existente" filtrado por `pedidos_compra` del mismo `proveedor_id` y `estado = 'pendiente'` (reutilizando `pedidosCompraPendientes`, ya cargado). Acción explícita y separada de "Guardar cambios" (no mezclar con la edición de líneas), porque toca una mutación distinta: cabecera + todas las líneas.

**Punto no obvio, verificado contra el trigger real**: actualizar solo `albaranes_compra.pedido_compra_id` **no dispara nada** — `actualizar_estado_pedido_compra()` es `AFTER ... ON entrada_material` y calcula todo a partir de `entrada_material.linea_pedido_compra_id`, no del campo de cabecera. Hace falta además actualizar `linea_pedido_compra_id` en cada `entrada_material` de ese albarán (emparejando por `articulo_id` contra las líneas del pedido elegido) — eso sí dispara el trigger y recalcula el estado del pedido correctamente. Importante: esta actualización debe alcanzar también a las líneas bloqueadas (`locked`, ya consumidas/ajustadas) — el flujo actual de `handleSubmit` las excluye de cualquier UPDATE, pero vincular a un pedido no toca cantidad/precio, así que debería estar permitido incluso sobre una línea bloqueada.

**Validación al guardar** (bloquear con aviso claro si falla):
- El pedido elegido debe ser del mismo proveedor que el albarán (defensa además del filtro del desplegable).
- Cada `articulo_id` del albarán debe existir entre las líneas del pedido elegido, y de forma no ambigua (si el pedido tuviera más de una línea para el mismo artículo, no hay forma automática de saber cuál corresponde).
- **No bloquear** solo porque el pedido ya tenga otro albarán vinculado — eso es entrega parcial normal (mismo patrón ya soportado en pedidos de venta), bloquearlo rompería un caso legítimo.
- Sobre-cobertura (que la cantidad total vinculada supere lo pedido): no bloquear tampoco — nada más en el flujo de compras lo bloquea hoy (a diferencia de ventas, que sí valida stock disponible), así que sería inconsistente introducirlo solo aquí.

No implementado — solo el diseño, para cuando aparezca un caso real.

## 9. Desplegable de consumo sin filtro estricto de `articulo_id`, con motivo/nota para sustituciones excepcionales

**Distinta de la #5** (esa es sobre reconocer líneas de receta con `ingrediente_id` — variantes genuinamente fungibles, tipo Huevina de distinto proveedor). Esta es sobre poder consumir, excepcionalmente, un artículo **distinto** al que fija la receta, cuando no son intercambiables en el caso normal — caso real que la motivó: Caja Grande y Caja Pequeña, cada una va con su tortilla, solo se sustituyen si se agota la que corresponde. Vincularlas al mismo `ingrediente_id` (como si fueran fungibles, patrón de la #5) sería incorrecto aquí: haría que ambas aparecieran como opciones indistinguibles en el desplegable de consumo **siempre**, no solo en la excepción — riesgo nuevo en el caso normal, no solo pérdida de una señal en el caso raro. Se descartó esa vía explícitamente tras evaluarlo.

**Diagnóstico confirmado contra el trigger real**: `check_consumo_produccion_pf()` (y por el mismo patrón, `check_consumo_produccion()`) **no valida en ningún momento que el lote consumido pertenezca al `articulo_id` de la receta** — el backend ya permite consumir un artículo distinto sin ningún problema. El único bloqueo hoy es de frontend: `cargarIngredientesConLotes()`, tanto en `Producciones.jsx` como en `ProduccionProductosFinales.jsx`, filtra el desplegable de consumo de cada línea estrictamente por `.eq('articulo_id', linea.articulo_id)` (o el `ingrediente_semielaborado_id`/`ingrediente_id` equivalente).

**Arreglo propuesto** (en ambas pantallas):
1. Quitar el filtro estricto — dejar elegir cualquier lote disponible en stock del mismo tipo (artículo o semielaborado), con el artículo/semielaborado de receta destacado/preseleccionado por defecto para no cambiar el flujo normal.
2. Añadir un campo `motivo`/nota **nullable** a `consumo_produccion_pf` y `consumo_produccion` (mismo espíritu que `ajustes_articulo.motivo`, pero opcional — la mayoría de consumos son la elección normal de receta y no lo necesitan). Se rellena **solo** cuando el lote elegido no coincide con el artículo/semielaborado que fija la receta de esa línea — esa es la señal que permite después contar/detectar cuántas veces hubo una sustitución excepcional (ej. cuántas veces se usó Caja Grande para una Tortilla Pequeña).

Esta idea ya se había identificado antes (durante el diagnóstico del filtro estricto de `articulo_id`) pero se perdió al reescribir la entrada #5 para documentar el hueco de `ingrediente_id` — de ahí que quede ahora como entrada propia, separada, para no perderla de nuevo.

No implementado — solo el diseño, para cuando se aborde.

## 10. Mostrar `referencia_proveedor` en el desplegable de selección de artículo

En el desplegable de selección de artículo (`PedidosCompra.jsx` y/o `AlbaranesCompra.jsx` en modo `compra_directa`), mostrar junto al nombre del artículo la `referencia_proveedor` (`articulo_proveedor.referencia_proveedor`) — dato ya capturado pero nunca mostrado en ningún desplegable, ya documentado hace tiempo como "capturado pero no reutilizado".

Como es N:M por proveedor, en principio parecía necesario decidir qué hacer en pantallas sin proveedor fijado (referencia preferente vs. omitir) — **pero confirmado que no hace falta**: en `PedidosCompra.jsx` el proveedor ya se elige primero, así que no hay ambigüedad. El desplegable de artículos que aparece después siempre puede mostrar directamente la `referencia_proveedor` de ESE proveedor ya fijado (join simple `articulo_proveedor` por `proveedor_id` + `articulo_id`), sin necesidad de decidir entre preferente/omitir.

Cambio más simple de lo que se planteaba inicialmente: solo añadir la referencia al label del desplegable ya existente.

Mejora de trazabilidad al identificar artículos rápido, sobre todo con nombres largos o similares entre sí.

✅ Implementado en `PedidosCompra.jsx` (commit `9905a4e`, 2026-08-08).

✅ Implementado también en `AlbaranesCompra.jsx` (modo `compra_directa` y modo "pedido", misma estructura de proveedor ya fijado). Probado en runtime real con proveedor Prodega: mismo resultado que en `PedidosCompra.jsx` (`"AOVE SPAIN (l) — ref. 125410"`, etc.), sin errores de consola.

## 11. `PedidosCompra.jsx`: cambiar de proveedor con líneas ya rellenas borra artículos sin avisar, deja cantidad/precio huérfanos

En `PedidosCompra.jsx`, cambiar de proveedor después de haber rellenado líneas de pedido borra silenciosamente los artículos seleccionados (probablemente porque ya no pertenecen al nuevo proveedor) pero deja las cantidades y precios de esas líneas colgados sin avisar — el usuario no se entera de que sus datos quedaron inconsistentes hasta que lo nota por sí mismo.

**Comportamiento correcto:** si se cambia de proveedor con líneas ya rellenas, mostrar una advertencia clara antes de proceder (ej. `confirm()` o modal: "Cambiar de proveedor borrará las líneas ya introducidas, ¿continuar?") y, si se confirma, limpiar las líneas por completo (no dejar cantidad/precio huérfanos de un artículo ya borrado).

**Prioridad:** más alta que mejoras cosméticas — puede llevar a guardar un pedido con datos inconsistentes sin que el usuario lo perciba.

✅ Implementado (commit `9905a4e`, 2026-08-08).

## 12. `Pedidos.jsx` (venta): no existe ningún flujo de edición, solo crear y cancelar

`Pedidos.jsx` (pedidos de venta) no tiene ningún flujo de edición — solo `handleSubmit` (crear) y `handleCancelar` (marcar `estado = 'cancelado'`, sin tocar líneas ni borrar nada). A diferencia de `AlbaranesCompra.jsx`, que sí tiene el ciclo completo de edición (`editandoId`, `lineasABorrar`, `handleEditar`, rama de `handleSubmit` para update, líneas bloqueadas con icono de candado cuando ya están consumidas/ajustadas).

**Trasplantar el mismo patrón es mecánicamente posible, pero más complejo que en compras**, por una asimetría real de esquema, no cosmética:

- `lineas_albaran_venta.linea_pedido_id` **sí** es FK exacta a la línea (`lineas_pedido_venta.id`) — igual de limpio que en compras, sin ambigüedad. Determinar qué líneas ya tienen entrega (parcial o total) es una query directa.
- `producciones_producto_final.pedido_id` es FK a la **cabecera** del pedido, no a la línea — enlace blando por diseño (comentario explícito en la migración `20260801_pedidos_venta.sql`: "Enlace blando (trazabilidad), no reserva dura"). Determinar qué línea concreta ya tiene producción vinculada solo se puede hacer cruzando `pedido_id` + `producto_final_id`, lo cual es **ambiguo** si el pedido tiene dos líneas del mismo `producto_final_id` — nada en el modelo ni en la UI actual lo impide hoy.

**Antes de implementar, decidir con el usuario:** ¿bloquear la línea igualmente por precaución cuando hay ambigüedad (dos líneas del mismo producto en el mismo pedido), o aceptar el riesgo y no bloquear por este criterio?

**Tamaño estimado:** bastante mayor que las mejoras mecánicas de `PedidosCompra.jsx` (#10 y #11) — del orden de ~150-200 líneas de patrón trasplantado más una decisión de diseño abierta, no solo trasplante directo.

✅ Fase 1 implementada (commit `6ae2954`, 2026-08-08): bloqueo completo de edición cuando el pedido tiene producción o entregas vinculadas; edición libre de cabecera y líneas cuando no. Fase 2 (bloqueo por línea en el caso ambiguo) sigue sin implementar — pendiente de decisión.

## 13. `Clientes.jsx`: refinar la UX del toggle activo/inactivo

Implementado en el commit que añade `clientes.activo` (columna boolean, default `true`): listado con badge "Activo"/"Inactivo" clicable para alternar directamente ahí, y filtro `.eq('activo', true)` solo en el desplegable de cliente de "Nuevo pedido" (`Pedidos.jsx`). Funciona, probado en runtime real por el usuario. Pendiente, como mejora de UX, no de corrección:

1. **Mover el toggle al formulario de edición**, quitándolo del listado — hoy se cambia con un clic directo sobre el badge de la fila; el usuario prefiere que solo se pueda cambiar desde "Editar cliente".
2. **Semáforo en vez de badge de texto** en el listado — sustituir el badge "Activo"/"Inactivo" por un indicador visual simple (punto rojo/verde), sin texto.
3. **Ordenar inactivos al final del listado** — hoy `cargarClientes()` ordena solo por `nombre` (`supabase.from('clientes').select('*').order('nombre')`); haría falta un segundo criterio de orden (activos primero, luego por nombre) o un `order('activo', { ascending: false })` antes del `order('nombre')`.

No implementado — solo la idea recogida, para cuando se aborde.

## 14. Registro de consumo en `Producciones.jsx`/`ProduccionProductosFinales.jsx` es uno-a-uno, no batch

Registro de consumo en `Producciones.jsx`/`ProduccionProductosFinales.jsx` es uno-a-uno (cada línea de receta dispara su propio guardado+refresco) en vez de batch.

**Hallazgo importante**: esto no es solo fricción de UX — un fallo a mitad del registro (ej. ingrediente 3 de 4 sin stock) deja los ingredientes anteriores ya guardados de forma no atómica.

**El trigger de validación (`check_consumo_produccion(_pf)`) ya es `DEFERRABLE INITIALLY DEFERRED`**, así que un `insert` multi-fila normal ya sería atómico sin necesitar ninguna migración de esquema.

**El patrón "acumular en estado, confirmar en bloque" ya existe en el mismo archivo** (`ProduccionCerradaEdicion`, vía RPC) — extender el mismo patrón a `ProduccionAbierta`.

**Tamaño estimado**: ~80-120 líneas, dos archivos casi idénticos.

**Decisión de diseño ya recomendada**: permitir registro parcial (solo líneas completadas), no exigir las 4 líneas rellenas a la vez, mismo patrón que `lineasValidas` ya usado en `Pedidos.jsx`/`PedidosCompra.jsx`.

No implementado — solo el diagnóstico y la estimación, para cuando se aborde.

## 15. `AlbaranesVenta.jsx`: permitir "forzar" añadir un producto fuera del pedido ligado

**Contexto — parte 1 ya implementada (filtro por defecto):** cuando el albarán viene con `pedido_id`, la lista de "Añadir productos finales"/"Añadir mercadería" ahora filtra por defecto a los productos/artículos que están en las líneas de ese pedido (`productosMostrados`/`articulosMostrados`, derivadas de `pedidoLineas`). Un albarán sin `pedido_id` (evento directo / venta directa) sigue mostrando el catálogo completo, sin cambios. Esto cierra el hueco de integridad más básico (añadir sin darse cuenta algo que el cliente no pidió), pero es solo el filtro — no hay forma de saltárselo cuando sí hace falta (venta real de algo adicional en el momento de la entrega).

**Lo que falta — parte 2, NO implementada, solo diseño:** un mecanismo explícito para forzar la inclusión de un producto/artículo fuera de las líneas del pedido, dejando constancia de que fue una adición en el momento de la entrega. Toca tres capas, no una:

**a) Esquema.** `lineas_pedido_venta` hoy solo tiene `id, pedido_id, producto_final_id, articulo_id, cantidad, precio_unitario, created_at, negocio_id` — verificado contra la base real, no hay ningún campo de texto/notas/origen. Hace falta una columna nueva nullable (decisión abierta: texto libre tipo `notas`, o un booleano `forzado`/`origen` tipo enum) antes de poder anotar nada.

**b) RPC de inserción atómica (no dos `.insert()` sueltos).** El flujo naive sería: insertar la línea nueva en `lineas_pedido_venta`, capturar su `id`, e insertarlo como `linea_pedido_id` en la nueva línea de `lineas_albaran_venta`. Pero son dos llamadas `.insert()` separadas desde el cliente — Supabase/PostgREST no las envuelve en una transacción común. Si la segunda falla, queda una línea de pedido huérfana ya guardada, sin entrega, sin que nadie lo note — mismo tipo de riesgo de no-atomicidad ya documentado en la entrada 14. La forma correcta es un RPC nuevo que haga ambos inserts en una sola transacción, siguiendo el patrón ya probado en este código (`rpc_editar_produccion_semielaborado`/`_producto_final`).

**c) Frontend.** Toggle/sección para revelar productos fuera del pedido (además de `productosMostrados`/`articulosMostrados`), marcar esas líneas como "forzadas" en el estado local de `lineas`, aviso visual en la tabla de líneas del albarán, y reestructurar `handleSubmit` para llamar al RPC en vez del insert directo actual quando haya líneas forzadas.

**Decisiones abiertas, no resueltas:**
- **Formato de la anotación**: texto libre vs. booleano/enum controlado (columna nueva en `lineas_pedido_venta`, punto (a) de arriba).
- **Precio de la línea de pedido forzada — quién lo decide**: usar el mismo precio ya tecleado en la línea del albarán (`ProductoParaVender`/`ArticuloParaVender` ya tienen ese campo) es razonable y consistente con un precedente ya existente (`lineas_pedido_compra.precio_unitario` y `entrada_material.precio` ya son independientes entre sí sin sincronización, en compras). Pero una vez creadas, las dos filas (pedido y albarán) quedan desacopladas — si se edita el precio del albarán después, el de la línea de pedido no se actualiza solo. A confirmar explícitamente antes de implementar, no asumir en silencio.
- **Interacción con la entrada 12 (Fase 2)**: si el pedido ya tenía dos líneas del mismo producto (nada lo impide hoy, ver entrada 12), forzar una tercera línea del mismo producto agrava esa ambigüedad ya conocida sobre qué línea concreta corresponde a qué producción/entrega. No es un problema nuevo de esta entrada, pero se solapan y conviene tenerlo presente si se abordan juntas.

**Ya cubierto sin trabajo extra**: la validación de stock (`check_stock_producto_final()`) es independiente de si existe línea de pedido o no, así que no hay riesgo nuevo de sobreventa por este cambio.

**Tamaño estimado**: migración (~15-20 líneas) + RPC nuevo (~50-70 líneas, rama producto/mercadería) + frontend en `AlbaranesVenta.jsx` (~80-120 líneas: toggle, estado de líneas forzadas, aviso visual, `handleSubmit` reestructurado) — del orden de **150-200 líneas repartidas en 3 capas**, sensiblemente más grande que el filtro de la parte 1 (que fue ~15 líneas, un solo archivo, sin backend).

No implementado — solo el diagnóstico y el diseño, para cuando se aborde.

## 16. `AjustesStock.jsx`: desplegable de lote crecerá sin límite con el histórico, sin distinción visual ni acotado por fecha

Verificado por grep exhaustivo en las cuatro pantallas que ofrecen selector de lote: `AjustesStock.jsx` es la **única** que no filtra por `stock_disponible > 0` en sus tres consultas de lote (`stock_lotes_articulo` línea 80, `stock_lotes_semielaborado` línea 87, `stock_lotes_producto_final` línea 94) — y es **correcto** que no lo haga, porque necesita poder mostrar y ajustar/corregir lotes ya agotados (a diferencia de las otras tres, donde ofrecer un lote sin stock para consumir/vender sí sería un bug). Las otras tres pantallas (`Producciones.jsx`, `ProduccionProductosFinales.jsx`, `AlbaranesVenta.jsx`) ya filtran correctamente con `.gt('stock_disponible', 0)` en todas sus consultas de lote — sin cambios necesarios ahí.

**El hueco no es de corrección, es de escalabilidad visual**: con el tiempo, la lista completa (agotados + con stock, histórico completo sin acotar) de cada ítem crecerá y será difícil de escanear de un vistazo para encontrar el lote correcto. Dos mejoras complementarias a evaluar cuando el volumen lo justifique — atacan el mismo problema de fondo desde ángulos distintos, ninguna sustituye a la otra:

1. **Agrupación visual por stock**: separar lotes con stock de lotes agotados dentro del mismo desplegable (ej. agrupación con `<optgroup>`, o una sección colapsable "Lotes agotados" aparte de la lista principal), en vez de filtrar por completo — mantiene la capacidad de corrección sobre cualquier lote sin perder legibilidad.
2. **Filtro por fecha**: acotar el desplegable por antigüedad. Dos variantes posibles a decidir cuando se aborde, no necesariamente excluyentes:
   - **(a) Por defecto, solo lotes de los últimos N meses**, ocultando histórico muy antiguo salvo que se pida explícitamente ver más ("mostrar todos").
   - **(b) Selector de rango de fecha** que el usuario controla activamente, para acotar la búsqueda cuando ya sabe aproximadamente cuándo ocurrió el lote que busca.

No implementado — no es urgente hoy (volumen bajo), para cuando el número de lotes por ítem lo justifique.

## 17. `AlbaranesVenta.jsx`: precio y cantidad pactados en el pedido no se heredan al construir el albarán

**Confirmado que sigue sin resolver** — no se abordó en ninguna sesión hasta ahora. Consolidado aquí por primera vez: el hallazgo ya existía disperso en `FLUJO_TORTILLA.md` (líneas 85, 88, 115 y 139, descrito ahí como "la asimetría más notable del sistema", Paso 6, cuello de botella #8 de la Sección A), pero **nunca tuvo entrada propia en este documento** — no había ninguna entrada desactualizada que cerrar, solo la ausencia de un punto de seguimiento accionable fuera de `FLUJO_TORTILLA.md`.

**Verificado contra el código real, no solo contra el diagnóstico previo**: cuando `AlbaranesVenta.jsx` se abre desde un pedido (`pedidoIdParam`), `pedidoLineas` (`AlbaranesVenta.jsx:262-268`) se usa **solo para filtrar** qué productos/artículos aparecen en la lista de "añadir" — nunca se pasa a `ProductoParaVender`/`ArticuloParaVender` como prop, así que esos componentes no tienen forma de saber cuál es la línea de pedido correspondiente. Consecuencia directa:

- `ProductoParaVender` (`AlbaranesVenta.jsx:434-439`): `cantidad` arranca vacía (`''`); `precio` arranca con `producto.precio_venta` — el precio de catálogo por defecto, **no** el `precio_unitario` pactado en `lineas_pedido_venta` para ese pedido concreto.
- `ArticuloParaVender` (`AlbaranesVenta.jsx:494-499`): igual para `cantidad`; `precio` arranca vacío del todo (ni siquiera hay un default de catálogo aquí).

**Riesgo real, no solo fricción de tecleo** (ya señalado en `FLUJO_TORTILLA.md` cuello de botella #8): si el precio pactado en el pedido difiere del `precio_venta` de catálogo (o de lo que se teclee de memoria) y nadie lo nota, el albarán —y la factura que sale de él— puede quedar con un precio distinto al pactado, sin ningún aviso.

**Solución no diseñada todavía, dirección probable**: pasar la línea de `pedidoLineas` que corresponde a cada `producto`/`articulo` mostrado como prop adicional a `ProductoParaVender`/`ArticuloParaVender`, y usar su `cantidad`/`precio_unitario` como valor inicial de los campos (en vez de `''`/`producto.precio_venta`) cuando exista. Sin diseñar todavía: qué pasa si la cantidad pactada supera el stock disponible del lote elegido (¿capar, avisar, dejar tal cual?), y si debe ser prellenado editable (probable) o de solo lectura.

No implementado — para cuando se aborde.

## 18. `AjustesStock.jsx`: solo permite ajuste relativo, no "cantidad final medida"

`AjustesStock.jsx` solo permite introducir el ajuste como cantidad relativa (suma/resta sobre el stock actual). En la práctica, muchas veces el flujo real es pesar físicamente el lote y teclear la cantidad final resultante, no calcular mentalmente la diferencia respecto al stock registrado.

**Mejora**: añadir un segundo modo de entrada ("Cantidad final" junto al ya existente "Ajuste relativo"), donde el usuario teclea el peso/cantidad real medida y el sistema calcula automáticamente el ajuste (cantidad final − stock actual del lote) y lo guarda igual que hoy en `ajustes_articulo`/`_semielaborado`/`_producto_final` — mismo dato final, solo cambia cómo se introduce.

Reduce cálculo mental y errores de signo al pesar en el momento.

No implementado — solo la idea recogida, para cuando se aborde.
