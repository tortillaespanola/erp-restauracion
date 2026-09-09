# CONTRATO_PAGOS_COMPRA.md

**Estado:** ✅ Cerrado — completado y verificado el 09-09-2026 (paso 5 cerrado sin implementar, por falta de precedente en Venta — ver sección 6).
**Basado en:** `AUDITORIA_PAGOS_VENTA_PARA_COMPRAS.md` (auditoría de solo lectura, sin cambios de código ni SQL).
**Alcance funcional:** paridad completa con el sistema de cobros de Venta — pagos parciales, saldo pendiente, iconos de estado — aplicado tanto a Albaranes de compra como a Facturas de compra.

---

## 1. Objetivo

Construir un sistema de registro de pagos a proveedores para Compras, reutilizando el esquema de datos existente de Venta (`pagos` / `pago_aplicacion`) ampliado — no duplicado — y replicando en frontend el patrón de `saldosVenta.js` / `RegistrarPagoForm.jsx` / `pagoDrawer`.

## 2. Decisiones de diseño fijadas (no discutibles dentro de este contrato)

### 2.1 Soft-delete en `facturas_compra`

Se añade columna `anulada` (boolean, default `false`) a `facturas_compra`, igual que ya existe en `facturas_venta`. El borrado de una factura de compra pasa de `DELETE` físico a marcar `anulada = true`. Esto es requisito previo indispensable: `pago_aplicacion` es una tabla de auditoría insert/select-only (nunca se actualiza ni se borra una fila de pago aplicado), así que el documento al que apunta no puede desaparecer físicamente sin dejar el historial huérfano.

- Todo lo que hoy filtra o lista `facturas_compra` debe excluir `anulada = true` por defecto, igual que ya hace el código de venta con sus facturas anuladas.
- No se toca `albaranes_compra`: mantiene su comportamiento actual de borrado (la auditoría no detectó el mismo problema ahí; si aparece en el desarrollo, se trata como hallazgo nuevo, no se asume).

### 2.2 Esquema de datos: una sola tabla ampliada, no tablas paralelas

No se crean `pagos_compra` / `pago_aplicacion_compra`. Se amplía el esquema existente:

- **`pagos`**: sin cambios de estructura. Sigue siendo el hecho de pagar/cobrar (fecha, monto, moneda, medio de pago, referencia, `anulado`), independiente de si el dinero entra o sale.
- **`pago_aplicacion`**: se añaden dos columnas nullable nuevas, `factura_compra_id` y `albaran_compra_id` (FK reales, no polymorphic association), junto a las dos ya existentes (`factura_venta_id`, `albaran_venta_id`). El `CHECK` se amplía de "exactamente uno de 2" a **"exactamente uno de 4"**.
- Se descarta explícitamente el patrón `documento_tipo` + `documento_id` genérico: rompería la integridad referencial real que la tabla necesita para auditoría financiera.
- **La dirección (cobro/pago) se deriva, no se almacena**: si la fila de `pago_aplicacion` tiene `factura_venta_id`/`albaran_venta_id` poblado → es un cobro; si tiene `factura_compra_id`/`albaran_compra_id` → es un pago a proveedor. No se añade columna de dirección redundante.
- La UI de Venta sigue diciendo "cobro" donde ya lo dice hoy; no se toca su naming. La UI de Compra introduce "pago a proveedor" como concepto nuevo, sobre las mismas tablas.

### 2.3 Moneda

Siempre CHF vía `negocio?.moneda` (`empresa_config`, `useNegocio()`) + `formatMoneda()`, igual que Venta. No se toca la tabla `proveedores`.

## 3. Fórmula de saldo (replicada tal cual, "mirar hacia abajo")

```
saldo_pendiente = total − Σ(monto_aplicado de pago_aplicacion, excluyendo pagos anulados)
```

- Se implementa duplicada a propósito, igual que en Venta: en JS (nuevo `saldosCompra.js`, análogo a `saldosVenta.js`) y en una vista SQL nueva `facturas_compra_con_saldo` (análoga a `facturas_venta_con_saldo`).
- Tolerancia de redondeo: `EPSILON = 0.005`, igual que Venta.
- `factura_compra_albaran` ya existe con la misma forma relacional que `factura_venta_albaran` (multi-albarán por factura) — la fórmula "mirar hacia abajo" (saldo de factura se propaga considerando sus albaranes) es replicable sin cambios de modelo adicionales, una vez resuelto 2.1.

## 4. Frontend

### 4.1 `saldosCompra.js`

Mismas funciones exportadas que `saldosVenta.js`, adaptadas a `factura_compra_id`/`albaran_compra_id`. Sin lógica nueva de negocio, solo el espejo de nombres de tabla/columna.

### 4.2 `RegistrarPagoProveedorForm.jsx`

