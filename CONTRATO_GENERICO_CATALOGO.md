# CONTRATO_GENERICO_CATALOGO.md

**Objetivo:** que el catálogo (artículos de compra → artículo base → BOM → semielaborado → BOM → producto final) deje de leerse como "software de restauración" y se lea como un ERP/MRP genérico, sin tocar el esquema de flujo que ya funciona.

**Origen de este contrato:** auditoría externa de UI (`AUDITORIA_FLOWBASE_UI.md`, agente web) + auditoría de código real (`AUDITORIA_ARQUITECTURA_CATALOGO.md`, Claude Code, solo lectura). Las decisiones de este contrato **sustituyen** cualquier recomendación de esos dos documentos que entre en conflicto con lo aquí escrito — en caso de duda, este documento manda.

---

## 0. Decisión de fondo (por qué NO se fusionan las tablas)

El audit externo proponía unificar `ingredientes` / `semielaborados` / `productos_finales` en una sola tabla `items` con un atributo `stage`. **Se descarta explícitamente.**

Motivo verificado en el código real: `receta_semielaborado` y `receta_producto_final` ya tienen un CHECK (`solo_un_tipo_ingrediente[_pf]`) que permite que cada línea de BOM apunte a un artículo de compra, a un artículo base (`ingrediente_id`) o a **otro semielaborado** (auto-referencia). Eso ya permite jerarquías de N niveles y mezcla de orígenes en el mismo BOM — que era el único beneficio real de fusionar tablas. Fusionar añadiría el riesgo de migración más alto del proyecto (el esquema base de esas tablas no está versionado en `supabase/migrations/`) a cambio de nada que no se tenga ya.

**Fuera de alcance de este contrato, explícitamente:**
- Cualquier fusión/unificación de `ingredientes`, `semielaborados`, `productos_finales`, `articulos_compra` en una tabla única.
- Cambiar `unidad_id` de `productos_finales` para admitir otra unidad además de "ud" (es una decisión de producto ya tomada y documentada en `20260926_unidad_semielaborados_productos_finales.sql`; no se toca aquí).
- Tocar la lógica de reparto de `CierreTanda.jsx` (solo se tocan sus strings, ver Fase 0).
- Convertir `pedidos_venta.estado` / `pedidos_compra.estado` en un ENUM de Postgres o en tabla de lookup — este contrato solo añade un `CHECK`, no cambia el tipo de dato.
- Iconografía, dashboard/landing page, IVA vs VAT — no forman parte de este contrato (quedan para uno posterior si se decide abordarlos).

---

## 1. Fase 0 — Renombrado y i18n (sin tocar base de datos)

**Estado: ✅ Aplicada y verificada el 10-09-2026 (pendiente de commit/push — ver conversación).**

Resumen de lo aplicado, para trazabilidad:
- Renombrado (1.1): `ingredientes` → **Artículo base** en las 36 claves i18n (`es`/`en`/`de`) donde el texto denota específicamente el concepto de catálogo (nav, título/subtítulo/formulario de `Ingredientes.jsx`, filtros de `Inventario.jsx`, desglose de `PedidosDelDia.jsx`, vinculación en `Articulos.jsx`, tipo de línea de BOM). Donde el código confirmó que el mismo texto se usa como etiqueta **genérica** de cualquier línea de fórmula/consumo (mezclando artículo/ingrediente/semielaborado — verificado línea a línea en `Producciones.jsx`, `ProduccionProductosFinales.jsx`, `estados_calculados.json`), se usó **"Componente"** en vez de "Artículo base" para no introducir una etiqueta incorrecta. `Receta` → **Fórmula (BOM)** en todos los sitios equivalentes. Detalle completo de la distinción en el hilo de trabajo.
- i18n (1.2): los 4 archivos identificados en la auditoría (`CierreTanda.jsx`, `AlbaranVentaForm.jsx`, `FacturaVentaForm.jsx`, `AuthGate.jsx`) ya no tienen strings hardcodeados — namespaces nuevos `cierre_tanda`, `albaran_venta_form`, `factura_venta_form`, `auth_gate` (registrados en `i18n/index.js`).
- Verificado en navegador en `es`/`en`/`de`: Artículos base, Semielaborados, Productos finales, drawers de Albarán/Factura de venta, Cierre de tanda (empty-state) y Login — 0 errores de consola. `npm run build` limpio.
- Sin cambios en `package.json`/`package-lock.json` (playwright instalado y desinstalado solo para la verificación, sin dejar rastro).

