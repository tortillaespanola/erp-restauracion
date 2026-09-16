# CONTRATO: Gestión Real de Stock Negativo / Incidencias (P0-2 del Roadmap Fase 06)

## Contexto

La simulación de 6 meses (`FASE06_SIMULACION_RESUMEN.md`, sección 5.4) detectó
que el trigger `registrar_incidencia_stock_negativo_consumo()` no funciona como
se esperaba: el trigger `check_consumo_produccion()` bloquea con
`RAISE EXCEPTION` **antes** de que se pueda crear ninguna incidencia. Como
resultado, hoy no existe stock negativo en el sistema ni un registro automático
de cuándo se intentó forzarlo.

**Evidencia real:** Mes 3 — 0 incidencias generadas a pesar de intentos
deliberados de consumir más material del disponible.

**Mecanismo que sí funciona hoy (no tocar), para referencia:**
`registrar_incidencia_caducidad_consumo()` genera filas correctamente al
consumir material caducado (Mes 4, Mes 6). El patrón de esa función es el
modelo a seguir para la nueva lógica de stock negativo.

**Referencia de mercado:** Odoo permite stock negativo por defecto en todo el
sistema (con módulos opcionales para restringirlo por producto/categoría/
ubicación). ERPNext hace lo contrario: bloquea por defecto y permite activar
negativo de forma granular (global, por ítem, e incluso por lote). Ambos
convergen en que la decisión debe ser **configurable a nivel de artículo**, no
un interruptor global — y ambos advierten del mismo riesgo: negativo en un
nivel que alimenta cálculos de coste/valoración genera datos poco fiables.

## Objetivo

Permitir stock negativo **de forma selectiva y solo en materias primas /
artículos comprados**, marcados explícitamente mediante un flag por artículo,
generando una incidencia automática cuando ocurre. El resto del sistema —
semielaborados y producto final, cuyo stock representa trabajo de
transformación ya ejecutado y no una promesa de proveedor pendiente de
cumplir — **sigue bloqueando exactamente igual que hoy, sin excepción**.

Esta distinción es la premisa de diseño de todo el contrato:

- **Materia prima / artículo comprado** (lo que entra por
  `albaranes_compra` → `entrada_material`): el déficit se puede regularizar
  con una compra futura. Aquí SÍ tiene sentido permitir negativo, artículo a
  artículo (ej. tornillería sí, roble no).
- **Semielaborado / producto final** (lo que sale de
  `producciones_semielaborado` / `producciones_producto_final`): el déficit
  no tiene ese respaldo — no se puede consumir una unidad que nunca se
  produjo sin romper la trazabilidad multinivel que la propia Fase 06 validó
  como funcionando correctamente (sección 4, punto 6). Aquí el bloqueo se
  mantiene **sin flag, sin excepción**.

## Antes de empezar: auditoría de esquema obligatoria

Lección de la propia Fase 06 (sección 6.3): revisa el código real de estos
triggers/funciones antes de asumir su comportamiento, y confirma el orden de
ejecución de triggers sobre la(s) misma(s) tabla(s).

- `check_consumo_produccion()` — confirmar sobre qué tabla(s) dispara, si
  distingue actualmente el tipo de artículo consumido (materia prima vs.
  semielaborado), y el orden de ejecución respecto a
  `registrar_incidencia_stock_negativo_consumo()`.
- `check_stock_producto_final()` — confirmar que gestiona exclusivamente
  distribución de producto final (no materia prima) y que su bloqueo
  incondicional queda intacto tras este contrato.
- `registrar_incidencia_stock_negativo_consumo()` — revisar su lógica actual,
  aunque no se dispare hoy; es la base sobre la que construir.
- `registrar_incidencia_caducidad_consumo()` — usar como referencia de patrón
  ya validado (misma tabla `incidencias_stock_articulo`, causa distinta).
- Tabla `ingredientes` (Article Base) y la tabla concreta de artículos
  comprables vinculada vía `articulo_ingrediente` — confirmar dónde vive hoy
  la distinción "es materia prima comprada" vs. "es semielaborado/producto
  final", para saber en qué tabla añadir el flag.
- Tabla `incidencias_stock_articulo` — estructura, estados válidos
  (`pendiente`, `pendiente_de_regularizar`, `cerrada`, etc.), y si ya
  contempla un tipo/causa de incidencia distinguible.
- Vistas `stock_lotes_articulo` / `stock_lotes_semielaborado` — confirmar si
  asumen en algún punto que el stock nunca es negativo (cálculos,
  agregaciones, `where cantidad > 0`, etc.). Solo `stock_lotes_articulo`
  debería verse afectado por este contrato; `stock_lotes_semielaborado` no
  debería cambiar de comportamiento en absoluto.

## Alcance

### 1. Migración SQL

Idempotente, con guarda tipo `if exists ... raise notice ... return` como en
el resto de la Fase 06.

