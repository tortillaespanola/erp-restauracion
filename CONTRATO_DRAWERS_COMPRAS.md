# CONTRATO_DRAWERS_COMPRAS.md

**Estado:** ✅ Cerrado — completado y verificado el 09-09-2026.
**Basado en:** `AUDITORIA_DRAWERS_VENTAS_PARA_COMPRAS.md` (auditoría de solo lectura, sin cambios de código).
**Precedentes:** `CONTRATO_UX_PEDIDOS_VENTA.md`, `CONTRATO_UX_ALBARANES_VENTA.md`, `CONTRATO_UX_FACTURAS_VENTA.md`, `CONTRATO_FILTROS_VENTA.md`.

---

## 1. Objetivo

Migrar las tres pantallas de Compras (`PedidosCompra.jsx`, `AlbaranesCompra.jsx`, `FacturasCompra.jsx`) del patrón actual de formulario inline/pantalla completa al patrón de **drawer lateral** ya establecido y probado en Venta, reutilizando el componente genérico `Drawer` de `ui.jsx` sin modificarlo.

## 2. Alcance

Incluye:
- Extraer los formularios de alta/edición de las tres pantallas de Compras a componentes propios (`PedidoCompraForm.jsx`, `AlbaranCompraForm.jsx`, `FacturaCompraForm.jsx`) si aún no lo están, montados dentro de `<Drawer>`.
- Adoptar el patrón de estado `modoDrawer` (`null` / `'nuevo'` / objeto) en las tres pantallas — no el booleano simple — porque las tres necesitan soportar edición (a diferencia de Albaranes/Facturas de venta, que solo tienen alta).
- Preservar el deep-linking unidireccional `PedidosCompra.jsx → navigate('/albaranes-compra?pedido_compra_id=...')`, con `AlbaranesCompra.jsx` leyendo el query param y auto-abriendo su drawer al montar, igual que `AlbaranesVenta.jsx`.
- Migrar la lógica de líneas bloqueadas (`locked`, vía `consumo_produccion`/`consumo_produccion_pf`/`ajustes_articulo`) de `AlbaranesCompra.jsx` al nuevo `AlbaranCompraForm.jsx`, resuelta en el padre (`handleEditar` async) **antes** de abrir el drawer — igual que hace `Pedidos.jsx` — para no abrir un formulario a medio cargar.
- El `useEffect` de recarga de `articulosDelProveedor` por `proveedorId` se mueve **dentro** del formulario extraído (no se pasa filtrado desde el padre), para mantener el mismo aislamiento que ya tiene Venta: el hijo es dueño de su estado derivado, el padre solo pasa catálogos base.
- Conservar el `<select>` de `tipoOrigen` (`'pedido'` / `'compra_directa'`) dentro de `AlbaranCompraForm.jsx`.
- Conservar el aviso de confirmación al cambiar de proveedor con líneas rellenas en `PedidoCompraForm.jsx`.
- Conservar el aviso de "tiene consumos asociados" al borrar un albarán de compra, como acción de fila del listado (fuera del drawer), igual que en Venta.
- Eliminar el `resetForm()` explícito: al desmontar el formulario cada vez que se cierra el drawer, cada apertura es un montaje limpio.
- **Paginación/filtros/orden server-side** en las tres pantallas de Compras, replicando el patrón de `CONTRATO_FILTROS_VENTA.md`: sustituir `cargarDatos()` (carga completa, sin `.range()`) por consultas con `.range()`, `{ count: 'exact' }` y filtros/orden resueltos en Supabase, no en el navegador. Se ejecuta como paso independiente por pantalla, después de tener el drawer funcionando en esa pantalla (ver sección 5), para no mezclar en un mismo cambio "dónde vive el formulario" con "cómo se consulta el listado".

