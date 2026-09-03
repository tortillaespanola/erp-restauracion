# CONTRATO_UX_PEDIDOS_VENTA.md

## Objetivo

Rediseñar la pantalla de listado de **Pedidos de Venta** (`Pedidos.jsx`, ruta `/pedidos`), pasando del patrón actual de tarjetas apiladas a una **tabla columnada con filas expandibles**, drawer lateral para alta/edición, y paginación clásica.

**Fuera de alcance de este contrato:** responsive/mobile (se documenta como deuda pendiente, no se resuelve aquí), filtros/búsqueda contextual (queda para una siguiente iteración), `PedidosCompra.jsx` (no se toca).

---

## 1. Estructura de la tabla principal

Reemplaza el `Card` por pedido por una fila de tabla real (`<table>` HTML, no divs simulando tabla).

Columnas, en este orden:

| Columna | Contenido | Notas |
|---|---|---|
| `▶` (toggle) | Icono expandir/colapsar | `IconChevronRight` / `IconChevronDown` de `@tabler/icons-react`, rota 90° al expandir |
| Fecha | `p.fecha` formateada con `formatFecha.js` | **Ordenable** (clic en cabecera) |
| Cliente | `p.clientes?.nombre ?? 'Sin cliente'` + `p.codigo_pedido` en mono gris pequeño debajo o al lado | — |
| Entrega prevista | `p.fecha_entrega_prevista` formateada, o `—` si no existe | **Ordenable** |
| Estado | `Badge` con `ESTADO_BADGE`/`ESTADO_LABEL` (sin cambios respecto al actual) | — |
| Progreso | Indicador agregado nuevo (ver sección 2) | — |
| Acciones | Iconos: `IconEdit` (abre drawer), `IconTruckDelivery` o similar (crear albarán), `IconX` (cancelar) | Solo visibles si `estado` no es `servido` ni `cancelado`, igual que hoy |

- Altura de fila objetivo: ~48–56px, compacta y escaneable.
- Cabecera de tabla `sticky top-0` al hacer scroll dentro del contenedor de la tabla.
- Orden por defecto: mismo criterio que hoy (`compararPedidos` — activos primero, luego servidos/cancelados, por `fecha_entrega_prevista` dentro de cada grupo), hasta que el usuario haga clic en una cabecera ordenable, momento en el que el orden por columna toma prioridad.

## 2. Indicador de progreso (columna "Progreso")

Nuevo elemento, no existe hoy. Resume el estado de las líneas del pedido sin necesidad de expandir:

- Texto tipo `3/5 líneas servidas` (líneas con `servido >= cantidad pedida` sobre total de líneas).
- Opcional (si es sencillo de implementar): barra de progreso fina (2–3px) debajo del texto, ancho proporcional.
- Si alguna línea tiene aviso de stock insuficiente (la misma condición roja que ya existe en la fila expandida), mostrar un pequeño indicador de alerta (icono `IconAlertTriangle` en ámbar/rojo) junto al progreso, para que el problema sea visible sin expandir.

## 3. Fila expandible (comportamiento acordeón)

- **Solo una fila expandida a la vez** (acordeón): al expandir una fila, cualquier otra fila expandida se colapsa automáticamente.
- Clic en el icono `▶` o en cualquier parte de la fila (excepto los botones de acción) expande/colapsa.
- Contenido de la fila expandida: el mismo que hoy vive en la mini-tabla dentro de cada `Card` — columnas Línea / Pedido / Previsto / Servido, con el aviso de stock insuficiente en rojo (celda "Previsto") y el verde en "Servido" cuando está completo. **No cambia esta lógica, solo cambia dónde se renderiza** (fila `<tr>` con `<td colspan>` que ocupa el ancho completo de la tabla, en vez de tabla dentro de `Card`).
- Notas del pedido (`p.notas`), si existen, se muestran también dentro de la fila expandida (hoy están en la tarjeta, fuera de la mini-tabla).
- Transición CSS suave al expandir/colapsar (no brusca).

## 4. Drawer lateral para alta/edición

