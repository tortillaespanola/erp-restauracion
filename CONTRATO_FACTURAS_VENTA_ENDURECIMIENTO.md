# CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md

## Objetivo

Antes de construir el módulo de pagos (`CONTRATO_PAGOS_VENTA.md`, pendiente), cerrar tres grietas en `FacturasVenta.jsx` que hoy lo hacen inviable como base fiable para calcular saldos pendientes: numeración manual, total potencialmente desincronizado de las líneas reales, y borrado físico sin rastro de auditoría.

Contexto: `facturas_venta` tiene 0 filas reales hoy — no hay datos de producción que migrar ni compatibilidad histórica que preservar. Se empieza con numeración limpia desde `RE-2026-001`.

**Fuera de alcance de este contrato:** el módulo de pagos en sí (tabla `pagos`/`pago_aplicacion`), cualquier rediseño visual de tabla/drawer al estilo de Pedidos/Albaranes (eso puede venir después, aquí solo se endurece la lógica de negocio), notas de crédito / abono formal (si en el futuro se necesita corregir una factura ya emitida más allá de anularla, es un contrato aparte).

---

## 1. Numeración automática y secuencial

- Formato: `RE-{año}-{secuencial de 3 dígitos, con ceros a la izquierda}` — ej. `RE-2026-001`, `RE-2026-002`, ..., `RE-2026-999`, y si se supera 999 en un año, ampliar a 4 dígitos (definir con Claude Code si el contador se calcula dinámicamente según longitud o se fija a 3 dígitos con overflow a 4 solo cuando haga falta). Prefijo `RE` de "Rechnung" (factura, en alemán), coherente con el idioma ya usado en el Lieferschein de albaranes.
- **Reinicia cada año**: el primer `RE` de cada año natural vuelve a `001`.
- Se genera en BD (trigger o función, mismo patrón que `generar_codigo('OV')` ya usado en `pedidos_venta` — revisar esa implementación como referencia directa).
- El campo `numero_factura` deja de ser un `<input>` de texto libre en el formulario de alta — se muestra de solo lectura (o ni siquiera se muestra hasta después de guardar, si es más simple generarlo en el INSERT vía trigger `BEFORE INSERT`).
- **Bloqueada, sin excepción**: nadie edita `numero_factura` manualmente, nunca, ni siquiera en casos "excepcionales". Si algo salió mal, se anula la factura (sección 3) y se emite una nueva con el siguiente número de la secuencia — nunca se reutiliza ni se salta manualmente un número.

## 2. Total siempre calculado de líneas

- Elimina el campo manual de "Total factura" del formulario de alta.
- El total se calcula siempre a partir de la suma de `cantidad × precio_unitario` de todas las líneas de todos los albaranes incluidos en la factura — la misma lógica que hoy ya existe en `prepararDocumento` (usada para el PDF), pero ahora se usa también para guardar el valor real en `facturas_venta.total`, no solo para mostrarlo en el PDF.
- Este cálculo ocurre en el momento de crear la factura (al guardar, no en cada carga del listado) y se persiste en la columna `total` — no se recalcula dinámicamente cada vez que se lista, para no depender de que los albaranes/líneas no cambien después (que no deberían, pero por si acaso).
- El listado de facturas debe mostrar ese total persistido, coherente siempre con lo que muestra el PDF — ya no puede haber divergencia entre ambos.

## 3. Anulación en vez de borrado físico

- Nueva columna en `facturas_venta`: `anulada` (boolean, default `false`).
- `handleBorrar` deja de hacer `DELETE` — pasa a hacer `UPDATE facturas_venta SET anulada = true WHERE id = X`, con su propio `confirm()` que dice explícitamente "Esta acción anula la factura de forma permanente, no se puede deshacer" (distinto texto al genérico actual).
- Una factura anulada:
  - Sigue apareciendo en el listado, visualmente diferenciada (fila atenuada/gris, texto tachado en el número, o un badge "Anulada" — decide con Claude Code el tratamiento visual mínimo, no hace falta rediseño completo aquí).
  - Su número (`RE-2026-00X`) queda "quemado" para siempre — no se reutiliza, no se reasigna.
  - No se puede volver a activar (no hay botón "reactivar" — si hace falta, se emite una factura nueva).
  - Sus filas en `factura_venta_albaran` **no se borran** — los albaranes que agrupaba vuelven a estar disponibles para incluirse en una factura nueva (esto hay que verificarlo con cuidado: la query que hoy filtra "albaranes ya facturados" en `FacturasVenta.jsx` debe excluir del filtro las relaciones cuya factura está anulada, para que esos albaranes vuelvan a aparecer como facturables).

## 4. No-objetivos explícitos

