# Contratos de datos — pantallas POS del flujo diario

Documento puente entre `FLUJO_TORTILLA.md` Sección D (el diagnóstico del flujo real) y el wireframe visual, que es una tarea separada posterior. Aquí solo se define, por pantalla, **qué lee, qué escribe, qué necesita teclear el usuario, y qué falta en el modelo** — nada de componentes, nada de layout.

Mapa de las 5 pantallas propuestas contra las 7 fases + entrega ya documentadas en la Sección D:

| Pantalla POS | Fases de la Sección D que cubre |
|---|---|
| 1. Pedidos del día | Fase 1 (agregación) |
| 2. Picking en almacén | Fases 2-3 (picking + pesaje de artículos) |
| 3. Producción de mezcla | Fases 5-6 (producción + pesaje de la mezcla) |
| 4. Producción de producto final | Fase 7 |
| 5. Cierre / entrega | La entrega a los clientes, ya identificada en la Sección D como necesaria para cerrar el día aunque quedara fuera de las 7 fases numeradas |

La Fase 4 (traslado a cocina) no tiene pantalla propia aquí tampoco — sigue siendo una acción puramente física sin ningún dato que capturar, tal como ya concluyó la Sección D; no se inventa una pantalla para ella.

## Diseño acordado: `tandas_produccion` (persistente, no memoria de sesión)

Una primera versión de este documento proponía pasar el conjunto de pedidos del día en memoria del navegador entre pantallas. Se descartó: el flujo cruza dispositivos y turnos (almacén, cocina, entrega pueden ser sesiones distintas), así que necesita estado en servidor. Diseño acordado:

- **`tandas_produccion`** (id, fecha, estado, negocio_id) — tabla nueva, mismo tamaño que `ubicaciones` cuando se creó. `estado` seguirá el mismo patrón ya usado en el resto del esquema (`'abierta'` mientras se trabaja en las pantallas 1-4, `'cerrada'` tras la pantalla 5), para que cualquier pantalla pueda preguntar "¿cuál es la tanda activa de hoy?" sin depender de nada del navegador.
- **`pedidos_venta.tanda_id`** (uuid, nullable, FK directa a `tandas_produccion`) — no una tabla puente N a N. La relación real es 1 a N (una tanda agrupa varios pedidos; un pedido pertenece a una sola tanda) — no hay caso hoy de un pedido repartido entre dos tandas, así que no se modela esa flexibilidad todavía. Mismo patrón que ya usa el esquema (`producciones_producto_final.pedido_id`, FK singular de hijo a padre).
- **`producciones_semielaborado.tanda_id`** y **`producciones_producto_final.tanda_id`** (uuid, nullable, FK a `tandas_produccion`) — para que las pantallas 3 y 4 registren de qué tanda forman parte.

✅ **Esquema implementado** (commit `4e8a0a1`, migración `20260811_tandas_produccion.sql`) — `tandas_produccion` y las tres columnas `tanda_id` existen y están activas hoy en el esquema real (verificado 2026-08-11 contra `information_schema`: las tres nullable, tipo `uuid`; `tandas_produccion` con 0 filas — nunca usada, porque no existe todavía ninguna pantalla que escriba en ella). El esquema está listo; lo que falta en las 5 pantallas de abajo es exclusivamente la UI.

---

## Ajuste transversal — el bloqueo de edición de `Pedidos.jsx` debe reconocer `tanda_id`, no solo `pedido_id`

**El ajuste más importante de este documento — riesgo real si se omite.**

El bloqueo de edición implementado en `MEJORAS_UI_PENDIENTES.md` #12 Fase 1 (commit `6ae2954`) comprueba, en `Pedidos.jsx:149`, `producciones_producto_final.eq('pedido_id', pedido.id)` para decidir si el pedido ya tiene producción vinculada y debe bloquearse. Pero en el flujo de tanda (Pantalla 4, más abajo), `producciones_producto_final.pedido_id` **queda sin rellenar a propósito** — el vínculo real es `tanda_id`, no `pedido_id`.

**Consecuencia si no se corrige**: un pedido que forma parte de una tanda abierta, con producción ya en curso o cerrada, seguiría apareciendo como editable en `Pedidos.jsx` sin ningún aviso — el mismo riesgo de editar sobre un dato ya comprometido que la #12 se creó para evitar, reabierto por una vía que no existía cuando se escribió esa entrada.

