# CONTRATO: Badge Visual de Caducidad en Selección de Lotes (P1-5 del Roadmap Fase 06)

## Contexto

La simulación de 6 meses (`FASE06_SIMULACION_RESUMEN.md`) señaló que, aunque
el sistema ya gestiona correctamente la caducidad a nivel de datos —
`registrar_incidencia_caducidad_consumo()` funciona bien y genera incidencias
reales cuando se consume material caducado (Mes 4, Mes 6, confirmado también
como referencia de patrón en los contratos P0-2 y P0-1) — **la UI no muestra
esa información en el momento en que más importa**: al elegir manualmente qué
lote consumir. Hoy el usuario selecciona un lote a ciegas, sin ver su fecha de
caducidad ni si ya está caducado, y solo se entera del problema después,
cuando el sistema genera la incidencia a posteriori.

Este es el contrato más ligero del roadmap: **puramente frontend**, no toca
ninguna función SQL ni trigger — la lógica de caducidad ya existe y funciona
correctamente en el backend (P0-1/P0-2 no la tocaron, y este contrato
tampoco).

## Objetivo

Mostrar de forma visual e inmediata, en cualquier selector de lote (dropdown,
tabla de selección, modal de consumo manual), la fecha de caducidad de cada
lote y un indicador claro cuando está caducado o próximo a caducar — para que
la decisión se tome informada, en vez de descubrir el problema después vía
incidencia.

## Antes de empezar: auditoría de esquema/UI obligatoria

Lección de la propia Fase 06 (sección 6.3): revisa el código real antes de
asumir su comportamiento.

- Localizar **todos** los puntos de la UI donde se selecciona un lote
  manualmente (no solo el flujo principal de consumo en producción — también
  ajustes de stock, traspasos, o cualquier otro selector de lote que exista).
- Confirmar de dónde sale hoy la fecha de caducidad para cada lote:
  columna directa en `entrada_material` / `stock_lotes_articulo`, o
  calculada (fecha de recepción + vida útil del artículo).
- Revisar si existe ya algún criterio de "próximo a caducar" en el backend
  (usado por algún informe o alerta) que se pueda reutilizar como umbral,
  o si hay que definir uno nuevo (ej. X días antes de la fecha).
- Confirmar si los selectores de lote ya ordenan por FIFO/fecha de caducidad
  (recomendable) o por otro criterio, ya que el badge debería reforzar ese
  orden, no sustituirlo.
- Revisar convenciones de color/badge ya usadas en el proyecto (`topics/
  brand-identity.md` y patrones visuales existentes en Incidencias o en el
  badge de stock negativo del contrato P0-2) para mantener consistencia
  visual en vez de introducir un esquema de color nuevo.

## Alcance

### 1. Frontend (único alcance de este contrato)

- En cada selector de lote identificado en la auditoría:
  - Mostrar la fecha de caducidad junto al identificador del lote.
  - Badge/indicador visual con al menos tres estados: caducado (rojo),
    próximo a caducar dentro del umbral definido (ámbar/amarillo), y normal
    (sin badge o verde neutro).
  - El lote caducado sigue siendo seleccionable (la lógica de negocio de si
    se permite o no consumirlo ya está resuelta en backend por P0-2/P0-1 y
    no se toca aquí) — el badge es información, no un bloqueo de UI nuevo.
- Si el umbral de "próximo a caducar" no existe ya en backend, definirlo
  como constante en frontend (ej. 7 días) en un único sitio reutilizable,
  no repetido por componente.
- Revisar los locales de i18next (es/en/de) para las nuevas etiquetas
  ("Caducado", "Caduca en X días", etc.).

### 2. Sin cambios de backend

- No se toca ningún trigger, función SQL ni tabla. La caducidad ya se
  calcula y gestiona correctamente en el backend; este contrato es
  exclusivamente de visibilidad en la interfaz.

### 3. Tests

Vitest + Testing Library, como en contratos anteriores.

- Test de que un lote caducado muestra el badge correspondiente.
- Test de que un lote próximo a caducar (dentro del umbral) muestra el
  badge intermedio.
- Test de que un lote normal no muestra ningún badge de alerta.
- Test de que el lote caducado sigue siendo seleccionable (no se bloquea la
  interacción).

## Fuera de alcance (dejar para roadmap posterior)

- Cualquier cambio en la lógica de negocio de si se permite o no consumir
  un lote caducado — eso ya está resuelto en backend y no se toca.
- Unificación de `facturas_venta_con_saldo` con `estado_pago` (P1-6).
- Alertas proactivas (notificaciones, emails) de próxima caducidad — este
  contrato cubre solo la visibilidad en el momento de selección manual, no
  un sistema de alertas separado.

## Criterios de aceptación

- Todo selector de lote identificado en la auditoría muestra la fecha de
  caducidad y el badge correspondiente (caducado / próximo / normal).
- El comportamiento de selección y consumo del lote no cambia respecto a
  hoy — el cambio es exclusivamente visual.
- Los tres estados de badge son visualmente distinguibles y consistentes
  con las convenciones de color ya usadas en el resto del proyecto.
- Tests pasan en CI.

## Nota de calidad

Al ser un contrato sin migración SQL, no aplica la fase de prueba en el SQL
Editor de los contratos anteriores. Sí conviene revisar manualmente en local
(o en el entorno de la demo AlpenWerk) los tres casos de fecha —caducado,
próximo a caducar, normal— antes de comitear, para confirmar visualmente que
el badge correcto aparece en cada caso real.
