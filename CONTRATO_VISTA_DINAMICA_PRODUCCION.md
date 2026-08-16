# Contrato: Vista Dinámica de Producción

Rediseño de Pantalla 1 (`PedidosDelDia.jsx`) + conexión con Pantalla de Producción (`Producciones.jsx`). Sustituye la agrupación producto→fecha→cliente por una vista filtrada, orientada a necesidad real de semielaborado.

Estado: Vista 1 completa y reordenada -- tabla de **productos finales arriba** (necesidad, stock, estado de toda la cadena, trazabilidad a pedido, filtro "Producto final") y tabla de **semielaborados abajo** (mismo tratamiento a un nivel, orden jerárquico), implementadas y verificadas en runtime contra dataset ZZ -- ver "Addenda: reordenación y estados (2026-08-14)" más abajo para el detalle completo de este segundo contrato, ya cerrado. La selección por radio + botón "Producir" general de la tabla de semielaborados ya no existe -- sustituida por un botón play por fila, ver "Addenda: desglose, reordenamiento por estado y producción directa por fila (2026-09-06)" más abajo. Vista 2 de **semielaborados** (`Producciones.jsx`) también completa -- tablas informativas de stock e historial reactivas al semielaborado seleccionado, cantidad_objetivo persistida y editable con estimación por fila, y layout final reordenado -- ver "Addenda: rediseño de tablas informativas — Vista 2 semielaborado (2026-08-14)" y "Addenda: sistema de estados final, cantidad_objetivo y layout — cierre de sesión (2026-08-14)" más abajo. El sistema de estados de "Producciones del día" quedó cerrado en **7 estados** con un algoritmo de **un solo nivel** (nunca se propaga el estado calculado de un hijo, siempre se mira su stock real) -- ver esa misma addenda final para el detalle completo, es la referencia autoritativa por encima de la addenda de 5 estados de más arriba (superada en este punto). Pendiente: (a) Vista 2 de **productos finales** (`ProduccionProductosFinales.jsx`), pantalla conceptualmente distinta y más compleja (producción en firme para clientes concretos, después albaraneada) -- a diseñar en PDF en sesión aparte, **no arrancar todavía, sin mockup no hay nada que implementar**; (b) tanda_id sigue huérfano (PENDIENTES_MODELO.md #12), sin cambios en ninguna sesión hasta ahora. La necesidad agregada mostrada en "Producciones del día" es ahora **neta en cascada por déficit**, no bruta de receta -- ver "Addenda: necesidad neta en cascada, no bruta de receta (2026-09-03)" más abajo. "Stock disponible para [X]" y "Estimación para [X]" en `Producciones.jsx` (Vista 2) muestran ahora solo el **nivel directo de receta**, no la explosión completa hasta materia prima -- ver "Addenda: nivel directo de receta en Vista 2 (2026-09-04)" más abajo. Al cerrar una producción de semielaborado, la app navega ahora a "Producciones del día" (`/pedidos-del-dia`), fijo e independiente del punto de entrada a `/producciones` -- ver "Addenda: navegación tras cerrar producción de semielaborado (2026-09-05)" más abajo. Las dos tablas de "Producciones del día" tienen ahora fila expandible con desglose por componente, se ordenan primero por estado (`RANGO_ESTADO` ya existente) y la de semielaborados inicia producción con un botón play por fila -- ver "Addenda: desglose, reordenamiento por estado y producción directa por fila (2026-09-06)" más abajo. El desglose muestra ahora la **contribución de cada padre** (no la necesidad global) cuando un semielaborado tiene más de un padre, y el botón play se oculta con necesidad ya cubierta (`ok`) -- ver "Addenda: fricciones detectadas al probar el Bloque 3a (2026-09-07)" más abajo. La tarjeta de "Producción en curso" (`ProduccionAbierta`) tiene layout reorganizado -- botones de acción arriba (visibles sin scroll), estimación/disponible fusionados con "orientativo" por línea, botón de precarga, reordenamiento por consumo registrado e indicador de "listo para cerrar" -- ver "Addenda: Bloque 3b — reorganización de 'Producciones en curso' (2026-09-08)" más abajo (incluye fix posterior de 2026-09-09: el botón de precarga no aparece con consumo ya registrado). En el desglose expandible, con el padre ya en `ok`, todas sus líneas se muestran `ok` sin mirar el stock actual del hijo (ya consumido al producir al padre) -- ver "Addenda: estado del desglose cuando el padre ya está OK (2026-09-10)" más abajo. Fecha: 2026-08-14 (addenda de necesidad en cascada: 2026-09-03; addenda de nivel directo en Vista 2: 2026-09-04; addenda de navegación tras cierre: 2026-09-05; addenda de desglose/reordenamiento/play: 2026-09-06; addenda de fricciones: 2026-09-07; addenda Bloque 3b: 2026-09-08; addenda estado desglose padre OK: 2026-09-10).

---

## Addenda: reordenación y estados (2026-08-14)

Contrato posterior ("Reordenación y mejora de estados — Producciones del día"), ya implementado y verificado en runtime real (commit `4e898c2`). Decisiones que no estaban en la versión original de este documento y no deben perderse:

**1. Librería de iconos del proyecto: `@tabler/icons-react`, NO `lucide-react`.** El contrato de reordenación pedía lucide por error -- verificado que no está instalada ni se usa en ningún punto del ERP. `@tabler/icons-react` es la librería real, ya usada en 15 archivos incluido este. **Cualquier contrato futuro que mencione "iconos lucide" debe leerse como `@tabler/icons-react` salvo que se diga explícitamente lo contrario.**

**2. El estado de cada fila son 5 valores, no 4** (el contrato original de reordenación pedía 4; el 5º surgió al probar contra datos reales, ver hallazgo abajo):
- **OK** (verde, `IconCircleCheck`) -- el stock ya cubre la necesidad.
- **Pendiente de producir** (azul, `IconClock`) -- la receta es producible con lo que hay en stock, pero todavía no se ha producido. **No cuenta como bloqueo** hacia los productos finales que dependen de este semielaborado.
- **Falta stock de semielaborados** (ámbar, `IconChefHat`).
- **Falta stock de ingredientes** (naranja, `IconCarrot`).
- **Falta stock de ambos** (rojo, `IconAlertTriangle`).

Solo los 3 últimos son bloqueo real y se propagan hacia arriba en la cadena de un producto final (recorrido transitivo vía `receta_producto_final` → `receta_semielaborado`, reutilizando el estado ya resuelto de cada semielaborado, sin consultas nuevas). "Pendiente de producir" es puramente informativo.

**Hallazgo que motivó el 5º estado**: `ZZ_Albondiga frita` (necesidad 4, disponible 0, receta con stock de sobra) mostraba "OK" en verde con el diseño de 4 estados -- un check verde junto a "disponible: 0.000" se lee como "ya resuelto" y el operador se saltaría una producción real pendiente. Confirmado con el propietario antes de implementar: "OK" queda reservado en exclusiva para cuando el stock ya cubre la necesidad.

**3. Filtro "Producto final"** (sustituye al filtro "Semielaborado" original): acota qué filas de la tabla de semielaborados se muestran (cierre transitivo de la cadena del producto elegido), **nunca recalcula sus cantidades** -- siguen siendo la necesidad global agregada de todos los pedidos pendientes, con o sin filtro.

**4. Próximo paso, todavía sin arrancar**: Vista 2 de `Producciones.jsx` y `ProduccionProductosFinales.jsx`, sin mockup/PNG de referencia todavía. No se retoma hasta tenerlo.

---

## Addenda: rediseño de tablas informativas — Vista 2 semielaborado (2026-08-14)

Contrato posterior ("Rediseño de tablas informativas — Producciones (Vista 2 semielaborado)"), implementado y verificado en runtime real contra dataset ZZ. **No es la "Vista 2" de nuevo diseño en PDF referida en el punto 4 de arriba** -- es una mejora puntual de las dos tablas informativas que ya existían en `Producciones.jsx`, reaccionando al semielaborado seleccionado en "Iniciar nueva producción" en vez de mostrar siempre todo el sistema.

**1. "Stock actual de semielaborados" → "Stock disponible para [nombre]".** Ya no lista todos los semielaborados del sistema -- lista el **nivel directo** de receta del semielaborado seleccionado (función `cargarCadenaCompleta()`, mismo alcance que `validarStockReceta()` desde la addenda "nivel directo de receta en Vista 2" más abajo -- originalmente bajaba recursivamente con BFS hasta materia prima, corregido por ser un bug, ver esa addenda). Columnas: nombre, tipo (Semielaborado / Ingrediente), stock disponible.

**Hallazgo corregido durante la verificación**: un mismo artículo (ej. AOVE) puede alcanzarse por dos caminos distintos de receta -- una vez referenciado directo (`articulo_id`) y otra vía un ingrediente genérico (`ingrediente_id` → `articulo_ingrediente`) que resuelve al mismo artículo. Sin deduplicar, aparecía dos veces con el mismo stock (y React lo marcaba como key duplicada). Se agrupa por el conjunto de `articulo_id` que resuelve cada línea -- si dos líneas resuelven exactamente al mismo conjunto, es una sola fila.

**2. "Historial de producciones cerradas" → filtrado al semielaborado seleccionado.** Antes mostraba las cerradas de todos los semielaborados; ahora solo las del seleccionado (`cerradasDelSeleccionado`, derivado de `cerradas` sin consulta adicional). Verificado con datos reales: 39 cerradas de "Mezcla Tortilla Espanola con Cebolla" en base de datos, 39 tarjetas mostradas tras seleccionarlo.

**3. Reactividad sin botón.** Ambos bloques se recalculan en cuanto cambia la selección del desplegable "Iniciar nueva producción" (`useEffect` sobre `semielaboradoId`), sin pulsar "Iniciar" ni ningún botón adicional.

**4. Estado sin selección / sin parpadeo.** Si se llega vía `/producciones?semielaborado_id=&cantidad=` (caso habitual desde "Producciones del día"), el desplegable ya viene precargado desde el estado inicial del componente, así que ambos bloques nacen ya poblados -- verificado que no hay parpadeo del mensaje de "sin selección" en ningún momento. Si se entra directo a `/producciones` sin ese parámetro, ambos bloques muestran "Selecciona un semielaborado para ver su stock e historial."

**5. Fix puntual posterior, mismo contrato**: el campo "Cantidad a producir" se estaba conservando al cambiar manualmente el semielaborado en el desplegable, arrastrando una cantidad que era específica del semielaborado anterior (o de la precarga por URL). Corregido: el `onChange` manual del selector limpia `cantidadPlan` a `''`; la precarga por URL (`?cantidad=`) sigue funcionando igual, solo se resetea en el cambio manual posterior. Verificado en runtime: entrada vía URL con cantidad 2 precargada, cambio manual de semielaborado → campo queda vacío.

Fuera de alcance de este contrato (sin tocar): el formulario "Iniciar nueva producción" en sí, `ProduccionProductosFinales.jsx`, y `tanda_id`/`tandas_produccion`.

---

## Addenda: sistema de estados final, cantidad_objetivo y layout — cierre de sesión (2026-08-14)

Cierre de la sesión que implementó `cantidad_objetivo`, los estados "en curso" y el fix del algoritmo de bloqueo. Puntos que no estaban en ningún contrato anterior y no deben perderse:

**1. Sistema de estados final -- 7 estados, con prioridad de más a menos bloqueante** (sustituye a los 5 estados de la addenda "reordenación y estados" de más arriba, que queda superada en este punto -- esos 5 siguen siendo válidos como base, pero ya no son la lista completa):
1. Falta stock de ambos
2. Falta stock de semielaborados
3. Falta stock de ingredientes
4. En curso (insuficiente)
5. Pendiente de producir
6. En curso — cubre necesidad
7. OK

El estado mostrado es siempre el peor (más bloqueante) de los aplicables. "En curso (insuficiente)" es más urgente que "Pendiente de producir" (ya hay algo en marcha, aunque no baste); "En curso — cubre necesidad" es menos urgente que "Pendiente de producir" (ya hay evidencia concreta de que se está cubriendo, aunque no haya terminado). Iconos `@tabler/icons-react` (`IconProgress` / `IconProgressCheck` para los dos nuevos) -- **sigue sin usarse `lucide-react`, no está instalada en el proyecto** (ver punto 1 de la addenda "reordenación y estados").

**2. Algoritmo de cálculo -- UN SOLO NIVEL, nunca propagación de estado calculado.** Tanto la tabla de Semielaborados como la de Productos finales calculan su estado de la misma forma: necesidad propia vs. stock propio: si cubre, OK; si no, se mira el **stock real** (no el estado calculado) de los componentes **directos** de receta. Nunca se propaga el estado calculado de un hijo hacia el padre.

Esto fue un **bug real corregido en esta sesión**: `estadoCadenaPF()` (tabla de productos finales) empezó propagando el estado *calculado* del semielaborado hijo -- si ese hijo estaba en "Pendiente de producir" (fácilmente producible pero sin stock), el producto final heredaba ese mismo estado no-bloqueante, aunque no hubiera stock real disponible para montarlo. Corregido para usar exactamente el mismo algoritmo de un nivel que ya usaba (correctamente) `estadoUnNivel()` para los semielaborados -- ya no desciende por `cadenaSemisDe` (cierre transitivo) para el cálculo de bloqueo; esa función se mantiene solo para el filtro "Producto final" de la tabla de semielaborados, que es un uso puramente de visualización, no de cálculo de estado.

Razón de negocio: si el semielaborado directo no está hecho -- aunque sea trivial de producir, ej. simplemente empaquetar hamburguesas ya fabricadas -- el producto final NO se puede tocar todavía. Debe marcar "Falta stock de semielaborados", no "Pendiente de producir". Verificado en runtime: `ZZ_Hamburguesas`, `ZZ_TORTILLACONCEBOLLAGRANDE` y `ZZ_TORTILLASINCEBOLLAGRANDE` pasaron de estados no-bloqueantes a "Falta stock de semielaborados"; subiendo el stock real del semielaborado directo por encima de la necesidad, la fila vuelve a "Pendiente de producir" (no a "OK", porque el producto final en sí sigue sin producir).

**3. `cantidad_objetivo` en `producciones_semielaborado`** (migración `20260902_cantidad_objetivo_produccion_semielaborado.sql`, columna `numeric` nullable, sin CHECK de positividad a nivel de base de datos -- mismo criterio que `cantidad_producida`): editable in-line dentro de cada tarjeta de "Producción en curso" en `Producciones.jsx`, independiente del formulario "Iniciar nueva producción". Alimenta dos cosas:
- La tabla "Estimación para [X] [unidad]" dentro de cada tarjeta: una fila por ingrediente/semielaborado del **nivel directo** de receta (mismo criterio que "Stock disponible para X" -- ver addenda "nivel directo de receta en Vista 2" más abajo, ya no es explosión completa), con alerta simple suficiente/insuficiente por fila -- puramente informativa, no precarga los selectores de lote de "Registrar consumo".
- Los estados "En curso" / "En curso — cubre necesidad" de "Producciones del día" (punto 1 de esta addenda): se agregan `cantidad_objetivo` de todas las producciones `abierta` de un semielaborado; si alguna no tiene valor definido, o la suma no alcanza la necesidad, es "insuficiente"; si todas están definidas y la suma cubre, es "cubre necesidad".

**4. Layout final de `Producciones.jsx` (semielaborado) con un semielaborado seleccionado en el desplegable superior**, de arriba a abajo:
1. Formulario "Iniciar nueva producción"
2. Stock disponible para [X]
3. Producciones en curso (filtradas a [X] -- si no hay ninguna de ese semielaborado, se muestra el título con un estado vacío breve, no se oculta la sección)
4. Historial de producciones cerradas de [X]

**Sin nada seleccionado**: "Stock disponible" e "Historial" se ocultan por completo (ni título ni mensaje de "sin selección" -- desaparecen del DOM, distinto del punto 4 de la addenda "Vista 2 semielaborado" de más arriba, que sigue vigente solo para el caso "hay selección pero sin datos"). "Producciones en curso" muestra todas las producciones activas sin filtrar.

**5. Próximo paso, todavía sin arrancar -- `ProduccionProductosFinales.jsx`**: pantalla conceptualmente distinta y **más compleja** que `Producciones.jsx` de semielaborado, no una simple repetición un nivel arriba. Aquí se produce en firme para uno o varios clientes concretos, y después se albaranea. Ejemplo de referencia dado por el propietario: para hamburguesas, la "producción" del producto final puede limitarse a empaquetar unidades ya hechas del semielaborado (coherente con el punto 2 de esta addenda: sin stock real del semielaborado, no hay nada que empaquetar). Sin mockup/PNG todavía -- se retoma en otra sesión cuando llegue.

**6. `tanda_id` sigue huérfano** (`PENDIENTES_MODELO.md` #12), sin cambios en ninguna sesión hasta ahora.

---

## Addenda: necesidad neta en cascada, no bruta de receta (2026-09-03)

Fix de un bug real de cálculo, no de estados ni de UI -- distinto del punto "Algoritmo de cálculo -- UN SOLO NIVEL" de la addenda "sistema de estados final" de arriba, que sigue intacto tal cual (ese punto es sobre cómo se calcula el **estado**; este es sobre cómo se calcula la **necesidad/demanda**, dos mecanismos independientes).

**Bug**: la "necesidad agregada" de cada semielaborado/ingrediente/artículo se calculaba explotando la receta hacia abajo por multiplicación pura (bottom de `necesidades_pedidos()`), sin descontar nunca el stock de los niveles intermedios. Un semielaborado ya cubierto por su propio stock seguía arrastrando su necesidad bruta de receta hacia sus hijos, aunque el stock físico de éstos estuviera en 0 y no hiciera falta producir nada más de ellos.

**Caso real que lo confirmó** (dataset ZZ): `ZZ_ALBODIGACONTOMATE` (necesidad 4, stock 4, "OK" correctamente) seguía arrastrando necesidad hacia `ZZ_Albondiga frita` y `ZZ_TomateFrito` (stock 0 en ambos, ya consumido al producir `ZZ_ALBODIGACONTOMATE`) -- ambos mostraban "Pendiente de producir" cuando nadie necesitaba ya que se produjera más de ellos.

**Fix**: nueva función `necesidades_pedidos_cascada(p_pedido_ids)` (migración `20260903_necesidades_pedidos_cascada.sql`), que propaga **déficit**, no cantidad bruta:

```
déficit(nodo) = MAX(0, necesidad_agregada(nodo) - stock_disponible(nodo))
necesidad_agregada(hijo) = Σ [ déficit(padre) × cantidad_por_unidad_receta ]
```

Si un padre ya tiene déficit 0, no arrastra ninguna necesidad hacia sus hijos, aunque el stock físico de éstos esté en 0. La necesidad **mostrada** de cada nodo sigue siendo la que le llega de sus padres (nunca neta de su propio stock -- eso sigue siendo la columna "Stock disponible" de al lado, comparación sin cambios); el déficit es un concepto interno de la función, nunca se expone directamente.

**`necesidades_pedidos()` no se toca** -- sigue sirviendo necesidad bruta por pedido individual, usada solo para la trazabilidad a pedido/cliente (tooltip) en `PedidosDelDia.jsx`, y sigue siendo la función compartida por las otras dos pantallas (`Producciones.jsx`, `ProduccionProductosFinales.jsx`), sin arriesgar su shape (mismo criterio ya fijado en la sección "Vista 1" de más abajo). La función nueva se llama **una sola vez, en batch, con todos los pedido_ids pendientes a la vez** -- a diferencia de `necesidades_pedidos()`, el déficit (`MAX(0, x)`) no es lineal y no se puede calcular por pedido individual y sumar después, o el mismo stock físico se descontaría una vez por cada pedido que lo mirase por separado.

**Alcance de la cascada, decidido explícitamente con el propietario** (no solo semielaborado→semielaborado, que era el caso mínimo reproducido): el propio stock de producto final también reduce lo que se traslada a sus semielaborados hijos, y el déficit sigue bajando hasta ingredientes/artículos (materia prima) -- cascada completa desde producto final hasta el final de la receta, en las cuatro filas que ya devolvía `necesidades_pedidos()` (`producto_final`, `semielaborado`, `ingrediente`, `articulo`). La fila `producto_final` sigue siendo necesidad bruta de pedido -- sin cambio de comportamiento visible en esa tabla.

**Resuelto por oleadas** (profundidad topológica **máxima** de cada semielaborado, no la de una ruta cualquiera): un semielaborado puede recibir aportes de varios padres a profundidades distintas (ej. un ingrediente compartido por dos ramas de receta) -- no se puede calcular su déficit ni repartirlo a sus hijos hasta que TODOS sus padres, de cualquier profundidad, ya se han resuelto. Mismo guarda de ciclo (profundidad máxima 20, misma excepción) que `necesidades_pedidos()`.

**No hace falta un octavo estado.** Se evaluó explícitamente el caso "necesidad ya cubierta por el padre, pero stock físico propio en 0" (`ZZ_Albondiga frita`/`ZZ_TomateFrito` en el caso real): con necesidad agregada 0, el ítem simplemente **no aparece** en la tabla de "Producciones del día" -- ni fila, ni estado, nada que decidir. Es el comportamiento correcto para una pantalla de "qué producir hoy": si nadie lo necesita, no pertenece a la lista de pendientes. Los 7 estados existentes siguen aplicando sin cambios a todo lo que sí tiene necesidad agregada > 0.

**Frontend** (`PedidosDelDia.jsx`, función `cargarDatos()`): las llamadas por-pedido a `necesidades_pedidos()` se mantienen intactas, pero ahora alimentan *solo* los mapas de trazabilidad (`pedidosPorSemi`/`pedidosPorPF`, el tooltip). Las cantidades de `necesidades`/`necesidadesPF` (columna "Necesidad agregada" de las dos tablas) vienen de una llamada nueva y separada a `necesidades_pedidos_cascada()` con todos los `pedido_id` pendientes juntos. El resto de la pantalla (estados, badges de bloqueo, orden jerárquico, filtro "Producto final", producciones en curso) no cambia -- consume las mismas cantidades de siempre, ahora correctas.

**Probado en transacción de prueba (con ROLLBACK)** contra los pedidos reales pendientes (OV-260101, OV-260102): caso real tal cual (0 diffs salvo la desaparición esperada de `ZZ_Albondiga frita`/`ZZ_TomateFrito` y sus ingredientes/artículos exclusivos), déficit parcial de un nivel (stock de `ZZ_ALBODIGACONTOMATE` bajado a 1.5 dentro de la transacción, valores exactos verificados a mano en toda la cadena) y déficit parcial en dos niveles encadenados (producción ficticia adicional para `ZZ_Albondiga frita`, también dentro de la transacción) -- los tres casos coinciden exactamente con el cálculo manual. Nivel `producto_final`: idéntico a `necesidades_pedidos()` en los 4 productos finales de los pedidos reales (ninguno tiene stock propio en este dataset, así que el déficit(PF) coincide con la necesidad bruta).

**Fuera de alcance de este fix** (sin tocar): `ProduccionProductosFinales.jsx` y la parte de albaranes; el sistema de 7 estados y su algoritmo de un solo nivel (arriba); `Producciones.jsx` (Vista 2) -- su propio uso de `necesidades_pedidos()` (`necesidadesSemielaboradoDeTanda`, precarga de `?tanda_id=`) no se toca, ese camino sigue huérfano por `PENDIENTES_MODELO.md` #12.

---

## Addenda: nivel directo de receta en Vista 2 (2026-09-04)

Fix de un bug real en `Producciones.jsx` (Vista 2, pantalla de registro de consumo de producción) -- mismo tipo de error de fondo que la addenda "necesidad neta en cascada" de arriba (explosión recursiva de receta donde debía haber un solo nivel), pero en una pantalla y una función distintas. **No toca** la regla "un solo nivel de estado, nunca propagación" del punto 2 de la addenda "sistema de estados final" (eso es sobre el **estado** de "Producciones del día"; esto es sobre qué **filas de receta se listan** en Vista 2) ni la propia `necesidades_pedidos_cascada()` de la addenda anterior.

**Bug**: `cargarCadenaCompleta()` (usada tanto por "Stock disponible para [X]" a nivel de página como por la tabla "Estimación para [X] [unidad]" dentro de cada tarjeta de "Producción en curso") hacía una explosión BFS recursiva de `receta_semielaborado` hasta agotar la cadena completa -- semielaborados intermedios **y** sus ingredientes/artículos hoja. Para un semielaborado compuesto por otros semielaborados (ej. `ZZ_ALBODIGACONTOMATE` = `ZZ_Albondiga frita` + `ZZ_TomateFrito`), esto hacía aparecer también AOVE, Carne Picada y Tomate Triturado -- materia prima que pertenece a la receta de los semielaborados *hijos*, no a la del semielaborado que se está produciendo, y que además ya se consumió al producir esos hijos.

**Confirmado con el propietario**: ambos bloques de Vista 2 deben mostrar únicamente lo que la receta indica en su **nivel directo** del semielaborado en producción -- ni más ni menos que lo que ya hacía `validarStockReceta()` (el aviso de stock insuficiente del formulario "Iniciar nueva producción") y `cargarIngredientesConLotes()` (los selectores de lote de "Registrar consumo", que nunca tuvieron este bug -- siempre filtraron `receta_semielaborado` por `semielaborado_id` sin recursión).

**Fix**: `cargarCadenaCompleta()` reescrita para hacer una única consulta a `receta_semielaborado` filtrada por `semielaborado_id` (sin bucle `frontera`/BFS), con el mismo criterio de resolución `ingrediente_id` → artículo vía `articulo_ingrediente` y la misma fusión de filas-hoja que ya tenía (dos líneas de receta que resuelven al mismo artículo físico se funden en una sola fila). `ratioPorUnidad` deja de acumularse por varios niveles -- al ser un único nivel, es directamente la `cantidad` de la línea de receta. La forma del resultado (`{tipo, nombre, unidad, stock, ratioPorUnidad}`) no cambia, así que ninguno de los dos puntos de consumo (`Producciones()` para "Stock disponible", `ProduccionAbierta` para "Estimación") necesitó cambios propios.

**Verificado contra el caso real** (consulta de solo lectura a `receta_semielaborado`, sin escritura): nivel directo de `ZZ_ALBODIGACONTOMATE` devuelve exactamente 2 filas (`ZZ_Albondiga frita` cantidad 1.000, `ZZ_TomateFrito` cantidad 0.005) -- ni AOVE, ni Carne Picada, ni Tomate Triturado. Verificado también que un semielaborado de un solo nivel (`ZZ_Albondiga frita`, receta de ingredientes puros: AOVE 0.050, Carne Picada 0.050) no cambia de comportamiento -- ya era, y sigue siendo, nivel directo.

**Fuera de alcance de este fix** (sin tocar): navegación posterior al cierre de una producción; reordenamiento de tabla, botones y precarga de estimación (mejoras de UI); `necesidades_pedidos_cascada()` y la pantalla "Producciones del día" (`PedidosDelDia.jsx`) -- ya corregidas en la addenda anterior, sin relación con este bug; `ProduccionProductosFinales.jsx` y la parte de albaranes.

---

## Addenda: navegación tras cerrar producción de semielaborado (2026-09-05)

Fix puntual en `Producciones.jsx` -- **no toca** `cargarCadenaCompleta()` ni la addenda "nivel directo de receta en Vista 2" de arriba (mecanismo completamente distinto).

**Bug**: al confirmar el cierre de una producción de semielaborado (`cerrarProduccion()`, tarjeta "Producción en curso"), la app no navegaba a ningún sitio -- solo llamaba a `onCambio()` (recarga los datos de la propia pantalla `/producciones`), igual que el resto de acciones de la tarjeta (registrar consumo, quitar consumo, guardar objetivo). El operador se quedaba en `/producciones`, que en cuanto se cerraba la última producción en curso quedaba sin nada útil que mostrar -- percibido como "redirige a Producciones vacía" en vez de volver al panel de "qué producir hoy".

**Puntos de entrada a `/producciones` verificados** (para decidir el destino fijo con el propietario): (a) botón "Producir" de `PedidosDelDia.jsx`, que navega con `?semielaborado_id=X&cantidad=Y` -- el origen habitual; (b) enlace directo "Producciones" del menú lateral (`Layout.jsx`), sin parámetros ni selección previa. El parámetro `?tanda_id=` que lee `Producciones.jsx` no tiene ningún punto de entrada real en el frontend hoy -- confirma que sigue huérfano (`PENDIENTES_MODELO.md` #12), sin relación con este fix.

**Decisión del propietario**: el redirect a `/pedidos-del-dia` tras cerrar es **fijo, independiente del punto de entrada** -- se aplica igual si se llegó vía el botón "Producir" que si se entró directo por el menú lateral.

**Fix**: `cerrarProduccion()` (componente `ProduccionAbierta`) llama a `navigate('/pedidos-del-dia')` (hook `useNavigate` de `react-router-dom`, ya importado en el archivo vía `useSearchParams`) en vez de `onCambio()` tras un cierre exitoso -- es el único punto de la tarjeta que navega; el resto de acciones (confirmar/quitar consumo, guardar objetivo, cancelar producción, editar cerrada) siguen usando `onCambio()` sin cambios, permaneciendo en `/producciones` como hasta ahora. `PedidosDelDia.jsx` ya recarga sus propios datos al montar, así que no hace falta pasarle ningún estado adicional en la navegación.

**Fuera de alcance de este fix** (sin tocar): el cierre de producción de producto final (`ProduccionProductosFinales.jsx`, su propio `cerrarProduccion()` con el mismo nombre pero componente distinto) y la parte de albaranes; reordenamiento de tabla, botones y precarga de estimación (Bloque 3, aparte); `cargarCadenaCompleta()` y la addenda de nivel directo (arriba).

---

## Addenda: desglose, reordenamiento por estado y producción directa por fila (2026-09-06)

Tres mejoras de UI/UX en `PedidosDelDia.jsx` ("Producciones del día"), sin tocar `necesidades_pedidos_cascada()`, `cargarCadenaCompleta()` ni la navegación de cierre (addendas anteriores). Dos de los tres puntos tenían decisiones de diseño abiertas -- propuestas al propietario y confirmadas antes de implementar (ver decisiones más abajo).

**1. Desglose por componente (fila expandible).** Cada fila de las tablas de "Productos finales" y "Semielaborados" tiene ahora un icono chevron (`IconChevronRight`/`IconChevronDown`) que despliega una sub-fila con el desglose de los componentes DIRECTOS de receta (mismo criterio de un solo nivel que el resto de la pantalla, no recursivo) -- nombre, tipo, necesidad, stock disponible y estado de cada uno:
- ~~**Semielaborado-hijo**: reutiliza tal cual la fila YA calculada de la tabla de Semielaborados... misma necesidad agregada GLOBAL...~~ -- **bug real, corregido al día siguiente por la addenda "Fricción 2" de más abajo**: la necesidad agregada global no es la contribución de ESE padre concreto cuando el hijo tiene más de un padre. Ver esa addenda para el criterio correcto.
- **Ingrediente/artículo hoja**: sin tabla propia en esta pantalla -- se reutilizan los mismos 2 estados que ya existían (`ok` / `ingrediente`, "Falta stock de ingredientes"), no se inventa uno nuevo. La necesidad de cada línea es `cantidad de receta × necesidad del padre` (mismo cálculo de siempre), comparada contra el stock disponible total.
- **Carga bajo demanda**: `validarStockReceta.js` gana un 4º parámetro opcional, `soloFaltantes = true` -- con el valor por defecto el comportamiento de los 2 llamantes existentes (`Producciones.jsx`, y esta misma pantalla para los badges de bloqueo) no cambia; el desglose llama con `soloFaltantes = false` para pedir TODAS las líneas del nivel directo, no solo las insuficientes. También gana un campo `id` por línea (id propio de artículo/ingrediente/semielaborado), necesario para cruzar una línea `'semielaborado'` con su fila ya calculada. Se pide una sola vez por fila (cacheada en `desgloseSemiPorId`/`desglosePFPorId`, reiniciada en cada `cargarDatos()`), no se repite en expands posteriores de la misma sesión de pantalla.
- **Descartado**: tooltip (no puede renderizar varias filas con icono/color, solo texto plano, como los tooltips de pedidos/faltantes que ya existían) y sub-tabla siempre visible (alarga demasiado la tabla principal con varias filas pendientes).
- Efecto colateral menor: `Td` (`components/ui.jsx`) ahora reenvía props adicionales (`{...props}`) al `<td>` -- necesario para `colSpan` en la fila de desglose, no cambiaba nada para los llamantes existentes (solo pasaban `children`/`className`).

**2. Reordenamiento por estado.** Ambas tablas ordenan ahora primero por el mismo `RANGO_ESTADO` que ya existía (usado para `peorEstado()`, 1 = más urgente/bloqueante ... 7 = `ok`) -- no se creó un criterio nuevo. Los estados que requieren acción quedan siempre arriba y los `ok` se hunden al final según cambian de estado, en vivo. Los criterios de orden previos pasan a ser el desempate DENTRO de un mismo estado: en Semielaborados, el orden jerárquico hoja→raíz (`ordenPorSemi`, sigue siendo el correcto para decidir por cuál empezar entre varios igual de urgentes); en Productos finales, alfabético (no había jerarquía entre ellos). Se añadió `rangoDeEstado()` como puente para los estados renombrados de la tabla de productos finales (`semis_en_curso_insuficiente`/`semis_en_curso_cubre`, ver `estadoCadenaPF`) que no existen como claves en `RANGO_ESTADO` -- remite a su rango base antes de comparar, sin duplicar los números.

**3. Botón play por fila, sin selección previa.** Sustituye el radio de cada fila de semielaborado -- un icono `IconPlayerPlay` en la fila navega directo a `/producciones?semielaborado_id=X&cantidad=Y` para ESE ítem, sin paso intermedio de selección. **Decisión confirmada con el propietario**: el radio y el botón "Producir" general se ELIMINAN por completo, no conviven con el play -- hoy no existe ningún flujo real de producir varios semielaborados a la vez (`Producciones.jsx` solo acepta un `semielaborado_id` por navegación), así que mantener ambos caminos habría sido funcionalidad duplicada sin ninguna capacidad nueva. Con esto desaparece también la necesidad original de un botón "Producir" sticky en la parte inferior -- no existe ya ningún botón general que necesite quedar fijo en pantalla; se descarta ese punto del pedido original por quedar sin objeto.

**Fuera de alcance de este cambio** (sin tocar): pantalla "Producciones en curso" (`ProduccionAbierta` en `Producciones.jsx`); `cargarCadenaCompleta()`, la navegación de cierre y `necesidades_pedidos_cascada()` (addendas anteriores); `ProduccionProductosFinales.jsx` y albaranes.

---

## Addenda: fricciones detectadas al probar el Bloque 3a (2026-09-07)

Dos fricciones encontradas probando en frontend la addenda anterior (2026-09-06) -- ambas en `PedidosDelDia.jsx`, sin tocar `necesidades_pedidos_cascada()` en sí (el cálculo de la tabla principal ya era correcto; solo cambia cómo se MUESTRA en el desglose por padre), `cargarCadenaCompleta()`, la navegación de cierre, `ProduccionProductosFinales.jsx` ni albaranes.

**Fricción 1 -- botón play activo en estado OK.** Con necesidad ya cubierta por stock, el play seguía llevando a Producciones precargado con esa misma cantidad -- sin sentido como atajo rápido desde esta pantalla. **Decisión confirmada**: se oculta (se sustituye por el icono en gris, sin `onClick`, con tooltip explicando por qué) cuando `f.estado === 'ok'`, tanto en la fila principal de la tabla de Semielaborados como en el criterio de estado del desglose (Fricción 2, más abajo) -- **no** se restringe la posibilidad de sobreproducir por otros motivos, que sigue disponible sin atajo desde `Producciones.jsx` directamente. Aclarado explícitamente con el propietario: el desglose expandible NO gana su propio botón play por fila (queda puramente informativo, como ya estaba) -- la corrección de Fricción 1 aplica solo al botón que ya existía en la tabla principal; lo que sí cambia en el desglose es que su ESTADO deja de heredar el bug de Fricción 2 (ver abajo), evitando que un hijo compartido se lea como "ok" o "pendiente" con el número equivocado.

**Fricción 2 -- necesidad agregada GLOBAL mostrada en el desglose de cada padre, en vez de la contribución de ESE padre.** Caso real que lo confirmó (dataset ZZ, verificado con consulta de solo lectura contra la base real, sin escritura): `ZZ_MEZCLATORTILLAPATATASINCEB` (id 17, kg) es consumido tanto por `ZZ_TORTILLACONCEBOLLAGRANDE` (necesidad objetivo 3, 0.700 kg/ud) como por `ZZ_TORTILLASINCEBOLLAGRANDE` (necesidad objetivo 7, 0.900 kg/ud) -- necesidad agregada GLOBAL 8.400 kg (= 6.300 + 2.100), stock disponible global también 8.400 kg (cubierto, `ok` en la tabla de Semielaborados). Antes de este fix, el desglose expandible de AMBOS productos finales mostraba "8.400 kg" idéntico en la línea de este semielaborado -- dando a entender que cada padre por sí solo necesitaba los 8.4 kg completos.

**Causa raíz**: `construirFilaDesglose()` (addenda anterior) sustituía el `necesario` de la línea (que `validarStockReceta()` YA calculaba correctamente como `cantidad_por_unidad_receta × necesidad_objetivo_del_padre`, es decir la contribución real) por la fila global YA calculada de la tabla de Semielaborados -- exactamente el mismo tipo de bug que Fricción 1, aplicado a un número en vez de a un botón.

**Verificado antes de tocar código**: `necesidades_pedidos_cascada()` (migración `20260903_...sql`) calcula el déficit de cada semielaborado como `greatest(necesidad_agregada_TOTAL - stock_TOTAL, 0)` -- el stock es un pool único compartido, nunca reservado ni prorrateado por padre. Confirma la hipótesis del propietario: la columna "stock disponible" del desglose debe seguir siendo el stock GLOBAL (sin repartir), cada línea comparando su propia contribución contra el total completo, independiente de qué más tire de él.

**Fix**: `construirFilaDesglose()` para una línea `'semielaborado'` ya NO reescribe el número con la fila global -- usa `linea.necesario` (la contribución real, ya calculada por `validarStockReceta()`) y `linea.disponible` (stock global, sin repartir). El **estado** de esa línea deja de heredar también el estado global de la fila (mismo bug, aplicado al badge) -- se recalcula con el mismo `estadoUnNivel()` de la tabla principal, pero evaluado contra la contribución de ESE padre: si el stock global ya cubre esa contribución, `ok` directo sin consulta adicional; si no, una consulta adicional (`validarStockReceta('semielaborado', id_hijo, contribución)`, solo en este caso, solo al expandir) resuelve los faltantes propios del hijo a esa cantidad, más `enCursoPorSemi` (ya cargado, sin consulta nueva) para la nota "en curso" -- también evaluado contra la contribución, no la necesidad global, evitando repetir el mismo error en el matiz "en curso cubre / insuficiente". `construirFilaDesglose()` pasa a ser `async` por esta consulta condicional; `toggleExpandSemi`/`toggleExpandPF` ahora esperan `Promise.all(...)` sobre las líneas. Ya no necesita `filasSemiPorId` ni `stockPorSemi` como parámetros (el cálculo queda autocontenido por línea) -- solo `enCursoPorSemi`.

**Verificado contra el caso real** (mismo dataset, solo lectura): con la fórmula `contribución = cantidad_por_unidad_receta × necesidad_objetivo(padre)`, `ZZ_TORTILLASINCEBOLLAGRANDE` → 0.900 × 7 = **6.300 kg**, `ZZ_TORTILLACONCEBOLLAGRANDE` → 0.700 × 3 = **2.100 kg** -- suman exactamente los 8.400 kg globales, ya no aparecen idénticos en ambos desgloses. Con el stock global (8.400) cubriendo ambas contribuciones por separado, las dos líneas quedan en `ok` -- consistente con el criterio de pool compartido confirmado arriba (no se probó en este dataset real el camino "línea insuficiente" por no haber un caso real con déficit en este nodo compartido; ese camino reutiliza `estadoUnNivel()`, ya verificado extensamente en sesiones anteriores para la tabla principal, con la única diferencia siendo la cantidad de referencia).

**Fuera de alcance de este fix** (sin tocar): Bloque 3b ("Producciones en curso"); `necesidades_pedidos_cascada()` en sí (correcto, no se toca); `ProduccionProductosFinales.jsx` y albaranes.

---

## Addenda: Bloque 3b — reorganización de "Producciones en curso" (2026-09-08)

Cinco mejoras de UI/UX en la tarjeta de producción activa (`ProduccionAbierta` dentro de `Producciones.jsx`), sin tocar "Producciones del día"/desglose expandible/botón play (Bloque 3a), la navegación de cierre (Bloque 2), `cargarCadenaCompleta()` (Bloque 1), `ProduccionProductosFinales.jsx` ni albaranes. Dos puntos tenían layout/mecanismo por confirmar -- propuestos y aprobados antes de implementar.

**Layout final de la tarjeta** (de arriba a abajo): cabecera → cantidad objetivo (+ bloque de tanda si aplica) → **botones de acción** (Confirmar consumo / Cerrar producción, con el indicador de listo-para-cerrar) → consumo ya registrado (historial) → Registrar consumo (cada línea con orientativo+estimación+disponible fusionados, botón de precarga, reordenada por consumo registrado).

**1. Estimación/disponible fusionados con "orientativo".** El bloque "ESTIMACIÓN PARA X UD" (tabla aparte, arriba de "Registrar consumo") desaparece -- cada línea de `IngredienteConsumo` muestra ahora junto a "orientativo: X por unidad" también "estimación: X disponible: X" (mismo cálculo de siempre, `ratioPorUnidad × objetivo` contra `cadenaEstimacion`, mismo umbral que antes: sin cantidad objetivo no se muestra nada de esto, solo "orientativo"). Emparejamiento por nombre entre `ingredientes` (`cargarIngredientesConLotes`) y `cadenaEstimacion` (`cargarCadenaCompleta`) -- mismo criterio que ya usaba la tabla separada, ambas consultan el mismo nivel directo de `receta_semielaborado.semielaborado_id`.

**2. Botón de precarga por línea.** Icono `IconWand` ("Usar estimación") junto a cada línea que tiene estimación calculada -- copia el valor de la estimación al campo Cantidad de esa línea (`precargarConEstimacion`), sin bloquear edición manual posterior. No aparece si no hay cantidad objetivo definida (no hay estimación con la que precargar).

**Fix posterior (2026-09-09)**: el botón tampoco aparece si esa línea ya tiene consumo registrado (`estimacion.registrado > 0`, parcial o completo) -- precargar la estimación TOTAL en ese caso machacaría el campo con una cifra que ya no representa lo que falta (caso real que lo confirmó: `ZZ_Albondiga frita` con 3 ud ya registradas de una estimación de 4 seguía ofreciendo precargar "4"). El resto de la lógica del punto 2 no cambia -- mismo `precargarConEstimacion`, mismo criterio de "sin objetivo no hay estimación".

**3. Botones de acción reposicionados.** "Confirmar consumo" y "Cerrar producción" (o su mini-formulario expandido) suben por encima de "Consumo ya registrado" y "Registrar consumo" -- visibles sin scroll aunque la lista de ingredientes sea larga. Layout propuesto y aprobado antes de implementar (ver arriba).

**4. Reordenamiento por consumo registrado.** Mismo criterio de reordenamiento que "Producciones del día" (Bloque 3a, punto 2) -- lo pendiente arriba, lo ya cubierto (consumo confirmado ≥ estimado) al final, con una ligera atenuación visual (`opacity-70`) en las líneas ya cubiertas. Sin cantidad objetivo definida no hay estimación contra la que comparar, así que no se reordena.

**Causa raíz de una pieza no trivial de este punto**: "consumo registrado" no se podía calcular comparando nombres -- `consumo_produccion` referencia lotes concretos (`entrada_material_id`/`produccion_origen_id`), y el nombre de un lote de artículo comprado (ej. "AOVE Hacendado 1L") no coincide con el nombre del ingrediente genérico de receta (ej. "Aceite de oliva") cuando la línea usa `ingrediente_id` en vez de `articulo_id` directo. Fix: `selectCompleto` (en `cargarDatos()` de `Producciones()`) pide ahora también `articulo_id` de `entrada_material` y `semielaborado_id` de la `producciones_semielaborado` de origen; `cargarIngredientesConLotes()` expone `articuloIdsDeReceta` (ya se calculaba internamente para filtrar lotes, no se exponía) -- con eso, cada línea de `consumo_produccion` se cruza con su línea de receta por id real (`articulo_id` dentro del conjunto resuelto, o `semielaborado_id` exacto), no por texto. Verificado contra el schema real (columnas existentes) y un caso real de ingrediente genérico (`ZZ_Patata`/`ingrediente_id`, resuelto vía `articulo_ingrediente` a su `articulo_id`).

**5. Indicador "listo para cerrar".** Texto/badge verde con `IconCircleCheck` ("Consumo suficiente para cerrar") junto a los botones de acción cuando TODAS las líneas de receta tienen consumo registrado ≥ su estimación -- mecanismo propuesto y aprobado antes de implementar (badge junto al botón, no banner). **Puramente informativo**: no deshabilita ni sustituye "Cerrar producción" -- cerrar con más o menos de lo estimado sigue siendo decisión operativa del operador, nunca un requisito del sistema. Mismo criterio `cubierto` que el punto 4, reutilizado (no se duplica el cálculo).

**Fuera de alcance de este cambio** (sin tocar): "Producciones del día", desglose expandible y botón play (Bloque 3a); navegación de cierre (Bloque 2); `cargarCadenaCompleta()` en sí (Bloque 1, la función sigue igual, solo cambia dónde/cómo se renderiza su resultado); `ProduccionCerradaEdicion` (edición de una producción ya cerrada, reutiliza `IngredienteConsumo` sin las props nuevas -- siguen siendo opcionales, sin regresión); `ProduccionProductosFinales.jsx` y albaranes.

---

## Addenda: estado del desglose cuando el padre ya está OK (2026-09-10)

Fix puntual sobre la addenda "fricciones detectadas al probar el Bloque 3a" (2026-09-07, Fricción 2) -- **no toca** `necesidades_pedidos_cascada()` (correcto, el cálculo de necesidad agregada del padre no cambia) ni la corrección de contribución por padre de esa misma addenda (correcta, esto es un ajuste adicional sobre el ESTADO de línea, no sobre la cifra de necesidad/contribución).

**Bug**: con el padre (fila principal, ej. `ZZ_ALBODIGACONTOMATE`) ya en estado `ok` (necesidad cubierta por su propio stock), sus líneas hijas en el desglose expandible seguían mostrando "Pendiente de producir" con stock disponible 0.000 -- porque ese stock ya se consumió al producir al padre. Comparar la contribución del hijo contra su stock ACTUAL (ya vaciado por ese mismo consumo) deja de tener sentido una vez el padre está resuelto -- el estado `ok` del padre ya certifica que esa necesidad se satisfizo.

**Caso real que lo confirmó** (mismo dataset, verificado con consulta de solo lectura): `ZZ_ALBODIGACONTOMATE` (id 18) con necesidad agregada 4.000 ud y stock disponible 4.000 ud -- `ok` en la tabla de Semielaborados. Sus dos hijos directos, `ZZ_TomateFrito` (id 15) y `ZZ_Albondiga frita` (id 19), tienen ambos stock actual 0.000 -- exactamente el caso que producía el falso "Pendiente de producir" en el desglose.

**Fix**: `construirFilaDesglose(linea, enCursoPorSemi, padreOk)` (`PedidosDelDia.jsx`) gana un tercer parámetro, `padreOk` -- con el padre en `ok`, se fuerza `estado: 'ok'` en TODAS las líneas del desglose (semielaborado e ingrediente/artículo) sin mirar su stock, y sin gastar la consulta adicional de faltantes que antes se pedía para las líneas de semielaborado insuficientes (ya no hace falta, se evita innecesariamente). Las cifras de necesidad y disponible se siguen mostrando tal cual (no se ocultan, solo cambia el badge de estado) -- siguen siendo informativas aunque ya no representen "trabajo pendiente". Sin `padreOk`, comportamiento idéntico a antes: comparación contribución vs. stock actual del hijo, sin cambios. `toggleExpandSemi`/`toggleExpandPF` pasan ahora `fila.estado === 'ok'` (el estado de la fila padre, ya calculado, sin consulta adicional) al construir el desglose -- aplica igual a la tabla de "Productos finales" y a la de "Semielaborados", mismo componente `construirFilaDesglose` para ambas.

**Fuera de alcance de este fix** (sin tocar): `necesidades_pedidos_cascada()` y el cálculo de necesidad agregada del padre; la corrección de contribución por padre (Fricción 2, cifras de necesidad/disponible sin cambios); Bloque 3b ("Producciones en curso"); `ProduccionProductosFinales.jsx` y albaranes.

---

## Objetivo

Un único punto de entrada para decidir **qué semielaborado producir hoy**, dimensionado por la necesidad real agregada de todos los pedidos pendientes que lo requieren — sin importar de qué producto final o jerarquía de receta provenga esa necesidad.

## Vista 1 — Selección: "Producciones del día" (nueva, sustituye a `PedidosDelDia.jsx` en su forma actual)

Renombrada de "Pedidos del día" a **"Producciones del día"**: la pantalla ya no organiza por pedido, organiza por semielaborado a producir — el nombre debe reflejar eso. Mismo componente/ruta, cambia el título/label visible.

Más adelante (fuera de alcance de este contrato) habrá una pantalla equivalente para **Productos Finales del día**, con la misma lógica pero un nivel arriba en la jerarquía (necesidad agregada de producto final, contra stock de semielaborado como aguas-abajo). No se aborda todavía.

**Filtros:**
- Semielaborado (selector)
- Fecha máxima de entrega

**Agregación:** por cada semielaborado, suma de la necesidad real across todos los pedidos pendientes que lo requieran (directa o vía receta de producto final), calculada reutilizando `necesidades_pedidos()` — no reimplementar la explosión de receta.

**Selección:** ~~un único semielaborado a la vez~~ -- superado por la addenda "desglose, reordenamiento por estado y producción directa por fila (2026-09-06)": no hay selección previa, cada fila inicia su propia producción directamente.

**Indicador visual:** verde cuando el stock disponible actual (`stock_lotes_semielaborado`) cubre la necesidad agregada; rojo/pendiente en caso contrario.

**Acción:** ~~botón "Producir"~~ -- superado por la misma addenda de más abajo: un botón play por fila navega a Vista 2 (`Producciones.jsx`) con `semielaborado_id` y cantidad necesaria precargados, sin botón general ni selección intermedia.

**Orden de filas — jerárquico, no alfabético:** de hoja a raíz. Un semielaborado sin ningún semielaborado-hijo pendiente en esta misma tabla va primero; los que dependen de otros semielaborados de la tabla van después de ellos. Es el orden real en el que el operador debe iniciar las producciones (empezar por lo que no depende de nada más). Cálculo: dado el conjunto pequeño de semielaborados ya presentes en el resultado (hoy 6), resolver relaciones semielaborado→semielaborado consultando `receta_semielaborado` filtrado a esos ids — no requiere tocar `necesidades_pedidos()` ni calcular profundidad global.

**Badges de tipo de bloqueo (columna fija + tooltip; ~~no fila expandible ni panel lateral~~ -- matiz de la addenda "desglose..." de más abajo: SÍ hay fila expandible, pero para el desglose por componente, no para el detalle de bloqueo -- el tooltip de badges sigue siendo el mecanismo para eso, ambos conviven):** para cada semielaborado en rojo, distinguir visualmente si el motivo es (a) falta de stock de un semielaborado-hijo pendiente de producir primero, (b) falta de stock de un ingrediente/artículo comprado, o ambos. El detalle exacto (qué item, cuánto falta) va en tooltip. Reutiliza la lógica de explosión de un nivel ya construida en `validarStockReceta()` (`Producciones.jsx`) — extraer a función compartida en vez de duplicarla, para no arriesgar divergencia entre las dos pantallas.

**Trazabilidad a pedido/cliente/fecha (mismo tooltip):** para cada semielaborado, qué pedidos (cliente + fecha de entrega) generan esa necesidad. Implementación: llamar a `necesidades_pedidos()` una vez por `pedido_id` (en vez de una sola llamada batch con todos los ids, que agrega y pierde la referencia al pedido de origen) y construir en el cliente un `Map<semielaborado_id, pedido[]>`, cruzando con los datos de `pedidos_venta` ya cargados. No se modifica `necesidades_pedidos()` — es una función compartida por tres pantallas (`PedidosDelDia.jsx`, `Producciones.jsx`, `ProduccionProductosFinales.jsx`) y cambiar su shape arriesga las tres. Coste de N llamadas pequeñas irrelevante al volumen real de pedidos pendientes simultáneos.

## Vista 2 — Producción (ya existe: `Producciones.jsx`, modo `?tanda_id=` o directo)

**No se reconstruye.** Se reutiliza tal cual, con una única pieza nueva:

**Validación previa nueva — informativa, no bloqueante:** antes de iniciar, comprobar recursivamente (misma lógica de explosión que `necesidades_pedidos()`) que cada ingrediente y semielaborado-hijo de la receta tiene stock disponible suficiente para la cantidad a producir. Si falta stock en cualquier nivel, **mostrar aviso claro con qué item falta y cuánto — pero el botón "Iniciar producción" queda habilitado igualmente.**

Decisión explícita (revisada tras probar el primer diseño con bloqueo duro): en producción real hay tolerancia — faltar unos gramos de un ingrediente, o producir algo menos de lo que pide la necesidad agregada, no debe impedir que el operador produzca. Lo que sí es innegociable es la **precisión del dato mostrado** (hasta el nivel de precisión que use la unidad, gramos/mililitros incluidos) para que el operador decida con conocimiento, no que el sistema decida por él.

Hoy esta validación no existe: `iniciarProduccion()` inserta la cabecera sin mirar receta ni stock. El único bloqueo actual (real, ese sí duro) sigue siendo `check_consumo_produccion()` a nivel de base de datos, que actúa al registrar cada línea de consumo y protege contra negativos reales — ese no se toca, sigue siendo la última línea de defensa. El aviso de este contrato es una capa de información previa, no un segundo bloqueo.

Resto del flujo sin cambios: iniciar (`estado: 'abierta'`) → registrar consumo → cerrar (`estado: 'cerrada'`).

---

## Tabla 2 — Productos Finales del día (misma pantalla que Vista 1, tabla separada debajo)

**Alcance de esta iteración — solo vista informativa, igual tratamiento que la tabla de semielaborados:**
- Necesidad agregada por producto final, reutilizando `necesidades_pedidos()` (ya devuelve filas `nivel = 'producto_final'` en la misma llamada — no se descartan como hasta ahora).
- Indicador verde/rojo contra stock disponible de producto final (verificar primero si existe una vista `stock_lotes_producto_final` análoga a las otras dos — no asumir, confirmar en el RPC/schema antes de implementar).
- Badges de tipo de bloqueo (semielaborado-hijo pendiente vs ingrediente/artículo directo), mismo patrón que la tabla de semielaborados, explotando un nivel de `receta_producto_final` (mismo patrón de 3 tipos con CHECK que `receta_semielaborado`, generalizar la función compartida en vez de duplicarla).
- Tooltip con trazabilidad a pedido/cliente/fecha, mismo mecanismo (llamada a `necesidades_pedidos()` por `pedido_id`).
- Sin orden jerárquico especial entre productos finales (no dependen unos de otros, solo de semielaborados/ingredientes) — orden alfabético, igual que el desempate ya usado en la tabla de semielaborados.

**Explícitamente FUERA de alcance de esta iteración (diferido a sesión con diseño en PDF):**
- Selección múltiple de pedidos.
- Agrupación por fecha de entrega + cliente dentro de la tabla de productos finales.
- Botón "Producir" con navegación a `ProduccionProductosFinales.jsx`.
- Revivir la creación de `tandas_produccion` / conectar con `CierreTanda.jsx` — esto resolvería el punto ya documentado en `PENDIENTES_MODELO.md` #12 (`tanda_id` huérfano), pero se decide con el diseño en PDF, no ahora.
- Las "Vista 2" (pantallas de producción en sí, tanto de semielaborados reformada como de productos finales nueva) — el usuario las diseñará en PDF en una sesión aparte.

**Nota operativa:** tras esta implementación, el histórico de contexto de la sesión de Claude Code está cargado — se recomienda una compactación/nueva sesión antes de seguir, apoyándose en este contrato y en `PENDIENTES_MODELO.md` como ancla (mismo patrón ya usado tras el commit `d70f3ac`).

- **No se crea un tercer estado de stock.** `'abierta'`/`'cerrada'` ya cumple el rol de "cocinando": una producción abierta no cuenta como stock disponible para nadie (`stock_lotes_semielaborado` filtra `estado = 'cerrada'`).
- **No se implementa ubicación física (cocina1/cocina2).** El bloqueo de stock mientras se produce, y su devolución parcial al cancelar/editar, ya funciona vía cálculo en vivo sobre `consumo_produccion` (disponible = producido − consumido, no es un contador físico). Sin caso real que justifique ubicaciones por ahora — el tipo `centro_produccion` existe en el CHECK de `ubicaciones` pero no se usa. Revisar si en el futuro hay más de una cocina física real y se necesita repartir carga entre ellas.
- **Cancelación de producción abierta = DELETE con cascade.** Ya funciona (`handleCancelar`), no se toca.

## Fuera de alcance de este contrato (contrato separado más adelante)

- **Estado 2 del workspace** (albaranar en masa una vez el stock de semielaborado está en verde) — se aborda en un contrato y prompt separados, una vez Vista 1 + validación de Vista 2 estén implementadas y verificadas en runtime.
- Multi-selección de varios semielaborados a la vez (hoy: uno por vez, explícitamente).

## Riesgo conocido a vigilar (no bloqueante hoy)

`PENDIENTES_MODELO.md` #2: las vistas agregadas de stock (`stock_semielaborados`, etc.) no agrupan por `ubicacion_id` — decisión deliberada de la Capa 2. No bloqueante mientras exista una única ubicación real. Si en el futuro se activa multiubicación, revisar antes de reactivar este contrato en ese punto.
