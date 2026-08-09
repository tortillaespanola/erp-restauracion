# Auditorías técnicas pendientes

Documento separado de `MEJORAS_UI_PENDIENTES.md` y `PENDIENTES_MODELO.md` a propósito: ninguna entrada aquí es una mejora concreta ya diagnosticada ni una decisión de modelo — son barridos sistemáticos sobre todo el código en busca de un patrón conocido, con alcance acotado y sin objetivo de "optimización general". Sin tests automatizados en el proyecto, un refactor amplio sin red de seguridad es alto riesgo; por eso cada auditoría entrega solo un listado de hallazgos con ubicación exacta, nunca una corrección automática — cada hallazgo se evalúa y prioriza individualmente después, mismo criterio ya aplicado al resto de pendientes de este repo.

## 1. Tres auditorías acotadas, para cuando se termine de cargar el histórico completo

1. **Código muerto real**: barrer el resto del código buscando el mismo patrón que `stock_articulos` (vistas/funciones/componentes sin ningún consumidor real) — mismo método de verificación (grep exhaustivo contra `frontend/src`) que ya se usó para detectar ese caso.
2. **Duplicación de bugs ya conocidos**: buscar sistemáticamente si el mismo tipo de problema que ya se corrigió en un sitio (filtro estricto de `articulo_id`, colisión de keys de React tipo `articulo_id ?? ingrediente_semielaborado_id`) existe sin corregir todavía en otras pantallas no revisadas.
3. **Consistencia del patrón de edición entre pantallas**: ahora que `AlbaranesCompra.jsx` y `Pedidos.jsx` (Fase 1) tienen el patrón de edición completo, verificar si el resto de pantallas que deberían tenerlo (`AlbaranesVenta.jsx`, `PedidosCompra.jsx`, etc.) lo tienen igual de bien hecho o quedaron con vacíos similares.

**Cuándo retomarlo**: cuando se termine de cargar el histórico completo — no antes, para no distraer de esa prioridad con un barrido que no es urgente hoy.
