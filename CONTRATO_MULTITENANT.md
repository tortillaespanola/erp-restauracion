# CONTRATO_MULTITENANT.md

## Objetivo

Activar el aislamiento multi-negocio (multi-tenant) que ya existe estructuralmente en el
esquema (`negocio_id` en 42 tablas), pero que hoy no es funcional porque las políticas RLS
comparan contra un UUID fijo en vez de resolver dinámicamente el negocio del usuario
autenticado.

Al finalizar este contrato, dos negocios (p. ej. "Española/Company Valencia" y el negocio

**Patrón recurrente a vigilar en cualquier tarea futura de este contrato:** un `UNIQUE`
o `PRIMARY KEY` sobre un **código/texto elegido por el negocio** (`clave` en
`secuencias_lote`, el viejo `anio` en `facturas_venta_secuencia`, `codigo` en
`unidades_medida`) casi siempre necesita partirse a `(negocio_id, código)`. Un
`UNIQUE`/`PK` sobre un **ID numérico interno** (`articulo_id`, `proveedor_id`, etc.) casi
nunca lo necesita, porque esos IDs ya son globalmente únicos en todo el esquema. Antes
de dar por cerrada cualquier auditoría de este tipo, distinguir explícitamente ambas
categorías en vez de "corregir todo por igual".
demo de catering) deben poder convivir en la misma base de datos sin que ningún usuario
pueda ver, editar ni contar (secuencias, agregados) datos del negocio ajeno.

## Fuera de alcance (explícitamente, para esta fase)

- Facturación o planes de suscripción por negocio
- Roles/permisos distintos dentro de un mismo negocio (solo se resuelve *a qué negocio
  pertenece* el usuario, no *qué puede hacer dentro de él*)
- Migración de datos históricos de negocio (el negocio "Española" existente simplemente
  pasa a ser uno más, con su `negocio_id` actual)

## Estado de partida (verificado en vivo, no solo migraciones)

- `negocio_id` (uuid not null, FK a `negocios(id)`) presente en 42 de 44 tablas base
- Excepciones: `negocios` (no aplica) y `facturas_venta_secuencia` (contador global, sin
  partición — ver Tarea 4)
- 42 policies RLS ya incluyen `negocio_id = '<uuid fijo>'::uuid` además de
  `auth.role() = 'authenticated'`, pero el UUID es un literal grabado, no derivado de
  `auth.jwt()` ni `current_setting()`
- `empresa_config`: PK `id integer default 1`, una sola fila hoy, sin
  `UNIQUE(negocio_id)` que impida una segunda fila mal formada
- `negocios`: 1 fila. `auth.users`: 1 usuario. Sin selector de negocio en frontend.

---

## Tarea 1 — Mecanismo de resolución dinámica del negocio

**Qué hacer:** decidir y construir cómo un usuario autenticado queda vinculado a un
`negocio_id`, resoluble en cada request sin round-trip adicional costoso.

**Opciones a evaluar (elegir una, documentar por qué):**

1. **Custom claim en el JWT** (`app_metadata.negocio_id` en Supabase Auth) — resuelto en
   login/signup, disponible en cada request vía `auth.jwt() -> 'app_metadata' ->> 'negocio_id'`.
   Más rápido en runtime, requiere lógica en el hook de creación/login de usuario.
2. **Tabla de pertenencia `usuarios_negocios(usuario_id, negocio_id)`** — más flexible
   (permite un usuario en varios negocios en el futuro), pero cada policy necesita un
   subquery contra esa tabla.

**Criterio de aceptación:** dado un usuario autenticado, existe una función SQL
(`negocio_actual()` o equivalente) que devuelve su `negocio_id` sin parámetros, usable
dentro de cualquier policy.

**Riesgo si se omite/hace mal:** todo lo demás (Tarea 2) depende de que esta función sea
correcta y no falseable por el propio usuario.

---

## Tarea 2 — Reescribir las 42 policies RLS