**Corrección requerida en `Pedidos.jsx`**: la consulta de bloqueo debe comprobar también producción vinculada vía tanda — un pedido con `tanda_id` asignado, cuya tanda tiene al menos una `producciones_producto_final` con ese mismo `tanda_id`, debe bloquearse igual que uno con `producciones_producto_final.pedido_id` directo. Join indirecto: `pedidos_venta.tanda_id → producciones_producto_final.tanda_id` (misma `tandas_produccion`), no un join literal entre las dos tablas.

**Cuándo aplicarlo**: junto con la Pantalla 1 (la primera vez que algo escribe `pedidos_venta.tanda_id`) — no debe quedar ni un commit en que un pedido pueda tener `tanda_id` asignado sin que `Pedidos.jsx` sepa bloquearlo por esa vía.

**Sobre la naturaleza "desechable" de `tandas_produccion` — por qué el bloqueo no necesita lógica de "tanda válida/inválida":** el propietario describe `tandas_produccion` deliberadamente como una muletilla de tecleo desechable, no un objeto con ciclo de vida robusto — si algo cambia por detrás (pedido editado, fecha modificada, el semielaborado se consumió para otra cosa), la tanda simplemente "queda deshabilitada" de facto: no hace falta reconciliarla, no hace falta una pantalla de gestión de tandas rotas, no hace falta que `estado` sea a prueba de fallos.

Esto no obliga a rediseñar el bloqueo de arriba — ya está alineado con esa idea sin haberlo nombrado explícitamente. Lo que el bloqueo protege no es la tanda, es la **producción real ya ocurrida** (`producciones_producto_final`/`producciones_semielaborado` con filas reales, consumo de stock real vía `consumo_produccion(_pf)`) — un riesgo que existe con independencia total de si `tandas_produccion` es una tabla robusta o una muletilla desechable. La condición de bloqueo consulta la existencia de producción real vinculada por `tanda_id`, **nunca** `tandas_produccion.estado` — un `tanda_id` asignado a un pedido cuya tanda nunca llegó a producir nada (tanda abandonada, "deshabilitada" en la práctica) no bloquea nada, correctamente, porque no hay nada real que proteger todavía. Si se hubiera diseñado el bloqueo como "cualquier pedido con `tanda_id is not null` se bloquea", sí habría contradicho la naturaleza desechable — penalizaría al operador por un objeto sin consecuencia. No es así como está diseñado.

**Consecuencia práctica para el resto de pantallas**: ninguna necesita comprobar ni mantener sincronizado `tandas_produccion.estado` para que el resto del sistema siga siendo correcto — es un campo informativo, no una fuente de verdad de la que otro código dependa.

---

## 1. Pedidos del día (agregación)

**Diseño confirmado por el propietario contra un mockup real** (sustituye la descripción original de "lista de pedidos candidatos" por la jerarquía real esperada en pantalla):

**Lee:**
- `pedidos_venta` agrupado por **`fecha_entrega_prevista`**, no por `fecha` (creación) — filtrado además por `estado`, join con `clientes.nombre`. `fecha_entrega_prevista` es `nullable`; verificado contra los datos reales (2026-08-11): los 65 pedidos no cancelados existentes la tienen rellena, 0 nulos hoy. Bajo riesgo, pero el contrato no debe asumir que seguirá siendo así — un pedido con `fecha_entrega_prevista is null` va a una cubeta explícita **"sin fecha de entrega"**, nunca desaparece en silencio de la agrupación.
- `lineas_pedido_venta` de esos pedidos — join con `productos_finales.nombre`/`articulos_compra.nombre`, necesario para agrupar cada línea bajo su `producto_final_id` (nivel superior de la jerarquía, ver "Muestra").
- `necesidades_pedidos(p_pedido_ids)` — **`necesidades_pedidos()` es agnóstica a fecha**: verificado contra su definición real, no filtra ni agrupa por ningún campo de fecha en su cuerpo, solo recibe el array de ids ya resuelto. Es esta pantalla, no la función, la que decide qué pedidos entran en cada grupo según `fecha_entrega_prevista` — se llama una vez por cada grupo fecha+producto que el usuario confirme, con los ids de ese grupo.
- Producción ya vinculada por `tanda_id` (`producciones_semielaborado`/`producciones_producto_final` de tandas relacionadas con los pedidos mostrados), para calcular el indicador de estado por grupo — ver "Muestra".

