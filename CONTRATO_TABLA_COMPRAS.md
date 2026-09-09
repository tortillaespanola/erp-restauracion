# CONTRATO_TABLA_COMPRAS.md

**Estado:** ✅ Cerrado — completado y verificado el 09-09-2026.
**Basado en:** auditoría de solo lectura del patrón de tabla de Venta vs. tarjetas de Compras (09-09-2026), sin cambios de código.
**Precedentes:** `CONTRATO_DRAWERS_COMPRAS.md` (que fijó tarjetas + `<Select>` "Ordenar por" como decisión deliberada, ahora revertida por decisión explícita del usuario — no es una corrección, es un cambio de diseño nuevo).

---

## 1. Objetivo

Sustituir las tarjetas de `PedidosCompra.jsx`, `AlbaranesCompra.jsx` y `FacturasCompra.jsx` por el mismo patrón de tabla con fila expandible y cabeceras ordenables que ya usan las 4 pantallas de Venta, con los mismos iconos de estado donde apliquen.

## 2. Alcance real: 3 pantallas, no 4

`PagosCompra.jsx` ya es un espejo exacto del patrón de tabla de `Pagos.jsx` (cabeceras clicables, fila expandible, badge "Anulada") — construido así desde `CONTRATO_PAGOS_COMPRA.md`. **No requiere ningún cambio en este contrato.**

## 3. Patrón a replicar (auditado, no un componente compartido)

No existe un componente de tabla genérico entre las 4 pantallas de Venta — cada una construye su propio `<table>` con clases Tailwind repetidas. El patrón a copiar, idéntico en las 3 pantallas de Compras:

- **Fila expandible:** `filaExpandidaId` único a nivel de pantalla (acordeón, no un `Set` por fila). Toggle con `IconChevronRight`/`IconChevronDown` (`@tabler/icons-react`) en un `<button>` dentro de la primera `<td>` (ancho fijo `w-8`). Fila `<tr>` extra con `colSpan` completo, `<div className="grid transition-[grid-template-rows] duration-200 ease-in-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}">` para la transición CSS sin JS.
- **Cabeceras ordenables:** cada `<th>` ordenable envuelve su texto en un `<button onClick={() => cambiarOrden('columna')}>` con icono `IconArrowsSort`/`IconArrowUp`/`IconArrowDown`. Estado `orden = { columna, direccion }`. Ciclo de 3 estados por columna: dirección inicial (semántica por columna, no un default global) → dirección contraria → `columna: null` (orden por defecto). El cambio de orden sigue dispatando el mismo `.order()` a Supabase que ya usa el `<Select>` actual — solo cambia el control de UI, no el mecanismo de datos. Cada cambio resetea `pagina` a 1.
- **Filtros:** el contenedor y el resto de filtros (Proveedor, Desde/Hasta, `<MultiSelect>` donde exista) no cambian de estructura. Solo desaparece el `<Field label="Ordenar por"><Select>...</Select></Field>`, sustituido por `cambiarOrden()`/`iconoOrden()` en las cabeceras.

## 4. Decisiones fijadas (confirmadas el 09-09-2026, no discutibles dentro de este contrato)

1. **Líneas ocultas tras la flecha de expandir**, igual que Venta — antes visibles siempre en la tarjeta, ahora requieren expandir la fila.
2. **Columna "Pedido origen" en Albaranes de compra**: se añade, resolviendo `entrada_material.linea_pedido_compra_id → pedidos_compra.codigo_pedido` (hoy embebido sin resolver). Requiere ampliar el `select()` de `cargarDatos()`.
3. **Filtro de Estado en Facturas de compra**: se añade, alcanzando paridad total con `FacturasVenta.jsx` (`ESTADOS_FILTRO_FACTURA`), usando los 5 valores de `estado_pago` ya existentes en `facturas_compra_con_saldo`.
4. **Columna "Progreso" en Pedidos de compra**: se añade, pero con **fórmula propia**, no la de Venta (que depende de `previsiones_distribucion_pf`/`stock_lotes_producto_final`, conceptos de producción que no existen en Compras). Fórmula: líneas recibidas / total de líneas (ej. "2/3 líneas recibidas"), sin barra de progreso de stock insuficiente — eso no tiene análogo en Compras.
5. **Icono de Facturación en Albaranes de compra**: sin distinción por tipo de proveedor (Venta distingue empresa/particular vía `clientes.tipo`; no se audita ni se añade un campo equivalente en `proveedores`). Todo lo no facturado usa un único color/estado "pendiente" (ámbar), sin la variante gris de "particular".
6. **Datos sin columna en Venta** (referencia de proveedor, código interno, temperatura/lote/caducidad por línea): se añaden como **columnas visibles nuevas**, no relegadas a la fila expandida — son datos que Compras necesita ver de un vistazo y Venta simplemente no tiene el concepto.

## 5. Mapeo de columnas por pantalla

### `FacturasCompra.jsx` (el más limpio, casi 1:1 con `FacturasVenta.jsx`)
Fecha | Número | Proveedor (tachado si anulada) | Estado (`estado_pago`, 5 valores, con filtro nuevo) | Total | Código interno | Acciones.
Expandido: texto con los albaranes incluidos (igual que hoy, sin tabla anidada — replica el patrón de `FacturasVenta.jsx`, no el de `Pedidos.jsx`).

### `PedidosCompra.jsx`
Fecha | Proveedor (+ código de pedido) | Entrega prevista | Referencia de proveedor | Progreso (fórmula propia, decisión 4) | Estado | Acciones.
Expandido: tabla anidada de líneas (Artículo, Pedido, Recibido) — igual que hoy.

