# CONTRATO_MULTITENANT.md

## Objetivo

Activar el aislamiento multi-negocio (multi-tenant) que ya existe estructuralmente en el
esquema (`negocio_id` en 42 tablas), pero que hoy no es funcional porque las políticas RLS
comparan contra un UUID fijo en vez de resolver dinámicamente el negocio del usuario
autenticado.

Al finalizar este contrato, dos negocios (p. ej. "Española/Company Valencia" y el negocio
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
