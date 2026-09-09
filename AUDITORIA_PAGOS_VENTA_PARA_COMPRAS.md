# Auditoría: sistema de cobros de Venta, para clonar en Compras

Documento de solo lectura. No se ha modificado ni propuesto ningún archivo de código ni SQL — es fase de diseño, base para `CONTRATO_DRAWERS_COMPRAS.md` y `CONTRATO_PAGOS_COMPRA.md`.

Fuente original del sistema auditado: `CONTRATO_PAGOS_VENTA.md` (referenciado en casi todos los comentarios del código) + `CONTRATO_FACTURAS_VENTA_ENDURECIMIENTO.md` + `CONTRATO_UX_FACTURAS_VENTA.md` (Bloque 1, vista de saldo).

---

## 1. `saldosVenta.js` — [frontend/src/lib/saldosVenta.js](frontend/src/lib/saldosVenta.js)

### Funciones exportadas

| Función | Recibe | Devuelve | Uso |
|---|---|---|---|
| `EPSILON` (const) | — | `0.005` | Tolerancia de redondeo en CHF, compartida entre cálculo de saldo y `RegistrarPagoForm.jsx` — evitar dos nociones distintas de "es cero". |
| `estadoPago(saldo, total)` | `saldo` (number), `total` (number\|string) | `'pagada'` \| `'pendiente'` \| `'parcial'` | Clasifica un saldo ya calculado. Es pura, sin I/O. |
| `saldosDeAlbaranesSueltos(albaranIds)` | `number[]` (ids de albaranes YA sabidos como "sueltos", es decir no agrupados en ninguna factura viva) | `Map<albaranId, saldoPendiente>` | Usado por `AlbaranesVenta.jsx` (badge de cobro) y por `documentosPendientesCliente`. |
| `estadosPagoDeAlbaranesSueltos(albaranIds)` | `number[]` | `Map<albaranId, 'pagada'\|'parcial'\|'pendiente'>` | Mismo cálculo que la anterior, pero ya resuelto a estado — usado por el filtro "Cobro" en `AlbaranesVenta.jsx`. |
| `saldosDeFacturas(facturas, albaranesPorFactura)` | `facturas: {id, total}[]`, `albaranesPorFactura: Map<facturaId, albaranId[]>` (ya resuelta por el llamador) | `Map<facturaId, saldoPendiente>` | Saldo de una factura = total − aplicado directo a la factura − aplicado a los albaranes que agrupa. |
| `documentosPendientesCliente(clienteId)` | `number` | `Array<{ tipo: 'factura'\|'albaran', id, codigo, fecha, saldo }>` ordenado por fecha ascendente | Función que alimenta el drawer "Registrar pago" — trae TODOS los documentos con saldo > 0 de un cliente (facturas no anuladas + albaranes sueltos). |
| `clientesParaDrawer(clientesActivos, pagoDrawer)` | `clientesActivos: {id,nombre}[]`, `pagoDrawer: {clienteId, clienteNombre} \| null` | `{id,nombre}[]` | Helper de UI: añade el cliente preseleccionado a la lista de opciones si no está entre los activos (ej. cliente desactivado con saldo pendiente histórico). No hace ningún cálculo de saldo. |

Función interna (no exportada) relevante: `aplicadoPorDocumento(facturaIds, albaranIds)` — trae `pago_aplicacion` con `pagos(anulada)` embebido y **excluye toda aplicación cuyo pago esté anulado**, en el único punto donde se suma "lo aplicado". Ningún otro código del proyecto necesita acordarse de excluir pagos anulados por su cuenta.

### Fórmula exacta de saldo pendiente

```
saldo_pendiente = total_documento − Σ(monto_aplicado de pago_aplicacion, excluyendo pagos.anulada = true)
```

- **Nunca se persiste** ningún saldo — se recalcula siempre al vuelo, tanto en JS (`saldosVenta.js`) como en SQL (vista `facturas_venta_con_saldo`, misma fórmula duplicada intencionalmente en los dos lenguajes, ver sección 5).
- **Redondeo/tolerancia**: `EPSILON = 0.005` (medio céntimo). Se usa en tres sitios con semántica distinta:
  - `estadoPago`: `saldo <= EPSILON` → pagada; `saldo >= total - EPSILON` → pendiente; resto → parcial.
  - Vista SQL `facturas_venta_con_saldo`: mismo umbral hardcodeado (`<= 0.005`) para `prioridad_grupo`.
  - `RegistrarPagoForm.jsx`: para detectar "coincidencia exacta" en la auto-aplicación (`Math.abs(d.saldo - montoNum) < EPSILON`) y para decidir si el monto recibido quedó totalmente repartido (`Math.abs(sinAplicar) < EPSILON`).
- No hay redondeo de visualización distinto del que ya aplica `formatMoneda` (2 decimales, formato de moneda del locale).

### Relación factura vs. albarán — la propagación es "mirar hacia abajo"