Cero riesgo: son solo claves de traducción y, como mucho, nombres de archivo/componente en frontend. No toca tablas, triggers, ni RPCs.

### 1.1 Mapeo de términos (namespaces de `frontend/src/i18n/{es,en,de}/*.json`)

| Concepto actual | Término genérico nuevo | Nota |
|---|---|---|
| `ingredientes` (agrupación) | **Artículo base** | ya no suena a "ingrediente de cocina" |
| Receta (`receta_semielaborado`/`receta_producto_final`) | **Fórmula / BOM** | término estándar de manufactura; mantener "Receta" como sinónimo en tooltip si se quiere suavizar la transición |
| `semielaborados` | Semielaborados | **sin cambio** — ya es término genérico de manufactura, no solo de cocina |
| `productos_finales` | Productos finales | **sin cambio** — ya es término genérico |
| `articulos_compra` | Artículos de compra | **sin cambio** — ya es genérico |

No hay renombrado de tablas ni columnas SQL — solo de etiquetas visibles (`i18n/*/ingredientes.json`, labels en `Ingredientes.jsx`, `Semielaborados.jsx`, etc.). El nombre interno de archivos/componentes (`Ingredientes.jsx`, `receta_semielaborado`) puede mantenerse tal cual salvo que se decida lo contrario — renombrar archivos no aporta valor de negocio y solo añade riesgo de romper imports.

### 1.2 Completar i18n en los 4 archivos con strings hardcodeados

Confirmado por auditoría de código (no son suposiciones del audit externo):

- `pages/CierreTanda.jsx` (378 líneas, 100% español hardcodeado: título, subtítulo, todos los `alert()`)
- `components/AlbaranVentaForm.jsx` (701 líneas: varios `alert()` y textos de ayuda)
- `components/FacturaVentaForm.jsx` (181 líneas, sin `useTranslation`)
- `components/AuthGate.jsx` (77 líneas, pantalla de login/guard)

Acción: extraer cada string a su namespace i18n correspondiente (crear `cierre_tanda.json`, `albaran_venta_form.json` si no existen ya como namespace, o añadir claves al namespace existente), traducir a `es`/`en`/`de`, sustituir por `t('...')`. **No cambiar la lógica de negocio de estos componentes**, solo los strings.

### 1.3 Criterio de aceptación de Fase 0
- `grep -r` de strings en español fuera de archivos `i18n/` sobre `pages/`+`components/` no debe devolver nada relevante (excluyendo `ui.jsx`, que no tiene strings de dominio propios).
- Cambiar el idioma de la app a EN o DE no debe dejar ningún texto en español visible en Ingredientes, Semielaborados, Productos finales, Cierre de tanda, Albarán de venta, Factura de venta, Login.
- Verificación en navegador en los 3 idiomas antes de commit.

---

## 2. Fase 1 — `categoria_id` en `semielaborados` y `productos_finales` (aditivo)

**Estado: ✅ Aplicada y verificada el 10-09-2026 (pendiente de commit/push — ver conversación).**

Resumen de lo aplicado: migración probada primero en `BEGIN...ROLLBACK` vía conexión directa (`SUPABASE_DB_URL`), luego aplicada en firme con confirmación explícita del usuario (acción de esquema sobre la BD real). Selector de categoría añadido al formulario inline de `Semielaborados.jsx` y `ProductosFinales.jsx` (no `required`, coherente con la nullability de la columna); listado de ambas pantallas muestra la categoría como texto en la línea descriptiva de cada tarjeta, igual patrón que `Articulos.jsx`/`Ingredientes.jsx` (ninguna de las dos tiene un filtro dropdown real — "columna/filtro" del punto 2.2 se resolvió como esa misma línea de texto, no un `<Select>` de filtrado que no existe en ningún sitio de referencia). Verificado en navegador creando un semielaborado y un producto final de prueba con categoría asignada (guardado confirmado por REST), limpiados después con verificación independiente. `npm run build` limpio, 0 errores de consola.