- No se implementa edición de facturas (nunca existió, sigue sin existir).
- No se implementa nota de crédito / abono formal — la "anulación" de este contrato es un apagado simple, no un documento fiscal de reversión.
- No se toca el generador de PDF (`generarPdf.js`) más allá de que ahora reciba un total ya persistido y fiable en vez de calculado al vuelo — su diseño/membrete queda igual.
- No se construye el módulo de pagos — este contrato es prerequisito, no lo incluye.
- No se resuelve la deuda ya documentada de `metodo_pago` en `AlbaranesCompra.jsx` (mencionada en el diagnóstico, pertenece al lado de compras, fuera de alcance).

## 5. Criterio de aceptación

- [x] Crear una factura nueva genera automáticamente `numero_factura` en formato `RE-{año}-{secuencial}`, sin intervención manual. Verificado con una factura real creada desde la UI (Bloque 3): `RE-2026-001`, campo no editable en el formulario.
- [x] Dos facturas creadas en el mismo año consecutivas reciben números consecutivos, sin huecos. Verificado a nivel de trigger con ejecución SQL real (no simulada) contra la base real, dentro de un `BEGIN...ROLLBACK` (Bloque 1): `RE-2026-001, 002, 003, 004` consecutivos. **No se probaron dos facturas reales consecutivas a través de la UI** — solo se creó una factura real en toda esta ronda (`RE-2026-001`, luego borrada como parte de la limpieza del Bloque 4); la garantía de consecutividad vive enteramente en el trigger de BD, que es justamente lo que se ejecutó de verdad.
- [x] (Si es practicable probarlo) una factura creada en un año distinto reinicia el secuencial a `001`. Verificado igual que el punto anterior: una fila fechada en 2027 en medio de la secuencia de 2026 recibió `RE-2027-001` sin afectar al contador de 2026.
- [x] El total guardado en `facturas_venta.total` coincide siempre con la suma real de líneas de los albaranes incluidos, sin posibilidad de introducir un valor manual distinto. Verificado con la factura real: `total = 50`, confirmado además por una suma independiente hecha por fuera del código de la app sobre las líneas reales del albarán.
- [ ] **No verificado visualmente.** El PDF generado muestra el mismo total que el listado. `prepararDocumento` ya no puede divergir del listado a nivel de código (ambos leen `f.total`, el mismo campo persistido, sin recálculo ni fallback) — pero nunca se hizo clic en "Imprimir" ni "Descargar PDF" para la factura real y ver el número dentro del PDF con los propios ojos. Recomendado confirmarlo la próxima vez que exista una factura real.
- [x] "Borrar" una factura ya no hace `DELETE` — marca `anulada = true`, con texto de confirmación distinto y explícito. Verificado con la factura real (Bloque 4): diálogo con el texto exacto pedido, `UPDATE` en vez de `DELETE` (la fila sobrevivió, solo cambió `anulada`).
- [x] Una factura anulada se distingue visualmente en el listado y no se puede reactivar. Verificado con captura real: badge "Anulada", número tachado, tarjeta atenuada, sin botón de reactivar.
- [x] Los albaranes de una factura anulada vuelven a estar disponibles para incluirse en una factura nueva. Verificado con datos reales de forma precisa (Bloque 4): `DN-260123` confirmado ausente de la lista de disponibles antes de anular y presente después, acotando el chequeo a los `<label>` de checkboxes para evitar falsos positivos con el texto "Albaranes incluidos" de la propia tarjeta.
- [x] Verificado en navegador con datos reales antes de dar por cerrado ("comprobado en frontend"), con la única excepción explícita señalada arriba (render visual del total dentro del PDF de Imprimir/Descargar).

---

**Nota de housekeeping (no es parte de la checklist de aceptación):** durante la verificación del Bloque 4 se reutilizó una factura real (`RE-2026-001`, cliente Tinto, albarán `DN-260123`) como fixture de prueba de anulación, y al limpiarla se hizo un `UPDATE` manual sobre `facturas_venta_secuencia` para devolver el contador de 2026 a `0` (no se pudo hacer `DELETE` de la fila del contador — `authenticated` no tiene ese grant — así que se puso `ultimo_numero = 0` en su lugar). Esto fue una excepción puntual de housekeeping, aceptable únicamente porque `facturas_venta` seguía en 0 filas reales en ese momento. **Nunca debe repetirse una vez el sistema tenga facturas reales en producción**: tocar `facturas_venta_secuencia` a mano después de eso reventaría la garantía de "un número, una sola vez" que es el propósito entero del Bloque 1 de este contrato (podría hacer que un número ya emitido se vuelva a generar, o crear huecos/colisiones en la secuencia). Efecto colateral conocido de esta limpieza: el albarán `DN-260123` (Tinto, 02/09/2026) quedó sin ninguna factura asociada tras borrar `RE-2026-001` — pendiente de facturarse de nuevo, no se corrigió como parte de este contrato.
