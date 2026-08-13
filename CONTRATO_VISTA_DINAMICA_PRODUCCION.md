# Contrato: Vista Dinámica de Producción

Rediseño de Pantalla 1 (`PedidosDelDia.jsx`) + conexión con Pantalla de Producción (`Producciones.jsx`). Sustituye la agrupación producto→fecha→cliente por una vista filtrada, orientada a necesidad real de semielaborado.

Estado: Vista 1 completa -- tabla de semielaborados (necesidad, stock, badges de bloqueo, trazabilidad a pedido, orden jerárquico) y tabla de productos finales (mismo tratamiento informativo, sin selección múltiple) implementadas y verificadas en runtime contra dataset ZZ. Pendiente: (a) Vista 2 de ambas pantallas de producción, a diseñar en PDF en sesión aparte -- no implementar nada de Vista 2 hasta recibir ese diseño; (b) tanda_id sigue huérfano (PENDIENTES_MODELO.md #12), se resuelve con el diseño de Vista 2; (c) sesión de compactación/UI con capturas reales, si sigue siendo necesaria tras ver el resultado visual actual. Fecha: 2026-08-13.

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

**Selección:** un único semielaborado a la vez. Puede provenir de múltiples pedidos y de múltiples jerarquías de producto — eso es indiferente para la selección, solo importa el total agregado de ese semielaborado.

**Indicador visual:** verde cuando el stock disponible actual (`stock_lotes_semielaborado`) cubre la necesidad agregada; rojo/pendiente en caso contrario.

**Acción:** botón "Producir" → navega a Vista 2 (`Producciones.jsx`) con `semielaborado_id` y cantidad necesaria precargados.

**Orden de filas — jerárquico, no alfabético:** de hoja a raíz. Un semielaborado sin ningún semielaborado-hijo pendiente en esta misma tabla va primero; los que dependen de otros semielaborados de la tabla van después de ellos. Es el orden real en el que el operador debe iniciar las producciones (empezar por lo que no depende de nada más). Cálculo: dado el conjunto pequeño de semielaborados ya presentes en el resultado (hoy 6), resolver relaciones semielaborado→semielaborado consultando `receta_semielaborado` filtrado a esos ids — no requiere tocar `necesidades_pedidos()` ni calcular profundidad global.

**Badges de tipo de bloqueo (columna fija + tooltip, no fila expandible ni panel lateral):** para cada semielaborado en rojo, distinguir visualmente si el motivo es (a) falta de stock de un semielaborado-hijo pendiente de producir primero, (b) falta de stock de un ingrediente/artículo comprado, o ambos. El detalle exacto (qué item, cuánto falta) va en tooltip. Reutiliza la lógica de explosión de un nivel ya construida en `validarStockReceta()` (`Producciones.jsx`) — extraer a función compartida en vez de duplicarla, para no arriesgar divergencia entre las dos pantallas.

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