Hoy solo `ingredientes` y `articulos_compra` tienen `categoria_id NOT NULL`. `semielaborados` y `productos_finales` nunca lo tuvieron. Se añade para que las 4 tablas de catálogo sean consistentes.

### 2.1 Migración SQL (nueva, `20260910_categoria_semielaborados_productos_finales.sql`)

```sql
alter table semielaborados
  add column categoria_id bigint references categorias_articulo(id);

alter table productos_finales
  add column categoria_id bigint references categorias_articulo(id);
```

**Decisión de diseño:** `categoria_id` se añade **nullable, sin default**, a diferencia de `ingredientes`/`articulos_compra` que son `NOT NULL`. Motivo: hay filas existentes en producción (semielaborados y productos finales ya creados) sin categoría asignable automáticamente — forzar `NOT NULL` exigiría inventar una categoría "Sin clasificar" o bloquear la migración. Se deja nullable y se asigna categoría manualmente desde el frontend según se vaya revisando el catálogo. Si más adelante se quiere forzar `NOT NULL`, será un contrato aparte una vez el backfill esté completo.

No se toca ningún trigger existente (`trg_sincronizar_unidad_texto_*`, `trg_calcular_fecha_caducidad_*`) — `categoria_id` no interviene en ninguno.

### 2.2 Frontend
- Añadir selector de categoría (mismo componente/patrón ya usado en `Articulos.jsx`/`Ingredientes.jsx`) a los formularios inline de `Semielaborados.jsx` y `ProductosFinales.jsx`.
- Añadir columna/filtro de categoría a los listados de ambas pantallas, igual que ya existe en Artículos e Ingredientes.

### 2.3 Metodología de ejecución
- Probar el `ALTER TABLE` en `BEGIN...ROLLBACK` primero.
- Commit local tras aplicar la migración.
- Verificar en navegador que Semielaborados y Productos finales cargan y guardan correctamente con el nuevo campo (categoría vacía en filas antiguas, seleccionable en altas nuevas) antes de hacer push.

### 2.4 Criterio de aceptación
- Las 4 pantallas de catálogo (Artículos, Artículo base, Semielaborados, Productos finales) muestran y permiten editar categoría.
- Ninguna fila existente pierde datos ni rompe su guardado por tener `categoria_id` nulo.

---

## 3. Fase 2 — Pantalla de administración de categorías y unidades de medida

Hoy `categorias_articulo` y `unidades_medida` son tablas configurables en base de datos pero **no hay ninguna UI** para gestionarlas (`Configuracion.jsx` solo gestiona `empresa_config`). Sin esto, dar categoría "consistente" a las 4 tablas es cosmético si el usuario no puede crear/editar categorías o unidades sin entrar a Supabase directamente.

### 3.1 Alcance
- Nueva sección dentro de `Configuracion.jsx` (o pestaña nueva) con dos tablas CRUD simples: **Categorías** (`categorias_articulo`) y **Unidades de medida** (`unidades_medida`).
- Categorías: alta/edición/baja de `nombre` + `acronimo`. Nota: no hay UNIQUE en BD sobre estos campos — la UI debe advertir de duplicados aunque no los bloquee a nivel de base de datos (fuera de alcance añadir el UNIQUE aquí; se puede evaluar en un contrato posterior).
- Unidades de medida: alta/edición de `codigo`/`nombre`/`tipo` (peso/volumen/unidad). **Sin opción de borrar** desde esta UI, porque la tabla no tiene `GRANT delete` para `authenticated` — replicar esa misma restricción en la interfaz (ocultar/deshabilitar el botón de borrar) en vez de añadir el grant, salvo que se decida lo contrario explícitamente antes de implementar.

### 3.2 Criterio de aceptación
- Se puede crear una categoría nueva y verla disponible inmediatamente en los selectores de Fase 1.
- Se puede crear una unidad de medida nueva y verla disponible en los selectores de unidad de Ingredientes/Artículos/Semielaborados.
- No aparece opción de eliminar unidades de medida en la UI.

---

## 4. Fase 3 — `CHECK` en `pedidos_venta.estado` y `pedidos_compra.estado`

Hoy ambos campos son `text not null default 'pendiente'` con el vocabulario documentado solo en un comentario SQL, sin restricción real. Un `UPDATE` manual o un bug futuro puede escribir cualquier valor.

