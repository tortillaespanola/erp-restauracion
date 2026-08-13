# Contrato: Vista Dinámica de Producción

Rediseño de Pantalla 1 (`PedidosDelDia.jsx`) + conexión con Pantalla de Producción (`Producciones.jsx`). Sustituye la agrupación producto→fecha→cliente por una vista filtrada, orientada a necesidad real de semielaborado.

Estado: Vista 1 (Producciones del día) y validación previa de Vista 2 (`Producciones.jsx`) implementadas y verificadas en runtime contra dataset ZZ. Pendiente: (a) sesión de UI/compactación aparte con capturas reales — no tocar layout hasta esa sesión; (b) contrato de Estado 2 (albaranar en masa) sin escribir todavía; (c) `tanda_id` ha quedado huérfano — ningún camino de la UI crea ya una `tandas_produccion`, `CierreTanda.jsx` y los modos `?tanda_id=` de `Producciones.jsx`/`ProduccionProductosFinales.jsx` siguen vivos pero inalcanzables desde el flujo nuevo, pendiente de resolver en el contrato de Estado 2. Fecha: 2026-08-13.

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

## Vista 2 — Producción (ya existe: `Producciones.jsx`, modo `?tanda_id=` o directo)

**No se reconstruye.** Se reutiliza tal cual, con una única pieza nueva:

**Validación previa nueva — informativa, no bloqueante:** antes de iniciar, comprobar recursivamente (misma lógica de explosión que `necesidades_pedidos()`) que cada ingrediente y semielaborado-hijo de la receta tiene stock disponible suficiente para la cantidad a producir. Si falta stock en cualquier nivel, **mostrar aviso claro con qué item falta y cuánto — pero el botón "Iniciar producción" queda habilitado igualmente.**

Decisión explícita (revisada tras probar el primer diseño con bloqueo duro): en producción real hay tolerancia — faltar unos gramos de un ingrediente, o producir algo menos de lo que pide la necesidad agregada, no debe impedir que el operador produzca. Lo que sí es innegociable es la **precisión del dato mostrado** (hasta el nivel de precisión que use la unidad, gramos/mililitros incluidos) para que el operador decida con conocimiento, no que el sistema decida por él.

Hoy esta validación no existe: `iniciarProduccion()` inserta la cabecera sin mirar receta ni stock. El único bloqueo actual (real, ese sí duro) sigue siendo `check_consumo_produccion()` a nivel de base de datos, que actúa al registrar cada línea de consumo y protege contra negativos reales — ese no se toca, sigue siendo la última línea de defensa. El aviso de este contrato es una capa de información previa, no un segundo bloqueo.

Resto del flujo sin cambios: iniciar (`estado: 'abierta'`) → registrar consumo → cerrar (`estado: 'cerrada'`).

---

## Decisiones ya tomadas — no reabrir sin motivo nuevo

- **No se crea un tercer estado de stock.** `'abierta'`/`'cerrada'` ya cumple el rol de "cocinando": una producción abierta no cuenta como stock disponible para nadie (`stock_lotes_semielaborado` filtra `estado = 'cerrada'`).
- **No se implementa ubicación física (cocina1/cocina2).** El bloqueo de stock mientras se produce, y su devolución parcial al cancelar/editar, ya funciona vía cálculo en vivo sobre `consumo_produccion` (disponible = producido − consumido, no es un contador físico). Sin caso real que justifique ubicaciones por ahora — el tipo `centro_produccion` existe en el CHECK de `ubicaciones` pero no se usa. Revisar si en el futuro hay más de una cocina física real y se necesita repartir carga entre ellas.
- **Cancelación de producción abierta = DELETE con cascade.** Ya funciona (`handleCancelar`), no se toca.

## Fuera de alcance de este contrato (contrato separado más adelante)

- **Estado 2 del workspace** (albaranar en masa una vez el stock de semielaborado está en verde) — se aborda en un contrato y prompt separados, una vez Vista 1 + validación de Vista 2 estén implementadas y verificadas en runtime.
- Multi-selección de varios semielaborados a la vez (hoy: uno por vez, explícitamente).

## Riesgo conocido a vigilar (no bloqueante hoy)

`PENDIENTES_MODELO.md` #2: las vistas agregadas de stock (`stock_semielaborados`, etc.) no agrupan por `ubicacion_id` — decisión deliberada de la Capa 2. No bloqueante mientras exista una única ubicación real. Si en el futuro se activa multiubicación, revisar antes de reactivar este contrato en ese punto.
