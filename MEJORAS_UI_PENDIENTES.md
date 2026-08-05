# Mejoras de UI pendientes (post-histórico)

Documento separado de `PENDIENTES_MODELO.md` a propósito: aquí no hay ninguna decisión de esquema pendiente — los datos ya existen (o están a una columna aditiva de existir), es una cuestión de qué se muestra en pantalla, no de cómo se modela. Mezclar deuda de interfaz con decisiones de modelo dificultaría el seguimiento de ambas.

La mayoría de estas entradas son mejoras de comodidad, sin prisa. La entrada marcada **PRIORITARIO** es una excepción — bloquea operativa real hoy, no post-histórico.

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

No implementado — solo la idea recogida, para cuando se aborde.

## 5. PRIORITARIO — El desplegable de consumo filtra por `articulo_id` de forma estricta, sin respaldo en el modelo

`Producciones.jsx` y `ProduccionProductosFinales.jsx` filtran el desplegable de consumo de cada línea estrictamente por el `articulo_id` que fija la receta (`cargarIngredientesConLotes()`, `.eq('articulo_id', linea.articulo_id)`) — no hay forma de consumir un artículo distinto (ej. una variante de calidad/proveedor distinta comprada puntualmente) aunque el modelo de datos ya lo permite sin problema: `check_consumo_produccion()` no valida en absoluto contra `receta_semielaborado`, ninguna restricción de esquema lo impide (verificado contra el código real del trigger).

Bloquea operativa real hoy, no es solo mejora de comodidad — de ahí la prioridad.

**Arreglo mínimo**: quitar el filtro estricto de `articulo_id`, dejar elegir cualquier lote disponible en stock (con el artículo de receta destacado/preseleccionado por defecto).

**No requiere `familia_ingrediente`** — esa sería la mejora futura de sugerencia automática de variantes intercambiables (ver exploración de diseño ya discutida). Esto es solo quitar un bloqueo de UI que hoy no tiene ningún respaldo en el modelo.

No implementado — solo el diagnóstico y el arreglo mínimo propuesto, para cuando se aborde.