### 4.1 Paso previo obligatorio (verificación, sin escribir nada)
Antes de añadir el CHECK, ejecutar en solo lectura:
```sql
select distinct estado from pedidos_venta;
select distinct estado from pedidos_compra;
```
Si aparece algún valor fuera de `pendiente|en_produccion|servido|cancelado` (venta) o `pendiente|recibido|cancelado` (compra), **detener la fase** y decidir caso por caso (dato corrupto vs. estado legítimo no documentado) antes de continuar.

### 4.2 Migración SQL (nueva, `20260910b_check_estado_pedidos.sql`)
```sql
alter table pedidos_venta
  add constraint chk_pedidos_venta_estado
  check (estado in ('pendiente', 'en_produccion', 'servido', 'cancelado'));

alter table pedidos_compra
  add constraint chk_pedidos_compra_estado
  check (estado in ('pendiente', 'recibido', 'cancelado'));
```
Reversible con `alter table ... drop constraint ...` si algo falla en producción.

### 4.3 Metodología de ejecución
- Ejecutar primero el paso 4.1 en la base de producción real (solo lectura) y pegar el resultado en el hilo de trabajo antes de proceder.
- Probar el `ADD CONSTRAINT` en `BEGIN...ROLLBACK`.
- Commit local, push solo tras confirmar que los triggers `actualizar_estado_pedido_por_produccion()` y `actualizar_estado_pedido_por_servicio()` siguen escribiendo sin violar el constraint (probar un ciclo completo pedido→producción→servido en el entorno de pruebas).

### 4.4 Criterio de aceptación
- Un intento de `UPDATE pedidos_venta SET estado = 'valor_inventado'` falla con violación de constraint.
- El ciclo de vida normal de un pedido (crear → en producción → servido) sigue funcionando sin cambios visibles para el usuario.

---

## 5. Orden de ejecución y checkpoints

1. **Fase 0** (i18n) — independiente, sin riesgo, puede ejecutarse y desplegarse sola.
2. **Fase 1** (`categoria_id` aditivo) — independiente de Fase 0, requiere verificación en navegador antes de push.
3. **Fase 2** (UI de administración) — depende de que Fase 1 esté aplicada (necesita `categorias_articulo`/`unidades_medida` como referencia, que ya existen, así que técnicamente podría ir antes; se deja en este orden porque da sentido de uso inmediato a los selectores de Fase 1).
4. **Fase 3** (`CHECK` en estado) — independiente de las anteriores, pero requiere el paso de verificación 4.1 antes de escribir nada.

Cada fase se commitea y verifica por separado — no se agrupan en un solo commit, siguiendo la metodología ya usada en `CONTRATO_DRAWERS_COMPRAS.md`/`CONTRATO_PAGOS_COMPRA.md`.

---

## 6. Prompt para Claude Code (pegar tal cual, fase por fase — no pasar el contrato entero de golpe)

> "Vamos a ejecutar la Fase [N] de `CONTRATO_GENERICO_CATALOGO.md` (adjunto/en el repo). Lee primero esa fase completa. No toques nada fuera de lo que esa fase describe explícitamente — en particular, no fusiones tablas, no cambies `unidad_id` de `productos_finales`, no toques la lógica de `CierreTanda.jsx` más allá de sus strings, y no conviertas `estado` en ENUM ni tabla de lookup. Si necesitas tocar algo no contemplado en la fase para completarla, dime qué y por qué antes de hacerlo. Sigue la metodología del proyecto: prueba cualquier cambio SQL en `BEGIN...ROLLBACK` primero, haz commit local antes de cualquier push, y no hagas push hasta que yo confirme verificación en navegador."

---

## 7. Pendiente para un contrato futuro (fuera de este)

- UNIQUE en `categorias_articulo(nombre, acronimo)` si se decide bloquear duplicados a nivel de BD.
- Revisar si `unidades_medida` debería tener `GRANT delete` (hoy deliberadamente no lo tiene, o es un descuido no confirmado).
- Backfill de `categoria_id` en filas existentes de `semielaborados`/`productos_finales` y posible paso a `NOT NULL` una vez completado.
- Iconografía neutra, IVA/VAT, dashboard — quedaron fuera del alcance de este contrato por decisión explícita en la conversación previa.