- **No son independientes.** Un albarán puede estar en dos estados mutuamente excluyentes:
  1. **Suelto** (no agrupado en ninguna factura viva): su saldo se calcula directamente sobre sí mismo (`saldosDeAlbaranesSueltos`), y **es candidato a cobro directo**.
  2. **Agrupado en una factura no anulada** (vía la tabla puente `factura_venta_albaran`): el albarán **deja de tener saldo propio a efectos de cobro** — su cobro se gestiona íntegramente a través de la factura. El icono de estado de cobro en la fila del albarán, en ese caso, ni siquiera se calcula sobre el albarán: se **hereda el estado de la factura** (`AlbaranesVenta.jsx`, variable `claveCobro` dentro del `if (facturado)`).
- El saldo de una factura sí "mira hacia abajo": suma tanto los pagos aplicados **directamente a la factura** como los aplicados **a cualquiera de los albaranes que agrupa** (`saldosDeFacturas`, con el `via_albaran` join en la vista SQL). Esto permite que, técnicamente, un pago se aplique a un albarán que ya está dentro de una factura (aunque en la práctica el flujo normal de UI es aplicar a la factura una vez agrupada).
- Una **factura anulada** rompe la agrupación a efectos de cobro: sus albaranes "vuelven a estar disponibles" como sueltos (mismo criterio ya usado para poder re-facturarlos, `FacturaVentaForm.jsx`) — y su propio saldo pasa a ser `NULL` (no aplica, ver vista SQL, sección 4 de `CONTRATO_PAGOS_VENTA.md`: "una factura anulada no es un documento con saldo pendiente").

---

## 2. Modelo de datos de pagos

### Tabla `pagos` — el hecho de que el cliente pagó algo

Migración: [supabase/migrations/20260930_pagos_venta.sql](supabase/migrations/20260930_pagos_venta.sql)

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `bigint identity` | PK |
| `cliente_id` | `bigint` | `not null references clientes(id)` |
| `fecha` | `date` | `not null` |
| `monto` | `numeric(12,2)` | `not null check (monto > 0)` |
| `metodo` | `text` | `not null check (metodo in ('efectivo','twint','tarjeta','transferencia'))` |
| `anulada` | `boolean` | `not null default false` |
| `notas` | `text` | opcional |
| `negocio_id` | `uuid` | `not null default '<uuid negocio>' references negocios(id)` |
| `created_at` | `timestamptz` | `default now()` |

- **No hay columna de moneda** en `pagos` — la moneda es un dato del negocio entero (`empresa_config.moneda`, vía `useNegocio()`/`negocio?.moneda`), no del pago ni del cliente. Ver sección 7.
- **No hay `fecha_futura` bloqueada**: no existe ningún `check` sobre `fecha`, así que técnicamente se permite registrar un pago con fecha futura — no está prohibido ni a nivel de BD ni de formulario.
- **Sobrepago**: no hay ningún CHECK que impida que `monto` de un pago exceda el saldo pendiente total del cliente — la única defensa contra sobrepago es a nivel de UI (`RegistrarPagoForm`, ver sección 3): el formulario bloquea el *submit* si el total **aplicado a documentos** excede el monto recibido, pero **nada impide que el monto recibido en sí sea mayor que toda la deuda del cliente** — ese excedente simplemente queda "sin aplicar" (`sinAplicar > 0`), visible en `Pagos.jsx` pero sin ningún control que lo impida ni lo señale como error.

### Tabla `pago_aplicacion` — a qué documento(s) se aplica el pago

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `bigint identity` | PK |
| `pago_id` | `bigint` | `not null references pagos(id)` |
| `factura_venta_id` | `bigint` | `references facturas_venta(id)`, nullable |
| `albaran_venta_id` | `bigint` | `references albaranes_venta(id)`, nullable |
| `monto_aplicado` | `numeric(12,2)` | `not null check (monto_aplicado > 0)` |
| `negocio_id` | `uuid` | `not null default ...` |
| `created_at` | `timestamptz` | `default now()` |
| — | — | `constraint pago_aplicacion_exactamente_un_documento check ((factura_venta_id is not null and albaran_venta_id is null) or (factura_venta_id is null and albaran_venta_id is not null))` |

- El CHECK "exactamente un documento" es la pieza estructural clave: cada fila resuelve a un único destino, factura O albarán, nunca ambos ni ninguno.
- **No hay CHECK que impida que la suma de `monto_aplicado` de un documento exceda su total** (sobre-aplicación a nivel de documento) — de nuevo, control únicamente en UI.

### RLS y grants

- Ambas tablas: RLS habilitado, política única "Acceso total temporal" (`auth.role() = 'authenticated' and negocio_id = ...`).
- `pagos`: `grant select, insert, update` (el `update` es exclusivamente para poder marcar `anulada = true`, nunca para editar monto/cliente/fecha — no hay UI que lo permita).
- `pago_aplicacion`: **solo `grant select, insert`** — nunca `update` ni `delete`. Documentado explícitamente: "una fila de pago_aplicacion, igual que factura_venta_albaran, no se corrige ni se borra — si un pago se registró mal, se anula el pago entero, sus aplicaciones quedan intactas como rastro de auditoría".

