# CONTRATO_ESTADO_DESPACHO_REAL.md

## Objetivo

Corregir una confusión de nomenclatura en el Historial de producciones
cerradas de `ProduccionProductosFinales.jsx` y diseñar el indicador que hoy
falta: si una tanda de producción **ya se ha entregado de verdad** (albarán
real), no solo si está **asignada** a un pedido (previsión interna).

El flujo de negocio tiene tres pasos distintos, y hoy el código solo modela
dos de ellos con nombres que se pisan entre sí:

1. **Producido** — tanda cerrada en `producciones_producto_final`.
2. **Asignado** — repartido a una línea de pedido vía
   `previsiones_distribucion_pf`. **Esto es lo que el badge actual llamado
   "Estado de despacho" mide**, con el nombre equivocado.
3. **Despachado** — existe una línea de `lineas_albaran_venta` real que cubre
   esa tanda. **Esto no se mide en ningún sitio hoy.**

Este documento no implementa nada. Es la base para decidir el criterio
exacto antes de tocar código, en una sesión aparte.

---

## 1. Renombrar el indicador existente (Parte 1)

### 1.1 Qué cambia y qué no

Solo cambian los **textos** (claves i18n). No cambia:
- La función `estadoDespacho()` (`ProduccionProductosFinales.jsx:27-35`) —
  la lógica de umbrales (`EPS`, `0% / 0-100% / 100%`) es correcta, solo el
  nombre del concepto es incorrecto.
- `cargarHistorial()` (líneas 306-409) ni las tablas que consulta
  (`previsiones_distribucion_pf`, `ajustes_producto_final`).
- El nombre de la variable/función en el código (`estadoDespacho`,
  `despachoPorTanda`, prop `despachoInfo`) — **fuera de alcance** de este
  contrato; ver 1.3.

### 1.2 Claves i18n afectadas

Archivo: `frontend/src/i18n/{es,en,de}/estados_calculados.json`, objeto
`despacho` (es, líneas 18-22):

```json
"despacho": {
  "no_despachado": "No despachado",
  "despachado": "Despachado",
  "parcial": "Parcial — {{pct}}%"
}
```

**Búsqueda de otros usos**: hay que confirmar (durante la implementación,
con grep) que las claves `estados_calculados:despacho.*` no se usan en
ningún otro punto de la UI aparte de `ProduccionProductosFinales.jsx`. Si no
hay otros usos, el rename es seguro sin romper nada. Si apareciera algún
otro uso, se evalúa en ese momento si comparte el mismo significado
("asignado a pedido") o no.

### 1.3 Propuesta de nuevas claves

Mismo namespace y misma estructura, mismos 3 estados, para no tocar
`estadoDespacho()` ni el resto del pipeline — solo el texto:

```json
"asignacion": {
  "sin_asignar": "Sin asignar",
  "asignado": "Asignado",
  "parcial": "Asignado parcial — {{pct}}%"
}
```

Puntos a decidir juntos:
- **Nombre de la clave padre**: `asignacion` (propuesto) vs. mantener
  `despacho` y solo cambiar las 3 sub-claves. Recomendación: renombrar
  también la clave padre a `asignacion`, porque así queda sitio limpio para
  crear una clave `despacho` nueva en la Parte 2 sin ambigüedad ni
  necesidad de un nombre más largo tipo `despacho_real`.
- **Nombre de la columna en la tabla** (`ProduccionProductosFinales.jsx`,
  cabecera de columna junto a línea ~1141): pasar de "Estado de despacho" a
  "Estado de asignación".
- **Nombres internos de código** (`estadoDespacho`, `despachoPorTanda`,
  `despachoInfo`, `mapaDespacho`): recomendación de renombrarlos también a
  `estadoAsignacion`/`asignacionPorTanda`/`asignacionInfo` en la misma
  pasada, para que el código no diga una cosa y la UI otra — puro
  renombrado interno, sin cambio de lógica ni de columnas de BD.

---

## 2. Indicador nuevo: despacho real (Parte 2)

### 2.1 Hallazgo clave del modelo de datos

