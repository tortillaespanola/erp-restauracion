# CONTRATO_FILTROS_VENTA.md

## Objetivo

Añadir filtros por Cliente, Estado y Rango de fechas a las tres pantallas de venta ya rediseñadas (`Pedidos.jsx`, `AlbaranesVenta.jsx`, `FacturasVenta.jsx` — esta última asumiendo que `CONTRATO_UX_FACTURAS_VENTA.md` ya está implementado, dado que los filtros se apoyan en su tabla/paginación). Filtros server-side, combinados con el ordenamiento, agrupamiento y paginación ya existentes en cada pantalla.

**Fuera de alcance:** guardar filtros favoritos/vistas guardadas, filtros en Pedidos/Albaranes/Facturas de compra, búsqueda de texto libre (esto es filtrado estructurado, no un buscador).

---

## 1. Diseño común a las tres pantallas

Barra de filtros fija encima de la tabla (debajo del botón "Nuevo X"), con:

- **Cliente**: `<Select>` de un solo cliente (reutilizando el componente ya usado en el resto del proyecto), opción "Todos" por defecto. A diferencia de los selectores de alta (que en Pedidos filtran `activo=true`), el filtro debe listar **todos los clientes, activos e inactivos** — es una herramienta de consulta histórica, no de alta, y un cliente ya inactivo puede seguir teniendo pedidos/albaranes/facturas antiguos que se quieran revisar.
- **Estado**: `MultiSelect` (componente ya existente en `ui.jsx`, documentado como pensado para esto), opciones específicas por pantalla — ver sección 2, 3 y 4, no son las mismas en las tres.
- **Rango de fechas**: dos `DateInput` (Desde / Hasta), filtrando sobre la columna `fecha` de cada pantalla (la misma que ya es ordenable).
- Botón "Limpiar filtros", visible solo si hay algún filtro activo.
- Cualquier cambio de filtro **resetea la paginación a la página 1** (si no, el usuario puede quedar en una página que ya no existe con el resultado filtrado).
- Los filtros se combinan con AND entre sí (cliente Y estado Y rango de fechas), y con OR dentro de "Estado" si se seleccionan varios valores.

## 2. Opciones de "Estado" en Pedidos

Las cuatro ya existentes: `pendiente`, `en_producción`, `servido`, `cancelado` (mismas `ESTADO_LABEL` ya usadas en el badge).

## 3. Opciones de "Estado" en Albaranes — dos filtros, no uno

Los albaranes tienen **dos dimensiones de estado independientes** (facturación y cobro), no una sola — mezclarlas en un único `MultiSelect` sería ambiguo (¿"Facturado" + "Pagada" es AND o OR contra dos badges distintos?). Se implementan como dos `MultiSelect` separados, ambos dentro de la misma barra de filtros:

- **Facturación**: `Pendiente de facturar` / `Facturado`.
- **Cobro**: `Pagada` / `Parcial` / `Pendiente` (solo aplica de forma directa a albaranes sueltos — un albarán ya facturado refleja su cobro a través de la factura, mismo criterio ya establecido en el badge).

## 4. Opciones de "Estado" en Facturas

`Pagada` / `Parcial` / `Pendiente` / `Anulada` — mismos valores que el badge ya implementado.

## 5. Implementación server-side

- Cliente: `.eq('cliente_id', valor)` cuando no es "Todos".
- Estado: `.in('estado', [...])` en Pedidos (columna real). En Facturas y Albaranes, dado que el estado de pago es calculado (no almacenado — ver `CONTRATO_UX_FACTURAS_VENTA.md` sección 1 para el mismo reto ya identificado ahí), el filtro de Estado debe resolverse contra la misma vista/RPC que ya se construya para el ordenamiento por estado de pago, no con un `.in()` directo sobre una columna que no existe.
- Rango de fechas: `.gte('fecha', desde)` / `.lte('fecha', hasta)` cuando se informan.
- Verificar explícitamente que los filtros no rompen el agrupamiento permanente ya existente (Pendiente/Parcial arriba en Pedidos y Facturas) — si se filtra a un solo estado, el agrupamiento es irrelevante para ese resultado, pero si se filtran varios estados a la vez, el agrupamiento debe seguir aplicando dentro del resultado filtrado.

