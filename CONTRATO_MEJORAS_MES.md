# CONTRATO_MEJORAS_MES.md

## Objetivo

Rediseñar dos pantallas del flujo de producción (MES) para hacerlas más
compactas, informativas y consistentes entre sí, reutilizando patrones de UI
ya existentes en el proyecto (`AlbaranesVenta.jsx` / `FacturasVenta.jsx`).

No se crean tablas ni columnas nuevas en BD. No se toca la vista
`stock_lotes_semielaborado`. No se toca el flujo `tanda_id` (confirmado código
muerto — fuera de alcance). No se toca `pedido_id` en `ProduccionProductosFinales.jsx`
(confirmado informativo/código muerto a efectos de triggers — fuera de alcance).

---

## 1. `Producciones.jsx` — Historial de Semielaborados

### 1.1 Alcance
El rediseño aplica al **historial general completo**, no solo a una vista
filtrada tras lanzar producción desde `PedidosDelDia.jsx`.

### 1.2 Filtro por semielaborado
Se mantiene el desplegable actual, pero cambia su comportamiento:
- **Por defecto**: `"Todos"` — se ve el historial completo paginado, sin
  necesidad de seleccionar nada primero (elimina el bloqueo actual que oculta
  todo el historial sin selección).
- El desplegable sigue permitiendo filtrar a un semielaborado concreto.
- Al llegar desde `PedidosDelDia.jsx` con `?semielaborado_id=`, ese valor
  precarga el desplegable (comportamiento ya existente, se conserva).

### 1.3 Forma: tabla con acordeón (reemplaza las `<Card>` apiladas)
Reutilizar el patrón de `AlbaranesVenta.jsx` (BLOQUE 4):
- Una sola fila expandida a la vez (`filaExpandidaId`, no `Set`).
- Fila principal en `<Table>`/`<Tr>` con icono `IconChevronRight`/`IconChevronDown`.
- Fila de detalle siempre montada, colapsada con
  `grid-template-rows` + `transition`, igual que en `AlbaranesVenta.jsx:420-538`.
- Botones de acción dentro de la fila con `stopPropagation()`.

Columnas de la fila principal:
`Fecha | Semielaborado | Cantidad producida | Notas | Estado de consumo (Badge) | ⌄`

> Confirmado tras revisión en frontend: las notas de producción van **como
> columna en la fila principal**, no dentro del detalle expandible.

### 1.4 Paginación
Reutilizar el patrón de `FacturasVenta.jsx`: estado `pagina` / `PAGINA_TAMANO`,
`.range(desde, desde + PAGINA_TAMANO - 1)` con `{ count: 'exact' }`, barra de
páginas simple.

### 1.5 Estado de consumo (nuevo indicador)
No existe hoy — se calcula, **sin tocar `stock_lotes_semielaborado`**, con una
consulta propia a nivel de página visible:

```
SUM(consumo_produccion.cantidad)    WHERE produccion_origen_id IN (ids visibles)  GROUP BY produccion_origen_id
SUM(consumo_produccion_pf.cantidad) WHERE produccion_origen_id IN (ids visibles)  GROUP BY produccion_origen_id
SUM(ajustes_semielaborado.cantidad) WHERE produccion_id        IN (ids visibles)  GROUP BY produccion_id
```

> **Corrección post-implementación (caso real WIP-MIXKZ-260060):** la primera
> versión del badge no incluía `ajustes_semielaborado`, lo que hacía que un
> lote con ajuste manual (p. ej. corrección de merma) mostrara "Parcial X%"
> aunque su `stock_disponible` real fuera 0. Fórmula corregida, replicando el
> signo de la vista `stock_lotes_semielaborado` (un ajuste negativo reduce
> stock igual que un consumo; uno positivo lo aumenta):

`consumido = suma_consumo_produccion + suma_consumo_produccion_pf - suma_ajustes_semielaborado`
`% = consumido / cantidad_producida`, acotado entre 0% y 100%

Badge (`components/ui.jsx`, reutilizar tal cual):
- `0%` → `Badge color="gray"` → "No consumido"
- `0% < % < 100%` → `Badge color="amber"` → "Parcial — X%"
- `% >= 100%` → `Badge color="green"` → "Completo"

### 1.6 Contenido de la fila expandible
Debe mostrar **tres bloques**, todos ya calculables con datos existentes:
1. **Ingredientes consumidos por esta producción** (aguas arriba) — la tabla
   que ya existe hoy dentro de `ProduccionCerrada` (`consumo_produccion` del
   propio registro), sin cambios de fondo, solo movida al detalle expandible.
2. **Consumido por** (aguas abajo, nuevo) — listado de qué producciones han
   tirado de este lote: filas de `consumo_produccion` y `consumo_produccion_pf`
   donde `produccion_origen_id` = id de esta tanda, con fecha, destino y
   cantidad.
3. **Ajustes de stock** (nuevo, corrección post-implementación) — filas de
   `ajustes_semielaborado` para esta tanda: cantidad, motivo, fecha. Sin este
   bloque, un lote con ajuste manual muestra "Completo"/"Parcial" sin
   explicar por qué — sería opaco justo en el caso que motivó la corrección.

---

## 2. `ProduccionProductosFinales.jsx` — Stock y cerradas de Producto Final

