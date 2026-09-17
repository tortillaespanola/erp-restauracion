# CONTRATO_UI_INCIDENCIAS_STOCK.md

**Estado:** BORRADOR — PENDIENTE DE REVISIÓN
**Prioridad:** P1 (Alto impacto, bajo esfuerzo)
**Fecha estimada de ejecución:** Fase A2
**Responsable:** Claude Code (bajo supervisión de revisión humana)
**Dependencias:** Ninguna bloqueante para la Parte A. La Parte B depende de la existencia confirmada de `AjusteStockForm.jsx` y las tablas `ajustes_producto_final`/`ajustes_semielaborado`.

---

## 0. Alcance real (revisado tras inspección del código)

Una revisión directa del repositorio (no solo de la auditoría) reveló que **el mecanismo de rechazo post-cierre ya existe**: `AjusteStockForm.jsx` + las tablas `ajustes_producto_final`/`ajustes_semielaborado`, accesible hoy desde la pantalla de Inventario. Esto invalida el diseño original de este contrato (que proponía crear una tabla `incidencias_stock` nueva con `produccion_origen_id`/`origen_rechazo` y una RPC nueva) — habría duplicado un mecanismo de movimiento de stock ya funcional, algo que el propio contrato pedía evitar explícitamente.

Este contrato se divide ahora en dos partes de naturaleza distinta:

- **Parte A — Pantalla de Incidencias (hueco real):** no existe ninguna pantalla que liste/filtre las incidencias que ya se registran en las tablas existentes. Esto sigue siendo necesario y es la prioridad de este contrato.
- **Parte B — Accesibilidad del flujo de rechazo post-cierre (mejora de UX, no de mecanismo):** el mecanismo ya existe y es correcto a nivel de datos, pero está colocado bajo "Ajustes de stock" en Inventario — un lugar pensado para ajustar artículos base, no el punto donde de forma natural se declara un rechazo de producción o de cliente en el día a día. Se añaden accesos directos desde las pantallas donde el usuario realmente detecta o gestiona el rechazo, sin tocar el mecanismo de base de datos subyacente.

---

## 1. Objetivo

**Parte A:** Construir una pantalla que permita revisar, filtrar y gestionar en bloque las incidencias de stock que el sistema ya registra en base de datos, hoy sin ningún punto de acceso en la interfaz.

**Parte B:** Hacer que el flujo ya existente de ajuste/rechazo post-cierre (`AjusteStockForm`) sea accesible desde los puntos donde el usuario naturalmente detecta el problema — Producciones / Producción de Productos Finales, y Albaranes de Entrega cuando el rechazo lo comunica el cliente — en lugar de obligar a navegar hasta Inventario > Ajustes de stock.

---

## 2. Contexto / Estado actual

- El registro de incidencias/ajustes de stock ya se persiste correctamente en base de datos con `user_id` y motivo, mediante `AjusteStockForm.jsx` y sus tablas asociadas.
- Ajustar artículos base desde Inventario es el flujo natural y correcto — **eso no cambia**.
- Para semielaborados y productos finales, "Ajustes de stock" también es funcionalmente correcto, pero en el uso diario real el rechazo se detecta en otro contexto: al cerrar/revisar una producción, o al procesar un albarán de entrega donde el cliente reporta un defecto. Obligar a saltar a Inventario para declararlo rompe el flujo natural de trabajo y es la razón original por la que "no se podía dar de alta scrap" tras el cierre — el mecanismo existe, pero no es descubrible desde donde se necesita.
- No existe ninguna pantalla en el frontend para consultar, filtrar o revisar en conjunto las incidencias ya registradas — los datos son invisibles para el usuario salvo consulta directa a la BD.

**⚠️ Nota para Claude Code antes de ejecutar:** confirmar los nombres exactos de las tablas de incidencias existentes (se mencionan 4 en la auditoría de código) y el contrato de props/uso actual de `AjusteStockForm.jsx` antes de tocar nada. Este documento no debe usarse como fuente de verdad del esquema — solo como guía de alcance.

---

## 3. Alcance EXACTO

### ✅ QUÉ SE TOCA (IN SCOPE)

**Parte A — Pantalla de Incidencias**

