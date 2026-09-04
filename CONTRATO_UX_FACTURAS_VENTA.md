# CONTRATO_UX_FACTURAS_VENTA.md

## Objetivo

Aplicar a **Facturas de Venta** (`FacturasVenta.jsx`, ruta `/facturas-venta`) el mismo patrón ya usado en Pedidos y Albaranes de venta: tabla con fila expandible, drawer lateral para alta, paginación y ordenamiento server-side — con el agrupamiento por estado (Pendiente/Parcial siempre arriba) como invariante permanente, igual que en Pedidos.

**Diferencia clave respecto a los dos contratos anteriores, y por qué este es más difícil:** el "estado de pago" de una factura (Pagada/Parcial/Pendiente) no es una columna almacenada — se calcula al vuelo (Bloque 3 de `CONTRATO_PAGOS_VENTA.md`) cruzando `facturas_venta.total` contra los pagos aplicados vía `pago_aplicacion`. Puede cambiar sin que nadie toque la fila de la factura (basta con registrar o anular un pago). El truco usado en Pedidos — una columna `grupo_estado` rellenada por trigger en el INSERT — **no sirve aquí tal cual**, porque el estado no se fija al crear la factura, cambia después y desde otra tabla.

**Fuera de alcance:** filtros (van en `CONTRATO_FILTROS_VENTA.md`, aparte), edición de facturas (sigue sin existir), notas de crédito, `AlbaranesCompra.jsx`/`PedidosCompra.jsx`.

---

## 1. Resolución técnica del ordenamiento por estado de pago

Antes de implementar la tabla, resolver cómo ordenar/paginar por un valor calculado, no almacenado. Opciones a evaluar con Claude Code (documentar en el propio código cuál se eligió y por qué):

- **Vista SQL** (`facturas_venta_con_saldo` o similar) que exponga, por cada factura no anulada, el saldo pendiente ya calculado (misma fórmula del Bloque 3 de Pagos) y una columna de prioridad de grupo (0 = Pendiente/Parcial, 1 = Pagada) — consultar esa vista en vez de la tabla cruda para poder `.order()`/`.range()` sobre un valor ya resuelto en BD.
- Alternativa si la vista resulta compleja de mantener: una función SQL (`RPC` de Supabase) que devuelva las facturas ya ordenadas y paginadas con el cálculo incluido.
- Lo que **no** vale: traer todo sin paginar y ordenar/agrupar en cliente — eso es exactamente el patrón que se abandonó en Pedidos por no escalar, y aquí hay el mismo volumen de datos.

Las facturas **anuladas** quedan siempre al final, sin importar su saldo (que además siempre será 0 o irrelevante una vez anuladas) — mismo criterio que ya aplica su badge visual actual.

## 2. Estructura de la tabla principal

Columnas:

| Columna | Contenido | Notas |
|---|---|---|
| `▶` | Toggle expandir | — |
| Fecha | `fecha` | Ordenable |
| Nº Factura | `numero_factura` (`RE-2026-XXX`) | — |
| Cliente | `clientes.nombre` | — |
| Estado | Badge `Pagada`/`Parcial`/`Pendiente`/`Anulada` (ya implementado en el contrato de Pagos) | — |
| Total | En CHF | — |
| Acciones | Iconos: `IconPrinter`, `IconDownload`, `IconCoin`/similar ("Registrar cobro", solo si Pendiente/Parcial), `IconBan` ("Anular", solo si no anulada) | Mismas funciones ya existentes, sin cambios de lógica |

- Cabecera sticky, mismo contenedor de scroll que Pedidos/Albaranes.
- **Agrupamiento permanente**: Pendiente/Parcial arriba, Pagada después, Anulada siempre al final — invariante, no se pierde al ordenar por columna (mismo principio que se corrigió en Pedidos tras el bug post-Bloque 5: la columna de agrupamiento es siempre la primera clave de orden, la elegida por el usuario es la segunda, dentro de cada grupo).

## 3. Fila expandible (acordeón)

Mismo patrón acordeón real (un id, no Set) que las dos pantallas anteriores.

Contenido: la lista de albaranes incluidos que hoy ya se muestra como texto plano bajo cada factura (`Albaranes incluidos: DN-260015 (14/04/2026), ...`) — se traslada tal cual a la fila expandida, como lista (no como mini-tabla de líneas de producto, porque una factura no tiene líneas propias, agrupa albaranes completos).

## 4. Drawer lateral para alta (solo alta, sin edición)

- El formulario actual (Cliente, Fecha, checkboxes de "Albaranes a incluir") se mueve a un drawer lateral, mismo patrón que `AlbaranVentaForm.jsx`/`PedidoForm.jsx`.
- Dado que la lista de albaranes a incluir puede ser larga (se ha visto un caso real con 8 albaranes en una sola factura), usar un ancho de drawer más generoso que el `max-w-md` por defecto — Claude Code decide el valor exacto (mismo criterio que se usó en Albaranes con `max-w-2xl`).
- Sin modo edición — nunca existió, no se introduce ahora.
- Botón "Nueva factura" fijo, abre el drawer vacío.
- Al guardar: cierra el drawer, refresca la tabla, `scrollIntoView` a la factura recién creada (misma lógica y misma limitación conocida de paginación cruzando páginas que en los contratos anteriores).

