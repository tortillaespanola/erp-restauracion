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

Ninguna de estas columnas está implementada todavía — es el diseño acordado, pendiente de una migración (fuera del alcance de este documento, que es solo el contrato).

---

## 1. Pedidos del día (agregación)

**Lee:**
- `pedidos_venta` filtrado por fecha (día u rango) y `estado` — join con `clientes.nombre`.
- `lineas_pedido_venta` de esos pedidos — join con `productos_finales.nombre` / `articulos_compra.nombre` para mostrar qué pidió cada uno.
- `necesidades_pedidos(p_pedido_ids)`, con el array de ids resultante del filtro (o del subconjunto que el usuario decida incluir, si quiere dejar alguno para otro día).

**Muestra:**
- Lista de pedidos del día candidatos, con cliente y cantidad, para poder deseleccionar alguno.
- El resultado completo de `necesidades_pedidos()` en sus 3 niveles — el nivel `articulo` es la lista de compra/pesaje que se usa físicamente en el almacén.

**Escribe:**
- `tandas_produccion` (insert, `estado = 'abierta'`).
- `pedidos_venta.tanda_id` (update) para cada pedido incluido en la tanda.

**Inputs del usuario:** elegir la fecha/rango; deseleccionar algún pedido de la tanda si no quiere incluirlo hoy; confirmar para abrir la tanda.

**Qué falta hoy:** requiere la migración de `tandas_produccion` + las tres columnas `tanda_id` descritas arriba — no implementada todavía. A nivel de lectura no falta nada — `necesidades_pedidos()` ya cubre exactamente esto.

---

## 2. Picking en almacén

**Lee:** el nivel `articulo` de `necesidades_pedidos()`, heredado de la pantalla 1 (no se recalcula).

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

**Qué falta hoy:**
- `producciones_semielaborado.tanda_id` — ver migración pendiente descrita arriba.
- No hay forma de distinguir "esto es lo que pedí producir" de "esto es lo que decidí hacer de más" si el usuario sube la cantidad sugerida a propósito (colchón de seguridad) — no bloquea nada, solo se pierde ese matiz para reporting futuro.

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

**Qué falta hoy:** `producciones_producto_final.tanda_id` — misma migración pendiente. El campo `pedido_id` singular se mantiene sin cambios para el flujo de un pedido suelto que ya existe; no hace falta ninguna tabla puente N a N para el caso agregado, `tanda_id` ya lo resuelve.

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

**Por qué no se toca `evento_directo` ni el trigger**: la venta sigue siendo `tipo_venta = 'pedido_planificado'` — el déficit de una tanda es una decisión de reparto ya conocida y cuantificada de antemano, distinta del caso que `evento_directo` modela (venta/consumo caótico sin cantidades claras de antemano). Conflating los dos difuminaría una distinción que hoy es útil: `evento_directo` es "no sé/no me importa la cantidad exacta"; un déficit de tanda es "sé exactamente cuánto falta y a quién, y quiero que quede registrado como una decisión, no como una venta que no bloqueó porque era un evento".

**Sobre distinguir el origen de la incidencia en el reporting futuro**: no se añade ningún campo `origen`. Es derivable al 100% sin duplicar el dato: `incidencias_stock_producto_final.linea_albaran_venta_id → lineas_albaran_venta.albaran_venta_id → albaranes_venta.tipo_venta`. Si `tipo_venta = 'evento_directo'`, la incidencia vino del trigger (el único caso en que inserta); en cualquier otro caso, vino de un reparto manual de tanda como este, la única otra vía posible. `tipo_venta` tampoco se edita nunca tras crear el albarán, así que la derivación es estable. Añadir `origen` sería guardar dos veces el mismo hecho con riesgo de que diverjan.

**Inputs del usuario:** si no hay déficit, solo confirmar ("Cerrar y repartir", un botón para los N pedidos de la tanda). Si hay déficit, decidir la prioridad de reparto antes de confirmar.

**Qué falta hoy:** a nivel de esquema, solo `producciones_producto_final.tanda_id` (ya contado en la migración pendiente de la pantalla 4) para poder recuperar los pedidos de la tanda sin memoria de sesión. El resto — el cálculo de déficit antes de escribir, la decisión de reparto, el insert condicional en incidencias — es lógica de la propia pantalla, no requiere ninguna tabla nueva ni tocar ningún trigger existente.
