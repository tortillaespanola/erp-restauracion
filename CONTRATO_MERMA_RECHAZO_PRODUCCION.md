# CONTRATO: Merma Parcial en Producción — `cantidad_rechazada` / `motivo_rechazo` (P1-4 del Roadmap Fase 06)

## Contexto

La simulación de 6 meses (`FASE06_SIMULACION_RESUMEN.md`) identificó que hoy
una producción solo distingue entre "completada" y "cancelada"
(`CONTRATO_AUDITORIA_CANCELACION_PRODUCCION.md`, P0-1). No existe forma de
registrar el caso intermedio, muy habitual en fabricación real: una
producción se completa, pero **parte de la cantidad producida no es válida**
(pieza defectuosa, medida incorrecta, rotura en manipulación). Hoy esa merma
no queda registrada en ningún sitio — o se ignora, o se fuerza artificialmente
a `cantidad_producida` la cifra real ya descontando el rechazo, perdiendo el
dato de cuánto se intentó producir frente a cuánto sirvió.

Esto es la base necesaria para calcular OEE (Overall Equipment Effectiveness)
y coste real de mermas, que el propio roadmap señala como el motivo de
prioridad de este contrato.

## Relación con contratos anteriores (no romper lo ya cerrado)

- **P0-1 (cancelación)**: una producción **cancelada** (`estado = 'cancelada'`)
  es distinta de una producción **completada con rechazo parcial**. Este
  contrato no toca el flujo de cancelación ni el estado `cancelada` — son
  casos mutuamente excluyentes: cancelar es "esto no se hizo", rechazo
  parcial es "esto se hizo, pero una parte no vale".
- **P0-2 (stock negativo)**: el consumo de materia prima para producir la
  cantidad rechazada **ya ocurrió** (se gastó material real en fabricar la
  pieza defectuosa) y no debe revertirse — a diferencia de la reversión de
  stock que sí aplica al cancelar (P0-1). Este contrato no toca el consumo
  de materia prima, solo el output de la producción.

## Objetivo

Añadir a las producciones completadas la posibilidad de registrar una
`cantidad_rechazada` (con motivo obligatorio cuando sea mayor que cero), de
forma que:
- `cantidad_producida` = cantidad que realmente pasa a stock disponible.
- `cantidad_rechazada` = cantidad fabricada pero descartada, con su motivo.
- La suma de ambas represente el total realmente ejecutado en esa tanda de
  producción (dato base para OEE).

## Antes de empezar: auditoría de esquema obligatoria

Lección de la propia Fase 06 (sección 6.3): revisa el código real antes de
asumir su comportamiento.

- Tablas `producciones_semielaborado` y `producciones_producto_final` —
  confirmar el nombre exacto de la columna de cantidad actual
  (`cantidad_producida` o equivalente) y si ya existe algún campo de cantidad
  planificada/objetivo con el que comparar el rechazo.
- Trigger/función que da de alta stock al completar una producción (el que
  inserta en `stock_lotes_semielaborado` / `stock_lotes_articulo` de producto
  final) — confirmar que usa la cantidad de producción para calcular cuánto
  stock nuevo generar; hay que asegurarse de que solo `cantidad_producida`
  (sin el rechazo) entra a stock disponible.
- Confirmar si existe ya alguna noción de "calidad" o "control de calidad"
  en el esquema (tabla, estado, o campo) que debiera integrarse en vez de
  duplicarse.
- Revisar `tandas_produccion` (mencionada como pendiente de UI en P2-1 del
  roadmap) — confirmar si el rechazo debe registrarse a nivel de tanda
  individual o a nivel de producción completa, ya que afecta a dónde vive la
  columna nueva.
- Vistas o cálculos existentes que sumen `cantidad_producida` para informes
  (ej. totales mensuales, comparativas) — confirmar que no haya que ajustar
  su interpretación ahora que "cantidad ejecutada" y "cantidad utilizable"
  dejan de ser lo mismo.

## Alcance

### 1. Migración SQL

Idempotente, con guarda tipo `if exists ... raise notice ... return` como en
el resto de la Fase 06.

