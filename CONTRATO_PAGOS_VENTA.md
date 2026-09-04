# CONTRATO_PAGOS_VENTA.md

## Objetivo

Construir el módulo de Pagos de Venta: registrar cobros de clientes y aplicarlos contra facturas y/o albaranes con saldo pendiente, cubriendo los tres casos reales descritos por el usuario (pago inmediato en la entrega, transferencia que cubre varias entregas facturadas, pago mixto). Se adapta al ERP el patrón "Receive Payment" que usan de forma consistente los sistemas AR de referencia (QuickBooks, JD Edwards/OFBiz, Compeat): un solo campo de monto recibido, auto-aplicación inteligente contra los documentos abiertos del cliente, con corrección manual disponible como excepción, no como el camino obligado.

**Contexto de datos real:** ya existe una lista (fuera del ERP, en poder del usuario) de qué facturas del histórico recién cargado estaban cobradas al momento de la entrega vs. pendientes — se usará como backfill real de prueba durante la implementación, en vez de datos sintéticos.

**Fuera de alcance de este contrato:** notas de crédito formales, reportes de aging/antigüedad de saldos, recordatorios de cobro (dunning), multi-moneda (se fija CHF, ver sección 1), edición o borrado de un pago ya registrado (si se registró mal, se anula igual que las facturas — ver sección 6).

---

## 1. Corrección de alcance menor: moneda fija a CHF

Antes de construir Pagos, corregir el hardcodeo de `€` ya presente en dos sitios, para no introducir un tercero:
- `generarPdf.js` (PDF de facturas).
- `FacturasVenta.jsx` línea ~277 (listado).

Cambiar a `CHF` en ambos, más cualquier importe que muestre la nueva pantalla de Pagos. **No se construye ningún selector de moneda configurable** — es un cambio de texto fijo, no una funcionalidad nueva. Si en el futuro surge necesidad real de multi-moneda, será un contrato aparte.

## 2. Modelo de datos

Dos tablas nuevas, siguiendo el patrón multi-tenant ya establecido en el proyecto (columna `negocio_id` + RLS `auth.role() = 'authenticated' and negocio_id = '<uuid fijo>'`, igual que el resto de tablas):

**`pagos`** — el hecho de que el cliente pagó algo:
```
id, cliente_id, fecha, monto, metodo (check: 'efectivo'|'twint'|'tarjeta'|'transferencia'), 
negocio_id, notas, created_at
```

**`pago_aplicacion`** — tabla puente, resuelve la aplicación a uno o varios documentos:
```
id, pago_id, factura_venta_id (nullable), albaran_venta_id (nullable), monto_aplicado, negocio_id
-- CHECK: exactamente uno de factura_venta_id / albaran_venta_id debe estar presente, nunca ambos ni ninguno
```

**Sin campo de "saldo" persistido en ningún lado** — ni en `clientes` (no existe hoy, no se añade), ni en `facturas_venta`, ni en `albaranes_venta`. Todo saldo pendiente se calcula al vuelo (sección 4), igual que ya se decidió para `total` en Facturas: un valor derivado siempre es más fiable que uno persistido que alguien puede olvidar sincronizar.

**Saldo a favor del cliente (crédito no aplicado)**: no es una entidad ni columna separada — es simplemente `pago.monto − suma(pago_aplicacion.monto_aplicado de ese pago)`. Si es mayor que cero, ese pago tiene un remanente sin aplicar, disponible para aplicarse más adelante desde el mismo drawer (sección 5, reutilizando un pago existente en vez de crear uno nuevo — decidir con Claude Code si esto entra en el alcance de la primera versión o se deja para una iteración siguiente, dado que añade complejidad al flujo de aplicación).

## 3. Pantalla Pagos.jsx — Historial

Mismo patrón ya establecido en Pedidos y Albaranes de venta: tabla con cabecera sticky, fila expandible en acordeón, ordenamiento por columna, paginación clásica server-side.

Columnas:

| Columna | Contenido |
|---|---|
| `▶` | Toggle expandir |
| Fecha | Ordenable |
| Cliente | — |
| Monto recibido | En CHF |
| Método | Badge (efectivo/twint/tarjeta/transferencia) |
| Aplicado | Suma de `pago_aplicacion.monto_aplicado` de ese pago |
| Sin aplicar | `monto − aplicado`; si es 0, no mostrar nada o un check; si es mayor que 0, destacar (es saldo a favor pendiente de aplicar) |

Fila expandida: detalle de cada `pago_aplicacion` de ese pago — a qué documento (factura o albarán, con su código/número) y cuánto se aplicó a cada uno.

