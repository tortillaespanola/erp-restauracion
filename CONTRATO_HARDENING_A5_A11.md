# CONTRATO_HARDENING_A5_A11 — Consistencia UX y feedback

## 0. Contexto

Segunda tanda del hardening de FlowBase (la primera, `CONTRATO_HARDENING_A1_A4.md`, ya está cerrada y en producción). Esta tanda cubre consistencia de UX y feedback — sin generalización de producto (eso va en un contrato aparte, alineado con `CONTRATO_GENERICO_CATALOGO.md`) y sin tocar el schema salvo que un problema lo exija de forma justificada.

Misma metodología que la tanda 1: root cause antes de fix, `BEGIN...ROLLBACK` para cualquier SQL, commits lógicos separados, push solo tras verificación en browser, reutilizar antes de crear.

Stack de test ya establecido: Vitest + Testing Library.

## 1. A5 — Success/error feedback en CRUD

Muchas operaciones de crear/editar/borrar/guardar no dan feedback visual claro al completarse.

**Objetivo:** patrón consistente de toast de éxito / error / loading state, vía un hook o componente reutilizable — busca primero si ya existe algo parcial en el proyecto antes de crear uno nuevo. No lo apliques a absolutamente todo; prioriza las operaciones donde hoy el usuario puede quedarse sin saber si algo se guardó.

## 2. A6 — Validación nativa sin localizar

Los mensajes de validación HTML nativa (`required`, `min`/`max`, tipo numérico inválido) aparecen en inglés del navegador aunque la interfaz esté en ES/EN/DE.

**Coordinación importante:** este proyecto tiene un `CONTRATO_I18N.md` en curso (idioma por negocio con override por usuario, PDFs en el idioma del negocio, migración por fases según criticidad operativa). No dupliques esa infraestructura de i18n — usa las claves/mecanismo que ya exista ahí para los mensajes de validación. Si esta pieza concreta de validación nativa no está cubierta todavía por ese contrato, avísalo en el informe en vez de crear un segundo sistema de traducción.

## 3. A7 — UX de inputs numéricos

Al editar un campo numérico con valor prellenado, el nuevo valor puede insertarse en la posición del cursor en vez de reemplazar el contenido (ej. querer escribir `20` sobre `3.2320` y acabar con algo mezclado).

**Objetivo:** comportamiento coherente de focus/select-on-focus en los inputs numéricos relevantes (quantity, price, stock, production quantity, percentages, costs). No debe romper la edición normal de valores ya existentes (por ejemplo, seguir pudiendo corregir solo un dígito con el teclado sin que se seleccione todo en cada pulsación).

## 4. A8 — UI muerta (búsqueda global / notificaciones)

Existen elementos de UI (buscador global, campana de notificaciones) que aparentan ser funcionales pero no hacen nada.

**No implementes búsqueda ni notificaciones reales todavía.** Solo: elimina el elemento, o conviértelo en placeholder claramente no interactivo. El criterio es simple: nada que aparente funcionar y no haga nada.

## 5. A9 — Inconsistencia en acciones de facturas (compra vs venta)

Revisar botones, labels, ubicación, diálogos y comportamiento CRUD entre facturas de compra y facturas de venta para que sean coherentes entre sí.

**Incluye explícitamente:** el pendiente ya identificado de que `handleBorrar` en Albaranes de compra debe capturar/manejar la violación de FK de `albaran_compra_id` (que se dejó sin `ON DELETE CASCADE` a propósito al construir `CONTRATO_PAGOS_COMPRA.md`) en vez de fallar silenciosamente o con un error genérico. Alinea el comportamiento de borrado de compra con el de venta si este último ya maneja ese caso mejor.

No cambies el modelo de negocio salvo que encuentres una inconsistencia real, no solo estética.

## 6. A10 — Patrón de creación (auditoría, no rediseño)

El drawer ya es el patrón establecido en este proyecto (migrado en ventas y en compras vía `CONTRATO_DRAWERS_COMPRAS.md`).

**Objetivo real de este punto:** audita qué pantallas del proyecto siguen usando modal o formulario inline para crear/editar (ej. Producciones, Semielaborados, Ajustes de stock, Productos finales — verifica cuáles) y decide, pantalla por pantalla, si migrarlas a drawer aporta consistencia real o si hay una razón legítima para que sigan como están (por ejemplo, un formulario que necesita más espacio horizontal). No hagas una migración masiva automática — lista las candidatas y su justificación en el informe, y migra solo las que tengan sentido claro sin abrir un frente enorme.

## 7. A11 — Rendimiento/usabilidad de Artículos

La pantalla de Artículos puede crecer mucho (tabla larga + información de precios por proveedor), dificultando escanear.

**Objetivo:** paginación, filas expandibles/colapsadas, filtro básico — mejora razonable, sin construir todavía un sistema de búsqueda global (eso es A8, explícitamente fuera de scope por ahora).

## 8. Testing

Añadir tests con Vitest + Testing Library donde el problema lo justifique (especialmente A7 — comportamiento de selección en foco — y A9 — el manejo de la FK al borrar). No es necesario forzar tests en cambios puramente visuales (A8, parte visual de A10).

## 9. Entregable final

Mismo formato que la tanda 1:
1. Qué encontraste (por punto A5-A11)
2. Qué cambiaste (por archivo)
3. Migraciones DB (o "No database changes")
4. Tests añadidos y resultado
5. Verificación en browser realizada
6. Detectado pero fuera de scope
7. Riesgos o decisiones que necesitan tu validación antes de la siguiente tanda (generalización de producto)
