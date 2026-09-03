# CONTRATO_UX_ALBARANES_VENTA.md

## Objetivo

Aplicar a **Albaranes de Venta** (`AlbaranesVenta.jsx`, ruta `/albaranes-venta`) el mismo patrón de rediseño ya implementado en Pedidos de Venta (ver `CONTRATO_UX_PEDIDOS_VENTA.md`), adaptado a las diferencias estructurales reales entre ambas entidades: un albarán no tiene ciclo de vida propio (no hay `estado`), no se edita (solo alta y borrado), y su formulario de alta es sustancialmente más complejo (selección de lotes/tandas).

**Fuera de alcance de este contrato:** responsive/mobile (misma deuda pendiente ya documentada), filtros/búsqueda contextual, `AlbaranesCompra.jsx` (no se toca), cualquier cambio a la lógica de generación de PDF o de reparto de lotes.

---

## 1. Diferencias respecto al patrón de Pedidos (por qué esto NO es un copy-paste)

| Aspecto | Pedidos (ya implementado) | Albaranes de venta (este contrato) |
|---|---|---|
| Columna Estado / Badge | Sí | **No aplica** — no existe `estado` en `albaranes_venta` |
| Columna Progreso | Sí (previsto/servido) | **No aplica** — se sustituye por columna Facturado (sección 3) |
| Agrupamiento `grupo_estado` | Sí, invariante permanente | **No aplica** — sin estados no hay grupos que preservar |
| Modo edición en drawer | Sí | **No aplica** — solo alta y borrado, nunca edición |
| Complejidad del formulario | Formulario simple, campos + líneas dinámicas | Formulario complejo: selección de lote/tanda por producto (`ProductoParaVender`, `ArticuloParaVender`, `FilaBloqueada`, `LineaPedidoLibrePendiente`, `LineaLibreParaVender`) |
| Trazabilidad al origen | N/A (es el origen) | Se añade columna "Pedido origen" (sección 4) |

## 2. Estructura de la tabla principal

Reemplaza el `Card` por albarán por una fila de tabla real, mismo patrón que Pedidos (`<table>`, cabecera `sticky top-0`, fila expandible en acordeón).

Columnas, en este orden:

| Columna | Contenido | Notas |
|---|---|---|
| `▶` (toggle) | Icono expandir/colapsar | Igual que Pedidos |
| Fecha | `alb.fecha` formateada | **Ordenable** |
| Nº Albarán | `alb.numero_albaran` o `(sin número)` | — |
| Cliente | `alb.clientes?.nombre ?? 'Sin cliente'` | — |
| Pedido origen | Ver sección 4 | Badge/link, puede estar vacío |
| Facturado | Ver sección 3 | Badge |
| Acciones | Iconos: `IconPrinter` (imprimir), `IconDownload` (descargar PDF), `IconTrash` (borrar) | Reemplaza los 3 `LinkAction` actuales, mismas funciones (`imprimirAlbaranVentaPdf`, `descargarAlbaranVentaPdf`, `handleBorrar`) sin cambios de lógica |

- Altura de fila y comportamiento sticky/acordeón: igual que Pedidos.
- **No hay columna de agrupamiento por estado** — el orden por defecto es simplemente `fecha` descendente (más reciente primero), sin el paso intermedio de migración que necesitó Pedidos, porque no hay grupos que preservar.

## 3. Columna "Facturado"

Nuevo indicador, no existe hoy en el listado (la información sí existe en BD vía `factura_venta_albaran`).

- Badge `Facturado` (verde) o `Pendiente de facturar` (gris/ámbar), según si el albarán tiene registro en `factura_venta_albaran`.
- **Importante de rendimiento**: resolver esto con un `join`/`select` embebido en la misma query de carga del listado (Supabase permite `select` anidado), no con una query N+1 por fila.
- Este indicador es informativo en el listado. La lógica de aviso ya existente en `handleBorrar` (que hoy ya distingue si el albarán está facturado) no cambia — solo se hace visible sin tener que intentar borrar para descubrirlo.

## 4. Columna "Pedido origen"

Nuevo indicador, trazabilidad que hoy existe en BD (`linea_pedido_id` por línea) pero no se expone visualmente.