Orden por defecto: `fecha` descendente (sin necesidad de agrupamiento por estado, igual que Albaranes — un pago no tiene ciclo de vida propio más allá de existir).

## 4. Cálculo de saldo pendiente por documento

Necesario tanto para decidir qué se ofrece cubrir en el drawer de la sección 5 como para no duplicar conceptualmente el saldo de un albarán que ya está agrupado en una factura:

- **Factura no anulada**: `saldo = total − (pagos aplicados directo a la factura) − (pagos aplicados a los albaranes que esa factura agrupa)`. Esto reutiliza el mismo razonamiento ya implementado para el punto 4 del contrato de Albaranes (columna "Pedido origen"): mirar hacia abajo, a través de `factura_venta_albaran`.
- **Albarán**: solo se considera "pendiente de cobro directo" si **no** está incluido en ninguna factura no anulada (si lo está, su saldo se gestiona a través de la factura, no directamente). Si es un albarán suelto: `saldo = total del albarán (suma de líneas) − pagos aplicados directo a ese albarán`.
- Una factura anulada, o un albarán ya cubierto al 100%, no aparecen como documentos con saldo pendiente.

## 5. Drawer "Registrar pago" (patrón Receive Payment)

Accesible desde dos puntos de entrada (sección 6), mismo drawer en ambos casos.

**Cabecera del drawer (siempre visible):**
- Selector de cliente (`<Select>` reutilizando el patrón ya existente en `ui.jsx`; filtrar por `activo = true` como ya hace `Pedidos.jsx`, para consistencia con el resto de pantallas de venta activa — Claude Code puede confirmar si tiene sentido con el volumen real de clientes).
- Fecha del pago.
- Monto recibido.
- Método (`efectivo`/`twint`/`tarjeta`/`transferencia`).
- Indicador persistente: **"Aplicado: X CHF / Recibido: Y CHF"**, con estado visual (verde si coincide, ámbar si queda monto sin aplicar, rojo si por error se aplicó más de lo recibido — este último caso debe estar bloqueado, no solo advertido).

**Cuerpo del drawer (aparece al elegir cliente):**
- Lista de documentos con saldo pendiente de ese cliente (facturas no anuladas + albaranes sueltos, sección 4), **agrupados visualmente por tipo** (encabezado "Facturas" / "Albaranes" dentro de la lista, o badge de tipo claramente visible por fila) — no una lista plana mezclada: en pruebas reales, mezclar ambos tipos sin distinción causó que una factura real pasara desapercibida entre albaranes. Cada línea con: checkbox, tipo (Factura/Albarán) + código, fecha, saldo pendiente, campo de monto a aplicar (editable, reutilizando el patrón de checkbox + input ya usado en `FacturasVenta.jsx:241-249`).
- **Auto-aplicación al introducir el monto recibido:**
  - Si el monto coincide exactamente con el saldo de un solo documento, se marca automáticamente ese documento con el monto completo.
  - Si no hay coincidencia exacta, se reparte automáticamente contra los documentos más antiguos primero (FIFO por fecha), hasta agotar el monto recibido o los documentos disponibles.
  - El usuario puede corregir cualquier auto-aplicación: destildar, tildar otro, cambiar el monto de una línea concreta — la propuesta automática es un punto de partida, no una imposición.
- Botón "Guardar": inserta 1 fila en `pagos` + una fila en `pago_aplicacion` por cada documento con monto aplicado > 0.

## 6. Acceso rápido desde documento

- **Facturas de venta**: nuevo icono de acción "Registrar cobro" (junto a Imprimir/Descargar/Anular) en las filas con saldo pendiente > 0 (sección 4) — no se muestra si la factura ya está saldada o anulada.
- **Albaranes de venta**: mismo icono, solo en albaranes sueltos (no incluidos en ninguna factura no anulada) con saldo pendiente > 0.
- En ambos casos, el icono abre el mismo drawer de la sección 5, con el cliente ya seleccionado y ese documento concreto ya marcado con su saldo pendiente como monto sugerido — el usuario solo tiene que confirmar método y fecha, o ajustar si el pago cubre más de lo esperado.
- **Badge de estado de pago**, añadido en la misma pasada por tocarse los mismos archivos: en Facturas de venta y en Albaranes sueltos (no en los ya incluidos en una factura, cuyo estado se refleja en la factura), un badge `Pagada` (saldo = 0) / `Parcial` (0 < saldo < total) / `Pendiente` (saldo = total), calculado con la misma fórmula del Bloque 3 — sin columna nueva que mantener, solo lectura del cálculo ya existente. Motivo: hoy solo `Pagos.jsx` muestra si algo está cobrado, y esa falta de visibilidad ya causó una confusión real durante las pruebas de este mismo contrato (una factura cobrada por transferencia se confundió con un albarán sin pagar, al no distinguirse visualmente en el listado).