**Muestra — jerarquía de 3 niveles, no lista plana** (`producto_final → fecha_entrega_prevista → cliente`, según el mockup real):

1. **Nivel producto_final** (ej. "Tortilla de Patatas") — cabecera de sección.
2. **Nivel fecha_entrega_prevista** (ej. "18/08") dentro de cada producto — fila de subtotal en negrita con la cantidad agregada de ese grupo (ej. **8**). Es este número el que alimenta la decisión de cuánta Mezcla producir — corresponde al nivel `semielaborado` de `necesidades_pedidos()` calculado solo sobre los pedidos de ese grupo concreto, no de toda la pantalla.
3. **Nivel cliente**, dentro de cada grupo fecha+producto — una fila por cliente con su cantidad (ej. "Zum Kuss · 2"). Las filas de cliente muestran **solo cantidad, nunca su propio estado** — el estado no existe a este nivel.

**El indicador de estado (columnas "Semielaborado"/"Producto Final") vive a nivel de grupo fecha+producto, nunca por fila de cliente** — porque la producción real (la Mezcla, la Tortilla) se hace una vez para todo el grupo, no una vez por cliente. Se deriva de si existe ya `producciones_semielaborado`/`producciones_producto_final` vinculada por `tanda_id` a los pedidos de ese grupo: vacío = pendiente, con indicador visual = ya generada. Cálculo derivado por consulta, sin ninguna columna nueva que mantener sincronizada — mismo criterio que la derivación de origen de incidencia ya usada en la Pantalla 5.

**Escribe:**
- `tandas_produccion` (insert, `estado = 'abierta'`) — **una tanda por fecha, compartible entre productos, no una por grupo fecha+producto.** Caso real que lo motivó: una misma producción de Mezcla puede repartirse entre dos productos finales distintos (ej. Tortilla Grande y Tortilla Pequeña) — forzar una tanda separada por producto habría creado dos tandas para lo que en la realidad es una sola Mezcla. La reutilización de tanda se busca por `fecha_entrega_prevista` (o la cubeta "sin fecha"), no por `producto_final + fecha`. Cuando un grupo sin tanda propia coincide en fecha con una tanda ya confirmada en **otro** producto, la pantalla ofrece una elección explícita, no una fusión automática por coincidencia de fecha (dos productos pueden compartir fecha sin compartir Mezcla realmente): **"Añadir a la tanda existente (compartiendo con X)"** o **"Crear tanda independiente"**. El rango de fechas visible en pantalla sigue siendo solo de visualización/planificación (como en el mockup con 18/08 y 19/08 a la vista a la vez); la tanda se abre o se comparte cuando el operador confirma un grupo concreto.
- `pedidos_venta.tanda_id` (update) para cada pedido incluido en ese grupo.

**Inputs del usuario:** elegir el rango de fechas a visualizar (para ver varios grupos por delante, como en el mockup); dentro de un grupo fecha+producto concreto, deseleccionar algún pedido si no quiere incluirlo en esa tanda; confirmar para abrir la tanda de ese grupo.

**Qué falta hoy:** nada a nivel de esquema — `tandas_produccion` y `pedidos_venta.tanda_id` ya existen (ver arriba). Falta solo la pantalla: ningún componente en `frontend/src` los usa todavía. A nivel de lectura tampoco falta nada — `necesidades_pedidos()` ya cubre exactamente esto, incluido el nivel `ingrediente` añadido después de la primera versión de este documento (ver Pantalla 2, más abajo, para cómo debe presentarse).

---

## 2. Picking en almacén

**Lee:** los niveles `articulo` **e `ingrediente`** de `necesidades_pedidos()`, heredados de la pantalla 1 (no se recalcula).

**Nivel `ingrediente` — decisión explícita, aunque sin caso real todavía:**

