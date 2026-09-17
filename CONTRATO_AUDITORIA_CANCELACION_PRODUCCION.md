# CONTRATO: Auditoría de Cancelaciones de Producción (P0-1 del Roadmap Fase 06)

## Contexto

La simulación de 6 meses (`FASE06_SIMULACION_RESUMEN.md`) detectó que cancelar
una producción hoy ejecuta un `DELETE` puro sobre el registro de producción
(`producciones_semielaborado` / `producciones_producto_final`). El resultado
es que **no queda ningún rastro** de que la producción existió, cuándo se
canceló, quién la canceló, ni por qué. Esto es un problema de trazabilidad
tanto operativa (no puedes responder "¿por qué se canceló esto?" seis meses
después) como de integridad de los datos usados para métricas: el roadmap ya
identifica que P1-4 (`cantidad_rechazada` / OEE) necesita datos fiables de
mermas y cancelaciones, y con un `DELETE` puro esa información simplemente no
existe.

## Objetivo

Sustituir el `DELETE` de cancelación por un cambio de estado a `cancelada`
(soft-cancel), con motivo obligatorio, usuario y timestamp, de modo que el
registro de producción permanezca en la base de datos como evidencia de que
existió y de por qué se detuvo, en lugar de desaparecer sin dejar huella.

## Antes de empezar: auditoría de esquema obligatoria

Lección de la propia Fase 06 (sección 6.3): revisa el código real antes de
asumir su comportamiento.

- Localizar el/los punto(s) exacto(s) donde hoy se ejecuta el `DELETE` de
  cancelación: función RPC, trigger, o directamente desde el frontend
  (Supabase client `.delete()`). Confirmar si hay uno o varios flujos
  distintos (semielaborado vs. producto final; cancelación manual vs.
  automática).
- Tablas `producciones_semielaborado` y `producciones_producto_final` —
  estados válidos actuales (enum, check constraint o texto libre), y si ya
  existe algún campo de auditoría (`created_by`, `updated_at`, etc.) que se
  pueda reutilizar como patrón.
- Efectos secundarios que hoy dependen de la existencia/no-existencia de la
  fila de producción al cancelarla:
  - Triggers de consumo (`check_consumo_produccion()`,
    `check_consumo_produccion_pf()`, del contrato P0-2 recién cerrado) — si
    la cancelación hoy revierte consumos de stock vía `ON DELETE CASCADE` o
    lógica equivalente, hay que replicar esa reversión de stock de forma
    explícita al pasar a soft-cancel, porque el registro ya no desaparecerá.
  - `stock_lotes_semielaborado` / vistas de trazabilidad multinivel (Fase06,
    sección 4, punto 6) — confirmar que no asumen que solo existen
    producciones "vivas" (por ejemplo, sumando cantidades sin filtrar por
    estado).
  - Cualquier `foreign key` con `ON DELETE CASCADE` que hoy limpie registros
    relacionados (líneas de consumo, incidencias vinculadas) al borrar la
    producción — con soft-cancel esas filas relacionadas seguirán existiendo
    y hay que decidir si también deben marcarse o quedarse como están.
- Frontend: dónde se dispara hoy la cancelación (qué componente, qué
  confirmación se pide al usuario) para saber dónde añadir el campo de
  motivo.

## Alcance

### 1. Migración SQL

Idempotente, con guarda tipo `if exists ... raise notice ... return` como en
el resto de la Fase 06.

- Añadir a `producciones_semielaborado` y `producciones_producto_final`:
  - Nuevo valor de estado `cancelada` (enum/constraint existente).
  - Columna `motivo_cancelacion` (texto, obligatorio cuando `estado =
    'cancelada'` — vía `CHECK` constraint).
  - Columna `cancelada_por` (referencia a usuario, si el patrón de
    auditoría del proyecto lo contempla) y `cancelada_en` (timestamp).
- Sustituir la lógica de `DELETE` por un `UPDATE` a `estado = 'cancelada'`
  con los campos anteriores. Si la cancelación hoy vive en una función RPC,
  modificarla ahí; si vive directamente en el frontend, crear una función
  RPC nueva para centralizar la lógica (incluida la reversión de stock) y
  evitar que el frontend pueda hacer un `DELETE` directo.
- Revertir explícitamente el consumo de stock asociado a la producción
  cancelada (devolver a `stock_lotes_articulo` / `stock_lotes_semielaborado`
  las cantidades que se habían descontado), ya que antes esto lo resolvía
  implícitamente el `DELETE` en cascada y ahora hay que hacerlo a mano.
- Revisar las vistas de stock y trazabilidad para que las producciones en
  estado `cancelada` **no cuenten** como producción real (ni en cantidades
  producidas ni en consumo activo), pero sigan siendo consultables como
  historial.
- Backfill: no aplica — las producciones ya eliminadas por `DELETE` no se
  pueden recuperar; el cambio aplica solo hacia adelante.

### 2. Frontend

- Al cancelar una producción, pedir el motivo (campo de texto obligatorio)
  antes de confirmar — sustituye o complementa el diálogo de confirmación
  actual.
- Mostrar las producciones canceladas en el historial/listado
  correspondiente, distinguibles visualmente (ej. estado tachado o badge
  gris) y **excluidas** de los cálculos de producción activa en curso.
- Revisar los locales de i18next (es/en/de) para el nuevo estado y el campo
  de motivo.

### 3. Tests

Vitest + Testing Library, como en contratos anteriores.

- Test SQL: cancelar una producción con motivo la deja en estado
  `cancelada` en vez de eliminarla, y revierte correctamente el stock
  consumido.
- Test SQL: intentar cancelar sin motivo falla (constraint).
- Test de que las vistas de stock no cuentan producciones canceladas como
  activas.
- Test de UI: el flujo de cancelación pide motivo y no permite confirmar
  sin él; la producción cancelada aparece en el historial correctamente.

## Fuera de alcance (dejar para roadmap posterior)

- `cantidad_rechazada` / `motivo_rechazo` para mermas parciales, es decir,
  producción que se completa pero con parte de la cantidad no válida (P1-4)
  — este contrato cubre solo la cancelación total de una producción, no el
  rechazo parcial.
- UI de `tandas_produccion` (P2-1).
- Estado `planificada` para producción sin iniciar (P2-3).

## Criterios de aceptación

- Cancelar una producción ya no ejecuta `DELETE`: el registro persiste con
  `estado = 'cancelada'`, motivo, usuario y timestamp.
- El stock consumido por una producción cancelada queda revertido
  correctamente.
- Las producciones canceladas son visibles en el historial pero no se
  cuentan en ningún cálculo de producción activa o disponible.
- No es posible cancelar sin indicar un motivo.
- Los flujos de producción no cancelada (completada, en curso) no sufren
  ninguna regresión.
- Tests pasan en CI.

## Nota de calidad

Antes de escribir SQL largo con patrones repetitivos, ten especial cuidado con
errores de tokenización (multiplicaciones sin `*`, variables con espacios,
palabras clave rotas) — fueron el problema más recurrente en la Fase 06.
Prueba primero en una transacción `BEGIN...ROLLBACK` contra datos reales en el
SQL Editor del Dashboard, simulando el rol `authenticated` real (no el
superusuario), antes de aplicar en firme — la migración anterior (P0-2)
descubrió un problema de RLS que solo apareció al probar así.