**No incluye** (fuera de alcance de este contrato, requieren decisión aparte si se quieren):
- Añadir columna `grupo_estado` a `pedidos_compra` para replicar el agrupamiento visual "activos arriba / cerrados al fondo" de `Pedidos.jsx` (venta).
- Cambiar el campo `total` de `FacturasCompra.jsx` de manual a calculado — es una decisión de negocio deliberada y distinta de Venta, no se toca.
- Cualquier funcionalidad de pagos a proveedores — se trata en `CONTRATO_PAGOS_COMPRA.md`, aparte.

## 3. Diferencias respecto a Venta que la migración debe respetar (no "corregir")

| Aspecto | Venta | Compra | Implicación para el drawer |
|---|---|---|---|
| Dirección del stock | Consume lotes existentes | Crea lotes nuevos (`entrada_material`) | `AlbaranCompraForm` se parece estructuralmente a `PedidoForm.jsx` (líneas simples), no a `AlbaranVentaForm.jsx` (selección FIFO) |
| Catálogo de artículos | Global, prop estática | Depende de proveedor, recarga dinámica | `useEffect` de recarga vive dentro del form extraído |
| Edición con líneas bloqueadas | No existe (Pedidos bloquea todo o nada) | Sí, por línea (`locked`) | Debe migrarse sin perder granularidad |
| Total de factura | Calculado server-side | Manual (`<Input type="number">`) | Se mantiene manual, no se toca en este contrato |
| Confirmación al cambiar proveedor | No aplica | Sí, si hay líneas rellenas | Se conserva en `PedidoCompraForm.jsx` |

## 4. Plantillas de referencia

- **Listados**: `Pedidos.jsx` (venta) como plantilla principal por soportar `modoDrawer` de 3 estados. `AlbaranesVenta.jsx`/`FacturasVenta.jsx` solo como referencia del caso "solo alta" (no aplica aquí, las tres pantallas de compra necesitan edición).
- **Formularios**: `PedidoForm.jsx` (venta, líneas en lista simple) como base de `AlbaranCompraForm.jsx`, combinado con la lógica de líneas bloqueadas ya existente en el `AlbaranesCompra.jsx` actual. **No** usar `AlbaranVentaForm.jsx` como plantilla — resuelve un problema distinto (consumo FIFO) que no aplica a Compras.

## 5. Orden de ejecución propuesto

Por cada pantalla, primero el drawer y después la paginación/filtros server-side sobre esa misma pantalla ya migrada — nunca los dos cambios a la vez:

1. `PedidosCompra.jsx` + `PedidoCompraForm.jsx` → drawer (el más simple, sin líneas bloqueadas, sirve de validación del patrón) → paginación/filtros/orden server-side.
2. `AlbaranesCompra.jsx` + `AlbaranCompraForm.jsx` → drawer (el más complejo: líneas bloqueadas + catálogo por proveedor + deep-linking) → paginación/filtros/orden server-side.
3. `FacturasCompra.jsx` + `FacturaCompraForm.jsx` → drawer (el más simple de los tres, sin líneas propias) → paginación/filtros/orden server-side.

Cada paso (drawer o paginación) se entrega y valida por separado antes de pasar al siguiente.

## 6. Criterios de aceptación

- Las tres pantallas abren alta y edición en drawer, sin navegación de página completa salvo el deep-link ya existente entre Pedidos → Albaranes de compra.
- Ningún comportamiento funcional descrito en la sección 3 cambia respecto al comportamiento actual.
- El borrado de líneas/documentos con dependencias (consumo de producción, ajustes) sigue avisando antes de confirmar, igual que hoy.
- No se introduce `resetForm()` en ningún formulario nuevo.
- Las tres pantallas consultan con `.range()` y `{ count: 'exact' }`; ningún listado carga la tabla completa sin límite tras este contrato.
- Los filtros y el orden aplicados por el usuario se resuelven en la consulta a Supabase, no filtrando/ordenando el array ya cargado en el navegador.

## 7. Riesgos conocidos y aceptados

