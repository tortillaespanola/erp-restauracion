# CONTRATO_FACTURA_PDF.md

## 1. Contexto

- `facturas_venta` y `albaranes_venta` se relacionan N a N vía la tabla puente `factura_venta_albaran`. Una factura puede incluir varios albaranes de un mismo cliente.
- `FacturaVentaForm.jsx` genera la factura por selección de albaranes completos (checkboxes), no de líneas sueltas, y con una única fecha de factura (sin rango de fechas en el alta).
- El PDF de factura actual (`generarPdf.js`, uso genérico `generarDocumentoPdf('Factura', documento)`) es una plantilla simple sin relación visual con la de albarán: sin VON/AN, sin desglose de subtotal/IVA, sin footer de marca, sin datos bancarios.
- El PDF de albarán (`generarAlbaranVentaPdf.js`) ya tiene toda la riqueza visual que la factura debe alcanzar: fuentes propias, VON/AN, tabla de líneas, ZWISCHENSUMME, BEMERKUNGEN, footer de marca (este último ya cubierto por `CONTRATO_PIE_DOCUMENTO.md`).

## 2. Objetivo

Sustituir la generación de PDF de factura de venta por una plantilla nueva, visualmente alineada con la de albarán, que además:

- Consolide en una tabla las líneas de todos los albaranes incluidos en la factura, con la fecha de origen de cada línea.
- Muestre el periodo cubierto ("Abrechnungsperiode") entre la fecha mínima y máxima de los albaranes incluidos.
- Incluya una sección de condiciones de pago y datos bancarios (`Zahlungskonditionen`), ausente en el albarán.
- Avise, sin bloquear, cuando quedan albaranes del mismo periodo sin incluir en la factura.

## 3. Refactor previo: helpers compartidos

Antes de construir la plantilla nueva, extraer de `generarAlbaranVentaPdf.js` a un módulo común (p. ej. `frontend/src/lib/pdfDocumentoBase.js`, nombre libre) lo que ambos documentos van a compartir:

- `registrarFuentes()` (Montserrat/SpaceMono).
- `lineaMixtaDerecha()`.
- Dibujo de cabecera logo + datos empresa.
- Dibujo del bloque VON/AN.
- Dibujo del footer de marca (ya con los campos de `CONTRATO_PIE_DOCUMENTO.md`).
- Resolución de BEMERKUNGEN (`documento.notas` → `datos_bancarios.observaciones` → nada), también ya definida en `CONTRATO_PIE_DOCUMENTO.md`.

`generarAlbaranVentaPdf.js` pasa a consumir este módulo. **Este refactor no debe cambiar el resultado visual del albarán** — se verifica en navegador comparando el PDF generado antes/después del refactor, byte a byte de contenido visible, antes de tocar nada de factura.

## 4. Nuevo `generarFacturaVentaPdf.js`

Reemplaza el uso de `generarPdf.js` para facturas de venta. (Verificar primero si `generarPdf.js` se usa también para otros tipos de documento aparte de `'Factura'` — si es así, se deja intacto para esos otros usos y solo se desvía la ruta de factura de venta hacia el generador nuevo).

### Estructura visual

1. Cabecera: logo + datos de empresa (helper compartido).
2. Bloque derecho: `Rechnung <numero_factura>` / `Datum: <fecha>`.
3. `Abrechnungsperiode: <fecha_min> - <fecha_max>`, calculado sobre las fechas de los albaranes incluidos (vía `factura_venta_albaran` → `albaranes_venta.fecha`). Si todas las fechas coinciden, se muestra igualmente como rango (misma fecha dos veces) — sin caso especial.
4. VON/AN (helper compartido).
5. Tabla de líneas (equivalente a LIEFERDETAILS): columnas `Datum / Artikel / Beschreibung / Menge / Preis / Einheit / Total`. Una fila por línea de cada albarán incluido; `Datum` es la fecha del albarán de origen de esa línea, no la fecha de la factura.
6. `ZWISCHENSUMME` (subtotal), `MWST (0%)` y `TOTAL`, alineados a la derecha. El 0% queda hardcodeado igual que en el Excel de referencia — IVA dinámico fuera de alcance.
7. `BEMERKUNGEN`: helper compartido (`documento.notas` → `datos_bancarios.observaciones`), **más** la línea de aviso de periodo incompleto cuando aplique (ver §6) — esta línea se añade siempre al final, independientemente de si hay Bemerkungen propias.
8. `ZAHLUNGSKONDITIONEN` (nueva, solo en factura), desde `datos_bancarios` del negocio: `condiciones_pago`, `enlace_pago_online` (como línea de tipo "Bezahlen mit ...", enlace clicable), `beneficiario`, `direccion_beneficiario`, `iban`, `bic` (solo si no está vacío), `referencia_pago`, `banco`. Cualquier campo vacío se omite sin dejar hueco ni error.
9. Footer de marca (helper compartido).

Formateo de importes usa `empresa_config.moneda` (ya existe, default `CHF`), no un símbolo hardcodeado.

## 5. Base de datos

```sql
alter table facturas_venta
  add column aviso_periodo text;
```

Nullable. Guarda, en el momento de crear la factura, el texto de aviso (si lo hubo) sobre albaranes del periodo no incluidos — así el PDF, si se regenera más adelante, muestra siempre el mismo aviso que se calculó al facturar, en vez de recalcularlo cada vez contra el estado actual de la base de datos (que puede haber cambiado).

## 6. Lógica de consolidación y aviso de periodo

En `FacturaVentaForm.jsx`, al guardar:

1. Determinar fecha mínima y máxima entre los albaranes marcados.
2. Buscar otros albaranes del mismo cliente con fecha dentro de ese rango que **no** estén marcados y sigan disponibles para facturar (mismo criterio de disponibilidad que ya usa el formulario: no incluidos en una factura no anulada).
3. Si existen: no se bloquea el guardado. Se muestra un aviso (toast) al usuario indicando cuántos/qué albaranes quedan fuera del periodo. Se compone el texto de `aviso_periodo` (p. ej. "Existen albaranes del periodo [fecha_min–fecha_max] pendientes de facturar.") y se guarda en `facturas_venta.aviso_periodo` al insertar la factura.
4. Si no existen albaranes fuera: `aviso_periodo` queda `null` y no se añade ninguna línea extra en BEMERKUNGEN.

## 7. Fuera de alcance

- Selección de líneas sueltas (se mantiene selección por albarán completo).
- IVA/MWST dinámico o configurable por producto/negocio.
- Edición o regeneración con recálculo de facturas ya emitidas.
- Cualquier acción automática sobre los albaranes avisados (refacturación, agrupación automática en la siguiente factura, etc.) — el aviso es solo informativo.
- Anulación/reversión de factura — sin cambios sobre `anulada`, que ya existe.

## 8. Metodología

Orden de ejecución: (1) refactor de helpers compartidos con verificación visual del albarán sin diffs, (2) migración `aviso_periodo` en `BEGIN...ROLLBACK`, (3) `generarFacturaVentaPdf.js` nuevo, (4) lógica de aviso en `FacturaVentaForm.jsx`. Verificación en navegador de: una factura de un solo albarán, una factura de varios albaranes con fechas distintas (Abrechnungsperiode correcto), y un caso forzado con un albarán del periodo fuera de la selección (aviso en pantalla + línea en el PDF). Commit local y push solo tras esa verificación completa.
