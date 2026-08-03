# Diagnóstico: ¿cómo trata "lugar" el modelo actual?

Documento puramente diagnóstico, previo a diseñar una entidad `ubicaciones`. Basado en el esquema real (`supabase/migrations/*.sql`) y el código real del frontend (`frontend/src/pages/*.jsx`, `frontend/src/lib/*.js`). No propone ningún modelo ni campo nuevo — solo reporta lo que ya existe o se ignora.

**Limitación de fuente**: el esquema base (tablas como `entrada_material`, `producciones_semielaborado`, `producciones_producto_final`, `albaranes_compra`, `clientes`, `proveedores`, etc.) no tiene migración fundacional en el repo — se creó directamente en Supabase Studio. Solo hay migraciones incrementales desde 2026-07-31 en adelante (`ALTER TABLE`, tablas nuevas). Lo que aquí se afirma sobre esas tablas base viene de cómo el frontend las lee/escribe (`supabase.from(...).select(...)`), no de un `CREATE TABLE` verificado línea a línea. Donde hay margen de duda se indica explícitamente.

---

## 1. Campos que hoy distinguen implícitamente "dónde"

Búsqueda exhaustiva de `ubicacion|almacen|sede|sucursal|zona|lugar|sitio|local_id` en `supabase/migrations/` y `frontend/src/`: **cero coincidencias** relativas a lugar físico operativo (cámara, almacén, punto de venta, etc.).

Los únicos campos que representan "un lugar" en el sistema son direcciones de **terceros**, no ubicaciones propias del negocio:

