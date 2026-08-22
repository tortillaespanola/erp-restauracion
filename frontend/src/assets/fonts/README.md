# Fuentes embebidas para el PDF del albarán de venta

TTF estáticos (no variables), licencia SIL Open Font License 1.1 (ver `OFL.txt`).
Usados por `generarAlbaranVentaPdf.js` vía `doc.addFont()` — jsPDF necesita el binario
TTF, no sirve cargarlas por `@font-face`/Google Fonts `<link>` para texto dentro del PDF.

- `Montserrat-Regular.ttf`, `Montserrat-Bold.ttf` — de github.com/JulietaUla/Montserrat
  (repo original, estático; Google Fonts solo distribuye la versión variable).
- `SpaceMono-Regular.ttf`, `SpaceMono-Bold.ttf`, `SpaceMono-Italic.ttf` — de
  github.com/google/fonts (ofl/spacemono).
