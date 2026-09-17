# CONTRATO_HARDENING_A1_A4 — Bugs críticos de estabilidad e integridad de datos

## 0. Contexto

Este contrato cubre **solo** los 4 problemas críticos detectados en la auditoría funcional de FlowBase (browser automation). NO toca generalización de producto, UX secundaria ni features nuevas — eso irá en contratos separados (`CONTRATO_HARDENING_A5_A11.md` y el ya existente `CONTRATO_GENERICO_CATALOGO.md`).

Repositorio: https://github.com/tortillaespanola/flowbase
Desplegado: https://flowbase-orpin.vercel.app

No hagas cambios fuera del scope de este contrato, aunque los detectes de paso. Anótalos en un apartado "Detectado pero fuera de scope" en tu informe final.

## 1. Metodología obligatoria (ya usada en este proyecto)

- Antes de tocar código: inspecciona el módulo afectado, el schema de Supabase, las queries y el flujo completo UI→API→DB→UI. No propongas fix sin root cause.
- Cualquier migración SQL: probar primero en `BEGIN ... ROLLBACK`, documentar por qué es necesaria, y que sea backwards-compatible. Nunca `DROP TABLE`, `DELETE` masivo, ni cambios destructivos de schema.
- Commit local tras cada fix lógico (mensajes descriptivos, uno por problema — no mezclar "fix numeric parsing" con otra cosa). Push solo después de verificación manual en browser.
- Antes de crear un componente/hook/servicio nuevo: busca si ya existe algo reutilizable (ya hay, por ejemplo, `formatCantidad.js` / `formatPrecio.js` para formato numérico).

## 2. A1 — CRITICAL — SPA Routing / Vercel

Rutas internas (ej. `/produccion/producciones`) dan 404 al hacer refresh o acceder directamente, aunque funcionan navegando desde dentro de la app.

**Objetivo:** configurar el rewrite SPA correctamente en `vercel.json` (o equivalente) para que TODAS las rutas de React Router resuelvan vía fallback a `index.html`, no solo la ruta donde se detectó el bug.

**Verificar:** navegación interna, refresh, acceso directo por URL, rutas anidadas, deep links.

## 3. A2 — CRITICAL — Sales Order Status (single source of truth)

Se ha visto un pedido en estado `Served` con líneas en `0/2 served`. Los dos estados pueden contradecirse.

**Contexto importante que Code debe conocer antes de decidir nada:** este proyecto ya tiene una decisión pendiente documentada sobre un problema relacionado — la tabla `productos_finales` tiene un estado que hoy solo refleja si el stock es suficiente (necesidad vs. producido), pero NO si las unidades producidas ya fueron distribuidas a los pedidos via `previsiones_distribucion_pf`. Es decir: puede haber stock "OK" con residual sin distribuir. Esa capa (`previsiones_distribucion_pf`) es solo de warnings, no bloquea nada todavía.

Antes de tocar el estado de pedidos de venta:
1. Investiga cómo se calcula hoy el estado de cabecera del pedido vs. el estado de fulfillment de línea (busca los triggers/funciones tipo `actualizar_estado_pedido_por_servicio()`).
2. Ten en cuenta que ya hubo bugs históricos de asimetría en triggers de estado (no revertían al borrar) — revisa que tu fix no reintroduzca eso.
3. Decide: ¿el estado de cabecera debe derivarse siempre de las líneas, o mantenerse independiente con reglas explícitas? Documenta la decisión y el porqué en el informe final, relacionándola con el pendiente de `previsiones_distribucion_pf` si aplica (no hace falta resolver ese pendiente aquí, pero si tu cambio lo afecta, dilo explícitamente).

**Tests de regresión mínimos:** 0% servido, parcialmente servido, 100% servido, pedido cancelado, pedido nuevo, pedido sin líneas (si el modelo lo permite).

## 4. A3 — CRITICAL — Numeric / Locale Bug

Bug detectado: `50.000 - 1.000` puede resultar `49` en vez de `49.000` en algún formulario — posible error de parseo de separador de miles/decimales, factor 1000 de diferencia.

**Regla:** los valores numéricos deben tratarse como números en todo el flujo interno (state, API, DB); el formato localizado (ES `49.000` / EN `49,000` / DE `49.000,50` etc.) es responsabilidad exclusiva de la capa de presentación.

Ya existen helpers de formato en el proyecto (`formatCantidad.js`, `formatPrecio.js`) — reutilízalos, no crees un segundo sistema. Revisa también los usos de `.toFixed()` todavía sin migrar a esos helpers (deuda ya conocida).

**Auditar globalmente**, no solo el campo donde se detectó: quantities, prices, costs, stock, production quantities, sales/purchase quantities.

**Tests:** ES/EN/DE × valores `1, 1.5, 10, 1000, 10000, 1000.5, 12345.67`.

## 5. A4 — HIGH — Dependent Dropdown Race Conditions

Dropdowns dependientes (ej. Proveedor → Artículo) pueden mostrar momentáneamente vacío, datos viejos o "no results" por condición de carrera en fetch asíncrono.

**Objetivo:** un patrón reutilizable (abort/cancelación de fetch obsoleto, reset de selección al cambiar el padre, loading state claro) — no un parche puntual para un solo selector. Debe poder aplicarse a cualquier dependent selector del proyecto.

## 6. Testing

No existe hoy un framework de tests automatizados en el proyecto (solo verificación manual en browser). Antes de escribir tests para A2/A3/A4:

**Decisión a confirmar conmigo antes de generalizar infraestructura:** propones qué framework introducir (sugerencia: Vitest, por ser nativo de Vite) con el mínimo overhead — no lo decidas ni lo instales sin decírmelo primero en tu plan inicial.

## 7. Entregable final

Igual que el resto de contratos de este proyecto:
1. Qué encontraste (root cause de cada uno de los 4 bugs)
2. Qué cambiaste (por archivo)
3. Migraciones DB (o "No database changes")
4. Tests añadidos y resultado
5. Verificación en browser realizada
6. Detectado pero fuera de scope de este contrato
7. Riesgos o decisiones que necesitan tu validación antes de continuar con la siguiente tanda