## 7. No-objetivos explícitos

- No se implementan notas de crédito formales.
- No se implementan reportes de aging/antigüedad de saldos ni recordatorios de cobro.
- No se construye selector de moneda configurable — CHF fijo (sección 1).
- No se permite editar un pago ya guardado. Si se registró mal, se anula (mismo patrón que facturas: columna `anulada` en `pagos`, sus `pago_aplicacion` dejan de contar en los cálculos de saldo, decidir con Claude Code si se borran físicamente o se mantienen con la factura ya anulada — recomendado: mantener por rastro de auditoría, igual que se hizo con facturas).
- No se resuelve en esta primera versión la reaplicación de saldo a favor de un pago antiguo (mencionado como posible extensión en sección 2) — confirmar alcance con Claude Code antes de implementar si conviene incluirlo ahora o después.

## 8. Criterio de aceptación

- [ ] `CHF` sustituye a `€` en los tres sitios (PDF de facturas, listado de facturas, pantalla de pagos). Cambiado en código en los 3 sitios. Verificado visualmente en el listado de Facturas (captura real) y en Pagos (uso real). **No verificado visualmente en el PDF impreso/descargado** — misma limitación ya documentada en `CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md`.
- [x] Registrar un pago que coincide exactamente con una factura la marca automáticamente y la deja saldada. Verificado con datos reales: 3 facturas de "Zum Kuss" (`RE-2026-001/007/014`), cada una pagada con un pago que coincidía exacto, badge "Pagada" confirmado.
- [ ] Registrar un pago que cubre varias entregas de un cliente (el caso que más duele, según el usuario) reparte correctamente entre los documentos elegidos. **No verificado con datos reales.** Los 3 pagos reales existentes fueron cada uno una coincidencia exacta contra una sola factura — el reparto FIFO contra varios documentos a la vez con un único pago no se ha ejercitado todavía.
- [ ] Un pago que no cubre el monto total de los documentos seleccionados deja los saldos parciales correctos en cada documento (caso "Parcial"). **No verificado.** Diferido de forma explícita por decisión del usuario: se comprobará cuando ocurra un pago parcial real, no se simula.
- [ ] Un pago que excede lo aplicado a documentos deja el remanente visible como "sin aplicar", sin bloquear el guardado. **No verificado con datos reales** — no se ha dado el caso todavía.
- [ ] No se puede aplicar más monto del recibido (bloqueo real, no solo visual). Implementado (botón "Guardar" deshabilitado + revalidación en el submit), pero **nunca se intentó deliberadamente en el navegador** para confirmarlo con un caso real.
- [x] El listado histórico de pagos (tabla + acordeón + paginación + orden) funciona igual que Pedidos/Albaranes. Tabla y acordeón ejercitados con uso real (alta, expandir detalle, anulación). **Paginación y orden por columna no se han podido probar a fondo** por el volumen bajo de datos actual (menos de una página llena).
- [x] El acceso rápido desde Facturas y desde Albaranes abre el drawer correctamente preseleccionado. Verificado con datos reales, incluido un bug real encontrado y corregido en el camino: un cliente inactivo no aparecía en el `<Select>` aunque la preselección funcionara por dentro (fix: `clientesParaDrawer()` en `saldosVenta.js`, añade el cliente preseleccionado a la lista aunque esté inactivo).
- [x] Un albarán ya incluido en una factura no anulada no aparece como candidato a cobro directo. Verificado con un caso real (`DN-260070` agrupado en `RE-2026-009`, no anulada) mediante consulta SQL que reproduce la misma regla de exclusión.
- [x] Anular un pago revierte el saldo pendiente del documento que cubría (Bloque 7, no estaba en la lista original de este criterio pero es parte del contrato final). Verificado con un pago de prueba desechable: se registró, se confirmó "Pagada" en la factura, se anuló, y la factura volvió a "Pendiente".
- [x] Verificado en navegador con datos reales antes de dar por cerrado ("comprobado en frontend"), con las excepciones explícitas señaladas arriba (PDF visual, reparto FIFO multi-documento, caso Parcial, remanente sin aplicar, bloqueo de exceso, paginación/orden de Pagos con volumen bajo).
