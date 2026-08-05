# Mejoras de UI pendientes (post-histórico)

Documento separado de `PENDIENTES_MODELO.md` a propósito: aquí no hay ninguna decisión de esquema pendiente — los datos ya existen (o están a una columna aditiva de existir), es una cuestión de qué se muestra en pantalla, no de cómo se modela. Mezclar deuda de interfaz con decisiones de modelo dificultaría el seguimiento de ambas.

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