Mismos campos, validaciones y comportamiento que `RegistrarPagoForm.jsx`:
- Un pago por sesión de formulario (no varios en batch).
- Si el monto introducido supera el saldo pendiente, mismo comportamiento de bloqueo/aviso que Venta (a confirmar el valor exacto contra el código de `RegistrarPagoForm.jsx` al implementar, no se reinventa).

### 4.3 `pagoDrawer` en Compras

- Se añade a `AlbaranesCompra.jsx` y `FacturasCompra.jsx`, con el mismo patrón de estado (objeto o `null`) usado en Venta para su `pagoDrawer`.
- Mismo componente de formulario reutilizado entre ambas pantallas (parámetro indica si aplica a factura o albarán), igual que Venta.

### 4.4 Iconos de estado en la tabla

Mismo componente de icono de estado (pendiente/parcial/pagado), reutilizado tal cual, alimentado por `facturas_compra_con_saldo` / cálculo equivalente para albaranes.

### 4.5 Historial de pagos

Si Venta expone un sub-listado de historial de pagos por documento, se replica igual para Compras. (A confirmar contra el código real de Venta al implementar — la auditoría no especificó si existe una pantalla dedicada o solo el saldo actual visible.)

## 5. Alcance explícito

**Incluye:**
- Migración `facturas_compra`: columna `anulada` + cambio de `DELETE` físico a soft-delete.
- Migración `pago_aplicacion`: columnas `factura_compra_id`, `albaran_compra_id` + `CHECK` ampliado.
- Vista `facturas_compra_con_saldo`.
- `saldosCompra.js`, `RegistrarPagoProveedorForm.jsx`, `pagoDrawer` en Albaranes y Facturas de compra, iconos de estado.

**No incluye:**
- Ningún cambio en el esquema o comportamiento de `pagos`/`pago_aplicacion` para lo ya existente en Venta, salvo la ampliación aditiva del `CHECK`.
- Corrección de la mezcla terminológica "pago"/"cobro" en el código de Venta ya existente.
- Cambios en `albaranes_compra` más allá de sumarle el `pagoDrawer` (su lógica de borrado/edición actual no se toca; ver `CONTRATO_DRAWERS_COMPRAS.md` para su migración a drawer de formulario).

## 6. Orden de ejecución propuesto

1. ✅ **Migración SQL — aplicada y verificada el 09-09-2026.** `anulada` en `facturas_compra` (default `false`, confirmado contra un dato real: factura id=8, `anulada: false` sin que el insert la fijara explícitamente) + ampliación de `pago_aplicacion` (`factura_compra_id`, `albaran_compra_id`) y su `CHECK` (0 violaciones contra las 12 filas reales existentes, antes y después de aplicar).
2. ✅ **Vista `facturas_compra_con_saldo` + `saldosCompra.js` — aplicada y verificada el 09-09-2026.** Vista con `estado_pago` de 5 valores (`anulada`/`sin_total`/`pagada`/`parcial`/`pendiente`), añadido tras detectar que `facturas_compra.total` nullable (a diferencia de venta) hacía indistinguibles `sin_total` y `pendiente` (ambos con `saldo_pendiente = NULL`). Verificado con datos reales insertados y borrados de nuevo tras la prueba: caso parcial, caso pagada y caso sin_total, JS y SQL coinciden en los tres. Cuenta demo confirmada limpia tras la limpieza (0 filas residuales en `pagos`/`pago_aplicacion`/factura de prueba).
3. ✅ **`RegistrarPagoProveedorForm.jsx` + `pagoDrawer` en `FacturasCompra.jsx` — aplicado y verificado el 09-09-2026.** Formulario espejo de `RegistrarPagoForm.jsx`, inserta en `pagos` (`proveedor_id`) y `pago_aplicacion` (`factura_compra_id`). `FacturasCompra.jsx` pasa a consultar `facturas_compra_con_saldo`, con badge de `estado_pago`, botón "Registrar pago" (deshabilitado si `sin_total`/`anulada`/sin saldo), y `handleBorrar` → `handleAnular` (soft-delete, consistente con la sección 2.1). Icono de estado en tabla incluido ya (trivial, reutiliza `estado_pago` de la vista) — no queda pendiente para el paso 5. Verificado en navegador con factura real (id=11): pago parcial 40/100 CHF → saldo 60, badge "Parcial"; intento de pago que supera el saldo restante → bloqueado con aviso, sin crear pago. Cuenta demo limpia tras la prueba.
4. ✅ **`pagoDrawer` en `AlbaranesCompra.jsx` — aplicado y verificado el 09-09-2026.** Reutiliza `RegistrarPagoProveedorForm.jsx` sin cambios (tipo `'albaran'` ya soportado desde el paso 3). Saldo calculado con `saldosDeAlbaranesSueltos` de `saldosCompra.js` (paso 2), sin vista SQL nueva — total del albarán desde `entrada_material`. `handleBorrar` **bloquea por completo** (no solo avisa) si el albarán tiene filas en `pago_aplicacion`, a diferencia del aviso de consumo/ajustes que sí deja continuar — resuelve el pendiente documentado abajo desde el paso 1. Hallazgo real encontrado y corregido: el filtro "Facturación" estaba roto (asumía `factura_compra_albaran` embebido como array; PostgREST lo embebe como objeto único) — corregido con `facturaVivaDe`, función única compartida entre el filtro y el cálculo de saldo. Verificado en navegador: pago parcial 500 CHF sobre albarán real (saldo 933,40) → badge "Parcial"; intento de borrar ese albarán → bloqueado con aviso; filtro "Facturado" verificado con relación real. Cuenta demo limpia tras la prueba.
5. **No implementado, cierre documentado el 09-09-2026.** Verificado con el código real: no existe historial de pagos por documento ni en Venta ni en Compra hoy — `FacturasVenta.jsx` solo expande los albaranes de la factura; `RegistrarPagoForm.jsx`/`RegistrarPagoProveedorForm.jsx` muestran el saldo actual, no un histórico; `Pagos.jsx` es la vista inversa (pago → documentos), sin filtro por documento concreto. Sin precedente en Venta que replicar, se decide no construirlo de cero para Compras dentro de este contrato — requeriría su propio contrato aparte si se pide en el futuro.