- Añadir columna `permite_stock_negativo` (boolean, default `false`) en la
  tabla de artículos comprables (materia prima). Default `false` para que
  ningún artículo existente cambie de comportamiento sin decisión explícita.
- Modificar `check_consumo_produccion()` para que, **solo cuando el consumo
  es de materia prima** (no de semielaborado):
  - si `permite_stock_negativo = false` en el artículo → mantiene el
    `RAISE EXCEPTION` actual (comportamiento sin cambios).
  - si `permite_stock_negativo = true` → permite el consumo, deja el stock en
    negativo, y delega en `registrar_incidencia_stock_negativo_consumo()`.
- **No tocar** el bloqueo cuando el consumo es de semielaborado como input de
  otro nivel de producción: sigue siendo `RAISE EXCEPTION` incondicional,
  igual que hoy.
- **No tocar** `check_stock_producto_final()`: sigue bloqueando de forma
  incondicional, sin flag ni excepción.
- Ajustar `registrar_incidencia_stock_negativo_consumo()` para que:
  - se dispare de forma efectiva cuando corresponda (no anulada por el otro
    trigger),
  - registre artículo, lote, pedido/producción de origen y cantidad de
    déficit,
  - use un tipo de incidencia distinguible del de caducidad, con estado
    `pendiente_de_regularizar`.
- Revisar y, si hace falta, ajustar `stock_lotes_articulo` para que siga
  siendo correcta con cantidades negativas en los artículos marcados.
  `stock_lotes_semielaborado` no debería requerir ningún cambio.
- No aplica backfill retroactivo (no hay stock negativo histórico que
  corregir), pero sí un script de verificación post-migración que confirme
  que un consumo de prueba sobre un artículo marcado genera la incidencia
  esperada, y que un artículo sin marcar sigue bloqueando igual que antes.

### 2. Frontend

- Nuevo campo/checkbox `permite_stock_negativo` en el formulario de edición
  de artículo (materia prima), visible solo ahí — no en semielaborados ni
  producto final.
- Indicador visual de stock negativo en la ficha de artículo/lote cuando
  aplica (ej. badge rojo o valor en rojo).
- Mostrar las nuevas incidencias de stock negativo en el módulo de
  Incidencias (ya existente para caducidad), distinguibles por tipo/causa.
- Revisar los locales de i18next (es/en/de) para el nuevo campo y los nuevos
  mensajes/labels.

### 3. Tests

Vitest + Testing Library, como en contratos anteriores.

- Test SQL: artículo con `permite_stock_negativo = true` → consumo que
  excede stock genera la incidencia correcta (cantidad, tipo, estado) y el
  stock queda en negativo.
- Test SQL: artículo con `permite_stock_negativo = false` (o sin marcar) →
  sigue bloqueando con `RAISE EXCEPTION`, sin regresión sobre el
  comportamiento actual.
- Test SQL: consumo de semielaborado como input de otro nivel sigue
  bloqueando siempre, sin flag posible — verificar que el flag ni siquiera es
  consultable/aplicable en esa ruta.
- Test de que la caducidad (`registrar_incidencia_caducidad_consumo`) sigue
  funcionando sin regresión.
- Test de UI: checkbox en formulario de artículo, badge de stock negativo, y
  nueva incidencia visible en el listado correspondiente.

## Fuera de alcance (dejar para roadmap posterior)

- Auditoría de cancelaciones de producción con motivo (P0-1)
- `cantidad_rechazada` / `motivo_rechazo` (P1-4)
- Badge visual de caducidad en selección de lotes (P1-5)
- Flag equivalente a nivel de categoría/familia de artículos (granularidad
  adicional tipo Odoo/ERPNext) — valorar en una iteración posterior si el
  volumen de artículos hace tedioso marcarlos uno a uno.

## Criterios de aceptación

- Un artículo de materia prima marcado con `permite_stock_negativo = true`
  puede consumirse por encima de su stock disponible, queda en negativo, y
  genera una incidencia real y consultable en `incidencias_stock_articulo`.
- Un artículo de materia prima sin marcar sigue bloqueando el consumo
  exactamente igual que hoy, sin cambios de comportamiento.
- Ningún semielaborado ni producto final puede quedar en stock negativo bajo
  ninguna circunstancia — el bloqueo se mantiene incondicional.
- La caducidad sigue funcionando exactamente igual que antes (sin regresión).
- Las vistas de stock siguen devolviendo datos correctos en todos los
  escenarios existentes de la demo AlpenWerk y de Española/Company Valencia.
- Tests pasan en CI.

## Nota de calidad

Antes de escribir SQL largo con patrones repetitivos, ten especial cuidado con
errores de tokenización (multiplicaciones sin `*`, variables con espacios,
palabras clave rotas) — fueron el problema más recurrente en la Fase 06.
Prueba primero en una transacción `BEGIN...ROLLBACK` contra datos reales en el
SQL Editor del Dashboard antes de aplicar en firme, como se hizo con el
contrato de estado "parcial".