- Añadir a `producciones_semielaborado` y `producciones_producto_final`:
  - Columna `cantidad_rechazada` (numérica, default `0`, `CHECK >= 0`).
  - Columna `motivo_rechazo` (texto, nullable), con `CHECK` que lo exija
    obligatorio cuando `cantidad_rechazada > 0`.
  - `CHECK` adicional: `cantidad_rechazada <= cantidad_producida_total`
    (el nombre exacto de la cantidad total ejecutada depende de lo que
    confirme la auditoría de esquema — puede requerir una columna nueva de
    "cantidad total ejecutada" si hoy `cantidad_producida` ya representa
    solo lo utilizable).
- Ajustar el trigger/función que da de alta stock al completar producción
  para que **solo** la cantidad utilizable (total ejecutado menos rechazo)
  entre a `stock_lotes_semielaborado` / stock de producto final. El material
  ya consumido de materia prima para la parte rechazada **no se revierte**
  (a diferencia de la cancelación en P0-1).
- Backfill: no aplica de forma retroactiva con datos reales (no hay forma de
  reconstruir qué parte de una producción histórica ya completada fue
  rechazo), pero conviene un script de verificación post-migración similar
  a los contratos anteriores.

### 2. Frontend

- Al completar una producción, permitir indicar `cantidad_rechazada`
  (opcional, default 0) y, si es mayor que cero, exigir `motivo_rechazo`
  antes de confirmar.
- Mostrar la merma en el historial/detalle de producción (cantidad
  utilizable vs. rechazada), distinguible visualmente.
- Si existen informes o dashboards con totales de producción, añadir el
  desglose (producido utilizable / rechazado) donde tenga sentido, sin
  necesidad de construir aún el cálculo completo de OEE (eso puede ser una
  iteración posterior una vez el dato base esté disponible).
- Revisar los locales de i18next (es/en/de) para los nuevos campos y
  mensajes.

### 3. Tests

Vitest + Testing Library, como en contratos anteriores.

- Test SQL: completar producción con `cantidad_rechazada > 0` sin motivo
  falla (constraint).
- Test SQL: completar producción con rechazo válido — solo la cantidad
  utilizable entra a stock, la rechazada no.
- Test SQL: `cantidad_rechazada` no puede superar el total ejecutado.
- Test de que una producción sin rechazo (caso normal, mayoritario) no
  sufre ninguna regresión respecto al comportamiento actual.
- Test de UI: el formulario de completar producción exige motivo cuando hay
  rechazo, y el historial muestra el desglose correctamente.

## Fuera de alcance (dejar para roadmap posterior)

- Cálculo completo de OEE (disponibilidad × rendimiento × calidad) — este
  contrato solo deja el dato base (`cantidad_rechazada`) disponible; el
  cálculo y visualización de OEE como métrica es un contrato aparte.
- Badge visual de caducidad en selección de lotes (P1-5).
- Unificación de `facturas_venta_con_saldo` con `estado_pago` (P1-6).
- UI de `tandas_produccion` (P2-1) — si la auditoría de esquema revela que
  el rechazo debería vivir a nivel de tanda en vez de a nivel de producción
  completa, valorar si conviene esperar a P2-1 o implementar aquí a nivel de
  producción y migrar más adelante.

## Criterios de aceptación

- Una producción completada con parte de merma permite registrar
  `cantidad_rechazada` y `motivo_rechazo`, y ambos quedan persistidos.
- Solo la cantidad utilizable entra a stock disponible; la rechazada no.
- No es posible registrar rechazo sin motivo.
- Una producción sin rechazo (el caso normal) se comporta exactamente igual
  que hoy, sin ninguna regresión.
- El consumo de materia prima de la parte rechazada no se revierte (se gastó
  material real).
- Tests pasan en CI.

## Nota de calidad

Antes de escribir SQL largo con patrones repetitivos, ten especial cuidado con
errores de tokenización (multiplicaciones sin `*`, variables con espacios,
palabras clave rotas) — fueron el problema más recurrente en la Fase 06.
Prueba primero en una transacción `BEGIN...ROLLBACK` contra datos reales en el
SQL Editor del Dashboard, simulando el rol `authenticated` real (no el
superusuario), antes de aplicar en firme.