### 2.1 Nuevo selector de producto
Añadir un desplegable de producto final, mismo patrón que el de Semielaborados
en `Producciones.jsx`:
- **Precarga** con el valor de `?producto_final_id=` cuando se llega desde
  `PedidosDelDia.jsx` (comportamiento por defecto: filtrado a ese producto).
- El usuario puede cambiarlo manualmente a otro producto, o a `"Todos"`.
- Este selector controla **tanto** la tabla de stock actual **como** el
  historial de cerradas (punto 2.2 y 2.3) — una sola fuente de verdad para el
  filtro de la pantalla.

> Nota: esto amplía ligeramente lo pedido originalmente ("que solo aparezca el
> producto que estoy produciendo") añadiendo la posibilidad de cambiar de
> producto sin salir de la pantalla, igual que ya existe en Semielaborados.
>
> **Implementado como**: no se añadió un desplegable nuevo — se reutilizó el
> selector ya existente de "Iniciar nueva producción" como filtro dual
> (elegir qué producir / filtrar stock e historial), exactamente el mismo
> patrón de un único selector con doble función que ya tiene `semielaboradoId`
> en Semielaborados. Confirmado como el diseño correcto, no una desviación.

### 2.2 Stock actual de productos finales
La tabla (`stock_productos_finales`, hoy sin filtro) pasa a filtrar por el
producto seleccionado en el desplegable (2.1). Con `"Todos"` seleccionado, se
comporta como hoy (todos los productos).

### 2.3 Historial de producciones cerradas
Mismo tratamiento que el punto 1.3 de Semielaborados:
- Reemplazar las `<Card>` apiladas por tabla con acordeón (una fila expandida
  a la vez), mismo patrón de `AlbaranesVenta.jsx`.
- Paginación con el patrón de `FacturasVenta.jsx`.
- Filtrado por el producto seleccionado en 2.1.

Columnas de la fila principal:
`Fecha | Producto | Cantidad producida | Notas | Estado de despacho (Badge) | ⌄`

> Mismo criterio que en Semielaborados: notas como columna en la fila
> principal, no en el detalle expandible.

### 2.4 Estado de despacho (nuevo indicador)
**Confirmado: basado en `previsiones_distribucion_pf` (previsto/repartido a
pedido), no en `lineas_albaran_venta` (facturado real).** Son conceptos
distintos en el modelo actual — se deja constancia explícita aquí para no
confundirlos en el futuro.

Cálculo por página visible, mismo patrón que `sumaPrevistoPorTanda` en
`PedidosDelDia.jsx:388-403`, pero indexado por tanda cerrada en vez de por
producto agregado:

```
SUM(previsiones_distribucion_pf.cantidad_prevista) WHERE produccion_pf_id IN (ids visibles) GROUP BY produccion_pf_id
SUM(ajustes_producto_final.cantidad)                WHERE produccion_pf_id IN (ids visibles) GROUP BY produccion_pf_id
```

> **Corrección preventiva (mismo hueco detectado en Semielaborados, punto
> 1.5):** `ajustes_producto_final` es un mecanismo real y ya alcanzable
> desde `AjusteStockForm.jsx`/`AjustesStock.jsx` sobre tandas de producto
> final — hoy sin filas, pero expuesto al mismo error: un ajuste manual
> (p. ej. unidades defectuosas dadas de baja) dejaría el badge mostrando
> "Parcial X%" sobre stock que ya no existe. Se corrige desde el diseño
> inicial, sin esperar a que ocurra con datos reales.

`repartido = previsiones_distribucion_pf.cantidad_prevista - ajustes_producto_final.cantidad` (sumados por tanda)
`% = repartido / cantidad_producida`, acotado entre 0% y 100%

Mismo Badge que en 1.5:
- `0%` → gray → "No despachado"
- `0% < % < 100%` → amber → "Parcial — X%"
- `% >= 100%` → green → "Despachado"

### 2.5 Contenido de la fila expandible
Debe mostrar **dos bloques**:
1. **Repartido a pedidos** — filas de `previsiones_distribucion_pf` donde
   `produccion_pf_id` = id de la tanda, con `linea_pedido_id`, cantidad
   prevista y fecha.
2. **Ajustes de stock** (preventivo, mismo criterio que en Semielaborados
   1.6) — filas de `ajustes_producto_final` para esa tanda: cantidad,
   motivo (`motivo_categoria`/`motivo_detalle`) y fecha. Hoy estará casi
   siempre vacío (0 filas en el sistema a fecha de este contrato), pero
   debe estar listo para cuando se registre el primero.

---

## 3. Fuera de alcance (explícito)

- Flujo `tanda_id` (código muerto, sin navegación viva).
- Vínculo `pedido_id` en `ProduccionProductosFinales.jsx` (informativo).
- Cualquier cambio a `stock_lotes_semielaborado` o a los triggers existentes.
- Migraciones SQL nuevas — todo el cálculo usa tablas/columnas ya existentes.
- Distinguir "previsto" vs "facturado real" en el badge de despacho (queda
  como posible mejora futura si se necesita).

---

## 4. Decisiones ya cerradas (para no volver a preguntarlas)

- Acordeón: una sola fila expandida a la vez, no múltiple.
- Semielaborados: historial general, filtro por desplegable con `"Todos"` por
  defecto.
- Productos finales: se añade selector de producto, con precarga desde query
  param y opción de cambiarlo manualmente.
- Despacho de PF: basado en `previsiones_distribucion_pf`, no en albarán real.