1. Nueva ruta/pantalla `Incidencias` (ej. `/incidencias`) accesible desde el menú principal.
2. Tabla con filas expandibles/drawer lateral, siguiendo el patrón Fiori-like ya adoptado en el resto de FlowBase (paginación y filtros server-side).
3. Listar de forma unificada (o en tabs, a decidir en el Paso 4.1) las 4 tablas de incidencias/ajustes existentes.
4. Filtros: rango de fechas, tipo de incidencia, artículo, usuario que la registró.
5. Vista de detalle por incidencia (drawer): artículo, lote (si aplica), cantidad, motivo, usuario, fecha.
6. Acción de "marcar como revisada" si las tablas existentes soportan un estado de revisión; si no, añadirlo vía migración aditiva simple.
7. Selección múltiple para marcar varias incidencias como revisadas en bloque.
8. Respeto de RLS/multi-tenant existente (ya confirmado como funcional).

**Parte B — Accesos directos al flujo de rechazo existente**

9. Añadir un desglose explícito de **origen del rechazo** (cliente / inspección de calidad / producción aguas abajo / otro) al `AjusteStockForm` existente, cuando se usa sobre semielaborado o producto final — como campo nuevo, no como mecanismo nuevo.
10. Botón/acceso directo a `AjusteStockForm` (pre-rellenado con el lote/producción relevante) desde:
    - La pantalla de Producciones / Producción de Productos Finales, sobre una producción ya cerrada.
    - La pantalla de Albaranes de Entrega, sobre una línea de albarán ya entregada, cuando el cliente reporta un rechazo.
11. Cualquier alta realizada desde estos accesos directos debe aparecer inmediatamente en la pantalla de Incidencias de la Parte A.

### ❌ QUÉ NO SE TOCA (OUT OF SCOPE)

- **Crear una tabla de incidencias nueva, columnas `produccion_origen_id`/`origen_rechazo` en una tabla nueva, o una RPC nueva de alta de rechazo** — descartado explícitamente; se reutiliza `AjusteStockForm` y sus tablas existentes.
- Lógica de generación de incidencias ya existente (cómo y cuándo se crean hoy) — no se modifica.
- Edición o reapertura de producciones ya cerradas — sigue descartado como solución; el rechazo sigue siendo un evento nuevo, nunca una mutación retroactiva.
- El flujo de ajuste de artículos base desde Inventario — permanece exactamente igual.
- Flujo de "Cierre de Tanda" ni `tandas_produccion` (contrato separado).
- Cálculo de necesidades/MRP.
- Notificaciones o alertas automáticas sobre nuevas incidencias.

---

## 4. Pasos técnicos concretos

### Paso 4.1: Inventario de las 4 tablas de incidencias existentes

Confirmar nombres, columnas y si ya tienen o no un estado de revisión. Decidir si la pantalla de Incidencias las unifica en una vista con columna `tipo`/`origen` o usa tabs por tabla.

### Paso 4.2: Migración opcional — estado de revisión

Solo si ninguna de las 4 tablas ya lo tiene:

```sql
ALTER TABLE <tabla_incidencia>
  ADD COLUMN IF NOT EXISTS revisada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisada_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS revisada_en timestamptz;
```

### Paso 4.3: Vista/función de consulta paginada

Vista o función RPC que unifique (con `UNION ALL` si son tablas separadas) las 4 fuentes con joins ya resueltos a artículo/lote/usuario, para evitar N+1 queries desde el frontend. Ajustar nombres reales según el Paso 4.1.

### Paso 4.4: Componente de pantalla de Incidencias (frontend)

`IncidenciasStock.jsx`, patrón tabla+drawer+paginación server-side ya usado en el resto de FlowBase. Filtros como querystring controlado. Acción "marcar revisada(s)" vía RPC o `UPDATE` respetando RLS.

### Paso 4.5: Campo de origen en `AjusteStockForm`

Revisar el componente y su tabla asociada (`ajustes_producto_final`/`ajustes_semielaborado`). Si no existe ya una columna de origen, añadirla de forma aditiva:

```sql
ALTER TABLE ajustes_producto_final
  ADD COLUMN IF NOT EXISTS origen_rechazo text
    CHECK (origen_rechazo IN ('cliente', 'inspeccion_calidad', 'produccion_aguas_abajo', 'otro'));
-- repetir en ajustes_semielaborado si aplica
```

Añadir el selector correspondiente en `AjusteStockForm.jsx`, visible solo cuando el ajuste es de tipo rechazo/scrap sobre semielaborado o producto final (no en artículos base, donde no aplica).

