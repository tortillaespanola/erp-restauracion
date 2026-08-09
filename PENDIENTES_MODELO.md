# Pendientes conscientes del modelo de datos

Documento de seguimiento para decisiones de modelo que se identificaron durante la auditoría de asimetrías "camino ideal vs. variante directa/informal" (ver historial: Flujo A/B de compras, `tipo_venta` en ventas, `tipo_produccion` en producción) pero que se dejaron deliberadamente sin resolver, para no mezclarlas con el flujo de regularización de incidencias que todavía no existe.

## 1. `ajustes_articulo` / `ajustes_semielaborado` / `ajustes_producto_final` exigen un lote específico

Las tres tablas de ajustes (merma/corrección) requieren identificar el lote exacto de origen:

- `ajustes_articulo.entrada_material_id` — `NOT NULL`
- `ajustes_semielaborado.produccion_id` — `NOT NULL`
- `ajustes_producto_final.produccion_pf_id` — `NOT NULL`

En el día a día normal esto es correcto y deseable (trazabilidad exacta). Pero en un evento o showcooking caótico, puede no estar claro de qué lote concreto salió lo que se estropeó o no se consumió — por ejemplo, si hay dos lotes del mismo artículo mezclados físicamente sobre la mesa de trabajo. Hoy el sistema obligaría a elegir un lote aunque sea una atribución aproximada; no hay forma de registrar una merma "genérica" sin lote conocido.

**Por qué no se resolvió ahora**: a diferencia de la asimetría de bloqueo de stock (que impedía completar la acción por completo), aquí *sí* existe un camino — elegir el lote más plausible — así que el impacto es menor. Además, la forma correcta de resolverlo probablemente dependa de cómo se diseñe el futuro flujo de regularización de incidencias (¿una merma sin lote se reparte proporcionalmente entre los lotes negativos existentes? ¿se dispara desde la propia pantalla de incidencias en vez de desde el formulario de ajuste?) — resolverlo antes de tener ese diseño podría significar rehacerlo.

**Cuándo retomarlo**: junto con el diseño del flujo de regularización de `incidencias_stock_producto_final`, `incidencias_stock_articulo` e `incidencias_stock_semielaborado` (las tres tablas ya tienen `estado` ampliable a `'pendiente' | 'regularizado' | 'ignorado'`, preparadas para ese momento).

## 2. Vistas de stock agregado (`stock_articulos`, `stock_productos_finales`, `stock_semielaborados`) no agrupan por ubicación — y dos consumidores del frontend colisionarían si empezaran a hacerlo

Detectado durante el diseño de la Capa 2 de `ubicaciones` (vincular stock a ubicación, ver `UBICACIONES_DIAGNOSTICO.md`). Esa capa añade `ubicacion_id` solo a las tablas de lote y a sus vistas por-lote (`stock_lotes_articulo`, `stock_lotes_semielaborado`, `stock_lotes_producto_final`) — decisión deliberada, no un descuido. Las tres vistas agregadas siguen sumando el stock de un ítem a través de todos sus lotes sin distinguir ubicación.

Cuando una capa futura sí necesite mostrar stock por ubicación y agrupe también estas tres vistas por `ubicacion_id` (pasando de una fila por ítem a una fila por ítem+ubicación), dos consumidores del frontend colisionarán de forma silenciosa, sin ningún error visible:

- `Producciones.jsx:211-215` — `stockTotal.map(s => <tr key={s.semielaborado_id}>...)`: la key es solo `semielaborado_id`. Con dos filas del mismo semielaborado en dos ubicaciones, React colisiona claves y probablemente solo pinta una fila, ocultando stock real sin ningún error visible.
- `ProduccionProductosFinales.jsx:203-207` — mismo patrón exacto, `key={s.producto_final_id}`.

Ambas keys tendrán que pasar a compuestas (`item_id` + `ubicacion_id`) en esa misma tarea futura, no antes.

**Nota adicional, código muerto detectado de paso**: `stock_articulos` no tiene ningún consumidor en el frontend hoy (grep exhaustivo en `frontend/src`, cero coincidencias) — ya está muerta antes de tocar nada de ubicaciones. Vale la pena saberlo antes de invertir esfuerzo manteniéndola o agrupándola por ubicación en capas futuras si nadie la lee.

**Por qué no se resolvió ahora**: la Capa 2 de `ubicaciones` es deliberadamente solo "vincular" — añadir la columna a las tablas de lote y a sus vistas correspondientes, sin cambiar las vistas agregadas ni ningún trigger. Arreglar las keys de React ahora adelantaría trabajo de una capa que todavía no existe (agrupación de stock por ubicación) y que no se ha diseñado.

**Cuándo retomarlo**: junto con la capa que agrupe `stock_articulos`/`stock_productos_finales`/`stock_semielaborados` por `ubicacion_id` (probablemente Capa 3 o posterior, cuando exista un caso real de stock multi-ubicación visible en pantalla).