### Triggers/vistas que recalculan estado al insertar/borrar un pago

- **No hay ningún trigger.** Es el punto de diseño central del contrato (documentado extensamente en los comentarios de la vista SQL, sección 4 del informe anterior citada aquí de nuevo porque es crítica): se **rechazó explícitamente**:
  - Una columna generada (`generated always as`) — Postgres no permite que lea tablas externas (`pago_aplicacion`/`pagos`).
  - Un trigger que mantenga una columna desnormalizada en `facturas_venta`/`albaranes_venta` — "reintroduce justo lo que el contrato rechaza: un valor persistido que alguien puede olvidar sincronizar", con más superficie de sincronización porque el trigger tendría que dispararse desde una tabla ajena.
  - Una vista materializada — necesitaría `REFRESH`, inaceptable para una pantalla que se abre justo tras registrar un pago.
- **Solución adoptada**: vista SQL normal (no materializada) — `facturas_venta_con_saldo` — recalculada en cada consulta, con `security_invoker = true` para respetar RLS de las tablas base. Ver detalle en sección 5.
- **No existe una vista equivalente para albaranes** (`albaranes_venta_con_saldo`) — el saldo de un albarán suelto se resuelve solo en JS (`saldosDeAlbaranesSueltos`), porque `AlbaranesVenta.jsx` no necesita ordenar/paginar por ese saldo en servidor (a diferencia de `FacturasVenta.jsx`, que sí agrupa por `prioridad_grupo`).

---

## 3. `RegistrarPagoForm.jsx` — [frontend/src/components/RegistrarPagoForm.jsx](frontend/src/components/RegistrarPagoForm.jsx)

### Props de entrada

```
<RegistrarPagoForm
  clientes={...}                     // lista para el <Select>, ya resuelta por el llamador (ver clientesParaDrawer)
  clienteIdInicial={null}            // opcional: precarga el cliente
  documentoPreseleccionado={null}    // opcional: { tipo: 'factura'|'albaran', id, saldo }
  onGuardado={fn}
  onCancelar={fn}
/>
```

### Campos del formulario

| Campo | Tipo | Default | Validación |
|---|---|---|---|
| Cliente | `<Select>` | `clienteIdInicial` o vacío | `required` |
| Fecha | `<DateInput>` | hoy (`new Date().toISOString().slice(0,10)`) | `required` |
| Monto recibido | `<Input type="number" step="0.01">` | `documentoPreseleccionado.saldo.toFixed(2)` si viene preseleccionado, si no vacío | `required`, `min="0.01"` |
| Método | `<Select>` (efectivo/twint/tarjeta/transferencia) | vacío | `required` |
| Notas | `<Textarea>` | vacío | opcional |
| Checkbox + monto por documento (uno por cada documento con saldo pendiente del cliente elegido) | lista dinámica | ver auto-aplicación abajo | el monto de cada aplicación marcada debe ser numérico y > 0 (implícito: filas con `apl.monto <= 0` se descartan silenciosamente al construir `filasAplicacion`, no hay `alert()` específico para ese caso) |

### Pagos parciales y múltiples aplicaciones en una sola sesión

- **Un único pago por sesión de formulario** (una sola fila `pagos`), pero ese pago **puede aplicarse a varios documentos a la vez** en el mismo submit — la tabla `pago_aplicacion` permite N filas por `pago_id`.
- Al elegir un cliente, se cargan TODOS sus documentos con saldo pendiente (`documentosPendientesCliente`) agrupados visualmente por tipo (Facturas / Albaranes), cada uno con checkbox + input de monto propio.
- **Auto-aplicación (propuesta, no impuesta)**: al escribir el monto recibido, si:
  - hay una coincidencia exacta (dentro de `EPSILON`) con el saldo de un único documento → se marca solo ese, por el total.
  - si no, se reparte FIFO por fecha ascendente (orden que ya trae `documentosPendientesCliente`) hasta agotar el monto o los documentos.
  - Si el drawer se abrió con `documentoPreseleccionado` (icono de acceso rápido de una fila), **ese documento manda siempre** sin pasar por la búsqueda genérica — corrección de un bug real documentado (dos documentos con igual saldo, competían y podía ganar el equivocado).
- En cuanto el usuario toca manualmente un checkbox o un monto (`tocadoManualmente = true`), la auto-aplicación **deja de recalcularse** al seguir cambiando el monto recibido — "la propuesta automática es un punto de partida, no una imposición".

### Qué pasa si el pago supera el saldo pendiente

