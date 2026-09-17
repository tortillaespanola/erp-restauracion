# CONTRATO_RLS_MULTITENANT_CIERRE.md

**Estado:** ✅ COMPLETADO Y VERIFICADO
**Fecha de auditoría:** 17 de septiembre de 2026
**Veredicto:** El sistema ya cumple con los requisitos de aislamiento multi-tenant. No se requiere ejecución de migraciones.

---

## 1. Hallazgos de la Auditoría (Evidencia)

Tras ejecutar el script de introspección `audit_rls_multitenant.sql` en la base de datos de producción/staging, se confirma que la arquitectura multi-tenant ya está implementada y funcional:

1. **Resolución de contexto**: Existe la función `public.negocio_actual()` que resuelve el contexto mediante un `JOIN` con la tabla `usuarios_negocios` (no mediante claims de JWT). Este diseño es superior, ya que soporta usuarios en múltiples negocios y falla de forma ruidosa (`RAISE EXCEPTION`) si no hay mapping, evitando fugas de datos silenciosas.
2. **Aislamiento RLS**: Las ~42 tablas con `negocio_id` ya tienen políticas RLS activas que utilizan `negocio_actual()`. No se encontraron UUIDs hardcodeados en políticas, funciones, triggers ni vistas.
3. **Defaults seguros**: Las columnas `negocio_id` ya tienen `DEFAULT public.negocio_actual()`, garantizando que los `INSERT` desde el frontend (que no envían el ID explícitamente) se asignen correctamente.
4. **Secuencias particionadas**: Las tablas `facturas_venta_secuencia` y `secuencias_lote` ya poseen restricciones `UNIQUE` / `PRIMARY KEY` compuestas por `(negocio_id, anio)` y `(negocio_id, clave)` respectivamente. Las funciones generadoras (`generar_codigo`, `trg_generar_numero_factura_venta`) ya utilizan `ON CONFLICT` contra estas claves.
5. **Datos reales**: Existen 3 negocios activos y 3 usuarios correctamente mapeados en `usuarios_negocios`. La tabla `empresa_config` contiene 4 filas (una por negocio), lo cual es el comportamiento esperado y correcto.

---

## 2. Decisión

**NO EJECUTAR** el borrador original de `CONTRATO_RLS_MULTITENANT.md`. Hacerlo sobrescribiría la función `negocio_actual()` con una versión basada en JWT que devolvería `NULL` para los usuarios actuales, rompiendo el acceso a la aplicación inmediatamente.

---

## 3. Deuda Técnica Menor Detectada (Opcional)

Durante la auditoría se detectó una fila huérfana/duplicada en la tabla `negocios`:

- ID: `e2f1933d-...` (nombre: "AlpenWerk Möbel GmbH", `codigo_corto` = NULL, sin usuarios asociados).
- ID Real: `82d2c14e-...` (nombre: "AlpenWerk Möbel GmbH", `codigo_corto` = 'ALP', con usuarios asociados).

**Acción recomendada**: Eliminar la fila huérfana (`e2f1933d-...`) en un mantenimiento programado, ya que no tiene dependencias (no hay usuarios ni datos transaccionales vinculados a ella).

---

## 4. Siguiente Paso en el Roadmap

Con el aislamiento multi-tenant confirmado como **Nivel 5 (Maduro)**, el siguiente bloqueador crítico identificado en la auditoría es la **Fase A3: MRP Ligero (Explosión de Demanda)**. Actualmente, el cálculo de materia prima necesaria a partir de múltiples pedidos se realiza manualmente fuera del sistema.

Se procederá a redactar `CONTRATO_MRP_LIGERO_DEMANDA.md`.