### Paso 4.6: Accesos directos desde Producciones / Producción Productos Finales

Botón "Declarar rechazo" en el detalle de una producción cerrada, que abre `AjusteStockForm` pre-rellenado con el `lote_id`/`articulo_id` de esa producción. Reutilizar el componente tal cual está — este paso es de navegación/props, no de lógica nueva.

### Paso 4.7: Acceso directo desde Albaranes de Entrega

Botón "Declarar rechazo de cliente" en una línea de albarán ya entregada, que abre `AjusteStockForm` pre-rellenado con `origen_rechazo = 'cliente'` y el lote/artículo de esa línea.

### Paso 4.8: i18n

Añadir las claves de traducción necesarias siguiendo la convención i18next ya en uso.

---

## 5. Criterios de aceptación verificables

1. La pantalla de Incidencias es accesible desde el menú, lista las 4 fuentes existentes y carga sin errores de consola.
2. Los filtros (fecha, tipo, artículo, usuario) reducen correctamente el conjunto de resultados, con paginación server-side funcional.
3. El drawer de detalle muestra todos los campos relevantes, incluido el nuevo `origen_rechazo` cuando aplica.
4. Marcar una o varias incidencias como revisadas persiste el cambio en BD y se refleja sin recargar.
5. Un usuario del Negocio A no ve incidencias del Negocio B.
6. Desde una producción cerrada, el botón "Declarar rechazo" abre `AjusteStockForm` con el lote/artículo correcto pre-rellenado, sin modificar ningún campo de la producción original.
7. Desde un albarán de entrega, el botón "Declarar rechazo de cliente" abre `AjusteStockForm` con `origen_rechazo = 'cliente'` preseleccionado.
8. Cualquier alta hecha desde estos accesos directos aparece inmediatamente en la pantalla de Incidencias de la Parte A.
9. El flujo de ajuste de artículos base desde Inventario sigue funcionando exactamente igual que antes.

---

## 6. Plan de testing

### 6.1 Testing de Base de Datos

Cualquier migración (Pasos 4.2 y 4.5) se prueba primero con `BEGIN...ROLLBACK` en staging.

### 6.2 Testing unitario (Vitest)

- Lógica de construcción de filtros/querystring de la pantalla de Incidencias.
- Lógica de pre-relleno de `AjusteStockForm` según el punto de entrada (producción vs. albarán).

### 6.3 Testing E2E (Playwright)

1. Login, navegar a Incidencias, aplicar filtros, abrir drawer, marcar como revisada.
2. Desde una producción cerrada de prueba, usar "Declarar rechazo", completar el formulario, confirmar.
3. Verificar en BD que la producción original no cambió ningún campo y que la incidencia aparece en la pantalla de Incidencias.
4. Repetir desde un albarán de entrega, verificando que `origen_rechazo = 'cliente'` queda preseleccionado.
5. Confirmar que el flujo clásico de ajuste de artículo base desde Inventario sigue funcionando sin cambios.

---

## 7. Riesgos y Rollback

### Riesgos identificados

- **Suposiciones sobre `AjusteStockForm` incorrectas:** este contrato asume que el componente acepta pre-relleno vía props/query params; si no es así, el Paso 4.6/4.7 requiere refactorizarlo primero. *Mitigación:* inspeccionar el componente antes de tocar las pantallas de origen.
- **Confusión de UX entre "Ajustes de stock" y "Declarar rechazo":** al ser el mismo formulario con distintos puntos de entrada, hay que asegurar que el usuario entienda que está en el mismo flujo. *Mitigación:* mantener el título/contexto del formulario coherente con el punto de entrada (ej. mostrar el lote/producción de origen ya cargado como contexto visible, no solo como valor oculto).
- **Volumen de datos en la pantalla de Incidencias:** paginación server-side obligatoria desde el primer commit si se unifican las 4 fuentes.

### Plan de Rollback

- Todas las columnas nuevas (`revisada`, `origen_rechazo`) son aditivas — revertibles con `DROP COLUMN` sin afectar datos existentes.
- Los accesos directos (botones en Producciones/Albaranes) son puramente de navegación — se pueden retirar sin tocar `AjusteStockForm` ni su lógica.
- La pantalla de Incidencias se puede retirar del menú sin efectos secundarios en el resto de la app.