- Un albarán puede tener líneas de un único pedido, de varios, o de ninguno (línea libre sin origen). Regla de visualización:
  - Si todas las líneas comparten el mismo `linea_pedido_id` → pedido → mostrar un solo badge/link: `código_pedido` (ej. `OV-260117`).
  - Si hay líneas de más de un pedido → mostrar `Varios` con tooltip listando los códigos.
  - Si ninguna línea tiene pedido de origen → mostrar `—`.
- El badge/link, si existe, navega a `/pedidos` con el pedido correspondiente (comportamiento exacto de la navegación a definir con Claude Code según lo que sea más simple de implementar: deep-link con query param, o simplemente texto no clicable en esta primera iteración si el deep-link añade complejidad innecesaria).
- Mismo cuidado de rendimiento que la sección 3: resolver en la query principal, no N+1.

## 5. Fila expandible (acordeón)

Igual patrón que Pedidos: acordeón real (una sola fila expandida a la vez), transición CSS suave.

Contenido de la fila expandida: la mini-tabla de líneas que ya existe hoy (Producto/Cantidad/Precio), sin cambios de lógica — solo cambia dónde se renderiza (de `Card` a `<tr><td colspan>`).

## 6. Ordenamiento y paginación

- Cabecera de "Fecha" ordenable (asc/desc), traducido a `.order()` server-side.
- Sin columna de agrupamiento (a diferencia de Pedidos) — el `.order()` por defecto es `fecha` descendente, `id` como desempate.
- Paginación clásica server-side con `.range()`, mismo tamaño de página que Pedidos (20, salvo que Claude Code vea un valor más natural).

## 7. Drawer lateral para alta

- El formulario de alta (todo lo que hoy vive inline arriba de la tabla: `ProductoParaVender`, `ArticuloParaVender`, `FilaBloqueada`, `LineaPedidoLibrePendiente`, `LineaLibreParaVender`) se mueve a un **drawer lateral**, mismo patrón visual que `Inventario.jsx` y el ya usado en `PedidoForm.jsx`.
- **Solo modo alta** — no hay modo edición, no hay que replicar precarga de datos existentes.
- Si el usuario llega desde `/albaranes-venta?pedido_id=X` (vía el botón "Crear albarán de venta" de Pedidos), el drawer se abre automáticamente en modo alta, filtrado y con las filas bloqueadas (`FilaBloqueada`) precargadas — mismo comportamiento que hoy, solo cambia el contenedor.
- Dado el tamaño de este formulario (varios subcomponentes con sus propios selectores de lote), evaluar con Claude Code si el drawer necesita ser más ancho que el usado en Pedidos/Inventario, o si necesita scroll interno propio — no forzar el mismo ancho de 448px si el contenido no cabe razonablemente.
- Al guardar: cierra el drawer, refresca la tabla, `scrollIntoView` al albarán recién creado (mismo comportamiento y misma limitación conocida que Pedidos respecto a paginación cruzando páginas).
- El `autoPrint()` automático que existe hoy al crear un albarán se mantiene sin cambios de lógica, solo se dispara igual desde dentro del drawer.

## 8. Componentes y estilo

Mismos criterios que el contrato de Pedidos: reutilizar `ui.jsx`, `@tabler/icons-react`, paleta sin cambios, Tailwind puro.

## 9. No-objetivos explícitos

- No se implementan filtros ni búsqueda en esta iteración.
- No se resuelve responsive/mobile.
- No se toca `AlbaranesCompra.jsx`.
- No se cambia la lógica de generación de PDF (`generarAlbaranVentaPdf.js`), de reparto de lotes, ni la validación de disponibilidad por tanda.
- No se implementa edición de albaranes (nunca existió, no se introduce ahora).
- No se cambia la lógica de `handleBorrar` ni su aviso especial cuando el albarán ya está facturado — solo se hace visible el estado "Facturado" de antemano en la tabla.

## 10. Criterio de aceptación