## 5. Ordenamiento y paginación

- Cabecera de "Fecha" ordenable, dentro de cada grupo de estado (sección 1).
- Paginación clásica server-side, `.range()`, tamaño de página 20 (o el valor que Claude Code vea natural dado que ahora se consulta una vista/RPC en vez de la tabla directa).

## 6. Componentes y estilo

Mismos criterios que los contratos anteriores: `ui.jsx`, `@tabler/icons-react`, Tailwind, CHF fijo (ya corregido en el contrato de Pagos).

## 7. No-objetivos explícitos

- No se implementan filtros (contrato aparte).
- No se implementa edición de facturas.
- No se cambia la lógica de cálculo de saldo/estado de pago, numeración, ni anulación — todo eso ya existe (contratos de endurecimiento y Pagos), aquí solo cambia dónde y cómo se muestra.

## 8. Criterio de aceptación

- [x] La tabla reemplaza las tarjetas, con las columnas de la sección 2. Verificado con captura real (Bloque 2): las 7 columnas (▶/Fecha/Nº Factura/Cliente/Estado/Total/Acciones) en el orden correcto, cabecera sticky, icono "Registrar cobro" visible solo en filas con saldo pendiente.
- [x] El agrupamiento Pendiente/Parcial arriba, Pagada, Anulada al final, es permanente y sobrevive a cualquier ordenamiento por columna elegido por el usuario. Verificado con datos reales (Bloque 4), repetido tras el Bloque 6 con las 15 facturas ya incluyendo RE-2026-015: en las 4 combinaciones de clic (default, desc explícito, asc, vuelta a default) las 3 Pagadas (10/07) se mantienen siempre después de las Pendientes -- incluido el caso crítico en ascendente, donde RE-2026-015 (04/09) es la fecha más reciente de toda la tabla y aun así se queda dentro de su grupo. **Parcialmente verificado**: el grupo Anulada (prioridad_grupo=2) nunca se ejerció con una fila anulada real -- no existe ninguna factura anulada en los datos reales hoy; la lógica SQL se verificó solo por lectura del código de la vista (Bloque 1).
- [x] El ordenamiento/paginación por un valor calculado (estado de pago) funciona correctamente en servidor, sin traer todo sin paginar. Verificado en dos capas: la vista `facturas_venta_con_saldo` (Bloque 1) resuelve saldo/prioridad en SQL, y `.range()`+`count: 'exact'` (Bloque 5) se probó tanto con la página real única (15 filas) como con una simulación de tamaño de página 5 sobre los mismos datos reales, confirmando 3 páginas sin huecos ni duplicados y el agrupamiento intacto a través del corte de página.
- [x] Expandir una fila muestra la lista de albaranes incluidos. Verificado con datos reales (Bloque 3): factura con 2 albaranes (RE-2026-013) y con 1 albarán (RE-2026-009), acordeón real confirmado (expandir una colapsa la otra). **No verificado**: el caso de una factura con 0 albaranes (`—`) -- no existe ningún caso así en los datos reales; la rama de código es literal, sin cambios respecto al original que ya funcionaba.
- [x] El drawer de alta reutiliza la lógica existente sin regresiones (selección de cliente, carga de albaranes disponibles, guardado, numeración automática, total calculado). Verificado de punta a punta con una factura real (Bloque 6): cliente "Zum Kuss", 3 albaranes disponibles listados correctamente, 1 seleccionado (DN-260121), guardado como RE-2026-015 (numeración automática correcta tras RE-2026-014), total persistido 75.00 CHF confirmado por consulta directa contra `lineas_albaran_venta` (3 × 25.00 = 75.00, coincide exacto). Esta factura es real y permanente (no se ha anulado ni borrado).
- [ ] Imprimir/Descargar/Registrar cobro/Anular siguen funcionando idénticos, ahora como iconos en la fila. **Parcialmente verificado.** La visibilidad condicional de los iconos sí se comprobó con datos reales en varias capturas (Registrar cobro solo en filas con saldo pendiente; Anular en todas las no anuladas). **No se hizo clic en Imprimir/Descargar/Anular** en ningún bloque -- misma cautela deliberada que en Albaranes, para no disparar PDFs/anulaciones reales sin pedirlo explícitamente; el código de esos handlers no cambió, solo se movieron de `LinkAction` de texto a botones de icono.
- [x] Verificado en navegador con datos reales antes de dar por cerrado ("comprobado en frontend"), con las excepciones explícitas señaladas arriba (grupo Anulada, factura con 0 albaranes, clic real en Imprimir/Descargar/Anular).
