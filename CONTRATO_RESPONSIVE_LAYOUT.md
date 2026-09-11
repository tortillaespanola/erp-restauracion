# CONTRATO_RESPONSIVE_LAYOUT.md

**Estado: ✅ Cerrado.** Fase 0 (convención) y Fase 1 (shell) implementadas y verificadas — commit `594890c`, desplegado en Vercel. Fase 2 descartada por decisión de producto (scroll horizontal nativo aceptado en tablas anchas; formularios ya caían a una columna sin cambios), no por falta de tiempo. Detalle completo en `PENDIENTES_MODELO.md` #21.

## Contexto
FlowBase se ve "responsive pero no funcional" en móvil: el sidebar nunca colapsa
y se queda fijo ocupando ~40% del ancho de pantalla en cualquier resolución.
El contenido principal queda comprimido en el resto, forzando texto a wrap
letra por línea y formularios a un ancho inservible. No es un problema de cada
pantalla individual — es el layout raíz (shell) el que no tiene breakpoint.

## Objetivo
Fijar de una vez la convención responsive del shell de la app, para que:
1. La app sea usable en móvil desde ya.
2. Toda pantalla nueva que se construya después la herede automáticamente,
   sin volver a auditar el layout cada vez.

## Fase 0 — Convención (documentar antes de tocar código)
- Definir el breakpoint estándar (`md:` de Tailwind, 768px) como corte
  sidebar-visible / sidebar-drawer.
- Documentar la convención en `PENDIENTES_MODELO.md` o `MEMORY.md`:
  "Sidebar oculto por defecto <768px, overlay al abrir; contenido principal
  siempre `w-full` en ese rango; evitar anchos fijos en px en contenedores
  raíz de pantalla, usar `w-full`/`max-w-*` + padding responsive."

## Fase 1 — Shell de layout (el 80% del resultado)
- Componente de layout raíz (el que envuelve sidebar + contenido):
  - Sidebar: oculto por defecto en `<md`, con botón hamburguesa en el header
    que lo abre como overlay/drawer encima del contenido (no empuja el layout).
  - Contenido principal: pasa a `w-full` cuando el sidebar está oculto.
  - Cerrar el drawer al navegar a una pantalla (tap en un ítem del menú).
- Verificación en navegador real (Browserbase o móvil físico) en 3-4 pantallas
  representativas: una de listado (Albaranes compra), una de formulario largo
  (Artículo de compra), una de dashboard/inicio.

## Fase 2 — Barrido ligero post-Fase 1
Tras Fase 1, revisar qué queda pendiente (probablemente menor):
- Tablas anchas (Albaranes, Facturas, Inventario 4 niveles): decidir scroll
  horizontal contenido vs. colapso a tarjetas en móvil.
- Formularios con muchos campos en fila (ej. Nuevo artículo): confirmar que
  caen a una columna en móvil sin intervención manual por pantalla.
- Drawers de detalle (Pedidos/Albaranes/Facturas de venta, y su próxima
  extensión a compras vía `CONTRATO_DRAWERS_COMPRAS.md`):
  - Confirmar que el propio drawer ocupa ancho completo en móvil en vez de
    un ancho fijo en px (probable causa raíz más común).
  - Confirmar que el contenido interno del drawer (formularios multi-columna,
    tablas anidadas) también cae a una columna en móvil — no asumir que
    arreglar el ancho del drawer resuelve automáticamente su contenido.

## Fuera de alcance
- Rediseño visual (esto es solo layout/estructura, no estética).
- Optimización para pantallas muy pequeñas (<360px) salvo que aparezcan
  problemas evidentes durante la verificación.
- Gestos táctiles avanzados (swipe, etc.) — solo tap estándar.

## Entregable
- Shell responsive funcional, verificado en navegador real.
- Convención documentada para que futuras pantallas la hereden sin coste
  adicional de auditoría.