## 7. Criterios de aceptación

- Borrar una factura de compra con pagos aplicados nunca produce un `DELETE` físico ni deja filas huérfanas en `pago_aplicacion`.
- El saldo calculado en JS y en la vista SQL coinciden siempre (dentro de `EPSILON`).
- Un pago registrado contra una factura de compra nunca puede modificarse ni borrarse después de creado (mismo comportamiento append-only que Venta).
- La UI de Venta no cambia en ningún punto como efecto colateral de este contrato.

## 8. Decisiones de Code pendientes de seguimiento

- **Rollback de alta fallida en `FacturaCompraForm.jsx:196`** se queda como `DELETE` físico (no soft-delete) — criterio de Code, no pactado explícitamente en el contrato original, pero aceptado: una factura que nunca llegó a persistir de verdad no necesita rastro de auditoría. Aprobado.
- **Hallazgo bloqueante (09-09-2026, RESUELTO el mismo día):** `pagos.cliente_id` era `NOT NULL` y no existía `proveedor_id` (contradecía la asunción original de la sección 2.2, "sin cambios de estructura"). Resuelto con `20261004_pagos_proveedor_id.sql`: añadida `proveedor_id` nullable, `cliente_id` relajada a nullable, `CHECK pagos_exactamente_un_titular` (mismo patrón de recuento que `pago_aplicacion_exactamente_un_documento`). Verificado: las 12 filas reales de `pagos` siguen cumpliendo el `CHECK` sin excepción. Efecto colateral detectado y corregido en el mismo cambio: `Pagos.jsx` (Venta) no filtraba por `cliente_id`, así que un futuro pago a proveedor se habría colado en su listado/conteo — se añadió `.not('cliente_id', 'is', null)` a esa consulta, verificado que sigue mostrando exactamente los mismos 12 pagos que antes.
- **`albaran_compra_id` en `pago_aplicacion` sin `ON DELETE CASCADE`** (deliberado, por defecto bloquea el borrado). **RESUELTO en el paso 4:** `handleBorrar` de `AlbaranesCompra.jsx` ahora comprueba `pago_aplicacion` antes de intentar el `DELETE` y bloquea con aviso si hay pagos aplicados.
- **Hallazgo real (paso 4, 09-09-2026):** el filtro "Facturación" de `AlbaranesCompra.jsx` estaba roto de fábrica — `factura_compra_albaran` se embebe como objeto único vía PostgREST, no como array, así que "Facturado" nunca mostraba nada. Corregido con `facturaVivaDe`, compartida entre el filtro y el cálculo de saldo. No es un efecto de este contrato, era un bug preexistente descubierto al implementar el saldo de albaranes.
- **Hueco de alcance detectado y RESUELTO el mismo día (09-09-2026):** faltaba `PagosCompra.jsx` ("Pagos de compra"), equivalente a `Pagos.jsx` ("Pagos de venta") — el listado global de todos los pagos (no el historial por documento, descartado en el paso 5 por falta de precedente). Construido como espejo de `Pagos.jsx`, filtrando `proveedor_id is not null` (inversa exacta del filtro ya añadido a `Pagos.jsx`), mismo botón "Anular" (soft-delete, nunca `DELETE`), reutiliza `RegistrarPagoProveedorForm.jsx` para registrar pagos eligiendo documento. Verificado con datos de prueba reales, insertados y borrados de nuevo: `pagos.id=80` y `pago_aplicacion.id=82` confirmados borrados tras la limpieza, consulta de pagos a proveedor de vuelta a 0. Cuenta demo limpia.