`lineas_albaran_venta` **tiene FK directa** a la tanda de producción:
columna `produccion_pf_id → producciones_producto_final(id)`, además de
`producto_final_id`, `linea_pedido_id` (opcional) y las variantes de
mercadería/texto libre. Esto ya existía antes de que se creara
`previsiones_distribucion_pf` (`supabase/migrations/20260801_pedidos_venta.sql:68-73`).

Es decir: **el vínculo con la producción es directo, no pasa
obligatoriamente por `previsiones_distribucion_pf`.**

Confirmado además que **crear una línea de albarán nunca exige pasar por
una previsión previa** (`frontend/src/components/AlbaranVentaForm.jsx`):
- En venta directa (sin pedido de origen) no hay previsión en absoluto.
- Incluso viniendo de un pedido con previsión, existe siempre una "fila
  manual" que permite elegir cualquier tanda con stock, no necesariamente
  la prevista.
- El propio comentario de diseño en
  `supabase/migrations/20260912_previsiones_distribucion_pf.sql:1-8` lo deja
  explícito: la previsión es "provisional... no es un compromiso real ni
  mueve stock — eso sigue pasando únicamente vía `lineas_albaran_venta`".

**Consecuencia para el diseño**: el indicador de despacho real debe leer
`lineas_albaran_venta` directamente por `produccion_pf_id`, **sin pasar por
`previsiones_distribucion_pf`** como intermediario ni como filtro. Usarla
como fuente daría falsos negativos en todos los despachos directos (que,
según el punto 2.1, son el caso normal y no la excepción).

`albaranes_venta` no tiene estado borrador/emitido/anulado — un albarán
existe (cuenta) o se ha borrado físicamente (con `ON DELETE CASCADE` sobre
sus líneas). No hace falta filtrar por estado del albarán.

### 2.2 Cálculo propuesto

Mismo patrón de 3 tramos que el badge actual, mismos umbrales (`EPS`),
pero con otra fuente:

```
SUM(lineas_albaran_venta.cantidad)
  WHERE produccion_pf_id IN (ids visibles)
  GROUP BY produccion_pf_id
```

```
real = SUM(lineas_albaran_venta.cantidad) para esa tanda
% = clamp(real / cantidad_producida * 100, 0, 100)
```

Badge (clave i18n nueva, `estados_calculados:despacho.*`, reutilizando el
namespace liberado en la Parte 1):
- `real ≈ 0` → gray → **"No despachado"**
- `0% < % < 100%` → amber → **"Despachado parcial — X%"**
- `% ≥ 100%` → green → **"Despachado"**

Esto es una consulta más simple que la actual (una sola tabla en vez de dos
con resta), porque `lineas_albaran_venta.cantidad` ya es la cantidad real
entregada — no hace falta el ajuste tipo `ajustes_producto_final` que existe
para compensar `previsiones_distribucion_pf` (esa resta modela un reparto
interno corregible; un albarán ya emitido no se "corrige", se borra y
rehace, y ese borrado ya resta solo con el `DELETE` físico de la línea).

### 2.3 Casos límite

- **Tanda sin ninguna asignación previa, pero con albarán directo** — sí es
  posible en el modelo actual (venta directa, o fila manual sobre pedido
  existente; ver 2.1). El indicador de despacho real lo captura
  correctamente porque no depende de que exista una fila en
  `previsiones_distribucion_pf`. El indicador de *asignación* (Parte 1)
  seguiría mostrando "Sin asignar" para esa misma tanda — **los dos badges
  pueden divergir legítimamente**, y eso es precisamente la información
  nueva que se quiere exponer (una tanda puede estar despachada sin haber
  pasado por el reparto interno).

- **Tanda asignada (Parte 1 en verde/ámbar) pero sin albarán todavía** —
  caso normal de negocio (pedido repartido a la tanda pero aún no
  entregado). Badge nuevo en gris "No despachado" mientras el de asignación
  ya muestra progreso. Es el caso que hoy el badge mal llamado "despacho"
  confunde: hoy dice "Parcial — X%" para esto, dando a entender que ya se
  entregó parte, cuando en realidad solo está reservado/repartido en papel.

- **Tanda con albarán parcial repartido entre varios pedidos y momentos
  distintos** — el `SUM(lineas_albaran_venta.cantidad)` agrega correctamente
  todas las líneas de albarán que apunten a esa `produccion_pf_id`,
  independientemente de a qué pedido/línea de pedido pertenezcan o de en
  cuántos albaranes distintos se hayan emitido. No hace falta desglosar por
  pedido para el cálculo del %, solo para el detalle expandible (ver 2.4).