### `AlbaranesCompra.jsx` (el más complejo)
Fecha | Número | Proveedor | Código interno | Pedido origen (columna nueva, decisión 2) | Facturación (icono nuevo, sin distinción de tipo, decisión 5) | Cobro (icono, hoy es badge condicional → pasa a icono `EstadoIcono` igual que Venta) | Acciones.
Expandido: tabla anidada de líneas (Artículo, Cantidad, Precio, Caducidad, Notas, Temperatura con aviso inline si fuera de rango, Lote) — mismas columnas que hoy, sin cambios (ya eran visibles todas, siguen igual, solo ahora detrás de la flecha).

## 6. Riesgos ya confirmados línea por línea (no asumidos)

- **`handleEditar` de Pedidos de compra vs. Venta**: distinto código, distinto nº de consultas (0 en Compras vs. 4 en Venta), pero comportamiento visual análogo — ya documentado y aceptado en `CONTRATO_DRAWERS_COMPRAS.md`. Mover el botón de la tarjeta a la columna Acciones no toca esa lógica.
- **`facturaVivaDe()`** ya corregida en ambas pantallas de Compras desde `CONTRATO_PAGOS_COMPRA.md` paso 4 — no requiere ningún cambio en este contrato, solo se confirma que sigue funcionando igual tras el cambio de layout.
- **`MultiSelect`/`Select` de `ui.jsx`** son idénticos entre Venta y Compras — sin riesgo de estilo distinto.

## 7. Orden de ejecución propuesto

Empezar por la pantalla más simple para validar el patrón antes de atacar la compleja:

1. ✅ **`FacturasCompra.jsx` — aplicado y verificado el 09-09-2026.** Tabla con fila expandible y cabeceras ordenables, patrón exacto de `FacturasVenta.jsx`. Filtro de Estado nuevo (`.in('estado_pago', ...)` directo — más simple que Venta, ya que `facturas_compra_con_saldo` expone `estado_pago` como columna calculada en servidor, sin precómputo de ids necesario). Verificado en navegador con 3 facturas de prueba (pendiente/sin_total/anulada): ciclo de 3 estados en orden de Fecha, filtro de Estado aislando correctamente, fila expandible (texto, sin tabla anidada, como pedía el contrato), y las tres acciones (Registrar pago/Editar/Anular) funcionando desde la columna Acciones. Cuenta demo limpia tras la prueba.
2. ✅ **`PedidosCompra.jsx` — aplicado y verificado el 09-09-2026.** Tabla con fila expandible y cabeceras ordenables, mismo patrón que `FacturasCompra.jsx`. Columna Progreso ("X/Y líneas recibidas") trivial de calcular — `entrada_material(cantidad)` ya venía embebido, sin ampliar el `select()`. Verificado en navegador: Progreso mostró "1/2 líneas recibidas" correctamente; ciclo de 3 estados confirmado en Fecha (desc/asc/sin orden) y Entrega prevista (asc/desc/sin orden), con la dirección inicial correcta en ambas; las tres acciones (Editar/Recibir como albarán/Cancelar) funcionando desde la columna Acciones. Nota de transparencia: un script de prueba propio de Code canceló un pedido de prueba antes de tiempo por un selector ambiguo (confirma que "Cancelar" funciona, no es un bug de la implementación). Cuenta demo limpia tras la prueba (33 pedidos reales, sin residuos).
3. ✅ **`AlbaranesCompra.jsx` — aplicado y verificado el 09-09-2026.** Tabla con fila expandible y cabeceras ordenables. 8 columnas: Fecha | Número | Proveedor | Código interno | Pedido origen (nueva, resolviendo `entrada_material.linea_pedido_compra_id → pedidos_compra.codigo_pedido`) | Facturación (icono `EstadoIcono`, sin distinción de tipo de proveedor) | Cobro (icono, antes badge — mismo cálculo de `saldosDeAlbaranesSueltos`) | Acciones. Contenido expandido con todas las columnas de línea que ya tenía la tarjeta (Artículo, Cantidad, Precio, Caducidad, Notas, Temperatura, Lote). Verificado en navegador contra datos reales: Pedido origen mostrando código real vinculado, iconos de Facturación/Cobro con los colores correctos (facturado/pendiente, pagada/parcial/pendiente), y las tres acciones (incluido el bloqueo por FK de pagos aplicados) funcionando desde la columna Acciones. Limpieza confirmada de forma independiente.

**Contrato cerrado en su totalidad.** Las 3 pantallas migradas de tarjetas a tabla, `PagosCompra.jsx` sin tocar (ya cumplía el patrón), decisiones de la sección 4 aplicadas y verificadas contra datos reales en cada paso.

Cada paso se entrega y verifica en navegador (no solo revisión de código) antes de pasar al siguiente.

## 8. Criterios de aceptación

- Las 3 pantallas usan `<table>` con fila expandible (acordeón) y cabeceras ordenables, sin `<Select>` "Ordenar por".
- El mecanismo de datos (`.order()` contra Supabase, paginación, filtros) no cambia — solo el control de UI del orden.
- Ningún dato que hoy se ve en la tarjeta desaparece: se mapea a columna visible o a la fila expandida, según la sección 5.
- `PagosCompra.jsx` no se toca.

## 9. Fuera de alcance

- Cualquier columna o icono de Venta que dependa de conceptos de producción (tandas, previsiones de stock de producto final) — no tienen análogo en Compras y no se inventan.
- Añadir a `proveedores` un campo de tipo (empresa/particular) equivalente al de `clientes` — decisión 5 lo descarta explícitamente.
