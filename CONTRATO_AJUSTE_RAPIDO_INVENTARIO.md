# CONTRATO: Ajuste Rápido desde Inventario + Rediseño de Ajustes de Stock

**Estado**: Propuesta — pendiente de validación antes de implementación
**Fecha**: 2026-09-01
**Pantallas afectadas**: `Inventario.jsx`, `AjustesStock.jsx` (o equivalente)

---

## 1. Problema actual

- `Inventario.jsx` es la pantalla de visualización de stock, con buena UX (usa `demanda_pendiente_ingrediente()`).
- La pantalla de Ajustes de stock es el único punto de entrada para crear un ajuste, pero:
  - Tiene UX/UI arcaica.
  - Lista todos los artículos, incluidos los que están a stock 0.
  - Esa lista crecerá indefinidamente con el tiempo → inviable a medio plazo.
- No hay forma de ajustar stock directamente desde Inventario, donde el usuario ya está viendo los datos relevantes.

## 2. Decisión de arquitectura

Separar responsabilidades por función, no por pantalla física:

| Función | Dónde vive | Rol |
|---|---|---|
| **Iniciar un ajuste** | Drawer/modal contextual desde una fila de `Inventario.jsx` | Punto de entrada único para crear ajustes |
| **Auditar ajustes** | `AjustesStock.jsx` rediseñada | Histórico de movimientos ya realizados, con filtros y paginación |

**Regla clave**: ambos flujos llaman a la **misma lógica de backend** (mismo trigger / misma tabla de ajustes). El drawer no es una ruta de negocio paralela, es solo una UI distinta sobre el mismo backend existente.

## 3. Alcance — Parte A: Drawer de ajuste rápido en Inventario

- Clic en una fila de `Inventario.jsx` abre un panel lateral (drawer) con:
  - Artículo (solo lectura, ya viene del contexto de la fila).
  - Cantidad actual (solo lectura).
  - Nueva cantidad (input).
  - Motivo del ajuste (select o texto, según lo que ya exista en el modelo de datos actual).
- Al guardar, reutiliza la función/trigger de ajuste ya existente (a confirmar: ¿cuál es la función actual que crea un registro de ajuste? Code debe localizarla, no crear una nueva).
- No se toca la lógica de cálculo de stock (`demanda_pendiente_ingrediente()`), solo se añade la acción de escritura.

## 4. Alcance — Parte B: Rediseño de Ajustes de stock como histórico

- La pantalla deja de ser "elige artículo y ajusta" y pasa a ser **tabla de movimientos**:
  - Columnas: fecha, artículo, cantidad anterior, cantidad nueva, delta, motivo, usuario (si aplica).
  - Filtros: por fecha, por artículo, por motivo.
  - Paginación (no cargar todo el histórico de golpe).
- **No debe** seguir siendo el punto de entrada para crear un ajuste nuevo salvo, opcionalmente, un botón "+ Nuevo ajuste" que abra el mismo drawer/modal usado en Inventario (para mantener un único componente de formulario, no dos).
- El problema de crecimiento de artículos a 0 se resuelve por diseño: al pasar de "lista de artículos" a "lista de eventos", el stock 0 deja de ser relevante para la vista.

## 5. Preguntas abiertas para Code (a resolver antes de tocar código)

1. ¿Cuál es la función/trigger actual que registra un ajuste de stock? (para reutilizarla, no duplicarla)
2. ¿El modelo de datos actual de ajustes ya guarda usuario y motivo, o hay que extenderlo?
3. ¿Existe ya un componente de drawer/modal reutilizable en el proyecto, o hay que crear uno nuevo siguiendo el patrón de UI existente?
4. ¿Cuántos registros de ajuste existen hoy en producción? (para decidir si la paginación es urgente o puede esperar)

## 6. Fuera de alcance (explícito)

- No se modifica el cálculo de stock ni las vistas `stock_lotes_*`.
- No se toca la lógica de FIFO ni de lotes.
- No se implementa exportación de histórico en esta fase (puede ser un contrato futuro).

---

**Siguiente paso**: pasar este contrato a Claude Code para que responda las preguntas de la sección 5 (solo lectura/exploración, sin implementar todavía) antes de aprobar el alcance final.
