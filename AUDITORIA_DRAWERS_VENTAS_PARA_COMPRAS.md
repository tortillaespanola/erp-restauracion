# Auditoría: patrón "listados + formularios en drawer" (Ventas) para replicar en Compras

Documento de solo lectura. No se ha modificado ningún archivo de código. Objetivo: servir de base para `CONTRATO_DRAWERS_COMPRAS.md`.

---

## 1. ARQUITECTURA DEL PATRÓN DRAWER

### Componente

Un único componente genérico y reutilizable: **`Drawer`**, definido en [frontend/src/components/ui.jsx:247-263](frontend/src/components/ui.jsx#L247-L263).

```jsx
export function Drawer({ open, onClose, title, children, anchoClase = 'max-w-md' }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/34 backdrop-blur-[1.5px]" onClick={onClose} />
      <div className={`relative w-full ${anchoClase} h-full bg-surface shadow-drawer flex flex-col`}>
        ...
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
```

- Backdrop + panel deslizante desde la derecha, ancho configurable vía `anchoClase` (default `max-w-md`; Albaranes de venta usa `max-w-2xl`, Facturas de venta usa `max-w-lg`).
- **No es un componente "inteligente"**: no sabe nada de formularios, guardado, ni validación. Solo monta/desmonta `children` según `open`. Toda la lógica vive en la pantalla padre y en el formulario hijo.
- Nació con el ajuste de stock (`AjusteStockForm.jsx` / `Inventario.jsx`) — el comentario en el código lo llama explícitamente "primer overlay del proyecto, pensado para reutilizarse... no acoplado al ajuste de stock".

### Apertura/cierre: estado local, NO query param propio del drawer

- Cada pantalla mantiene su propio estado de apertura en `useState`, no hay contexto ni store global de drawers.
- Dos variantes de estado según si la pantalla necesita distinguir alta de edición:
  - **Solo alta** (Albaranes de venta, Facturas de venta): un booleano `drawerAbierto`.
  - **Alta + edición** (Pedidos de venta): un único estado `modoDrawer` con tres posibles valores: `null` (cerrado), `'nuevo'` (alta) o el objeto de la entidad a editar (edición). Ejemplo en [Pedidos.jsx:77](frontend/src/pages/Pedidos.jsx#L77):
    ```js
    const [modoDrawer, setModoDrawer] = useState(null)
    ...
    <PedidoForm pedido={typeof modoDrawer === 'object' ? modoDrawer : null} ... />
    ```
  - El mismo patrón de 3 estados (`null` / `'nuevo'` / objeto) se usa también en `Inventario.jsx` (`ajusteDrawer`), y en `AlbaranesVenta.jsx`/`FacturasVenta.jsx` para el **drawer de cobro** (`pagoDrawer`, objeto o `null`).
- El contenido del formulario **solo se renderiza cuando el drawer está abierto** (`{drawerAbierto && <Form .../>}`), nunca se deja montado oculto. Esto es intencional: el formulario se desmonta por completo al cerrar, así que la siguiente apertura es un montaje limpio con estado inicial fresco — **no hace falta ningún `resetForm()`** (a diferencia del patrón viejo de Compras, ver sección 5).

### Deep-linking: SÍ existe, pero solo para un caso de uso concreto (navegación entre pantallas), no para "compartir el estado del drawer por URL" en general

- `AlbaranesVenta.jsx` lee `pedido_id` de `useSearchParams()` y, si está presente, **abre el drawer automáticamente** al montar:
  ```js
  const [searchParams] = useSearchParams()
  const pedidoIdParam = searchParams.get('pedido_id')
  ...
  useEffect(() => {
    if (pedidoIdParam) setDrawerAbierto(true)
  }, [pedidoIdParam])
  ```
- El origen de ese query param es un botón en `Pedidos.jsx` que hace `navigate('/albaranes-venta?pedido_id=${p.id}')` (navegación de página completa, no abre nada localmente).
- Fuera de ese caso, **abrir/cerrar el drawer no cambia la URL**. Cerrar el drawer no limpia el query param tampoco (es un detalle menor, no corregido).
- Conclusión: es deep-linking de un solo sentido (URL → abre drawer), pensado para enlazar una pantalla con otra, no un patrón general de "todo drawer es direccionable por URL".

---

## 2. CAMBIOS EN LAS PANTALLAS DE LISTADO (ventas)

Los tres listados de venta (`Pedidos.jsx`, `AlbaranesVenta.jsx`, `FacturasVenta.jsx`) comparten exactamente la misma silueta, evolucionada a través de varios contratos (`CONTRATO_UX_PEDIDOS_VENTA.md`, `CONTRATO_UX_ALBARANES_VENTA.md`, `CONTRATO_UX_FACTURAS_VENTA.md`, `CONTRATO_FILTROS_VENTA.md`). El "antes" de estas pantallas ya no existe en el repo (fueron reescritas en los mismos commits que introdujeron el drawer), pero por los propios comentarios del código y los contratos se reconstruye así:

**Antes** (mismo patrón que Compras tiene HOY, ver sección 5):
- Un `<Card>` con formulario inline arriba (siempre visible, sin ocultar) para alta (y a veces edición).
- Listado simple debajo, sin paginación server-side, sin filtros, cargando todas las filas de una vez.
- Fila expandible en editar = repoblar el mismo formulario de arriba con `setEditandoId(x)`.

**Ahora**, cada listado:
1. Cabecera con botón **"Nuevo X"** que abre el drawer (`<Button onClick={() => setDrawerAbierto(true)}>` o `setModoDrawer('nuevo')`).
2. Barra de filtros server-side (Cliente, Estado(s) vía `MultiSelect`, rango de fechas) — aplicados en la query de Supabase, no en cliente.
3. Tabla con:
   - Fila principal + fila de detalle expandible en acordeón (grid `grid-rows-[0fr]/[1fr]` animado, un único `filaExpandidaId` a nivel de pantalla, nunca más de una fila abierta a la vez).
   - Orden server-side por columna (click en cabecera, ciclo asc→desc→sin orden) + agrupamiento invariante por estado cuando aplica (`grupo_estado`/`prioridad_grupo`, siempre primera clave de `.order()`).
   - Paginación server-side (`PAGINA_TAMANO = 20`, `.range()`, `{ count: 'exact' }`).
   - `filaRefs` (un `Map` por id via `useRef`) para poder hacer `scrollIntoView` a la fila recién creada/editada tras cerrar el drawer.
4. El `<Drawer>` se declara al final del JSX de la pantalla, fuera de la tabla, condicionado por el estado de apertura.

### Cómo se dispara la apertura desde una fila

- **Alta**: siempre desde el botón de cabecera, nunca desde una fila.
- **Edición** (solo Pedidos de venta): botón de icono `IconEdit` en la fila, dentro de un contenedor con `onClick={(e) => e.stopPropagation()}` (para no disparar el toggle de expandir/colapsar de la fila) que llama a `handleEditar(pedido)`. Esa función primero hace una comprobación asíncrona server-side (¿tiene producción o albarán ya asociados? si sí, `alert()` y no abre nada) y solo si pasa la validación hace `setModoDrawer(pedido)`.
- **Cobro** (Albaranes/Facturas de venta): botón de icono `IconCash`/`IconCoin` en la fila (solo visible si hay saldo pendiente) que abre un **segundo drawer independiente** (`pagoDrawer`) con `RegistrarPagoForm`, preseleccionando cliente y documento.

### Acciones que NO usan el drawer (pantalla completa o modal nativo)

- **Imprimir/descargar PDF** (`IconPrinter`/`IconDownload`): genera el PDF client-side y lo abre en pestaña nueva o descarga — nunca un drawer, porque no hay nada que "editar", es una acción de salida pura.
- **Crear albarán desde un pedido** (`IconTruckDelivery` en `Pedidos.jsx`): **navegación de página completa** (`navigate('/albaranes-venta?pedido_id=${p.id}')`), no abre un drawer localmente — aterriza en otra pantalla que sí abre su propio drawer vía el query param (ver sección 1).
- **Cancelar pedido / borrar albarán / anular factura**: `confirm()` nativo del navegador + mutación directa, sin drawer ni pantalla — son acciones de un solo paso sin campos que rellenar.

---

## 3. CAMBIOS EN LOS FORMULARIOS (ventas)

Todos los formularios se **extrajeron a componentes propios** en `frontend/src/components/`, antes vivían inline en el JSX de la pantalla:

| Formulario | Archivo | Modos soportados |
|---|---|---|
| Pedido de venta | [PedidoForm.jsx](frontend/src/components/PedidoForm.jsx) | alta **y** edición |
| Albarán de venta | [AlbaranVentaForm.jsx](frontend/src/components/AlbaranVentaForm.jsx) | solo alta (nunca existió edición) |
| Factura de venta | [FacturaVentaForm.jsx](frontend/src/components/FacturaVentaForm.jsx) | solo alta (nunca existió edición) |
| Registrar pago (transversal) | [RegistrarPagoForm.jsx](frontend/src/components/RegistrarPagoForm.jsx) | solo alta |

### Props vs. estado propio (el cambio clave de arquitectura)

- **Antes**: la pantalla leía/escribía el estado del formulario directamente en sus propios `useState` (todo en el mismo archivo que la tabla).
- **Ahora**: el formulario es un componente **controlado por props de entrada + callbacks de salida**, sin ninguna lectura de `useParams`/`useSearchParams` propia (con la única excepción de `AlbaranVentaForm`, que si recibe `pedidoIdParam` como prop desde el padre —que sí lo lee de `useSearchParams`— dispara su propio `useEffect` para precargar líneas del pedido).
- Contrato de props consistente en los tres:
  ```
  <XForm
    {entidad}          // objeto a editar, o null/omitido si es alta (solo PedidoForm)
    {catálogos}        // clientes, productos, articulosMercaderia... ya cargados por el padre
    onGuardado={fn}    // se llama con el id de la entidad creada/editada
    onCancelar={fn}    // se llama al pulsar "Cancelar" o la X del drawer
  />
  ```
- El formulario **calcula su estado inicial una sola vez** con `useState(() => estadoInicial(entidad))`, y como se desmonta al cerrar el drawer, no necesita sincronizar props nuevas con estado viejo (no hay `useEffect` de "si cambia la prop, resetea campos").
- El padre nunca inspecciona ni modifica el estado interno del formulario — la única vía de comunicación de vuelta es `onGuardado(id)`.

### Guardado y refresco del listado padre

Patrón idéntico en las tres pantallas — función `alGuardarX(id)` en el padre:
```js
async function alGuardarAlbaran(idAlbaran) {
  setDrawerAbierto(false)              // 1. cierra el drawer
  await cargarDatos()                  // 2. recarga el listado completo desde Supabase
  requestAnimationFrame(() => {        // 3. tras el repintado, hace scroll a la fila
    filaRefs.current.get(idAlbaran)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}
```
- El `requestAnimationFrame` es necesario porque, en un alta nueva, la fila no existe en el DOM hasta que `cargarDatos()` termina y React repinta.
- Limitación conocida y aceptada (documentada en varios comentarios): si la entidad guardada cae en otra página de la paginación, no hay scroll cruzando páginas.
- El formulario **no** refresca el listado por sí mismo ni sabe que existe un listado — solo llama a `onGuardado(id)`.

### Validaciones, errores y estados de carga dentro del drawer

- **Sin librería de formularios** (no hay React Hook Form / Formik / Zod): validación manual e imperativa dentro de `handleSubmit`, con `alert()` nativo del navegador para errores (de validación de cliente y de errores de Supabase por igual). Ejemplo típico:
  ```js
  if (lineasValidas.length === 0) {
    alert(t('pedido_form:alertas.sin_lineas_validas'))
    return
  }
  ```
- Validaciones inline puntuales con mensaje bajo el campo (ej. fecha de entrega anterior a la fecha del pedido), pero la mayoría son bloqueantes vía `alert()` en el submit.
- **Estado de carga**: no hay un patrón uniforme.
  - `FacturaVentaForm` es el único con un booleano `guardando` que deshabilita el botón de submit y cambia su texto ("Guardando…").
  - `PedidoForm` y `AlbaranVentaForm` **no** deshabilitan el botón durante el guardado (riesgo de doble submit si el usuario hace doble clic, ya preexistente, no introducido por el drawer).
- **Errores de Supabase**: se comprueban campo a campo tras cada operación (`insert`/`update`/`delete`), con rollback manual si una operación posterior falla (ej. `AlbaranVentaForm`: si fallan las líneas tras crear la cabecera, hace `DELETE` de la cabecera recién creada).
- El drawer en sí (`ui.jsx`) no tiene ningún estado de carga ni gestiona errores — es responsabilidad exclusiva del formulario hijo.

---

## 4. COMPONENTES COMPARTIDOS Y REUTILIZACIÓN

### Genérico y reutilizable tal cual (~30% del patrón)

- `Drawer` (`ui.jsx`) — 100% agnóstico de dominio, ya usado por 4+ pantallas distintas (Pedidos, Albaranes venta, Facturas venta, Inventario/ajuste de stock, Pagos).
- Primitivas de formulario ya existentes y reutilizadas sin cambios: `Field`, `Input`, `Select`, `DateInput`, `SectionLabel`, `Button`, `LinkAction`, `MultiSelect`.
- El patrón de **3 funciones por pantalla** (`cargarDatos`, `alGuardarX`, `handleBorrar/handleCancelar`) es una convención repetida, no un hook compartido — cada pantalla la reimplementa (ver más abajo, "no hay hook nuevo").
- El patrón de **`filaRefs` + `scrollIntoView` en `requestAnimationFrame`** también es una convención copiada entre archivos, no una utilidad extraída.

### Específico de ventas (~70% del patrón)

- Todo el contenido de cada `XForm.jsx`: campos, catálogos, lógica de selección de lote/tanda (FIFO consumiendo `stock_lotes_producto_final` / `stock_lotes_articulo`), cálculo de precios pactados, generación de PDF tras guardar.
- Las columnas de cada tabla, los filtros específicos (Cliente, Facturación/Cobro, Estado de pedido), los badges de estado.
- La lógica de agrupamiento (`grupo_estado`, `prioridad_grupo`) es específica del dominio de cada tabla y requirió columnas/vistas SQL nuevas (migraciones `20260928_grupo_estado_pedidos_venta.sql`, vista `facturas_venta_con_saldo`).

### Hooks/contextos/utilidades nuevas creadas para este cambio

- **Ninguna genérica nueva.** No se creó ningún hook `useDrawer()`, `useEntityForm()` ni similar — cada pantalla repite el mismo `useState` + funciones a mano.
- Utilidades de dominio (no de drawer) creadas en paralelo: `frontend/src/lib/saldosVenta.js` (cálculo de saldos/estados de pago, `clientesParaDrawer` — esta última sí es un pequeño helper pensado específicamente para precargar el selector de cliente del drawer de pago).
- **Implicación directa para Compras**: no hay una "librería de drawers" que simplemente importar — replicar el patrón significa **copiar la convención** (estructura de estado, nombres de función, orden de pasos) a cada archivo nuevo, tal como se hizo de Pedidos → Albaranes → Facturas dentro de Ventas. Es un buen momento para plantear extraer algo genérico si se detecta duplicación excesiva, pero **no existe hoy**.

---

## 5. ESTADO ACTUAL DE COMPRAS (para diffear)

Los tres módulos de Compras **siguen el patrón antiguo pre-drawer**, prácticamente intacto:

| Pantalla | Archivo | Formulario | Estructura actual |
|---|---|---|---|
| Pedidos de compra | [PedidosCompra.jsx](frontend/src/pages/PedidosCompra.jsx) | inline (mismo archivo) | `<Card>` con `<form>` siempre visible arriba (solo alta) + listado de `<Card>` por pedido debajo, sin paginación ni filtros |
| Albaranes de compra | [AlbaranesCompra.jsx](frontend/src/pages/AlbaranesCompra.jsx) | inline (mismo archivo) | `<Card>` con `<form>` siempre visible arriba (alta **y** edición vía `editandoId`) + listado de `<Card>` por albarán debajo |
| Facturas de compra | [FacturasCompra.jsx](frontend/src/pages/FacturasCompra.jsx) | inline (mismo archivo) | `<Card>` con `<form>` siempre visible arriba (solo alta) + listado de `<Card>` por factura debajo |

Ningún archivo de Compras importa `Drawer`. **No existen** `PedidoCompraForm.jsx`, `AlbaranCompraForm.jsx` ni `FacturaCompraForm.jsx` como componentes separados — habría que crearlos desde cero extrayendo el JSX del `<form>` de cada pantalla.

Características comunes al estado actual de Compras (el "antes" real, ya no solo conceptual, de Ventas):
- Todas las cargas de listado son de una sola vez (`cargarDatos()` sin filtros ni `.range()`), sin `{ count: 'exact' }`, sin orden configurable por el usuario, sin `useEffect` con dependencias de filtro/página.
- El formulario usa `resetForm()` explícito tras guardar (porque el `<form>` nunca se desmonta) — esto **desaparecería** al mover a un drawer, igual que ya desapareció en Ventas.
- `AlbaranesCompra.jsx` ya tiene lógica de **edición con líneas bloqueadas** (`locked`, vía `IconLock`) cuando una línea de `entrada_material` ya fue consumida por producción o ajustada — más compleja que cualquier edición existente en Ventas (que no tiene ninguna, salvo Pedidos, y sin bloqueo de líneas parciales).
- Las tres pantallas ya usan `useTranslation` / `i18next` con namespaces propios (`pedidos_compra`, `albaranes_compra`, `facturas_compra`, `compras_comun`) — el trabajo de i18n de Compras (Fase 3/3-bis, ver commits recientes) **ya está hecho**, así que la migración a drawer no tiene que tocar textos, solo estructura.

### Diferencias funcionales relevantes venta vs. compra (afectan la migración)

1. **Dirección del stock — la asimetría más importante**:
   - *Venta* (`AlbaranVentaForm`): **consume** de lotes ya existentes (`stock_lotes_producto_final`, `stock_lotes_articulo`) — el formulario es "elige un lote con stock disponible y resta de él".
   - *Compra* (`AlbaranesCompra`): **crea** lotes nuevos (`entrada_material`, con `codigo_lote` autogenerado, `fecha_caducidad`, `temperatura_recepcion`) — el formulario es "da de alta N líneas con sus propios datos", estructuralmente mucho más parecido a `PedidoForm.jsx` (líneas simples tipo tabla) que a `AlbaranVentaForm.jsx` (selección de lote + reparto de previsiones). **No hay componentes tipo `ProductoParaVender`/`FilaBloqueada` que copiar** — esa parte de `AlbaranVentaForm` no tiene equivalente útil en Compras.

2. **Catálogo dependiente de proveedor, cargado dinámicamente**:
   - Compras filtra artículos por proveedor vía la tabla puente `articulo_proveedor` (con precio pactado y referencia del proveedor), recargando `articulosDelProveedor` en un `useEffect` cada vez que cambia `proveedorId`.
   - Ventas no tiene equivalente: `productos`/`articulosMercaderia` son catálogos globales, pasados como prop estática por el padre, sin recarga dependiente de cliente.
   - Implicación: el futuro `PedidoCompraForm`/`AlbaranCompraForm` en drawer necesitará su propio `useEffect` de recarga por proveedor (no puede limitarse a recibir todo por props como hace `PedidoForm.jsx`).

3. **Edición con líneas bloqueadas (solo en Compras)**:
   - `AlbaranesCompra.jsx` calcula, al editar, qué líneas de `entrada_material` ya fueron consumidas (`consumo_produccion`, `consumo_produccion_pf`, `ajustes_articulo`) y las renderiza en modo solo-lectura parcial (`locked: true`, solo caducidad/notas editables).
   - Ventas no tiene nada parecido (su única edición, Pedidos, sí bloquea la edición completa si hay producción/albarán asociado, pero es "todo o nada", no por línea).

4. **Total de factura manual vs. calculado**:
   - `FacturaVentaForm`: el campo `total` **no existe** en el formulario — se calcula siempre server-side a partir de las líneas de los albaranes incluidos (`calcularTotalDeAlbaranes`), endurecido en `CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md`.
   - `FacturasCompra.jsx`: el campo `total` (con IVA) es un `<Input type="number">` que el usuario rellena a mano — no hay tabla de líneas de factura de compra que sumar (las facturas de compra no tienen líneas propias, solo relacionan albaranes).
   - Esto es una decisión de negocio deliberada y probablemente **no** deba tocarse solo por adoptar el drawer — un cambio a "total calculado" en Compras sería un cambio funcional aparte, fuera del alcance de "solo migrar a drawer".

5. **Sin registro de pagos/saldos en Compras**:
   - Ventas tiene un sistema completo de saldos/cobros (`saldosVenta.js`, `RegistrarPagoForm`, drawer `pagoDrawer`, iconos de estado de cobro en la tabla).
   - Compras no tiene ningún equivalente (`grep` de "pago"/"saldo" + "compra" no devuelve nada) — no hay que replicar un segundo drawer de pago en esta migración, salvo que se pida explícitamente como funcionalidad nueva.

6. **Confirmación al cambiar de proveedor con líneas rellenas** (solo Compras, en Pedidos de compra):
   - `PedidosCompra.jsx` tiene un `confirm()` si el usuario cambia de proveedor con líneas ya rellenas (porque cambiar de proveedor vacía el catálogo de artículos disponibles). Ventas no necesita nada así porque su catálogo de productos no depende del cliente.

7. **Recepción de pedido como albarán — mismo patrón de navegación, pero destino con más estados que gestionar**:
   - `PedidosCompra.jsx` → `navigate('/albaranes-compra?pedido_compra_id=${p.id}')`, exactamente igual que Ventas (`pedido_id`). Al migrar, `AlbaranesCompra.jsx` deberá leer ese param y auto-abrir su drawer igual que `AlbaranesVenta.jsx`, pero **con la complicación añadida** de que hoy ese flujo ya alimenta un `tipoOrigen` (`'pedido'` vs `'compra_directa'`) con un `<select>` de pedidos pendientes — ese selector de tipo de origen no existe en Ventas y debe preservarse dentro del formulario en drawer.

---

## 6. RIESGOS / PUNTOS DE ATENCIÓN

1. **No copiar `AlbaranVentaForm.jsx` como plantilla literal.** Es el formulario más complejo de los tres y su complejidad entera (selección de lote FIFO, `FilaBloqueada`, reparto multi-tanda, previsiones de producción) **no aplica a Compras** porque compra crea lotes, no los consume. El componente más parecido en espíritu a lo que necesita `AlbaranCompraForm` es `PedidoForm.jsx` (líneas simples en lista) combinado con la lógica de líneas bloqueadas que YA EXISTE en el `AlbaranesCompra.jsx` actual (solo hay que extraerla a un componente, no reinventarla).

2. **La edición en drawer necesita el patrón de 3 estados (`null`/`'nuevo'`/objeto), no el booleano simple.** Como `AlbaranesCompra.jsx` sí soporta edición (a diferencia de `AlbaranesVenta.jsx`), su drawer debe replicar el `modoDrawer` de `Pedidos.jsx`/`PedidoForm.jsx`, no el `drawerAbierto` booleano de `AlbaranesVenta.jsx`. Mezclar el patrón equivocado perdería la funcionalidad de edición que Compras ya tiene hoy.

3. **Migrar las líneas bloqueadas (`locked`) exige cuidado con las 3 consultas de bloqueo** (`consumo_produccion`, `consumo_produccion_pf`, `ajustes_articulo`) — esa lógica async vive hoy en `handleEditar` de `AlbaranesCompra.jsx` y deberá moverse dentro del futuro `AlbaranCompraForm.jsx` (recibiendo el albarán a editar como prop) o quedarse en el padre antes de abrir el drawer (como hace `Pedidos.jsx` con su `handleEditar` async antes de `setModoDrawer`). Recomendado: seguir el patrón de `Pedidos.jsx` (validar/cargar en el padre, luego abrir el drawer ya con todo resuelto) para no bloquear la apertura del drawer con un formulario a medio cargar.

4. **`articulosDelProveedor` es estado derivado que hoy vive en la pantalla, no en el formulario.** Al extraer el formulario a un componente separado, hay que decidir: ¿el padre sigue cargando el catálogo por proveedor y se lo pasa como prop reactivo (requeriría que el padre conozca el `proveedorId` seleccionado dentro del formulario, rompiendo el aislamiento), o el propio `XCompraForm` hace su `useEffect` de carga por proveedor internamente (más aislado, mismo criterio que "el hijo no debe filtrarse desde fuera")? **Recomendado seguir el segundo camino** — mantiene la separación limpia que Ventas ya estableció (el formulario es dueño de su estado, el padre solo pasa catálogos "base" no filtrados).

5. **No confundir "migrar a drawer" con "igualar reglas de negocio".** Los puntos 4 y 6 de la sección 5 (total manual en factura de compra, confirmación al cambiar de proveedor) son decisiones de negocio ya existentes y deliberadas — la migración debe preservarlas tal cual, no "corregirlas" para que se parezcan más a Ventas salvo que el usuario lo pida explícitamente.

6. **Dependencias cruzadas con Inventario/Producción a vigilar en el refresco tras guardar:**
   - Un albarán de compra nuevo crea `entrada_material`, que alimenta directamente `stock_lotes_articulo` — pantallas como `Inventario.jsx` o los selectores de lote dentro de `AlbaranVentaForm.jsx` (venta) leen ese stock. **No hay problema de sincronización entre pestañas/pantallas** porque cada una recarga su propio stock al montar/abrir su drawer (no hay cache compartida), pero si en el futuro se abre el drawer de "nuevo albarán de compra" simultáneamente con un drawer de venta abierto en otra pestaña, el de venta no se refrescará solo — comportamiento ya existente y aceptado en el patrón de ventas (no es una regresión a introducir, es una limitación conocida a heredar conscientemente).
   - Borrar un albarán de compra en el patrón actual ya comprueba `consumo_produccion`/`consumo_produccion_pf`/`ajustes_articulo` antes de confirmar el borrado (mismo espíritu que el aviso de "tiene facturas" al borrar un albarán de venta) — esta lógica de aviso debe sobrevivir intacta al mover el borrado fuera del formulario (sigue siendo una acción de la fila del listado, no del drawer, igual que en Ventas).
   - `pedidos_compra.estado` se actualiza automáticamente en BD al recibir un albarán completo (mismo mecanismo que `pedidos_venta.estado`/`grupo_estado`, ver migraciones `20260816_fix_estado_pedido_compra.sql` / `20260928_grupo_estado_pedidos_venta.sql`) — si se quiere el mismo agrupamiento visual "activos arriba, cerrados al fondo" que tiene `Pedidos.jsx` (venta), Compras necesitaría una columna generada `grupo_estado` análoga, que **hoy no existe** para `pedidos_compra` (es una mejora nueva, no parte de "solo mover a drawer").

7. **Paginación/filtros server-side son opcionales pero recomendables por volumen, no por el drawer en sí.** El drawer no obliga a añadir paginación ni filtros — son mejoras que llegaron juntas en Ventas por los contratos `CONTRATO_FILTROS_VENTA.md` y bloques 4/5 de cada contrato UX, pero conceptualmente son independientes del drawer. Conviene decidir explícitamente en `CONTRATO_DRAWERS_COMPRAS.md` si esta migración **solo** cambia el contenedor (form inline → drawer) o si también añade paginación/filtros/orden server-side de una vez, para no mezclar alcance sin que quede documentado.

---

## Resumen ejecutivo para `CONTRATO_DRAWERS_COMPRAS.md`

- El "framework" a reutilizar literalmente es pequeño: el componente `Drawer` de `ui.jsx` y las primitivas de formulario. Todo lo demás es **convención a repetir**, no código a importar.
- La plantilla de listado más cercana a copiar para las tres pantallas de Compras es `Pedidos.jsx` (porque ya soporta edición vía `modoDrawer` de 3 estados) — `AlbaranesVenta.jsx`/`FacturasVenta.jsx` sirven de referencia solo para el caso "solo alta".
- La plantilla de formulario más cercana para `AlbaranCompraForm` es `PedidoForm.jsx` (líneas en lista simple) + la lógica de líneas bloqueadas ya existente en `AlbaranesCompra.jsx`, **no** `AlbaranVentaForm.jsx` (que resuelve un problema distinto: consumo de lotes FIFO).
- Puntos que requieren una decisión explícita antes de picar código: (a) si se añade paginación/filtros server-side a la vez o en un paso posterior; (b) si `articulosDelProveedor` se carga dentro del formulario o se sigue pasando desde el padre; (c) si se introduce un `grupo_estado` para `pedidos_compra` análogo al de venta.