- A nivel de **un documento individual**: el input de monto por documento no tiene `max` — el usuario puede escribir un valor mayor al saldo de ese documento a mano (no hay validación que lo impida al teclear).
- A nivel de **submit**: se calcula `excedeLoRecibido = totalAplicado > montoRecibido + EPSILON` — es decir, la única validación dura es que **la suma de lo aplicado a documentos no puede superar el monto recibido del pago**. Si se excede, el botón de submit queda deshabilitado (`disabled={guardando || excedeLoRecibido}`) y al intentar enviar de todos modos se muestra un `alert()`.
- Un indicador visual de 3 colores (`colorIndicador`) resume el estado del reparto en tiempo real: gris (sin monto), verde (aplicado == recibido, dentro de `EPSILON`), ámbar (recibido > aplicado, queda parte sin repartir — **permitido**, el pago se guarda igual con un remanente "sin aplicar"), rojo (aplicado > recibido — bloqueante).
- **No hay ninguna validación de que el monto aplicado a UN documento no supere SU saldo individual** — solo se valida el agregado contra el monto recibido total. Es decir: sí es posible, sin querer, marcar 100 en un documento con saldo 80 mientras el monto recibido es 120 y otro documento absorbe -20 conceptualmente inconsistente — el formulario no lo impide explícitamente línea por línea, solo vigila la suma total.

---

## 4. `pagoDrawer` — apertura y disparo

### Mismo componente de formulario, mismo botón/icono en ambas pantallas

- `AlbaranesVenta.jsx` y `FacturasVenta.jsx` reutilizan **el mismo `RegistrarPagoForm.jsx`**, sin ninguna variante — no hay dos formularios ni props condicionales por tipo de documento.
- Ambas pantallas declaran su propio estado `pagoDrawer` (`null` = cerrado; `{ clienteId, clienteNombre, documento: { tipo, id, saldo } }` = abierto y preseleccionado) — es estado **por pantalla**, no compartido ni levantado a un contexto común.
- El icono que dispara la apertura es distinto en cada pantalla (detalle menor, mismo significado):
  - `AlbaranesVenta.jsx`: `IconCash`, tooltip `ventas_comun:tooltip_registrar_cobro`.
  - `FacturasVenta.jsx`: `IconCoin`, mismo tooltip i18n.
  - Ambos solo se muestran si `tieneSaldoPendiente` (saldo > `EPSILON`), con `onClick` dentro de un contenedor `e.stopPropagation()` para no disparar el toggle de expandir la fila.
- Al pulsar el icono: `setPagoDrawer({ clienteId: doc.cliente_id, clienteNombre: doc.clientes?.nombre, documento: { tipo: 'albaran'|'factura', id: doc.id, saldo } })` — el `tipo` viene fijado por la pantalla que lo dispara (literal `'albaran'` en `AlbaranesVenta.jsx`, literal `'factura'` en `FacturasVenta.jsx`).
- El `<Drawer>` en ambas pantallas es idéntico en estructura (`title={t('ventas_comun:registrar_pago')}`, ancho por defecto sin `anchoClase`), pasando `clientes={clientesParaDrawer(clientesActivos, pagoDrawer)}`, `clienteIdInicial={pagoDrawer.clienteId}`, `documentoPreseleccionado={pagoDrawer.documento}`.
- También existe una **tercera vía de apertura**, sin preselección: el botón "Registrar pago" de `Pagos.jsx` (alta libre, `documentoPreseleccionado = null`, el usuario elige cliente y documentos desde cero).

### Diferencias de comportamiento albarán vs. factura

- **Ninguna a nivel de formulario o guardado.** `RegistrarPagoForm` no distingue en ningún punto de su lógica si `documentoPreseleccionado.tipo` es `'albaran'` o `'factura'` más allá de usarlo para: (a) el `find()` que localiza el documento en la lista recién cargada, y (b) qué columna (`factura_venta_id` vs `albaran_venta_id`) rellenar al construir `pago_aplicacion`.
- La única diferencia real está **antes** de abrir el drawer, en qué pantalla decide qué documentos son elegibles como "sueltos" (un albarán agrupado en una factura viva nunca ofrece su propio icono de cobro — hereda el de la factura, ver sección 1) — pero eso ocurre en `AlbaranesVenta.jsx`/`saldosVenta.js`, no en el formulario.

---

## 5. Iconos/indicadores de estado de cobro en la tabla

### Componente y configuración

- `EstadoIcono` (definido localmente en `AlbaranesVenta.jsx`, no exportado ni compartido) — recibe `{ cfg, label }` y pinta un icono Tabler con color, envuelto en un `<span title={label}>` para tooltip nativo.
- Configuración de colores por clave, **definida como objeto constante en cada archivo** (no una única fuente compartida entre Albaranes/Facturas de venta, aunque los 3 estados de cobro sí comparten semántica):
  ```js
  // AlbaranesVenta.jsx
  const ESTADO_COBRO_ICONO = {
    pagada:     { icon: IconCircleCheck,   color: 'text-green-600' },
    parcial:    { icon: IconCircleHalf2,   color: 'text-amber-600' },
    pendiente:  { icon: IconAlertTriangle, color: 'text-red-600' },
  }
  ```
