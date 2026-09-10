# CONTRATO_GENERALIZACION_TANDA3 — Genericización de producto

## 0. Contexto

Tercera y última tanda de la auditoría de hardening/generalización de FlowBase. Las dos anteriores (`CONTRATO_HARDENING_A1_A4.md`, `CONTRATO_HARDENING_A5_A11.md`) están cerradas y en producción.

Esta tanda NO es un contrato nuevo desde cero: **su núcleo es `CONTRATO_GENERICO_CATALOGO.md`, que ya existe en el repo con las fases y decisiones ya fijadas.** Léelo primero y ejecútalo tal como está — no reabras decisiones que ya tomó el usuario ahí (en particular: NO fusiones `ingredientes`/`semielaborados`/`productos_finales` en una tabla única; eso se decidió explícitamente en contra).

Este documento añade únicamente lo que quedó fuera de ese contrato pero seguía pendiente del audit original de generalización.

Misma metodología de siempre: root cause antes de fix, `BEGIN...ROLLBACK` para SQL, commits lógicos separados por fase/punto, push solo tras verificación en browser, Vitest + Testing Library donde aplique.

## 1. Ejecutar tal cual — `CONTRATO_GENERICO_CATALOGO.md`

Fase 0 (renombrado i18n/terminología: ingredientes→"Artículo base", recetas→"Fórmula/BOM"), Fase 1 (`categoria_id` en `semielaborados`/`productos_finales`, nullable y aditivo), Fase 2 (UI de admin para `categorias_articulo`/`unidades_medida`), Fase 3 (CHECK constraint en `estado` de `pedidos_venta`/`pedidos_compra`).

Respeta también su lista de "explícitamente fuera de scope": fusión de tablas, cambiar `productos_finales.unidad_id`, tocar lógica de `CierreTanda.jsx` más allá de sus strings, convertir `estado` a ENUM/lookup, dashboard/IVA-VAT.

## 2. Añadido — Generalizar "CIF"

Terminología específica española (`CIF`) debe generalizarse a un concepto tipo `Tax ID` / `VAT number` según idioma, integrado en la misma infraestructura i18n que ya usa `CONTRATO_I18N.md` (no crear una segunda). Aplica en ES/EN/DE. Este punto encaja de forma natural en la Fase 0 de terminología — impleméntalo junto a esa fase, no como paso aislado.

## 3. Añadido — Verificar el estado de €→CHF

Hay una decisión ya tomada (documentada al scopear `CONTRATO_I18N.md`) de que el símbolo `€` en la app es un error de plantilla y la moneda correcta es CHF. Antes de tocar nada de moneda en esta tanda:

1. Comprueba si ese fix ya se aplicó en algún commit anterior o si sigue pendiente.
2. Si sigue pendiente, aplícalo aquí (reemplazo simple de símbolo/config, no un sistema multi-moneda).
3. **No construyas** soporte multi-moneda (EUR/USD configurables) ni un sistema de payment methods genérico en esta tanda — el proyecto solo tiene negocios en Basel hoy. Si detectas hardcoding de `CHF`/`Twint` que sea trivial de sacar a config sin esfuerzo (ej. una constante en vez de un literal repetido 10 veces), hazlo; si requiere diseño nuevo, anótalo como pendiente para cuando haya un negocio en otra moneda real.

## 4. Añadido — Limpieza de demo data

Revisa los registros creados durante QA/testing de las dos tandas anteriores (browser automation, pruebas manuales).

**Regla estricta:** no borres nada sin comprobar antes qué es. Limpia solo:
- registros inequívocamente de testing (nombres tipo "test", "prueba", timestamps de sesiones de QA identificables)
- duplicados accidentales evidentes

Mantén intactos todos los datos de Demo Catering Basel que sirven como demo real del negocio, y todos los datos reales de producción de Española/Company Valencia. Ante la duda, no borres — lista el registro dudoso en el informe y pregúntame.

## 5. Añadido — Iconos de sidebar genéricos

La sidebar usa hoy iconos temáticos de gastronomía en varias entradas (ej. Artículos base = gorro de chef, Semielaborados = taza, Producciones = batidor, Productos finales = utensilio de cocina, Producción prod. finales = icono de horno/cocción). Refuerzan la percepción de "software de catering" incluso después del renombrado de terminología de la Fase 0.

**Objetivo:** sustituirlos por iconos genéricos y neutrales (paquete/caja, capas/stack, engranaje/play, check-box, flecha de proceso — a tu criterio siempre que sean neutrales, no literalmente de cocina). Usa el mismo set `@tabler/icons-react` que ya está en el proyecto (usado, por ejemplo, en el sistema de indicadores de stock) — no introduzcas una librería de iconos nueva.

No te limites a las 5 entradas de la captura: audita el resto de la sidebar y cualquier icono equivalente que se repita dentro de las pantallas (headers de tabla, botones, tarjetas) por si hay más iconos food-specific colados fuera del menú.

## 6. Explícitamente fuera de esta tanda

- **A13 (dashboard/home):** el propio audit original ya decía "no construyas BI complejo ahora". Sigue fuera de scope — se evaluará como tanda futura solo si aporta valor operativo real reutilizando info existente, no como prioridad actual.
- **A15 (breadcrumbs/navegación):** cosmético, bajo impacto — no forma parte de esta tanda. Si durante el trabajo de Fase 0-3 ves un breadcrumb que se rompe por el renombrado de terminología, arréglalo puntualmente; no audites navegación completa.
- Cualquier ítem que `CONTRATO_GENERICO_CATALOGO.md` ya listó como fuera de scope (ver sección 1).

## 7. Entregable final

Mismo formato que las tandas anteriores:
1. Qué encontraste (por fase de `CONTRATO_GENERICO_CATALOGO.md` + CIF + estado de €→CHF + demo data + iconos)
2. Qué cambiaste (por archivo)
3. Migraciones DB (o "No database changes")
4. Tests añadidos y resultado
5. Verificación en browser realizada
6. Detectado pero fuera de scope
7. Valoración final: después de las 3 tandas, ¿hasta qué punto FlowBase se percibe como ERP genérico y qué sigue anclándolo a catering (aunque sea solo por los datos de demo, que deben quedarse)?