**Qué hacer:** sustituir, en cada una de las 42 tablas, el literal
`negocio_id = '<uuid fijo>'::uuid` por `negocio_id = negocio_actual()` (o el equivalente
elegido en la Tarea 1).

**Orden sugerido:** empezar por 2-3 tablas de bajo riesgo (p. ej. `proveedores`,
`articulos_compra`) para validar el patrón, después generar el resto por script/plantilla
en vez de editar una a una a mano — con 42 tablas, hacerlo manual es la mayor fuente de
error humano de todo el contrato.

**Criterio de aceptación:** con dos usuarios de prueba en dos negocios distintos, cada uno
ve exclusivamente las filas de su propio negocio en las 42 tablas — verificado tabla por
tabla, no solo en las pantallas más usadas.

**Plan de pruebas:** ejecutar en `BEGIN...ROLLBACK`, con `SET LOCAL ROLE authenticated` +
el patrón correcto de simulación de JWT ya documentado en
`feedback_test_rls_authenticated.md` (evitar repetir el error ya conocido de que
`SET LOCAL ROLE` solo no simula auth real).

---

## Tarea 3 — `UNIQUE(negocio_id)` en `empresa_config`

**Qué hacer:** añadir la constraint que impide dos filas de configuración para el mismo
negocio. Evaluar si además conviene mover la PK de `id integer default 1` a `negocio_id`
directamente, dado que conceptualmente cada negocio tiene exactamente una fila de config.

**Criterio de aceptación:** un intento de insertar una segunda fila de `empresa_config`
para un `negocio_id` ya existente falla a nivel de base de datos, no solo por disciplina
del frontend.

---

## Tarea 4 — Particionar `facturas_venta_secuencia` por negocio

**Qué hacer:** añadir `negocio_id` a esta tabla y ajustar la función que genera el
siguiente número de factura para que la secuencia sea por negocio, no global.

**Riesgo concreto si se omite:** con dos negocios activos, sus facturas se numerarían
correlativamente compartiendo el mismo contador — un negocio "vería" saltos en su propia
numeración por culpa del otro. Contablemente inaceptable.

**Criterio de aceptación:** dos negocios generando facturas en paralelo obtienen cada uno
su propia secuencia correlativa (1, 2, 3... por negocio), sin huecos causados por el otro.

**Decisión de formato (no se conoce si los negocios serán fiscalmente independientes,
así que se previene desde ya):** el negocio A conserva su formato actual sin cambios
retroactivos (`RE-2026-001`...`017` no se renombran). A partir de esta tarea, el
generador de número de factura incluye un código corto de negocio (p. ej.
`negocios.codigo_corto`, a añadir) en el formato visible, de forma que dos facturas de
negocios distintos nunca puedan verse idénticas sobre el papel, independientemente de si
resultan ser la misma entidad fiscal o no. El negocio A puede mantenerse sin segmento
por continuidad histórica, o adoptar el nuevo formato hacia delante — a decidir al
diseñar la migración, pero nunca reescribiendo las 17 ya emitidas.

---

## Tarea 7 — `secuencias_lote` con el mismo problema que Tarea 4, mayor radio de impacto

**Hallazgo (detectado al investigar Tarea 4, fuera del alcance original):**
`secuencias_lote` (la tabla detrás de `generar_codigo()`, usada para `OV-`, `OC-`,
códigos de lote de producción, etc.) tiene `PRIMARY KEY (clave)` global, no
`(negocio_id, clave)` — el mismo problema estructural que motivó la Tarea 4, pero
afectando a pedidos de venta, pedidos de compra y trazabilidad de lotes FIFO, no solo a
facturas.

**Riesgo concreto:** sin corregir, el día que el negocio demo empiece a generar sus
propios pedidos/lotes, competiría literalmente por los mismos códigos correlativos que
el negocio A — colisión de numeración desde el primer día del segundo negocio.

**Prioridad:** alta — probablemente antes que la Tarea 5 (selector de frontend), porque
esta sí bloquea de forma silenciosa y con daño creciente en cuanto exista actividad real
en el negocio demo, mientras que la Tarea 5 solo afecta la comodidad de acceso.

