# CONTRATO_RLS_MULTITENANT.md

**Estado:** PENDIENTE DE EJECUCIÓN
**Prioridad:** P0 (Bloqueante para SaaS)
**Fecha estimada de ejecución:** Fase A1 (Mes 1)
**Responsable:** Claude Code (bajo supervisión de revisión humana)

---

## 1. Objetivo

Activar el aislamiento real multi-tenancy reemplazando los UUIDs fijos hardcodeados por una resolución dinámica de `negocio_id` en las políticas RLS, los valores por defecto (DEFAULT) de las columnas y las secuencias globales de numeración.

---

## 2. Contexto / Estado actual

Según la auditoría técnica de FlowBase:

- Existen ~42 tablas con la columna `negocio_id uuid NOT NULL`.
- Las políticas de Row Level Security (RLS) actuales contienen literales hardcodeados del tipo `negocio_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid`, lo que impide que nuevos negocios accedan a sus propios datos o que un usuario pueda cambiar de contexto.
- Las tablas `facturas_venta_secuencia` y `secuencias_lote` tienen claves primarias o restricciones UNIQUE globales, lo que provocará colisiones de numeración en cuanto se registre el segundo negocio.
- Las columnas `negocio_id` tienen un `DEFAULT` hardcodeado, por lo que cualquier `INSERT` que no especifique explícitamente el negocio asignará los datos al negocio original por error.

---

## 3. Alcance EXACTO

### ✅ QUÉ SE TOCA (IN SCOPE)

1. Creación de la función SQL `public.negocio_actual()` para resolver el `negocio_id` dinámicamente desde el JWT de Supabase.
2. Actualización de las políticas RLS de las ~42 tablas para usar `negocio_id = public.negocio_actual()`.
3. Actualización de las restricciones `DEFAULT` de las columnas `negocio_id` en las ~42 tablas para usar `DEFAULT public.negocio_actual()`.
4. Modificación del esquema de `facturas_venta_secuencia` para ser único por `(negocio_id, anio)`.
5. Modificación del esquema de `secuencias_lote` para ser único por `(negocio_id, clave)`.
6. Actualización de la función `generar_codigo()` (o equivalente) para que use `negocio_actual()` o reciba el `negocio_id` como parámetro.
7. Backfill de datos existentes para asegurar que el `negocio_id` de las secuencias coincida con el negocio propietario.

### ❌ QUÉ NO SE TOCA (OUT OF SCOPE)

- Lógica de negocio de las funciones de generación de códigos (solo se modifica el alcance del `UNIQUE`/`PK`, no la lógica de construcción del string).
- Interfaz de usuario (UI) para cambio de negocio (se manejará en un contrato de frontend posterior).
- Fusión o refactorización de tablas de catálogo.
- Tablas estrictamente globales por diseño que no estén en la lista de las 42 tablas transaccionales/configuración.

---

## 4. Pasos técnicos concretos

### Paso 4.1: Función de resolución dinámica (`negocio_actual`)

Crear o reemplazar la función en el esquema `public`:

```sql
CREATE OR REPLACE FUNCTION public.negocio_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'negocio_id', '')::uuid,
      NULLIF(current_setting('request.jwt.claims', true)::json->>'negocio_id', '')::uuid
    )
$$;
```

### Paso 4.2: Actualización de DEFAULTs en columnas `negocio_id`

Aplicar este patrón a las ~42 tablas identificadas (ej. `pedidos_venta`, `pedidos_compra`, `empresa_config`, etc.):

```sql
ALTER TABLE pedidos_venta
  ALTER COLUMN negocio_id DROP DEFAULT,
  ALTER COLUMN negocio_id SET DEFAULT public.negocio_actual();
```

### Paso 4.3: Reescritura masiva de políticas RLS

Generar un script que dropee la política antigua y cree la nueva. Patrón a aplicar:

```sql
DROP POLICY IF EXISTS "Acceso temporal negocio fijo" ON public.pedidos_venta;

CREATE POLICY "Usuarios solo ven su propio negocio"
ON public.pedidos_venta
FOR ALL
USING (negocio_id = public.negocio_actual())
WITH CHECK (negocio_id = public.negocio_actual());
```

### Paso 4.4: Particionado de `facturas_venta_secuencia`

1. Añadir columna `negocio_id` a la tabla (si no existe).
2. Backfill con el `negocio_id` del negocio actual.
3. Cambiar la restricción:

   ```sql
   ALTER TABLE facturas_venta_secuencia
     DROP CONSTRAINT IF EXISTS facturas_venta_secuencia_pkey,
     ADD PRIMARY KEY (negocio_id, anio);
   ```

4. Asegurar que la función que incrementa la secuencia filtre por `WHERE negocio_id = public.negocio_actual()`.

### Paso 4.5: Particionado de `secuencias_lote` y función `generar_codigo`

1. Modificar la tabla:

   ```sql
   ALTER TABLE secuencias_lote
     DROP CONSTRAINT IF EXISTS secuencias_lote_pkey,
     ADD PRIMARY KEY (negocio_id, clave);
   ```

2. Backfill de la columna `negocio_id`.
3. Modificar la función `generar_codigo(clave text)` para que internamente use `v_negocio_id := public.negocio_actual();` en sus consultas UPSERT.

---

## 5. Criterios de aceptación verificables