- Si se abre un drawer de "nuevo albarán de compra" mientras hay un drawer de venta abierto en otra pestaña, el de venta no se refresca solo. Limitación ya existente en Venta, se hereda conscientemente, no es una regresión.

## 8. Decisiones que quedan explícitamente fuera y requieren su propio contrato si se piden

- `grupo_estado` para `pedidos_compra`.
- Cambiar el total de factura de compra de manual a calculado.

## 9. Desviaciones de alcance aceptadas durante la ejecución

- **Paso 1 (Pedidos de compra):** `PedidosCompra.jsx` no tenía ninguna función de edición antes de este contrato (el contrato asumía paridad con `Pedidos.jsx` de venta, que sí la tiene). Se añadió como funcionalidad nueva, no como migración de comportamiento existente. Criterio de bloqueo confirmado: no editable si alguna línea tiene `entrada_material` recibida. Confirmado y aceptado explícitamente el 09-09-2026.
- **Paso 2 (Albaranes de compra):** drawer con `anchoClase="max-w-2xl"` (igual que `AlbaranesVenta.jsx`), decidido por Code por la mayor densidad de columnas de la línea de albarán. Confirmado y aceptado explícitamente el 09-09-2026.
  - **Verificación pendiente de hacer a mano** (no cubierta por la verificación automática de Code, por falta de datos reales en la demo): el bloqueo visual de líneas ya consumidas (`locked`) y el aviso de borrado "con dependencias" (consumo de producción real). El código es una migración literal del original sin cambios de lógica, pero no se ha visto funcionar en pantalla contra un caso real todavía.
- **Paso 3 (Facturas de compra):** `FacturasCompra.jsx` tampoco tenía función de edición (mismo hueco que en el paso 1). Se añadió: factura siempre editable, proveedor deshabilitado al editar, relación con albaranes resuelta por diff (borrar quitados + insertar nuevos, ya que `factura_compra_albaran` no admite `UPDATE`). Sin criterio de bloqueo, porque no hay hoy ningún concepto de "anulada" ni de pago que lo justifique (eso llega con `CONTRATO_PAGOS_COMPRA.md`).
  - Nota técnica: se detectó y corrigió un bug real durante la verificación (no solo revisión de código) — la precarga de albaranes seleccionados al editar se perdía por una interacción entre la lógica de "primera carga" y `React.StrictMode` (doble invocación de efectos en desarrollo). Corregido comparando el proveedor actual contra el anterior por valor, en vez de contar invocaciones.

## 10. Estado de cierre

- Migración a drawer (pasos 1-3 de la sección 5): **completa** en las tres pantallas, verificada en navegador.
- Paginación/filtros/orden server-side: **completa**. `.range()` + `{ count: 'exact' }` en las tres pantallas, filtros server-side, `<Select>` "Ordenar por" y el mismo bloque de paginación que ya usan las tres pantallas de Venta, copiado literal. Decisiones tomadas: UI de tarjetas + `<Select>` (no tabla, Compras nunca tuvo tabla); Albaranes de compra solo con filtro "Facturación" (sin "Cobro", no existe sin sistema de pagos); Facturas de compra sin filtro de Estado (no hay `anulada` ni saldo todavía). Verificado con datos reales: conteos correctos al filtrar/limpiar, orden y paginación funcionando. Ningún cambio necesario en los tres formularios extraídos ni en pagos.
- Verificación manual del paso 2 (bloqueo `locked` + aviso de borrado con dependencias en Albaranes de compra): **completada con caso real**, generado de forma no destructiva vía un ajuste de stock genuino sobre un albarán de prueba. Bloqueo visual y aviso de borrado confirmados exactamente como se esperaba; borrado en cascada limpio, sin huérfanos.
- **Contrato cerrado al 100%.** Fuera de alcance, tal como se excluyó siempre explícitamente: `grupo_estado` para `pedidos_compra`, total de factura de compra calculado, y todo lo de `CONTRATO_PAGOS_COMPRA.md`.