**Qué hacer:** mismo patrón que Tarea 4 — clave compuesta `(negocio_id, clave)`,
backfill del negocio A explícito, `negocio_actual()` en la función generadora, y la
misma decisión de formato visible que en Tarea 4 (evaluar si `OV-`/`OC-`/códigos de lote
necesitan también un segmento identificador de negocio).

---

## Tarea 5 — Selector/login de negocio en el frontend

**Qué hacer:** UI mínima para que, tras login, el usuario quede en el contexto de su
negocio (si un usuario solo pertenece a uno, puede ser automático y transparente; si se
optó por la tabla de pertenencia de la Tarea 1 y en el futuro un usuario tiene varios
negocios, añadir selector explícito).

**Criterio de aceptación:** no hay ninguna pantalla del ERP alcanzable sin que el contexto
de negocio esté resuelto primero.

---

## Tarea 6 — `DEFAULT` fijo en `negocio_id` (escritura, no solo lectura)

**Hallazgo (detectado al probar la Tarea 2/denormalización, fuera del alcance original):**
las 42 tablas tienen `negocio_id` con `DEFAULT '<uuid fijo>'::uuid`, no
`DEFAULT negocio_actual()`. La Tarea 2 arregla quién puede *leer* qué (RLS/SELECT), pero
no toca qué negocio recibe un `INSERT` que no fije `negocio_id` explícitamente — que es
la mayoría del código del frontend hoy.

**Riesgo concreto:** con un segundo negocio activo, cualquier `INSERT` sin `negocio_id`
explícito seguirá cayendo silenciosamente en el negocio original, sin importar qué
usuario lo ejecute. Un usuario del negocio demo podría crear un pedido que termine
asignado al negocio de Española sin ningún error visible.

**Qué hacer:** una vez exista `negocio_actual()` (Tarea 1), cambiar el `DEFAULT` de las
42 columnas a `DEFAULT negocio_actual()`.

**Criterio de aceptación:** un `INSERT` desde un usuario del negocio B, sin especificar
`negocio_id`, queda correctamente asignado al negocio B — verificado tabla por tabla,
no solo en las más usadas por el frontend.

**Orden respecto a las demás tareas:** depende de la Tarea 1 (necesita `negocio_actual()`
ya funcionando) y debería ir en paralelo o justo después de la Tarea 2, antes de dar por
cerrado el contrato — no es opcional ni de "fase futura".

**Regla operativa derivada (documentar, no una tarea en sí):** a partir de que el
`DEFAULT` dependa de `negocio_actual()`, cualquier migración o script de seed que inserte
en estas 42 tablas sin especificar `negocio_id` explícito fallará, porque esas
migraciones corren como superusuario/sin JWT y `auth.uid()` es `NULL` en ese contexto.
Es el comportamiento correcto ("fallar ruidoso, nunca silencioso"), pero implica que
toda migración/seed futura debe pasar `negocio_id` a mano — incluido el futuro script
de población de la empresa demo de catering.

---

## Plan de verificación final (antes de tocar producción)

1. Crear 2 usuarios de prueba, cada uno vinculado a un negocio distinto
2. Para cada una de las 42 tablas, confirmar aislamiento cruzado (usuario A no ve/edita/
   cuenta filas del negocio B) — idealmente con un script de verificación reutilizable,
   no solo clics manuales
3. Confirmar numeración de facturas independiente entre ambos negocios
4. Confirmar que `empresa_config` rechaza una segunda fila mal formada
5. Solo tras (1)-(4) verificados en la copia/rama de pruebas: aplicar a producción y dar
   de alta el negocio demo de catering como segundo negocio real

## Rollback

Cada cambio de policy debe poder revertirse individualmente (guardar el `CREATE POLICY`
original de las 42 antes de tocarlas). Si algo falla en producción tras aplicar, el
camino de vuelta es restaurar las policies originales con el UUID fijo — el sistema vuelve
a comportarse como single-tenant funcional mientras se investiga el fallo.