## 3. Carga de histórico masivo (futuro cliente con volumen alto de pedidos/ventas previas en Excel u otro sistema)

Hoy la carga de histórico se hace a mano vía interfaz porque el volumen propio es bajo.

**Por qué no se resolvió ahora**: no hay ningún caso real que lo exija — un importador genérico diseñado sin un formato concreto delante casi seguro no encajaría con el formato real del primer cliente que sí necesite carga masiva, y habría que rehacerlo de todos modos.

**Cuándo retomarlo**: cuando exista un caso real con volumen alto, diseñar un importador específico para el formato real de ese cliente en ese momento — no antes, no genérico.

## 4. Onboarding de un negocio/cliente nuevo desde cero: orden correcto para no repetir la conflación de artículos

El orden correcto es crear primero los ingredientes (`Ingredientes.jsx`), luego los artículos granulares por proveedor+calidad vinculados a su ingrediente, y construir las recetas apuntando siempre a `ingrediente_id`, nunca a `articulo_id` directo — evita desde el origen la conflación que tuvo que corregirse a posteriori en el negocio actual (Española), donde los 5 artículos base ya están atados a `receta_*` con `articulo_id` directo y no se pueden migrar sin rediseñar la receta primero.

**Por qué no se resolvió ahora**: no hay todavía ningún caso real de onboarding de un segundo negocio — documentarlo como checklist formal ahora sería escribir un procedimiento sin nadie que lo siga ni lo valide.

**Cuándo retomarlo**: cuando se aborde el onboarding real de un negocio/cliente nuevo, documentar esto como guía/checklist de alta inicial.

## 5. Campo de origen/país para `articulos_compra`

Relevante para trazabilidad y posible etiquetado, especialmente en materia prima (ej. huevos suizos, aceite español). Cambio pequeño: columna nullable en `articulos_compra` — falta decidir si texto libre o país controlado (tabla/enum).

Si en el futuro el origen resultara variar lote a lote para un mismo artículo (excepción, no la norma), el patrón ya existente es dar de alta un artículo nuevo vinculado al mismo ingrediente — mismo mecanismo que ya resuelve variantes de proveedor/calidad (ver `articulo_ingrediente`), no necesita campo de lote aparte.

**Por qué no se resolvió ahora**: no hay ningún caso real hoy que lo exija (ni un cliente pidiendo trazabilidad de origen, ni una necesidad de etiquetado activa) — decidir texto libre vs. controlado sin un caso real delante corre el mismo riesgo que un importador genérico: adivinar mal el formato.

**Cuándo retomarlo**: cuando exista un caso real de trazabilidad o etiquetado que lo requiera, decidir la forma del campo (texto libre vs. país controlado) en ese momento, con el caso real delante.

## 6. `producciones_producto_final` no valida en ningún nivel de backend que `pedido_id` corresponda a un pedido no cancelado/servido

Verificado contra el código y la base real (ver caso OV-260022): el único punto que impedía crear una producción sobre un pedido cancelado era de frontend (`Pedidos.jsx`, botón "Iniciar producción" — recién corregido). A nivel de backend no hay ningún `CHECK`, trigger o RPC que lo valide; probado con un `INSERT` directo (en transacción de prueba, con ROLLBACK) sobre un pedido real cancelado y tuvo éxito sin ningún error.

Si en el futuro se añade otra vía de creación de producciones (API directa, importador, otra pantalla), este hueco volvería a ser accesible sin que nadie lo note.

**Por qué no se resolvió ahora**: no urgente mientras el único punto de entrada real sea `Pedidos.jsx` con el fix de frontend ya aplicado — añadir una validación de backend para un único punto de entrada ya cubierto sería adelantar trabajo sin un segundo caso real que lo justifique.

**Cuándo retomarlo**: si aparece una segunda vía de creación de `producciones_producto_final` (API, importador, otra pantalla), añadir la validación a nivel de backend (trigger `BEFORE INSERT` que compruebe `pedidos_venta.estado`) para que no dependa solo del frontend que la llame.

## 7. Internacionalización: la capa de interfaz se puede posponer, el contenido de texto libre del usuario no

La capa de interfaz (textos de botones/menús/mensajes) sí puede ser la última pieza a montar, mismo patrón ya usado en las webs de Española/Company Valencia (`data-i18n`). Pero el contenido de texto libre introducido por el usuario (nombres de artículos, categorías, ingredientes, notas) no se traduce solo — si algún futuro cliente opera en un idioma distinto, ese contenido queda fijo en el idioma en que se tecleó, sin mecanismo de traducción entre negocios.

**Por qué no se resolvió ahora**: no es un problema para el negocio actual (todo en español) — no hay ningún caso real que lo exija todavía.

**Cuándo retomarlo**: antes de asumir que "idiomas" es solo una tarea de UI final, si algún día hay un cliente multi-idioma real — revisar entonces qué mecanismo de traducción (o de convivencia de idiomas) hace falta para el contenido ya introducido por usuarios, no solo para los textos fijos de la interfaz.