`necesidades_pedidos()` devuelve hoy 4 niveles, no 3 como asumía la primera versión de este documento — se le añadió `'ingrediente'` en la migración `20260813_ingredientes.sql`, posterior al contrato original. A diferencia del nivel `articulo` (siempre resuelto a un artículo concreto), el nivel `ingrediente` es deliberadamente ambiguo: agrupa variantes intercambiables (ej. Huevina normal/Premium) sin decidir cuál usar — esa decisión es humana y ocurre en la pantalla de producción (3/4), no en el almacén.

**Decisión para esta pantalla**: mostrar el nivel `ingrediente` como una sección separada del nivel `articulo`, con la etiqueta del ingrediente y su cantidad (ej. "Huevina: 4.2 kg"), sin intentar resolverlo a un artículo concreto aquí — resolverlo en el picking adelantaría una decisión que el diseño ya asignó deliberadamente a otra pantalla. El operador de almacén ve "hace falta Huevina, 4.2 kg, de cualquier variante disponible" y prepara cualquier lote válido; la elección de lote/variante exacta queda para el registro de consumo en la Pantalla 3/4, igual que ya ocurre hoy con la elección de lote dentro de un mismo artículo.

**Sin caso real todavía** — ninguna receta real usa `ingrediente_id` hoy (las 5 líneas reales de receta siguen con `articulo_id` directo, ver migración `20260813_ingredientes.sql`). Si la pantalla se construye antes de que exista un caso real, la sección de `ingrediente` puede quedar simplemente vacía/oculta cuando no hay filas de ese nivel que mostrar — no bloquea nada.

**Escribe:** nada — y no propongo crear una tabla nueva solo para esto. El motivo, ya lo documentó la Sección D: "pesar el artículo" y "registrar el consumo en la producción" son, en la práctica, el mismo número (`consumo_produccion.cantidad`). Separarlos en dos registros (uno de "lo pesado en almacén" y otro de "lo consumido en cocina") crearía una tabla cuyo único propósito sería detectar diferencias entre ambos — un caso de uso que nadie ha pedido todavía. Es el mismo criterio que ya aplica `PENDIENTES_MODELO.md`: no diseñar la solución antes de tener el caso real.

**Inputs del usuario:** marcar visualmente qué artículos ya se han cogido/pesado — un checklist de sesión, no persistido (aquí sí basta con memoria de sesión: es un checklist de un solo tramo del flujo, en un único dispositivo/momento, no algo que deba sobrevivir a un cambio de turno).

**Qué falta hoy:** nada que deba resolverse en esta capa. Si en el futuro hace falta trazabilidad de pesaje-vs-consumo (mermas detectadas ya en el almacén, por ejemplo), sería una tabla nueva con su propio diseño en ese momento — se señala aquí para no perder el hilo, no se propone ahora.

---

## 3. Producción de mezcla (cocina)

**Lee:**
- El nivel `semielaborado` de `necesidades_pedidos()` — p. ej. "Mezcla: 12 kg" — para precargar la cantidad a producir.
- `receta_semielaborado` — los 4 ingredientes y su proporción por unidad de semielaborado.
- `stock_lotes_articulo` — para elegir de qué lote concreto de cada artículo se consume (esto no cambia: el sistema sigue sin elegir el lote automáticamente, solo lo ordena por caducidad como ya hace hoy).

**Escribe:**
- `producciones_semielaborado` (insert; `tanda_id` = la tanda abierta en la pantalla 1; `cantidad_producida` se confirma al cerrar).
- `consumo_produccion` (una fila por ingrediente).

**Precarga automática:**
- La "cantidad a producir" deja de ser un campo en blanco para teclear y pasa a precargarse directamente del nivel `semielaborado` de `necesidades_pedidos()`, editable (el peso real de la mezcla cocinada puede variar del teórico, así que no se bloquea, solo se sugiere).
- Los 4 consumos se precalculan multiplicando `receta_semielaborado.cantidad × cantidad_necesaria del nivel "semielaborado"` (no leyendo el nivel `articulo` ya sumado de `necesidades_pedidos()`, que mezclaría el origen si en el futuro hubiera más de un semielaborado en la misma tanda del día — hoy con un solo semielaborado da el mismo resultado, pero este es el cálculo que sigue siendo correcto cuando deje de haberlo). El usuario solo confirma el lote de cada artículo y, si hace falta, ajusta la cantidad exacta.