## 6. No-objetivos explícitos

- No se guardan filtros entre sesiones ni se sincronizan con la URL (a menos que Claude Code lo vea trivial de añadir de paso — no es un requisito, no bloquea el contrato).
- No se implementa búsqueda de texto libre por número de pedido/albarán/factura o nombre de cliente parcial — es selección exacta vía el `<Select>` de cliente.
- No se tocan las pantallas de compra.

## 7. Criterio de aceptación

- [x] Filtro por Cliente funciona en las tres pantallas, incluyendo clientes inactivos en la lista. Mecanismo (`.eq('cliente_id', ...)`) verificado funcionalmente en las tres (Pedidos aislado: `Zum Kuss` → 23, coincide con BD; Albaranes y Facturas dentro de los casos combinados de 3 filtros: `CASA`/`Rosenkranz`). Inclusión de clientes inactivos verificada por conteo en las **tres** pantallas: 25 opciones (24 clientes reales + "Todos", incluidos los 2 inactivos) en Pedidos, Albaranes y Facturas por igual.
- [x] Filtro por Estado funciona con las opciones correctas de cada pantalla (sección 2, 3, 4). Pedidos: Pendiente+Servido combinado verificado (88, coincide con BD). Albaranes: Facturación y Cobro, aislados y combinados (46, 19, 27, 0). Facturas: Pendiente+Pagada combinado (14) y Anulada aislado (1, único caso real existente). **Parcial**: ningún estado "Parcial" real existe todavía en Facturas ni en Albaranes (mismo hueco de datos ya documentado en `CONTRATO_PAGOS_VENTA.md`/`CONTRATO_UX_FACTURAS_VENTA.md`) — la opción existe y la lógica es la misma `estadoPago()` de siempre, pero no se ha visto un caso real con ella.
- [x] En Albaranes, los dos filtros de estado (Facturación / Cobro) funcionan de forma independiente y combinable. Verificado a fondo: aislados (46 Facturado, 19 Pagada), combinado positivo (`Pendiente de facturar`+`Pendiente` → 27, cada fila con ambos badges coincidiendo) y combinado contradictorio (`Facturado`+`Pagada` → 0, prueba que el AND es real).
- [x] Filtro por rango de fechas funciona en las tres pantallas. Pedidos aislado (`01/06–30/06/2026` → 29, coincide con BD). Albaranes y Facturas verificados dentro de los casos combinados de 3 filtros (abril 2026 para `CASA`, junio 2026 para `Rosenkranz`), en ambos casos el rango excluyó correctamente filas fuera de él.
- [x] Cambiar cualquier filtro resetea a la página 1. Implementado de forma idéntica en las tres pantallas (cada `cambiarFiltroX` llama `setPagina(1)`, mismo patrón ya usado para `cambiarOrden`). Confirmado indirectamente en todas las verificaciones de Pedidos (el pie de página siempre mostró "página 1 de N" tras cada cambio de filtro) — no se hizo la prueba específica de "estar en página 2, cambiar un filtro, confirmar que vuelve a la 1" en ninguna de las tres pantallas.
- [x] "Limpiar filtros" restaura el listado completo sin filtros. Verificado con datos reales en las **tres** pantallas: Pedidos (filtrando a 1 pedido, "Limpiar filtros" devuelve los 93 reales), Albaranes (92 antes y después) y Facturas (15 antes y después) — en las tres, el botón aparece con un filtro activo y desaparece (`count = 0`) tras limpiar.
- [x] El agrupamiento permanente (Pedidos y Facturas) se preserva correctamente al combinarse con filtros de estado múltiples. El caso más fuerte de todo el contrato: en Pedidos, Pendiente+Servido (88 filas) deja el único Pendiente arriba pese a no ser la fecha más reciente del conjunto; en Facturas, Pendiente+Pagada (14 filas) deja las 11 Pendientes arriba y las 3 Pagadas después, con la Anulada correctamente fuera del resultado filtrado.
- [x] Verificado en navegador con datos reales antes de dar por cerrado ("comprobado en frontend"), con las excepciones menores señaladas arriba (reset de página no probado explícitamente desde una página >1, estado Parcial sin caso real en Facturas/Albaranes).