- `FacturasVenta.jsx` no usa iconos por celda para el estado de cobro — usa `<Badge>` de texto con el mismo mapeo de color a `ESTADO_PAGO_BADGE = { pagada: 'green', parcial: 'amber', pendiente: 'gray' }` (nótese: **colores distintos** entre las dos pantallas para el mismo estado — pendiente es rojo en Albaranes pero gris en Facturas, con un comentario explícito documentando que fue una decisión consciente de rediseño: "Cobro usa los mismos 3 colores tanto si el estado es propio del albarán... nunca gris: pendiente pasa a rojo en este rediseño" — es decir, la paridad de color **no** es total hoy entre las dos pantallas de venta, algo a decidir explícitamente para Compras en vez de asumir "cuál es la correcta").
- Estado de Facturación (no de Cobro) en Albaranes tiene su propia configuración `ESTADO_FACTURACION_ICONO` (facturado/pendiente_particular/pendiente_empresa) — no aplica a Compras salvo que se quiera un concepto de "Estado de recepción de factura" análogo (fuera del alcance de "clonar cobros").

### Umbral y origen del cálculo

- Los 3 estados (`pagada` / `parcial` / `pendiente`) vienen siempre de `estadoPago(saldo, total)` en `saldosVenta.js` — mismo umbral `EPSILON` en todos los sitios (frontend y vista SQL).
- **Origen del dato — mixto, no uniforme entre las dos pantallas**:
  - `FacturasVenta.jsx`: el estado se calcula en **frontend**, pero a partir de `saldo_pendiente`/`total`/`anulada` que ya vienen **resueltos por la vista SQL** `facturas_venta_con_saldo` (no se llama a `saldosDeFacturas()` en JS para esto, la vista ya trae `saldo_pendiente` calculado) — el frontend solo aplica `estadoPago()` sobre esos valores ya traídos.
  - `AlbaranesVenta.jsx`: no hay vista SQL para albaranes — el estado se calcula **enteramente en frontend**, con una consulta batch aparte (`saldosDeAlbaranesSueltos`/`estadosPagoDeAlbaranesSueltos`) tras cargar la página de albaranes.
- Un cuarto estado, **"Anulada"**, no es un estado de saldo — es un `Badge` aparte basado directamente en la columna `facturas_venta.anulada`, independiente de `estadoPago()` (una factura anulada tiene `saldo_pendiente = NULL` en la vista, así que nunca entra en `estadoPago`).

---

## 6. Historial de pagos

**Sí existe una pantalla dedicada**: [frontend/src/pages/Pagos.jsx](frontend/src/pages/Pagos.jsx) (ruta propia, no es un sub-listado embebido dentro de Facturas/Albaranes).

- Sigue el mismo patrón de listado con drawer que el resto de Ventas (paginación server-side de 20, orden por Fecha, fila expandible en acordeón).
- La consulta trae `pagos` con `pago_aplicacion` embebido (incluyendo `facturas_venta(numero_factura)`/`albaranes_venta(numero_albaran)` para poder mostrar a qué documento fue cada céntimo sin queries N+1).
- Columnas: Fecha, Cliente, Monto recibido, Método (badge de color por método), Aplicado (suma de `pago_aplicacion`), Sin aplicar (remanente, en ámbar si > 0), Acciones.
- **Fila expandida**: tabla de detalle con una fila por cada aplicación del pago (Tipo factura/albarán, código del documento, monto aplicado) — esto es, en efecto, el "historial de a dónde fue este pago".
- **No existe el inverso**: no hay, dentro de `FacturasVenta.jsx`/`AlbaranesVenta.jsx`, un sub-listado de "todos los pagos que tocaron esta factura concreta" — solo se ve el **saldo actual** agregado en esas pantallas. Para ver el detalle de pagos de un documento concreto hay que ir a `Pagos.jsx` y no hay ningún filtro por documento ahí tampoco (solo ordena por fecha, sin filtro de cliente/documento) — **para auditar el historial de UNA factura concreta hoy hay que buscarla visualmente en `Pagos.jsx`**, no hay enlace directo desde la fila de la factura al pago que la saldó. Es una limitación real a tener en cuenta si `CONTRATO_PAGOS_COMPRA.md` quiere mejorar sobre esto (opcional, no heredado automáticamente por "clonar").
- **Anulación**: `handleAnular` en `Pagos.jsx` hace `UPDATE pagos SET anulada = true` (nunca DELETE) — mismo criterio de auditoría que facturas.

---

## 7. Relación con Proveedores

### Campos actuales de `proveedores`

Confirmado por [frontend/src/pages/Proveedores.jsx](frontend/src/pages/Proveedores.jsx) (hace `select('*')` y expone el formulario con estos campos exactos, sin ningún campo oculto adicional visible en el código): `id`, `razon_fiscal`, `nombre_comercial`, `cif`, `direccion`, `email`, `telefono`.

