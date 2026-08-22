# Contrato: Plantilla PDF del albarán de venta (Lieferschein)

Rediseño de la plantilla PDF del albarán de venta, sustituyendo el layout genérico compartido
con Factura de venta por una plantilla propia en alemán, inspirada en el Lieferschein de
referencia de Española (adjunto en la conversación de origen, no versionado en el repo).
Alcance exclusivamente de presentación: no toca la lógica de negocio de `pedidos_venta` ni de
`albaranes_venta`, ni la generación de Factura de venta.

Estado: implementado, pendiente de "comprobado en frontend" antes de commit/push (ver
metodología del proyecto). Ver "Addenda: decisiones de la sesión (2026-08-22)" más abajo para
el detalle completo de las decisiones de diseño y los hallazgos durante la exploración.

---

## Addenda: decisiones de la sesión (2026-08-22)

**1. `generarDocumentoPdf()` (`frontend/src/lib/generarPdf.js`) es compartida por Albarán de
venta Y Factura de venta** (`AlbaranesVenta.jsx` y `FacturasVenta.jsx`, mismo `tipo` como
parámetro). Rediseñar esa función habría cambiado también el PDF de Factura, fuera de alcance.
Se creó **`frontend/src/lib/generarAlbaranVentaPdf.js`** como función nueva e independiente
(`generarAlbaranVentaPdf`, `descargarAlbaranVentaPdf`, `imprimirAlbaranVentaPdf`).
`generarPdf.js` queda intacto, Factura de venta sigue con el diseño anterior sin cambios.

**2. jsPDF no puede usar fuentes web vía `<link>` de Google Fonts** — el texto dentro de un PDF
generado por jsPDF no lee CSS/DOM, necesita el `.ttf` embebido en base64 vía `doc.addFileToVFS()`
+ `doc.addFont()`. Montserrat y Space Mono **no estaban cargadas en el proyecto en absoluto**
(verificado: sin `<link>` en `index.html`, sin `@font-face` en `index.css`/`App.css`). Se
añadieron 5 archivos TTF estáticos en `frontend/src/assets/fonts/` (licencia SIL OFL 1.1, ver
`OFL.txt` en esa carpeta):
- `Montserrat-Regular.ttf` / `Montserrat-Bold.ttf` — Google Fonts solo distribuye Montserrat
  como fuente variable; los estáticos vienen del repo original (github.com/JulietaUla/Montserrat).
- `SpaceMono-Regular.ttf` / `SpaceMono-Bold.ttf` / `SpaceMono-Italic.ttf` — de
  github.com/google/fonts (ofl/spacemono), estático.

Se registran en el `doc` de jsPDF bajo dos familias (`Montserrat`, `SpaceMono`) con sus estilos
`normal`/`bold`/`italic`, cacheando la conversión a base64 a nivel de módulo (un solo fetch por
sesión, no por PDF generado).

**3. Reparto tipográfico aplicado** (instrucción original del usuario):
- **Montserrat** (bold en títulos de sección, normal en etiquetas menores): "Lieferschein"
  + número, "DATUM:", "VON:"/"AN:", "LIEFERDETAILS", "ZWISCHENSUMME:", "BEMERKUNGEN:",
  "SPANISCHI STUURHAIT", "ESPANOLA.CH".
- **Space Mono** (normal en cuerpo, bold en cabecera de tabla, italic en tagline/cita del
  footer): valores de fecha, datos de VON/AN (nombre, dirección, CIF), toda la tabla
  LIEFERDETAILS (cabecera y cuerpo), el importe de ZWISCHENSUMME, la línea de contacto E/T.
- El wordmark "ESPAÑOLA" del membrete **no se tipografía aparte** — ya viene incluido en el
  logo raster reutilizado tal cual (`empresa.logo_url`), no se regenera.

Como esto exige mezclar dos fuentes en una misma línea (p.ej. "Lieferschein" en Montserrat +
el número en Space Mono, ambos terminando alineados a la derecha), se añadió un helper interno
`lineaMixtaDerecha()` que compone la línea de derecha a izquierda calculando el ancho de cada
segmento con `getTextWidth()` (jsPDF no soporta estilos mixtos dentro de un mismo `doc.text()`).

**4. `unidad` no estaba en el join de líneas del albarán.** El query original de
`AlbaranesVenta.jsx` traía `productos_finales(nombre)` / `articulos_compra(nombre)` sin
`unidad`, así que la columna EINHEIT no tenía dato real disponible. Se amplió el `select` a
`productos_finales(nombre, unidad)` / `articulos_compra(nombre, unidad)` y se añadió el helper
`unidadLineaVenta()` (mismo patrón que el `nombreLineaVenta()` ya existente), con fallback a
`'ud'` para líneas libres/servicio sin producto ni artículo asociado.

**5. `formatCantidad`/`formatPrecio` (`lib/formatCantidad.js`) no se usaban en el generador
genérico** (formateaba con `.toFixed(2)` a mano). La nueva plantilla sí los usa: MENGE vía
`formatCantidad(cantidad, unidad)`, PREIS/TOTAL vía `formatPrecio(...)` + `" €"` (se mantiene
€, no CHF — la referencia es un ejemplo visual de una empresa suiza, pero los datos reales del
ERP siguen siendo de una empresa con CIF español). Notación es-ES (coma decimal) por
instrucción explícita de "no reinventar formato", aunque el documento esté en alemán.

**6. DATUM por línea:** `lineas_albaran_venta` no tiene fecha propia por línea (solo
`cantidad`, `precio_unitario`, `descripcion`/producto). La columna DATUM de la tabla repite la
fecha del propio albarán en cada fila — no se ha tocado el esquema para añadir una fecha por
línea, fuera de alcance de un cambio de presentación.

**7. BEMERKUNGEN usa el campo `notas` ya existente de `albaranes_venta`** (editable en el
formulario de alta), no texto hardcodeado. Convención adoptada: `notas` es un único `<input
type="text">` en la BD, así que varios bullets se separan por `;` (p.ej. `Frágil; Entregar
antes de las 12h`). Si `notas` está vacío, se muestran dos líneas por defecto en alemán
(constante `BEMERKUNGEN_POR_DEFECTO` en el propio archivo, fácil de editar) para que la
plantilla no quede vacía por defecto. El footer ("SPANISCHI STUURHAIT" + tagline + cita +
"ESPANOLA.CH") sí queda fijo/hardcodeado — es copy de marca fija, no dato del albarán, igual
que en la referencia.

**8. Multi-negocio ("Company Valencia"):** verificado que hoy es inactivo — la tabla `negocios`
tiene una única fila y el frontend no filtra por `negocio_id` en ningún punto (columna añadida
a nivel de BD en `20260807_negocio_id_particion.sql` pero sin selector/lógica en frontend). No
se ha construido ninguna variante condicional por negocio; si en el futuro se activa un segundo
negocio con datos/idioma distintos, esta plantilla necesitará esa lógica entonces.

**9. Pendiente explícito, fuera de esta sesión:** verificación visual en el frontend real
(botones "Imprimir"/"Descargar PDF" de un albarán con líneas y logo reales) antes de commit,
según la metodología del proyecto.
