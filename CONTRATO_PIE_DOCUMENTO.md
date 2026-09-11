# CONTRATO_PIE_DOCUMENTO.md

## 1. Contexto

`generarAlbaranVentaPdf.js` dibuja hoy un footer de marca fijo ("SPANISCHI STUURHAIT", tagline, cita, web) hardcodeado en el archivo — igual para cualquier negocio. La sección BEMERKUNGEN usa `documento.notas` (partido por `;`) si existe, o si no, un texto legal por defecto también hardcodeado en alemán ("Lokale handwerkliche Produktion...", "Nicht Mehrwertsteuerpflichtig..."). Ninguno de los dos viene de `empresa_config` ni de `datos_bancarios`.

## 2. Objetivo

Hacer configurables por negocio, sin tocar aún la plantilla de factura (eso es `CONTRATO_FACTURA_PDF.md`):

- El footer de marca del PDF (eslogan, comentario de eslogan, página web).
- El texto por defecto de BEMERKUNGEN cuando el documento no trae notas propias.

## 3. Base de datos

```sql
alter table empresa_config
  add column eslogan text,
  add column comentario_eslogan text,
  add column pagina_web text;
```

Los tres, nullable — un negocio puede no tener todavía marca definida. Probar primero en `BEGIN...ROLLBACK`.

`datos_bancarios.observaciones` ya existe (aplicado en `CONTRATO_CONFIGURACION_SUBMENUS.md`) y pasa a ser la fuente del texto por defecto de BEMERKUNGEN — no se crea columna nueva para esto.

## 4. UI

En `ConfiguracionErp.jsx` (tab "Configuración ERP"), se añaden 3 campos nuevos al formulario existente de esa pestaña: **Eslogan**, **Comentario de eslogan**, **Página web**. Mismo patrón de guardado que el resto de `empresa_config` (update sobre `negocio_id`).

## 5. Cambios en `generarAlbaranVentaPdf.js`

- **Footer de marca**: sustituir el texto hardcodeado por `empresaConfig.eslogan`, `empresaConfig.comentario_eslogan`, `empresaConfig.pagina_web`. Si alguno viene vacío/null, se omite esa línea del footer (no se dibuja un placeholder ni se mantiene el texto antiguo como fallback).
- **BEMERKUNGEN**: la prioridad pasa a ser `documento.notas` (si el albarán tiene notas propias, partidas por `;`, igual que hoy) → si no hay, `datosBancarios.observaciones` del negocio → si tampoco hay, no se dibuja la sección (sin fallback hardcodeado en alemán).
- Esto obliga a que la función que arma el documento para el PDF (o el propio `generarAlbaranVentaPdf.js`) reciba también la fila de `datos_bancarios` del negocio, además de `empresaConfig`. Decisión de implementación libre para Claude Code: pasarlo como parámetro nuevo o cargarlo dentro del propio generador — no cambia el contrato.

## 6. Fuera de alcance

- Plantilla de factura (PDF nuevo, Zahlungskonditionen, Abrechnungsperiode) — todo eso es `CONTRATO_FACTURA_PDF.md`.
- Extraer helpers compartidos (fuentes, VON/AN, footer) a un módulo común reutilizable entre albarán y factura — esa extracción se hace en `CONTRATO_FACTURA_PDF.md`, cuando exista un segundo consumidor real.
- IVA/MWST dinámico.
- Validación de longitud o formato del eslogan/comentario (texto libre, sin límite impuesto en esta fase).

## 7. Metodología

Migración en `BEGIN...ROLLBACK` primero. Tras aplicar, verificar en navegador: guardar los 3 campos nuevos desde Configuración ERP, generar un albarán de un negocio con eslogan configurado y otro sin configurar (footer debe omitir líneas vacías sin romper el layout), y un albarán con y sin `notas` propias (para confirmar el fallback a `datos_bancarios.observaciones`). Commit local, push solo tras esa verificación visual.
