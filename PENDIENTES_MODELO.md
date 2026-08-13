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

## 8. ✅ Resuelto — aviso (no bloqueo) al consumir/vender con `fecha_caducidad` ya pasada

**Decisión de diseño confirmada y aplicada**: aviso, no bloqueo — mismo criterio que `evento_directo` (permitir la operación con una señal visible, no impedirla), porque usar algo justo caducado puede ser una decisión operativa legítima que corresponde a un humano, no al sistema.

**Implementado** (migración `20260826_incidencias_caducidad_consumo_venta.sql`): 3 triggers (`AFTER`, `CONSTRAINT TRIGGER`, `DEFERRABLE INITIALLY DEFERRED`, mismo punto de enganche que los triggers hermanos de stock negativo) que cubren los 4 puntos de consumo/venta pedidos, mapeados a 6 ramas concretas:

- `registrar_incidencia_caducidad_consumo` (tabla `consumo_produccion`) — artículo→semielaborado (rama `entrada_material_id`) y semi→semi (rama `produccion_origen_id`).
- `registrar_incidencia_caducidad_consumo_pf` (tabla `consumo_produccion_pf`) — artículo→producto final y semielaborado→producto final.
- `registrar_incidencia_caducidad_venta` (tabla `lineas_albaran_venta`) — producto final→venta y mercadería→venta directa.

Cada rama, si `fecha_caducidad` del lote origen es anterior a la fecha destino, inserta una fila con `motivo='caducidad'` en `incidencias_stock_articulo`/`_semielaborado`/`_producto_final` (las tres ya ampliadas con esa columna en la migración previa `20260825_incidencias_stock_motivo_caducidad.sql`). Sin condición de `tipo_produccion`/`tipo_venta` — la incoherencia se avisa siempre, a diferencia de los triggers de stock negativo que sí se limitan a `evento_directo`.

**Verificado con certeza contra la base de datos real hoy** (2026-08-11, consulta directa a `pg_trigger`/`pg_proc`): los 3 triggers existen, están activos (`tgenabled = 'O'`) y apuntan a sus funciones correctas. La incidencia real que motivó el trabajo sigue en la tabla: `incidencias_stock_articulo` id `14`, `entrada_material_id=83`, `consumo_produccion_id=273`, `motivo='caducidad'` (la Huevina caducada consumida en producción real, `estado='ignorado'` — ya revisada por el usuario).

**Aviso visual en frontend** (no solo backend): `Producciones.jsx`/`ProduccionProductosFinales.jsx` marcan el lote con "⚠ caducado, revisar antes de usar" en el label del desplegable cuando `fecha_caducidad < fechaDestino`; `AlbaranesVenta.jsx` tiene el mismo cálculo `caducado` en sus dos desplegables de venta.