- **Borrado de una línea de albarán** — al no depender de
  `previsiones_distribucion_pf`, el indicador de despacho real se recalcula
  solo, sin trigger: al desaparecer la fila de `lineas_albaran_venta`, el
  siguiente `SUM` ya la excluye. No hay estado derivado que resincronizar.

### 2.4 Contenido de la fila expandible (si se replica el patrón de 2.5 de `CONTRATO_MEJORAS_MES.md`)

Añadir un tercer bloque junto a "Repartido a pedidos" y "Ajustes de stock"
ya existentes: **"Despachado en albaranes"** — filas de
`lineas_albaran_venta` para esa tanda, con `albaran_venta_id`
(→ `numero_albaran`), `linea_pedido_id` si existe (→ pedido de origen, o
"venta directa" si es null) y cantidad. Pendiente de decidir si se
implementa en esta misma pasada o se deja para una iteración posterior —
no es necesario para que el badge en sí funcione.

### 2.5 ¿Requiere SQL nuevo?

**No.** Se calcula en el frontend exactamente igual que hoy se calcula la
asignación: una query adicional en `cargarHistorial()` sobre
`lineas_albaran_venta` filtrando `produccion_pf_id IN (ids visibles de la
página)`, agregada en un `Map` nuevo (`despachoRealPorTanda`), en paralelo
al `Map` de asignación ya existente. Sin vistas, columnas ni triggers
nuevos — mismo patrón, misma tabla origen que ya usa el resto de la
aplicación para derivar "cuánto se ha entregado" (ver
`AlbaranVentaForm.jsx:63-66`, `distribucion_prevista_pf()` en
`supabase/migrations/20260920_distribucion_prevista_pf_servido.sql:44`, y
el trigger de estado de pedido en
`supabase/migrations/20260801_pedidos_venta.sql:176`, los tres derivan
"despachado" sumando `lineas_albaran_venta.cantidad` de la misma forma).

---

## 3. Fuera de alcance (explícito)

- Tocar `previsiones_distribucion_pf`, su trigger
  (`trg_actualizar_previsiones_por_linea_albaran`) o el badge de "Estado de
  consumo" de Semielaborados (`Producciones.jsx`) — son mecanismos
  independientes, no se tocan.
- Añadir el nuevo badge a la tabla principal de "Productos finales" en
  Producciones del día (mismo pendiente ya documentado en
  `CONTRATO_VISTA_PRODUCCION_PRODUCTOS_FINALES.md:123`) — este contrato solo
  cubre el Historial de producciones cerradas.
- Cambiar el campo `estado` (CHECK/enum) de la tabla `productos_finales` —
  el nuevo indicador se implementa como badge aparte, calculado en cliente,
  igual que el de asignación.
- Migraciones SQL, vistas o columnas nuevas (ver 2.5).
- Filtrar por estado del albarán (borrador/emitido/anulado) — no existe tal
  estado en `albaranes_venta` (ver 2.1).

---

## 4. Decisiones a confirmar en la revisión

- [ ] Nombre final de la clave i18n padre: `asignacion` (propuesto) vs. otra.
- [ ] Renombrar también los identificadores internos en
      `ProduccionProductosFinales.jsx` (`estadoDespacho` →
      `estadoAsignacion`, etc.) en la misma pasada, o dejarlo para no mezclar
      un rename de código con un rename de UI.
- [ ] Texto exacto del badge parcial nuevo: "Despachado parcial — X%"
      (propuesto, para diferenciarlo verbalmente de "Asignado parcial — X%")
      vs. otra redacción.
- [ ] Si se añade el bloque "Despachado en albaranes" al desplegable (2.4)
      en esta misma implementación o en una iteración aparte.
- [ ] Si ambos badges (asignación + despacho real) conviven como dos
      columnas separadas en la tabla, o si se fusionan en un único
      indicador compuesto (recomendación: dos columnas separadas — son dos
      conceptos de negocio distintos y fusionarlos perdería la información
      de los casos límite del punto 2.3).