- [x] La tabla reemplaza las tarjetas, con las columnas de la sección 2. Verificado con captura real (Bloque 1): las 7 columnas en el orden correcto.
- [x] Ordenar por Fecha funciona correctamente (clic en cabecera), sin agrupamiento por estado (no aplica aquí). Verificado con datos reales (Bloque 5): default desc, clic 1 desc explícito, clic 2 asc, clic 3 vuelve a default.
- [x] La columna Facturado refleja correctamente si el albarán tiene factura asociada, resuelto sin N+1 queries (un solo embed `factura_venta_albaran(factura_venta_id)` en la query principal). Verificado con una fila real de `facturas_venta`/`factura_venta_albaran` insertada y luego borrada (Bloque 2) — incluyó corregir un bug real (PostgREST embebe como objeto único, no array).
- [x] La columna Pedido origen refleja correctamente el/los pedido(s) de origen o `—`/`Varios` según corresponda, resuelto sin N+1 queries (embed anidado en la misma query). El caso "un código" y el caso "—" están verificados con datos reales (90/92 y 2/92 albaranes respectivamente, Bloque 3). El caso "Varios" **no existe en los datos reales actuales** — se verificó con `codigosPedidoOrigen()` real ejecutado sobre un albarán fabricado en memoria (mock de red, sin escribir en BD), confirmando lista de códigos y tooltip correctos.
- [x] Expandir una fila muestra el detalle de líneas (Producto/Cantidad/Precio); expandir otra colapsa la anterior. Verificado con datos reales (Bloques 1 y 4): contenido correcto al expandir, y acordeón real confirmado inspeccionando `grid-template-rows` (84.7px ↔ 0px) entre dos filas distintas.
- [ ] **Parcialmente verificado.** El drawer de alta reutiliza toda la lógica existente sin regresiones. Lo que SÍ se probó con un albarán real de punta a punta (Bloque 6, `DN-260128`, ya borrado): apertura automática vía `?pedido_id=`, precarga de cliente, línea libre, guardado, cierre del drawer, refresco de tabla, navegación de vuelta a `/pedidos`, sin efecto colateral en el pedido de origen. Lo que **NO se pudo probar con datos reales** porque no existe ningún caso disponible hoy: (a) selección de lote/tanda con un guardado real en BD — no hay ningún producto final con stock > 0 en toda la base; (b) `FilaBloqueada` con un pedido activo real — no hay ningún pedido pendiente/en_producción con previsión de tanda asignada (las 23 previsiones con tanda existentes pertenecen todas a pedidos ya `servido`). Ambos casos se verificaron solo por lectura de código (movido verbatim, sin cambios) y, en el caso de `FilaBloqueada`/el layout de la fila de 4 columnas, con un mock de red sin escritura real.
- [ ] **Parcialmente verificado.** Imprimir/Descargar PDF/Borrar siguen funcionando idénticos, ahora como iconos. Borrar: verificado repetidamente con datos reales (Bloques 4 y 6), incluida una eliminación real completa. Imprimir: el `window.open`/`autoPrint()` se ejecuta sin errores (confirmado con un albarán real, Bloque 6), pero **no se pudo confirmar visualmente que el PDF se renderice dentro de la ventana emergente** — limitación conocida de la automatización headless con popups `blob:`, no necesariamente un fallo real; código sin cambios respecto al original. **Descargar PDF no se probó ni una sola vez** en ningún bloque (se evitó deliberadamente para no disparar descargas de archivo durante las pruebas automatizadas). Recomiendo que confirmes tú mismo Imprimir y Descargar con un caso real la próxima vez que uses la pantalla.
- [ ] **No verificado.** `handleBorrar` sigue avisando correctamente si el albarán ya está facturado. Se probó el aviso "simple" (albarán no facturado) varias veces con datos reales. El aviso especial con el mensaje `⚠️ Este albarán está incluido en N factura(s)...` **nunca se disparó a través del botón Borrar real** — en el Bloque 2, el albarán de prueba que se marcó como facturado se limpió borrando directamente las filas de `facturas_venta`/`factura_venta_albaran` por SQL, no haciendo clic en "Borrar" mientras estaba facturado. La lógica de `handleBorrar` no se tocó (solo se movió su visibilidad previa a la columna Facturado), pero esta rama específica del aviso queda sin ejercitar en esta ronda de pruebas.
- [x] La paginación funciona con `.range()` y es coherente con el ordenamiento activo. Verificado con datos reales (Bloque 5): 92 albaranes, 5 páginas, navegación 1↔2, `Anterior` se habilita/deshabilita correctamente.
- [x] Verificado en navegador antes de dar por cerrado ("comprobado en frontend"), con las excepciones explícitas señaladas arriba (selección de lote/tanda real, `FilaBloqueada` real, Descargar PDF, render visual del PDF en popup, aviso de borrar-ya-facturado).