**Sin UI de lectura de las incidencias todavía** — se registran en la tabla pero no hay pantalla dedicada para revisarlas en bloque (mismo hueco ya señalado en `MEJORAS_UI_PENDIENTES.md` #19 sobre `evento_directo`, que comparte la misma laguna de "sin pantalla de incidencias").

## 9. Caducidad desconectada entre los tres niveles (artículo, semielaborado, producto final)

**Prioridad: alta — riesgo real de trazabilidad, no cosmético.** Verificado contra el esquema real: la caducidad solo existe hoy en dos de los tres niveles, y de forma completamente desconectada entre sí:

- `entrada_material.fecha_caducidad` (artículo) — capturada manualmente al recibir el albarán.
- `producciones_producto_final.fecha_caducidad` (producto final) — calculada de forma **independiente**, solo a partir de `productos_finales.dias_caducidad_default` + la fecha de producción (`calcular_fecha_caducidad_pf()`), **nunca** a partir de la `fecha_caducidad` de los ingredientes realmente consumidos en esa producción.
- `producciones_semielaborado` — ~~no tiene columna `fecha_caducidad` en absoluto~~ **actualización: ya la tiene** (`dias_caducidad_default` en `semielaborados` + `fecha_caducidad` en `producciones_semielaborado`, mismo patrón que producto final, migración `20260824_fecha_caducidad_semielaborado.sql`). Sigue siendo un cálculo **independiente** por nivel, no heredado de ingredientes — el resto de esta entrada sigue vigente tal cual.

**Decisión de modelo pendiente**: ¿debería la caducidad de un nivel heredar/acotarse por la caducidad más próxima de sus ingredientes consumidos (ej. una producción de Mezcla no podría caducar después que su Huevina más próxima a caducar), o mantener el diseño actual de valores independientes por nivel, cada uno con su propia lógica de cálculo o captura manual?

**Por qué no se resolvió ahora**: sin caso real urgente todavía que fuerce la decisión — cambiar `calcular_fecha_caducidad_pf()` para que dependa de los ingredientes consumidos (en vez de solo `dias_caducidad_default`) es una decisión de diseño no trivial (¿qué pasa si un ingrediente no tiene `fecha_caducidad` capturada? ¿se ignora, o bloquea el cálculo?) que no conviene tomar sin un caso real delante.

**Cuándo retomarlo**: junto con la entrada 8 si se aborda el aviso de consumo de materia prima caducada — son temas relacionados (ambos giran sobre cómo se usa `fecha_caducidad` a través de los niveles) pero decisiones independientes; no es necesario resolver ambas a la vez.

## 10. Historial de vigencia de `dias_caducidad_default` — sin caso real todavía

`dias_caducidad_default` (en `productos_finales` y, desde la entrada 9, también en `semielaborados`) es un único valor mutable por ítem, sin historial de cambios. Si cambiara por normativa, no quedaría constancia de qué valor aplicaba en cada fecha pasada — solo el valor actual.

**Por qué no es un problema hoy**: el diseño ya protege lo que de verdad importa. `fecha_caducidad` de cada producción se calcula **una vez**, al cerrar (`calcular_fecha_caducidad_semi()`/`_pf()`, disparado solo en la transición `abierta → cerrada`), y queda grabado como una foto fija en esa fila — no es una referencia viva a `dias_caducidad_default`. Si el valor por defecto cambia después, ninguna producción ya cerrada se ve afectada ni se recalcula retroactivamente (comportamiento correcto: un lote ya cerrado bajo la regla antigua no debe cambiar de fecha de caducidad porque alguien actualizó un ajuste). Así que la pregunta "qué caducidad tenía este lote" ya tiene respuesta directa sin necesitar reconstruir la regla — se lee `fecha_caducidad` de la producción concreta.

Un historial de vigencia (tabla tipo `dias_caducidad_historico: producto_id, dias, vigente_desde`) solo aportaría algo distinto: reconstruir la **regla** en sí para auditoría (ej. "por qué 10 días y no 8 en marzo"), no el resultado ya calculado.

**Por qué no se resolvió ahora**: `dias_caducidad_default` está en `null` para el 100% de productos finales y semielaborados reales hoy (verificado) — nunca se ha usado, y mucho menos cambiado. Construir un historial de versionado para un valor que nadie ha tocado nunca sería complejidad especulativa sin caso real, mismo criterio que el resto de este documento. Si algún día se cambia a mano, queda un rastro informal pero real vía migración fechada y documentada (mismo patrón ya usado en esta sesión, ej. `20260821_fix_fecha_entrega_prevista_typos.sql`).

**Cuándo retomarlo**: si `dias_caducidad_default` empieza a usarse de verdad y, además, cambia al menos una vez por un motivo que necesite quedar auditado (normativa, cambio de proveedor de packaging, etc.) — no antes.

## 11. Ajustes de stock sin validación de coherencia temporal — riesgo teórico de balance intermedio negativo

**Hallazgo teórico, sin caso real todavía.** Verificado con certeza directamente contra el esquema real (no por inferencia de migraciones — `ajustes_articulo`/`ajustes_semielaborado` se crearon antes del primer archivo de migración trackeado, así que se consultó `information_schema` y `pg_constraint` en vivo): `ajustes_articulo`, `ajustes_semielaborado` y `ajustes_producto_final` tienen columna `fecha`, pero **cero triggers y cero check constraints** relacionados con esa columna en ninguna de las tres tablas — a diferencia de consumo/venta, que sí tienen los triggers de coherencia de fecha y de aviso de caducidad ya implementados en esta sesión (entradas 8 y 9). `AjustesStock.jsx` tampoco valida nada en el cliente.

Las tres vistas de stock (`stock_lotes_articulo`, `stock_lotes_semielaborado`, `stock_lotes_producto_final`) calculan `stock_disponible` como un `SUM` incondicional de todos los ajustes del lote, sin filtrar por fecha — un ajuste con `fecha` de hace un mes cuenta exactamente igual que uno de hoy. Como el cálculo es un agregado puro sobre todo el histórico, el balance **final** siempre es matemáticamente correcto sin importar el orden de las fechas introducidas — pero nada impide que el balance en algún punto **intermedio** del histórico real hubiera sido negativo. Ejemplo concreto: lote con 10 kg, consumo de 8 kg registrado el día 5, y después alguien introduce un ajuste de −5 kg con `fecha` = día 1 (corrigiendo un error de pesaje inicial). El sistema lo acepta sin aviso; si el resultado final no queda negativo, la incoherencia intermedia (stock ya negativo entre el día 1 y el día 5) queda invisible, sin ningún trigger que la detecte ni la registre.

**Por qué no se implementa ninguna validación ahora**: a diferencia de las entradas 8/9 (con caso real confirmado, WIP-MIXKZ-260032), este es un riesgo de diseño identificado por diagnóstico, sin ningún ajuste real que lo haya provocado todavía. Añadir un trigger de coherencia especulativo sin caso real que lo motive iría contra el mismo criterio ya aplicado en el resto de este documento (ver entrada 10).

**Cuándo retomarlo**: si aparece un caso real de un ajuste con fecha retroactiva que efectivamente cruce una fecha de consumo/venta posterior del mismo lote — entonces sí, diseñar la validación (probablemente aviso, no bloqueo, mismo criterio que las entradas 8/9) con ese caso real delante.

**Nota menor (no prioritaria)**: `ajustes_articulo` y `ajustes_semielaborado` tienen `motivo` como texto libre sin categorización — a diferencia de `ajustes_producto_final`, que ya tiene `'caducado'` como valor explícito de `motivo_categoria`. Caso marginal: alguien podría ajustar un lote caducado por otro motivo sin fijarse en la caducidad. No justifica un trigger de aviso (el usuario ya está mirando el lote de cerca al ajustarlo), pero si algún día se decide dar `motivo_categoria` controlado también a estas dos tablas (por consistencia con producto final), sería el momento de revisar esto de nuevo.

## 12. `tanda_id` ha quedado huérfano tras la Vista Dinámica de Producción — ningún camino de la UI crea ya una `tandas_produccion`

La Vista 1 (`PedidosDelDia.jsx`, ahora "Producciones del día") y la validación previa de Vista 2 (`Producciones.jsx`) de `CONTRATO_VISTA_DINAMICA_PRODUCCION.md` sustituyeron el flujo de agrupación por tanda por uno de necesidad agregada de semielaborado — sin crear ni asignar `tandas_produccion` en ningún punto del nuevo camino. El mecanismo en sí sigue intacto y funcional (tabla `tandas_produccion`, columnas `tanda_id` en `pedidos_venta`/`producciones_semielaborado`/`producciones_producto_final`, los modos `?tanda_id=` de `Producciones.jsx` y `ProduccionProductosFinales.jsx`, y `CierreTanda.jsx` completo con su reparto FIFO) — pero **inalcanzable**: nada en la UI actual escribe ya una fila nueva en `tandas_produccion`, así que no hay forma de llegar a `CierreTanda.jsx` (que además ya no tiene entrada en el menú lateral) salvo conociendo de antemano una `tanda_id` real.

**Por qué no se resolvió ahora**: la Vista Dinámica de Producción se diseñó y verificó deliberadamente por fases (Vista 1 → validación de Vista 2), dejando explícitamente fuera de alcance el "Estado 2" (albaranar en masa una vez el stock está en verde) — que es precisamente donde había que decidir si ese estado 2 revive `tandas_produccion` como su mecanismo de agrupación, lo sustituye por otro, o reconecta `CierreTanda.jsx` tal cual. Resolver esto antes de tener ese diseño sería adivinar.

**Cuándo retomarlo**: al escribir el contrato de Estado 2 — decidir explícitamente si `tandas_produccion`/`CierreTanda.jsx` se reutilizan, se rediseñan o se retiran. Detalle completo del estado y de las tres piezas huérfanas en `CONTRATO_VISTA_DINAMICA_PRODUCCION.md` (cabecera de estado y sección "Fuera de alcance de este contrato").