- El formulario que hoy vive arriba de la tabla (cliente, fecha, fecha de entrega, notas, líneas dinámicas con radio buttons Producto final/Mercadería/Otro-servicio) se mueve a un **drawer lateral**, siguiendo el mismo patrón ya usado en `Inventario.jsx` para ajustes de stock.
- Botón "Nuevo pedido" (fijo, arriba de la tabla o en el `PageHeader`) abre el drawer en modo alta, vacío.
- Icono "Editar" en la fila de un pedido abre el mismo drawer en modo edición, precargado con los datos de ese pedido.
- Al guardar (alta o edición) desde el drawer: cierra el drawer, refresca la tabla, y si es una edición, la fila correspondiente queda visible (scroll into view si estaba fuera del viewport).
- El drawer reutiliza la lógica de validación y guardado que ya existe en `Pedidos.jsx` — es un cambio de ubicación/contenedor, no de lógica de negocio.

## 5. Paginación

- **Paginación clásica** con números de página (no scroll infinito ni "cargar más").
- Tamaño de página sugerido: 20 pedidos (ajustable si Claude Code ve un valor más natural dado el volumen real de datos).
- La query a Supabase pasa de traer todos los pedidos sin límite a usar `.range()` con el offset correspondiente a la página activa.
- El ordenamiento por columna (sección 1) se traduce a `.order()` en la query de Supabase, no en cliente — para que la paginación y el orden sean coherentes entre sí.
- Controles de paginación: anterior/siguiente + números de página, ubicados debajo de la tabla.

## 6. Componentes y estilo

- Reutilizar los componentes ya existentes de `ui.jsx` (`PageHeader`, `Card`, `Button`, `Badge`, `EmptyState`, `LoadingState`) donde aplique — el lenguaje visual "Fiori" del proyecto no cambia.
- Iconografía: `@tabler/icons-react`, coherente con el resto del ERP.
- Paleta: sin cambios (azul `#0854A0` para acciones primarias, texto `#1C2938`, verde `#3B6D11` para éxito).
- Tailwind utility classes, sin introducir CSS modules ni librerías de estilos nuevas.

## 7. No-objetivos explícitos (para evitar scope creep en la ejecución)

- No se implementan filtros ni búsqueda en esta iteración.
- No se resuelve el problema de responsive/mobile del layout general (sidebar) — queda documentado como deuda pendiente separada.
- No se toca `PedidosCompra.jsx` ni `PedidosDelDia.jsx`.
- No se cambia la lógica de cálculo de `previsto`/`servido` ni la condición de aviso de stock insuficiente — solo su ubicación visual.

## 8. Criterio de aceptación

- [x] La tabla reemplaza las tarjetas, con las columnas de la sección 1.
- [x] Ordenar por Fecha y por Entrega prevista funciona correctamente (clic en cabecera).
- [x] La columna Progreso refleja correctamente líneas servidas/total y muestra alerta si hay déficit de stock.
- [x] Expandir una fila muestra el detalle de líneas; expandir otra colapsa la anterior automáticamente.
- [x] El drawer de alta/edición reutiliza la lógica existente sin regresiones (crear pedido, editar pedido, líneas dinámicas, cancelar).
- [x] La paginación funciona con `.range()` en servidor y es coherente con el ordenamiento activo.
- [x] Verificado en navegador antes de dar por cerrado (según metodología del proyecto: "comprobado en frontend").

Corrección post-Bloque 5: el agrupamiento por estado (activos arriba, servidos/cancelados al fondo) es un invariante permanente, no solo el orden por defecto. Cualquier ordenamiento por columna que el usuario elija (Fecha, Entrega prevista) se aplica dentro de cada grupo, nunca lo rompe. La columna de agrupamiento (orden_prioridad_estado o el nombre que le hayan puesto) debe ser siempre la primera clave de .order() en la query de Supabase; la columna elegida por el usuario es la segunda clave.

Corrección post-diagnóstico (cambio de criterio de producto, no una regresión respecto al `compararPedidos` original): cuando `orden.columna` es `null` (el usuario todavía no hizo clic en ninguna cabecera), la segunda clave de `.order()` -- después del agrupamiento por estado -- pasa a ser `fecha` descendente (más reciente primero), en vez de `fecha_entrega_prevista` ascendente. Se añade además `id` ascendente como tercera clave/desempate final, necesario para que el orden combinado sea estable entre páginas de `.range()` cuando hay empates en las claves anteriores.