**No existe** ninguno de los siguientes campos hoy en `proveedores`:
- **Moneda**: no existe, y **no hace falta añadirlo** — ver siguiente apartado, la moneda es un dato global del negocio, no del tercero.
- **Condiciones de pago** (días de vencimiento, pronto pago, etc.): no existe ningún campo así ni en `proveedores` ni en `clientes`. El sistema de cobros de Venta **tampoco** lo usa — no hay concepto de "fecha de vencimiento" ni "días de crédito" en `pagos`/`pago_aplicacion`/las vistas. Si `CONTRATO_PAGOS_COMPRA.md` quisiera introducir condiciones de pago (habitual en compras, donde sí importa cuándo vence pagarle a un proveedor), sería una funcionalidad **nueva**, no una paridad con Venta — Venta no lo tiene y por tanto no hay nada que clonar en ese punto concreto.
- **IBAN / datos bancarios del proveedor**: no existe. Tampoco existe nada equivalente en `clientes`. Sería, de nuevo, una extensión nueva si se quisiera (por ejemplo, para generar una remesa de pagos), no parte del sistema a clonar.

### Moneda — confirmación CHF, mismo mecanismo que Venta

- La moneda **no vive en `clientes` ni en `proveedores`**, ni en `pagos`, ni en ninguna tabla de documentos (`facturas_venta`, `albaranes_venta`, etc.) — vive en **`empresa_config`** (una única fila por negocio), campo `moneda`, expuesta a toda la app vía `NegocioContext.jsx` → `useNegocio()` → `negocio.moneda`.
- `formatMoneda(valor, moneda = 'CHF')` en [frontend/src/lib/formatCantidad.js:36](frontend/src/lib/formatCantidad.js#L36) es el **único punto de formato de moneda del proyecto**, con un comentario explícito documentando el bug histórico:
  > "consolida todos los sitios que antes concatenaban ' €' o ' CHF' a mano (bug real: varios mezclaban € heredado de una plantilla inicial con CHF, la moneda correcta del negocio)."
- **Confirmado: el símbolo/código a usar en Compras debe ser exactamente el mismo mecanismo — `formatMoneda(valor, negocio?.moneda)`**, nunca un literal `'CHF'` ni mucho menos `'€'` hardcodeado en ningún componente nuevo de Compras. No hace falta ni se debe añadir ningún campo de moneda a `proveedores` — sería una duplicación conceptual incorrecta (la moneda es del negocio que opera, no del tercero con el que se factura, salvo que el negocio quisiera soportar multi-moneda por proveedor, que **no es el caso hoy** en ningún punto del sistema de Venta que se está clonando).
- Riesgo concreto a vigilar en el nuevo código de Compras: cualquier `<Input>`/etiqueta que escriba "CHF" o "€" a mano en vez de pasar por `formatMoneda` reintroduciría exactamente el bug ya corregido una vez.

---

## 8. Estructura de Facturas y Albaranes de compra

### Relación múltiples-albaranes-a-una-factura: SÍ existe, misma forma que Venta

- Tabla puente `factura_compra_albaran` — confirmada en uso real en [FacturasCompra.jsx:29](frontend/src/pages/FacturasCompra.jsx#L29) (`factura_compra_albaran(albaranes_compra(id, numero_albaran, fecha))`) y en las migraciones (`20260807_negocio_id_particion.sql`, `20260907_default_negocio_id_dinamico.sql`, comentario en `20260813_ingredientes.sql`: "PK compuesta de las dos FKs", igual patrón que `factura_venta_albaran`).
- `FacturasCompra.jsx` ya calcula "qué albaranes de compra están disponibles para facturar" con la misma lógica que `FacturaVentaForm.jsx` (`cargarAlbaranesDelProveedor`: trae albaranes del proveedor + `factura_compra_albaran` para excluir los ya facturados) — **con una diferencia importante**: esa exclusión hoy es incondicional (`idsYaFacturados = new Set((resYaFacturados.data||[]).map(r => r.albaran_compra_id))`), **sin el filtro de "solo si la factura no está anulada"** que sí tiene el equivalente de Venta (`!r.facturas_venta?.anulada`). Esto es coherente con el siguiente punto: **hoy no existe el concepto de factura de compra anulada**, así que no hay nada que filtrar todavía — pero es una pieza que `CONTRATO_PAGOS_COMPRA.md`/`CONTRATO_DRAWERS_COMPRAS.md` deberá decidir explícitamente si se introduce (ver más abajo).
- **Conclusión**: sí, el saldo de una factura de compra podría calcularse con la misma fórmula "mirar hacia abajo" (directo a la factura + a través de `factura_compra_albaran` a los albaranes que agrupa) que usa `saldosDeFacturas()` en Venta — la forma relacional es idéntica.

### Estado de pago / columnas a reconciliar — se parte prácticamente de cero, con una laguna real a decidir

- **`facturas_compra` NO tiene columna `anulada`.** Solo `facturas_venta` la recibió (`20260929_facturas_venta_anulada.sql`); no hay ninguna migración equivalente para `facturas_compra`. Confirmado además por el propio código: `FacturasCompra.jsx` → `handleBorrar` hace **`DELETE` físico** (`supabase.from('facturas_compra').delete().eq('id', id)`), no una anulación — a diferencia de `FacturasVenta.jsx`, que nunca borra, solo `UPDATE anulada = true`.
  - **Esto es una decisión que hay que tomar en el contrato, no asumir**: para tener paridad real con el sistema de cobros de Venta (que depende estructuralmente de `anulada` para decidir si una factura sigue "viva" a efectos de saldo/agrupación), `facturas_compra` necesitaría un tratamiento equivalente — o bien añadir `anulada` (cambiando `handleBorrar` de DELETE a UPDATE, con el impacto que eso tiene en `factura_compra_albaran` y en la disponibilidad de sus albaranes para re-facturar), o bien diseñar el sistema de pagos de compra asumiendo que las facturas de compra sí se pueden borrar físicamente (lo cual complica menos el modelo de pagos, porque un borrado físico ya elimina cualquier saldo pendiente sin más, pero es INCONSISTENTE con el patrón "nunca DELETE, todo con rastro de auditoría" que sí sigue todo el sistema de Venta, incluida la propia tabla `pagos`).
- **No existe ninguna columna `estado_pago` ni similar** en `facturas_compra` ni en `albaranes_compra` hoy — no hay nada que reconciliar en ese sentido, se parte limpio.
- **`metodo_pago`** ya existe, pero **solo en `albaranes_compra`** (migración `20260806_metodo_pago_albaranes_compra.sql`, valores `'efectivo' | 'transferencia' | 'otro'` — nótese: **enum distinto** al `metodo` de `pagos` en Venta, que es `'efectivo' | 'twint' | 'tarjeta' | 'transferencia'`), junto con `sin_factura_prevista` (booleano). Esta columna hoy es **descriptiva de la intención de pago de una compra directa sin factura** (una anotación libre, no ligada a ningún registro de pago real ni a ningún saldo) — es un campo a **reconciliar explícitamente** con el nuevo sistema: ¿se deprecia en favor de un pago real registrado en la nueva tabla de pagos de compra?, ¿convive porque cubre el caso "efectivo, nunca habrá factura ni pago formal"?, ¿se migra su dato histórico? Esto debe decidirse en `CONTRATO_PAGOS_COMPRA.md`, no inferirse.
- **`pedidos_compra.estado`** (`pendiente`/`recibido`/`cancelado`) es un estado de flujo logístico (¿se recibió la mercancía?), no de pago — no hay solapamiento conceptual con el nuevo sistema, no necesita reconciliación.

---

## 9. Nomenclatura sugerida

### Nombre de tabla nueva

- **Sin colisión posible con `cobro`**: no existe ninguna tabla `cobros`/`cobros_venta` hoy — el sistema de Venta ya usa el nombre genérico **`pagos`** (sin sufijo `_venta`) para la tabla de dinero entrante, y **`pago_aplicacion`** para la tabla puente.
- **Esto crea un problema de nomenclatura real, no solo cosmético**: si Compras usa `pagos_compra`, conviviría en la misma base de datos con una tabla `pagos` (a secas) que en realidad es específica de Venta — la asimetría de nombres (`pagos` vs `pagos_compra`) sugeriría erróneamente que `pagos` es genérica/compartida cuando no lo es en absoluto (tiene `cliente_id not null`, FKs a `facturas_venta`/`albaranes_venta`). Alguien que llegue nuevo al proyecto podría razonablemente asumir que "pagos" cubre ambos flujos.
- **Dos caminos posibles a decidir en el contrato** (no se propone SQL, solo se plantea la decisión):
  1. **Nombrar la tabla nueva sin ambigüedad** — algo como `pagos_compra` / `pagos_proveedor` — y aceptar la asimetría de nombres con `pagos` (Venta) como deuda histórica ya asumida, documentándolo explícitamente para que no vuelva a confundir.
  2. **Renombrar `pagos` → `pagos_venta`** en la misma pasada (con su cascada de FKs, RLS, vista `facturas_venta_con_saldo`, y todo el frontend que la referencia) para que ambas tablas queden simétricas (`pagos_venta` / `pagos_compra`). Es un cambio de mayor alcance y riesgo (toca un módulo en producción), probablemente fuera del alcance razonable de "añadir pagos a compras" salvo que se decida explícitamente asumir ese coste ahora en vez de acumular más deuda.
  - Recomendación para decidir, no para ejecutar: la opción 1 es la de menor riesgo inmediato; la opción 2 es la más correcta a largo plazo. Debe ser una decisión consciente del usuario en el contrato, no algo que se resuelva implícitamente al picar código.

### "Cobro" vs "pago" — la terminología YA es inconsistente hoy, antes incluso de tocar Compras

- El código de Venta **ya mezcla los dos términos para el mismo concepto** (dinero entrante):
  - La **tabla**, el **componente** (`RegistrarPagoForm.jsx`), la **página** (`Pagos.jsx`), el **botón** ("Registrar pago", clave i18n `ventas_comun:registrar_pago`) y los **estados** (`enums:estado_pago`) usan siempre **"pago"**.
  - Pero el **tooltip del icono de acceso rápido** en las filas de Albaranes/Facturas usa **"cobro"** (`ventas_comun:tooltip_registrar_cobro`), y la **columna de filtro/estado** en `AlbaranesVenta.jsx` se llama **"Cobro"** (`albaranes_venta:filtros.cobro`, `albaranes_venta:tabla.cobro`).
- En español contable estricto, "cobro" (dinero que entra, desde la perspectiva del que vende) y "pago" (dinero que sale, desde la perspectiva del que compra) son términos distintos y no intercambiables — el proyecto ya los mezcla dentro del propio módulo de Venta (entidad = "pago", pero etiqueta de UI = "cobro" en varios sitios).
- **Implicación directa para `CONTRATO_PAGOS_COMPRA.md`**: si se reutiliza literalmente la palabra "pago" para el nuevo sistema de Compras (que es, semánticamente, el uso *correcto* del término — pagar a un proveedor sí es un pago), **colisiona en la cabeza del usuario/desarrollador** con el "pago" ya existente de Venta, que en realidad es conceptualmente un cobro. No es una colisión de nombres de tabla (si se elige `pagos_compra` no hay colisión técnica), sino una **colisión de vocabulario de dominio**: dos features en el mismo proyecto usando la misma palabra para dos direcciones de dinero opuestas.
- **Recomendación a decidir en el contrato** (de nuevo, decisión, no ejecución): esta es una buena oportunidad para fijar terminología de una vez —
  - Opción A: dejar "pago" para compras (dirección correcta del término) y aceptar que el módulo de Venta seguirá llamándose "pago" aunque semánticamente sea un cobro (ya es así hoy, no se corrige retroactivamente).
  - Opción B: aprovechar y renombrar la UI de Venta hacia "cobro" de forma consistente (tabla y componente pueden seguir llamándose `pagos`/`RegistrarPagoForm` a nivel técnico sin romper nada, cambiando solo textos i18n) para que la distinción de vocabulario quede clara de cara al usuario final: "Cobros" (Venta) vs "Pagos" (Compras).
  - Cualquiera de las dos es válida — lo importante es que quede **fijada explícitamente por escrito en el contrato**, no que se herede sin más la inconsistencia ya presente.

---

## Resumen ejecutivo para los dos contratos

**Para `CONTRATO_PAGOS_COMPRA.md`:**
- El modelo de datos a clonar es: una tabla de "hecho de pago" (`cliente_id`→ análogo `proveedor_id`, monto, fecha, método, `anulada`, notas) + una tabla puente de aplicación con el mismo CHECK "exactamente un documento" (factura de compra XOR albarán de compra) + ninguna columna de saldo persistida en ningún lado, todo calculado al vuelo con la misma fórmula (total − aplicado, excluyendo aplicaciones de pagos anulados).
- Decisiones que el contrato debe fijar explícitamente antes de tocar código: (a) nombre de la tabla nueva y si se toca o no el nombre de `pagos` existente; (b) terminología "pago" vs "cobro" de cara a UI; (c) si `facturas_compra` recibe una columna `anulada` (y su `handleBorrar` deja de hacer DELETE físico) o si el modelo de pagos de compra se diseña asumiendo que las facturas de compra siguen siendo borrables de verdad; (d) qué pasa con el `metodo_pago`/`sin_factura_prevista` ya existente en `albaranes_compra`; (e) si el enum de método de pago de compra es el mismo que el de venta (`efectivo`/`twint`/`tarjeta`/`transferencia`) o uno propio (compras probablemente no usa Twint, y sí podría necesitar algo como "cheque" o "domiciliación" — a confirmar con el usuario, no asumir paridad ciega).
- Moneda: usar siempre `negocio?.moneda` vía `useNegocio()` + `formatMoneda()`, igual que Venta — no añadir ningún campo de moneda a `proveedores`.
- No hay nada que clonar en cuanto a "condiciones de pago"/IBAN — Venta tampoco lo tiene, sería un añadido nuevo si se pidiera explícitamente.

**Para `CONTRATO_DRAWERS_COMPRAS.md`:**
- Si `CONTRATO_PAGOS_COMPRA.md` se ejecuta, el drawer de "Registrar pago a proveedor" debe seguir exactamente el mismo patrón ya auditado en el informe anterior (estado `pagoDrawer` por pantalla, mismo formulario reutilizado desde Albaranes y Facturas de compra, icono con `stopPropagation`, `onGuardado` → cerrar + `cargarDatos()`) — no hace falta volver a auditar esa mecánica, ya está cubierta por `AUDITORIA_DRAWERS_VENTAS_PARA_COMPRAS.md`.
- Si se decide crear una pantalla `PagosCompra.jsx` análoga a `Pagos.jsx`, es una cuarta pantalla nueva de Compras (no uno de los tres módulos originales), a añadir explícitamente al alcance si se quiere paridad completa con el historial de pagos de Venta.