| Campo | Tabla | Uso real |
|---|---|---|
| `clientes.direccion` | `clientes` | Se inyecta en el PDF de albarán/factura de venta ([AlbaranesVenta.jsx:250](frontend/src/pages/AlbaranesVenta.jsx#L250), [FacturasVenta.jsx:168](frontend/src/pages/FacturasVenta.jsx#L168)). Nunca se lee para decidir nada operativo. |
| `proveedores.direccion` | `proveedores` | Solo se edita en el formulario de proveedor ([Proveedores.jsx:151](frontend/src/pages/Proveedores.jsx#L151)); no aparece en ningún albarán ni en ningún cálculo. |
| `empresa_config.direccion` | `empresa_config` | Dato de membrete para PDFs ([generarPdf.js:63](frontend/src/lib/generarPdf.js#L63)). |

Ninguno de los tres tiene relación con "dónde físicamente está el stock" — son direcciones postales para facturación/membrete. No hay ningún campo que hoy diga, ni siquiera de forma informal, "esta cámara", "este punto de venta" o "este almacén".

### Campos de texto libre (`notas`) — la única vía informal disponible

Casi todas las tablas operativas tienen un campo `notas` (texto libre): `producciones_semielaborado.notas`, `producciones_producto_final.notas`, `albaranes_venta.notas`, `pedidos_compra.notas`/`pedidos_venta.notas` (probable, mismo patrón), `semielaborados.notas`, `productos_finales.notas`. También `entrada_material.notas` (por línea de albarán de compra).

En ningún caso el placeholder o la etiqueta sugiere lugar:
- `producciones_semielaborado`/`producciones_producto_final`: placeholder **"Notas (mermas, incidencias...)"** ([Producciones.jsx:365](frontend/src/pages/Producciones.jsx#L365), [ProduccionProductosFinales.jsx:360](frontend/src/pages/ProduccionProductosFinales.jsx#L360)).
- `entrada_material.notas`: placeholder **"Notas (temperatura de recepción, incidencias...)"** ([AlbaranesCompra.jsx:459](frontend/src/pages/AlbaranesCompra.jsx#L459)) — y de hecho hay un campo dedicado `temperatura_recepcion`/`temperatura_fuera_rango` justo al lado, o sea que cuando el sistema sí necesitó capturar un dato estructurado (temperatura) se le dio columna propia en vez de dejarlo en `notas`. Es la señal más clara de "si lugar importara, ya tendría su propia columna como la temperatura".
- El resto: **"Notas (opcional)"**, genérico.

No hay evidencia (ni en el código ni en el histórico narrado en `FLUJO_TORTILLA.md`) de que ningún usuario esté anotando lugar en estos campos hoy. Es un campo libre sin convención, no una ubicación implícita.

**Conclusión del punto 1**: el modelo actual no distingue "dónde" en ningún nivel, ni siquiera de forma informal/artesanal. No hay un campo que reconvertir — el diseño de `ubicaciones` parte de cero en cuanto a datos existentes, no de una convención a formalizar.

---

## 2. Tablas de stock/lote y su relación (inexistente) con lugar físico

| Tabla | Qué representa el lote | Campos relevantes | ¿Noción de lugar? |
|---|---|---|---|
| `entrada_material` | Una línea de albarán de compra = un lote de artículo recibido | `articulo_id`, `cantidad`, `precio`, `fecha_caducidad`, `codigo_lote` (autogenerado por trigger `trg_generar_lote_material`), `temperatura_recepcion`, `temperatura_fuera_rango`, `notas`, `linea_pedido_compra_id` | Ninguna. El lote se identifica por artículo + albarán de origen, no por dónde se almacena tras recibirlo. |
| `producciones_semielaborado` | Una tanda de producción de un semielaborado = un lote | `semielaborado_id`, `cantidad_producida`, `estado` (`abierta`/`cerrada`), `fecha`, `codigo_lote` (trigger `trg_generar_lote_semi`), `tipo_produccion` (`planificada`/`evento_directo`), `notas` | Ninguna. No hay campo de "dónde se produjo" ni "dónde se guarda". |
| `producciones_producto_final` | Una tanda de producción de un producto final = un lote | `producto_final_id`, `cantidad_producida`, `estado`, `fecha`, `codigo_lote` (trigger `trg_generar_lote_pf`), `fecha_caducidad` (calculada o editable), `tipo_produccion`, `notas` | Ninguna. |

Las vistas de stock agregado (`stock_lotes_articulo`, `stock_lotes_semielaborado`, `stock_lotes_producto_final`, `stock_semielaborados`, `stock_productos_finales`) suman/restan **solo por identidad del artículo/semielaborado/producto**, nunca por ningún otro eje. Ejemplo real ([20260803_producto_final_caducidad_merma.sql:63-75](supabase/migrations/20260803_producto_final_caducidad_merma.sql#L63-L75)):

```sql
create or replace view stock_lotes_producto_final as
select p.id as produccion_id, p.producto_final_id, pf.nombre,
  p.cantidad_producida
    - coalesce((select sum(v.cantidad) from lineas_albaran_venta v where v.produccion_pf_id = p.id), 0)
    + coalesce((select sum(a.cantidad) from ajustes_producto_final a where a.produccion_pf_id = p.id), 0)
    as stock_disponible,
  p.fecha, p.fecha_caducidad
from producciones_producto_final p
join productos_finales pf on pf.id = p.producto_final_id
where p.estado = 'cerrada';
```

No hay `group by` ni filtro por ningún campo de lugar porque no existe ninguno. **El stock hoy es, por construcción, de un único lugar implícito** (el negocio entero, tratado como un punto). Introducir `ubicaciones` significará añadir un eje de agrupación que hoy simplemente no está — no reinterpretar uno que ya exista de forma parcial.

Los tres formularios que consumen/ajustan stock (`Producciones.jsx`, `ProduccionProductosFinales.jsx`, `AjustesStock.jsx`) seleccionan el lote por **fecha + código + cantidad disponible**, nunca por lugar, porque no hay dato de lugar que mostrar ni por el que filtrar.

---

## 3. Señal de negocio único "hardcodeado" — a tener en cuenta para el diseño de `ubicaciones`

Esto no es sobre lugar físico, es sobre **si el modelo asume implícitamente un único propietario/negocio** de forma que sería costosa de deshacer. Se detectaron dos señales, una leve y una estructural:

### 3a. `empresa_config` — singleton explícito (señal leve, acotada)
`Configuracion.jsx` y `generarPdf.js` siempre acceden con `.eq('id', 1).single()` ([Configuracion.jsx:14](frontend/src/pages/Configuracion.jsx#L14), [generarPdf.js:28](frontend/src/lib/generarPdf.js#L28)). Es una tabla de una sola fila, con el id fijo a mano en el código. Si en el futuro este sistema diera servicio a un negocio distinto, `empresa_config` tendría que dejar de ser una fila fija con id=1 y pasar a ser una fila por negocio. El radio de impacto es pequeño (dos archivos, un dato de membrete), fácil de acotar.

### 3b. Políticas RLS "Acceso total temporal" — señal estructural, mucho más costosa
Cada tabla nueva creada por migración en este repo repite el mismo patrón (visto en `pedidos_venta`, `lineas_pedido_venta`, `pedidos_compra`, `lineas_pedido_compra`, `ajustes_producto_final`, `incidencias_stock_producto_final`, `incidencias_stock_articulo`, `incidencias_stock_semielaborado` — ver [20260801_pedidos_venta.sql:22-23](supabase/migrations/20260801_pedidos_venta.sql#L22-L23) y equivalentes en las otras cuatro migraciones):

```sql
create policy "Acceso total temporal" on <tabla> for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
```

Es decir: **cualquier usuario autenticado ve y modifica todas las filas de todas las tablas**. No hay ninguna columna de propietario/tenant en ninguna tabla (ni `negocio_id`, ni `owner_id`, ni equivalente) que una policy pudiera usar para particionar por negocio — la policy ni siquiera lo necesita hoy porque no hace falta distinguir "de quién es esta fila". El propio nombre de la policy, repetido literalmente en cada migración ("temporal"), sugiere que quien escribió esto ya sabía que era una simplificación provisional.

`AuthGate.jsx` confirma el mismo diseño desde el lado de autenticación: solo comprueba que exista sesión (`supabase.auth.getSession()`), sin leer ningún claim de organización/negocio del usuario ([AuthGate.jsx:12-23](frontend/src/components/AuthGate.jsx#L12-L23)).

**Por qué esto es lo caro de deshacer**: si en el futuro el sistema tuviera que dar servicio a un segundo negocio sin visibilidad sobre el primero, no bastaría con añadir una tabla `ubicaciones` con un `negocio_id` — haría falta añadir esa misma columna a *todas* las tablas existentes (no solo a las de stock: también `clientes`, `proveedores`, `articulos_compra`, `semielaborados`, `productos_finales`, `empresa_config`...) y reescribir *todas* las policies RLS de "acceso total" a "acceso filtrado por negocio". Es un cambio transversal a todo el esquema, no una migración aislada.

**Nota para el diseño de `ubicaciones`**: no hace falta resolver esto ahora (no hay caso real todavía, como se indicó). Pero como la nueva tabla `ubicaciones` se crea desde cero, sí conviene decidir conscientemente si nace ya con un campo `negocio_id` (nullable, sin usarlo todavía) para no repetir el mismo patrón "temporal" una vez más justo en la tabla que en el futuro sería la que particione todo lo demás — es la única decisión de este diagnóstico que toca directamente el diseño siguiente, el resto es solo constatación de que hoy no existe nada.

---

## 4. Resumen

- No existe ningún campo, columna o convención (ni siquiera informal en `notas`) que hoy represente lugar físico interno. Las únicas "direcciones" del sistema son de clientes/proveedores/empresa, para membrete de documentos, no operativas.
- Las tres tablas de lote (`entrada_material`, `producciones_semielaborado`, `producciones_producto_final`) identifican el lote por artículo/producto + evento de origen (albarán o producción) y fecha — nunca por lugar. Las vistas de stock agregan solo por identidad del ítem.
- El sistema entero asume un único negocio de forma extendida: la señal acotada es `empresa_config` (singleton `id=1`); la señal estructural y cara de deshacer es que **ninguna tabla tiene columna de propietario** y **todas las policies RLS dan acceso total a cualquier autenticado**, patrón repetido literalmente en cada migración nueva. Deshacer esto más adelante implicaría tocar todas las tablas y todas las policies, no solo las de stock.