**Inputs del usuario:** lote a consumir por ingrediente (de una lista ya filtrada/ordenada) + peso real al cerrar. Nada de tecleo de cantidades si no hay desviación respecto al plan.

**Sustitución excepcional, aviso de caducidad y batch de consumo — patrones ya construidos en `Producciones.jsx`, a heredar tal cual, no a rediseñar:**

- Cada línea de consumo debe ofrecer, junto al `<select>` de lote de receta, el enlace "Buscar sustituto" (visible solo si hay alternativas reales en la misma `categoria_id`, ver `MEJORAS_UI_PENDIENTES.md` #9) — mismo componente y misma lógica de filtrado que `Producciones.jsx` hoy, no una versión nueva. Al elegir un sustituto, la línea pasa a modo "SUSTITUCIÓN EXCEPCIONAL" (fondo/borde ámbar) y `consumo_produccion.motivo`/`nota` se rellenan igual que en `Producciones.jsx`.
- El label de cada lote debe marcar "⚠ caducado, revisar antes de usar" cuando `fecha_caducidad < fecha de la producción` — mismo cálculo (`caducado`) y misma redacción que ya usan `Producciones.jsx`/`ProduccionProductosFinales.jsx`.
- El registro de consumo debe seguir el patrón batch ya implementado (`MEJORAS_UI_PENDIENTES.md` #14): formulario controlado, líneas acumuladas en estado local, confirmación con un único insert multi-fila — no uno-a-uno. Este patrón ya coincide con la propia idea de "precarga automática" de esta pantalla, así que no hay tensión de diseño entre ambos.

✅ **Implementado — integrado en `Producciones.jsx` (`?tanda_id=`), no una pantalla nueva.** Decisión tomada al comparar ambas vías: crear una pantalla aparte habría obligado a extraer `cargarIngredientesConLotes`/`IngredienteConsumo`/el patrón de confirmación en batch a un módulo compartido o a duplicarlos — más riesgo que extender la pantalla que ya hace exactamente esto, mismo precedente ya usado por `ProduccionProductosFinales.jsx` con `?pedido_id=`. Entrada nueva desde la Pantalla 1: enlace "Producir semielaborado →" en cada grupo con tanda ya confirmada, navegando a `/producciones?tanda_id=X`.

`Producciones.jsx` gana: preselección del semielaborado en el formulario de inicio si la tanda solo necesita uno (`necesidadesSemielaboradoDeTanda`, recalculado en vivo contra el conjunto *actual* de pedidos de la tanda, no memorizado desde la Pantalla 1 — sigue siendo correcto si se añaden pedidos después); `tanda_id` guardado al iniciar; un bloque nuevo "Cantidad a producir — sugerida por la tanda" (editable) en `ProduccionAbierta`, con precarga automática de los 4 consumos (`receta_semielaborado.cantidad × cantidad_objetivo`, tal como fija el contrato) la primera vez que hay dato suficiente, y un enlace "Recalcular consumos sugeridos" para reaplicar tras editar la cantidad a mano.

Probado en runtime real, login real, con el catálogo real (receta de Mezcla, 4 ingredientes vía `ingrediente_id`) y una tanda de prueba construida desde la Pantalla 1 real:
- Cantidad sugerida precargada correctamente (1 kg, coincidente con `receta_producto_final.cantidad × cantidad pedida`) y los 4 consumos precalculados (0.800/0.350/0.400/0.150) sin tocar el nivel `articulo` ya sumado.
- Caso de aviso de caducidad: lote real ya caducado (`fecha_caducidad` anterior a la fecha de producción) marcado "⚠ caducado" en su label, seleccionado y confirmado sin bloqueo.
- Caso de sustitución excepcional: ingrediente sin stock suficiente de receta, sustituido por otro de la misma `categoria_id` vía "Buscar sustituto" — `consumo_produccion.motivo`/`nota` verificados directamente contra la base de datos.
- Confirmación en batch (4 líneas, un solo insert) verificada.
- La producción real preexistente (no vinculada a ninguna tanda) quedó intacta durante toda la prueba — verificado explícitamente antes y después.
- 0 errores de consola. Producción, consumos, pedido y tanda de prueba borrados al terminar — el borrado de la producción revirtió el stock de los lotes reales consumidos a sus valores exactos anteriores (verificado antes/después).

No hay forma de distinguir "esto es lo que pedí producir" de "esto es lo que decidí hacer de más" si el usuario sube la cantidad sugerida a propósito (colchón de seguridad) — no bloquea nada, solo se pierde ese matiz para reporting futuro. Sigue sin implementar, sin caso real que lo exija todavía.

---

## 4. Producción de producto final

**Lee:**
- El nivel `producto_final` de `necesidades_pedidos()` — p. ej. "Tortilla Española: 6" — para precargar la cantidad a producir.
- `receta_producto_final` — hoy 1 solo ingrediente (2 kg de Mezcla por unidad).
- `stock_lotes_semielaborado` — para sugerir el lote de Mezcla recién cerrado en la pantalla 3 (en un flujo POS lo normal es consumir inmediatamente lo que se acaba de producir, así que puede preseleccionarse en vez de solo ordenarse).

**Escribe:**
- `producciones_producto_final` (insert; `tanda_id` = la tanda abierta en la pantalla 1). **`pedido_id` queda sin rellenar** en este flujo agregado: es una FK singular pensada para el botón "Producir" de un pedido suelto que ya existe en `Pedidos.jsx`, no para una tanda que sirve a N pedidos a la vez. No es una pérdida de información — con `tanda_id` ya se puede llegar a los N pedidos vía `pedidos_venta.tanda_id`, así que ese campo simplemente no aplica aquí.
- `consumo_produccion_pf` (1 línea: la Mezcla consumida, mismo cálculo que en la pantalla 3: `receta_producto_final.cantidad × cantidad_necesaria del nivel "producto_final"`).

**Vínculo a los pedidos que se están sirviendo:** resuelto por `tanda_id`, no por nada que esta pantalla tenga que pasar explícitamente — la pantalla 5 lo recupera consultando `pedidos_venta where tanda_id = X`.

**Inputs del usuario:** lote de Mezcla a consumir (preseleccionado) + cantidad neta real al cerrar.

**Sustitución excepcional, aviso de caducidad y batch de consumo**: mismos tres patrones descritos en la Pantalla 3, aplicados aquí a `consumo_produccion_pf` en vez de `consumo_produccion` — no se repiten los detalles, es el mismo contrato.

**Qué falta hoy:** nada a nivel de esquema — `producciones_producto_final.tanda_id` ya existe. El campo `pedido_id` singular se mantiene sin cambios para el flujo de un pedido suelto que ya existe; no hace falta ninguna tabla puente N a N para el caso agregado, `tanda_id` ya lo resuelve. Falta la pantalla y los tres patrones heredados de la Pantalla 3.

---

## 5. Cierre / entrega

**Lee:**
- `pedidos_venta where tanda_id = X` y sus `lineas_pedido_venta`, para saber cuánto le corresponde a cada cliente — ya no depende de nada heredado en memoria, se recupera de servidor con la tanda como ancla.
- `producciones_producto_final.cantidad_producida` de la producción cerrada en la pantalla 4 (vinculada a la misma tanda).
- `stock_lotes_producto_final`, para confirmar el disponible real.

**Cálculo antes de escribir (el ajuste acordado):** la pantalla compara, para el producto final de la tanda, el total pedido (suma de `lineas_pedido_venta.cantidad` de los pedidos de la tanda) contra `cantidad_producida`, **antes de intentar ningún insert**:

- **Si no hay déficit**: reparto automático — un `albaranes_venta` por pedido/cliente (mismo mecanismo que ya usa hoy `AlbaranesVenta.jsx` cuando se inicia desde `Pedidos.jsx`) y una `lineas_albaran_venta` por cada uno, con `produccion_pf_id` = el lote recién producido y `cantidad` = lo pedido. Esto **ya funciona sin cambios en el esquema actual**: `lineas_albaran_venta.produccion_pf_id` no está limitado a un solo albarán, así que repartir un mismo lote entre varios clientes ya es válido hoy. Como nunca se pide más de lo disponible, `check_stock_producto_final` no se dispara — sigue haciendo su trabajo, solo que nunca hace falta que actúe.
- **Si hay déficit**: la pantalla se lo muestra al operador ("solo hay 5 de 6, ¿a quién completas primero?") para una decisión explícita de reparto, en vez de intentar los inserts en orden arbitrario y dejar que el último cliente reviente contra el trigger con un error crudo (que es lo que pasaría hoy si se repitiera el flujo actual en bucle sin este cálculo previo). Los inserts de `lineas_albaran_venta` solo llevan las cantidades realmente asignadas — nunca exceden el disponible, así que tampoco aquí se dispara el trigger.
- **Para cada cliente con reparto parcial deliberado**: la pantalla inserta explícitamente en `incidencias_stock_producto_final` (`produccion_pf_id`, `linea_albaran_venta_id` = el id real de la línea parcial ya insertada, `cantidad_negativa` = lo que falta, `estado = 'pendiente'`) — verificado que el esquema de esta tabla no asume implícitamente que toda fila viene del trigger: no hay ningún `CHECK` ni campo exclusivo de ese origen, y el trigger AFTER existente (`registrar_incidencia_stock_negativo_pf`) ya se autolimita a `tipo_venta = 'evento_directo'`, así que queda inerte en este camino (`pedido_planificado`) — no hay colisión ni doble inserción posible entre el insert manual de esta pantalla y el trigger.

**Líneas de texto libre ("Otro / servicio") — deben heredarse al albarán, igual que ya hace `AlbaranesVenta.jsx` hoy:** `necesidades_pedidos()` ignora deliberadamente las líneas con `descripcion` (no tienen receta ni stock que agregar — verificado contra la definición real de la función, no referencia esa columna en ningún punto). Pero eso no significa que esta pantalla pueda ignorarlas al construir los albaranes: si un pedido de la tanda tiene, además de sus líneas de producto final, una línea `descripcion` (ej. "Pan" comprado sin pasar por stock, o un servicio facturable), esa línea debe copiarse a `lineas_albaran_venta` de ese cliente con el mismo patrón ya implementado en `AlbaranesVenta.jsx` (commit `e8acb87`, heredar líneas "otro/servicio" de un pedido al crear el albarán). No participa en el cálculo de déficit/reparto de más abajo (no hay producción ni stock que repartir) — simplemente se traslada tal cual al albarán de ese pedido, en el mismo paso que reparte el producto final.

**Por qué no se toca `evento_directo` ni el trigger**: la venta sigue siendo `tipo_venta = 'pedido_planificado'` — el déficit de una tanda es una decisión de reparto ya conocida y cuantificada de antemano, distinta del caso que `evento_directo` modela (venta/consumo caótico sin cantidades claras de antemano). Conflating los dos difuminaría una distinción que hoy es útil: `evento_directo` es "no sé/no me importa la cantidad exacta"; un déficit de tanda es "sé exactamente cuánto falta y a quién, y quiero que quede registrado como una decisión, no como una venta que no bloqueó porque era un evento".

**Sobre distinguir el origen de la incidencia en el reporting futuro**: no se añade ningún campo `origen`. Es derivable al 100% sin duplicar el dato: `incidencias_stock_producto_final.linea_albaran_venta_id → lineas_albaran_venta.albaran_venta_id → albaranes_venta.tipo_venta`. Si `tipo_venta = 'evento_directo'`, la incidencia vino del trigger (el único caso en que inserta); en cualquier otro caso, vino de un reparto manual de tanda como este, la única otra vía posible. `tipo_venta` tampoco se edita nunca tras crear el albarán, así que la derivación es estable. Añadir `origen` sería guardar dos veces el mismo hecho con riesgo de que diverjan.

**Inputs del usuario:** si no hay déficit, solo confirmar ("Cerrar y repartir", un botón para los N pedidos de la tanda). Si hay déficit, decidir la prioridad de reparto antes de confirmar.

**Qué falta hoy:** nada a nivel de esquema — `producciones_producto_final.tanda_id` ya existe, permite recuperar los pedidos de la tanda sin memoria de sesión. El resto — el cálculo de déficit antes de escribir, la decisión de reparto, el insert condicional en incidencias, y la herencia de líneas de texto libre descrita arriba — es lógica de la propia pantalla, no requiere ninguna tabla nueva ni tocar ningún trigger existente.
