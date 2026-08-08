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
| Las 3 pantallas | Semielaborado | `codigo_lote` (de `producciones_semielaborado.codigo_lote`) | **No disponible todavía** — `stock_lotes_semielaborado` no lo expone. Útil porque hoy dos lotes de semielaborado de la misma fecha son indistinguibles en el desplegable (`Producción ${fecha} · disp.`, sin más). |
| Las 3 pantallas | Semielaborado | `notas` (de `producciones_semielaborado.notas`) | **No disponible todavía** — mismo caso que `notas` de artículo: falta añadirla a `stock_lotes_semielaborado` primero. |

No implementado — solo el diagnóstico de qué campo falta en qué pantalla y de dónde saldría, para cuando se aborde.

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

## 7. Componente de fecha personalizado

**Problema detectado:** los inputs `<input type="date">` nativos dependen del idioma/locale configurado en el navegador de cada máquina, no del sistema operativo. Si el navegador tiene el idioma en inglés (US), el orden de los campos cambia a mm/dd en vez de dd/mm, causando confusión al introducir fechas manualmente.

**Solución propuesta:** sustituir los inputs de fecha nativos por un componente de fecha personalizado en React (ej. `react-datepicker`), que controle el formato dd/mm/aaaa de forma fija desde el código, independiente de la configuración de cada máquina/navegador.

**Prioridad:** baja/media — no bloquea el uso actual (se soluciona a nivel de navegador), pero mejora la robustez del sistema al desplegar en distintas máquinas o para otros usuarios futuros.

**Fase:** revisar durante Layers 1 y 2 (UI/UX).

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