1. **Aislamiento RLS:** Un usuario con `negocio_id = A` en su JWT no puede hacer `SELECT`, `UPDATE` ni `DELETE` sobre filas donde `negocio_id = B`.
2. **Defaults correctos:** Un `INSERT` sin especificar `negocio_id` inserta la fila con el `negocio_id` extraído del contexto de la sesión.
3. **Secuencias independientes:** Dos negocios pueden generar una factura en el mismo año obteniendo ambos su propio correlativo sin violar la restricción UNIQUE.
4. **Códigos de lote independientes:** Dos negocios pueden generar un código para la misma clave sin colisión.
5. **Cero errores de consola:** La aplicación frontend sigue funcionando para el negocio actual sin cambios en el código de la UI.

---

## 6. Plan de testing

### 6.1 Testing de Base de Datos (OBLIGATORIO: `BEGIN...ROLLBACK`)

Ejecutar este bloque en la base de datos real antes de aplicar en firme:

```sql
BEGIN;

-- 1. Simular rol y JWT de Negocio A
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"role": "authenticated", "app_metadata": {"negocio_id": "11111111-1111-1111-1111-111111111111"}}';

-- 2. Verificar que negocio_actual() funciona
SELECT public.negocio_actual(); -- Debe devolver 1111...

-- 3. Verificar DEFAULT en INSERT
INSERT INTO pedidos_venta (cliente_id, estado) VALUES ('test-client', 'pendiente') RETURNING negocio_id;

-- 4. Simular rol de Negocio B e intentar leer datos de A
SET LOCAL "request.jwt.claims" TO '{"role": "authenticated", "app_metadata": {"negocio_id": "22222222-2222-2222-2222-222222222222"}}';
SELECT count(*) FROM pedidos_venta; -- Debe ser 0

ROLLBACK;
```

### 6.2 Testing E2E (Playwright)

1. Simular login de un usuario.
2. Crear un registro (ej. un Pedido).
3. Verificar en la base de datos que el registro tiene el `negocio_id` correcto y no el UUID hardcodeado antiguo.

---

## 7. Riesgos y Rollback

### Riesgos identificados

- **Bloqueo de la aplicación:** Si `negocio_actual()` devuelve `NULL` (ej. el JWT no tiene el claim), las consultas RLS devolverán 0 filas y los `INSERT`s fallarán.
  - *Mitigación:* Asegurar que el sistema de Auth actualice los metadatos antes de desplegar este contrato.
- **Pérdida de datos en backfill:** Si el script de backfill para secuencias se ejecuta sin el `negocio_id` correcto.
  - *Mitigación:* El backfill debe hacerse explícitamente con el UUID del negocio único que existe actualmente en producción.

### Plan de Rollback

Si la verificación falla, ejecutar el script de reversión que:

1. Restaure los `DEFAULT` de `negocio_id` al UUID hardcodeado original.
2. Dropee las nuevas políticas RLS y restaure las antiguas (se debe guardar un dump de las políticas antiguas antes de empezar).
3. Revierta los cambios de PK en `facturas_venta_secuencia` y `secuencias_lote`.

---

## 8. Auditoría complementaria — Huecos detectados en revisión

Antes de ejecutar el contrato, correr estas queries de diagnóstico. Son de solo lectura y no requieren `BEGIN...ROLLBACK`.

### 8.1 Usuarios de `auth.users` y su `app_metadata`

**CRÍTICO:** si esto devuelve 0 filas con `negocio_id` en `app_metadata`, el contrato **no puede desplegarse tal cual** — hay que añadir un paso previo de "inyección del claim en los usuarios existentes".

```sql
SELECT
    id,
    email,
    created_at,
    raw_app_meta_data,
    raw_app_meta_data->'negocio_id' AS negocio_id_claim,
    raw_app_meta_data->>'negocio_id' AS negocio_id_text
FROM auth.users
ORDER BY created_at;
```

### 8.2 Estado actual de `empresa_config` (el negocio "original")

Necesario para el backfill de secuencias globales.

```sql
SELECT
    id,
    negocio_id,
    -- campos útiles para verificar que es el negocio correcto:
    nombre,
    created_at,
    updated_at
FROM empresa_config;
```

### 8.3 Funciones del schema `public` que contienen literales UUID

Busca patrones tipo `'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid` dentro del cuerpo de la función.

```sql
SELECT
    p.proname AS funcion,
    pg_get_functiondef(p.oid) AS definicion_completa
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')  -- funciones y procedimientos
  AND pg_get_functiondef(p.oid) ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
ORDER BY p.proname;
```

### 8.4 Triggers que podrían contener literales UUID en su función asociada

Redundante con 8.3 si esta ya cubre funciones de trigger, pero útil para ver qué tablas están afectadas de un vistazo.

```sql
SELECT
    t.tgname AS trigger_name,
    c.relname AS tabla,
    p.proname AS funcion,
    pg_get_functiondef(p.oid) ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' AS tiene_uuid_hardcodeado
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

### 8.5 Vistas que referencian `negocio_id`

Para detectar literales en su definición.

```sql
SELECT
    v.table_name AS vista,
    v.view_definition
FROM information_schema.views v
WHERE v.table_schema = 'public'
  AND v.view_definition ILIKE '%negocio_id%'
ORDER BY v.table_name;
```
