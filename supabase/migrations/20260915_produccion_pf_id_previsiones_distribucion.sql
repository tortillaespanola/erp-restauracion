-- Capa C (cierre del ciclo producir -> distribuir -> albaranear): añade a
-- previsiones_distribucion_pf la tanda concreta (producción cerrada) que
-- cubre esa previsión. Hasta ahora la tabla era agnóstica de tanda (pool
-- agregado "producido hoy"); confirmado en la auditoría de Capa C que el
-- lote debe decidirse en el momento de distribuir (Producciones del día),
-- no al crear el albarán -- por defecto FIFO (tanda más antigua con stock),
-- pero reasignable a mano desde un selector en el desglose.
--
-- Nullable a propósito: una previsión puede crearse antes de que exista
-- ninguna tanda cerrada de ese producto (el desglose de distribución ya
-- permite hoy fijar cantidad_prevista con residual_libre negativo, sin
-- bloqueo -- mismo criterio aquí: la previsión expresa una intención del
-- operador, no depende de que la producción física ya exista). Cuando no
-- hay tanda todavía, produccion_pf_id queda NULL y la sugerencia FIFO (ver
-- función más abajo) tampoco devuelve nada hasta que se cierre una tanda
-- con stock.
--
-- ON DELETE SET NULL (no CASCADE, no RESTRICT): borrar una tanda de
-- producción es un caso real y posible -- ProduccionProductosFinales.jsx
-- permite cancelar producciones abiertas y borrar producciones ya cerradas
-- (handleCancelar/handleBorrarCerrada). La previsión en sí no es un
-- compromiso real (mismo principio que motivó el ON DELETE CASCADE de
-- linea_pedido_id en el Paso 1), pero aquí la fuente de verdad es la
-- intención del cliente (linea_pedido_id), no la tanda que la cubre -- así
-- que borrar la tanda no debe borrar la previsión: solo debe perder su
-- asignación de lote y volver al estado "sin tanda asignada", igual que si
-- nunca se hubiera asignado ninguna.
--
-- UNIQUE(linea_pedido_id), ya existente desde el Paso 1, se mantiene SIN
-- cambios: sigue siendo "una previsión por línea de pedido", y añadir a qué
-- tanda apunta esa única previsión no contradice esa unicidad -- reasignar
-- a otra tanda (FIFO recalculado, o cambio manual) es un UPDATE de la fila
-- existente, nunca un INSERT nuevo, que es justo lo que ya garantizaba el
-- UNIQUE del Paso 1. No hace falta tocarlo.
alter table previsiones_distribucion_pf
  add column produccion_pf_id bigint references producciones_producto_final(id) on delete set null;

-- No hace falta ningún GRANT nuevo sobre previsiones_distribucion_pf: el
-- GRANT de tabla ya cubre todas las columnas (SELECT/INSERT/UPDATE/DELETE
-- concedido a authenticated en 20260914_grant_previsiones_distribucion_pf.sql),
-- una columna añadida por ALTER TABLE queda cubierta automáticamente.

-- Sugerencia FIFO: para un producto final, la tanda más antigua con stock
-- disponible. Fuente: stock_lotes_producto_final (misma vista, mismo
-- order by fecha asc, que ya usan AlbaranesVenta.jsx y CierreTanda.jsx).
-- Devuelve cero filas si no hay ninguna tanda con stock -- el frontend debe
-- tratarlo como "todavía no hay lote que asignar", no como error.
--
-- Esta función da solo la SUGERENCIA (primera tanda por antigüedad); el
-- resto de tandas disponibles, para que el operador pueda cambiar a otra,
-- se consulta directamente contra stock_lotes_producto_final desde el
-- frontend (mismo patrón ya usado en AlbaranesVenta.jsx) -- no hace falta
-- una segunda función para eso.
create or replace function tanda_fifo_producto_final(p_producto_final_id bigint)
returns table (
  produccion_id bigint,
  fecha date,
  stock_disponible numeric,
  codigo_lote text
)
language sql
stable
as $$
  select produccion_id, fecha, stock_disponible, codigo_lote
  from stock_lotes_producto_final
  where producto_final_id = p_producto_final_id
    and stock_disponible > 0
  order by fecha asc, produccion_id asc
  limit 1
$$;

-- EXECUTE en funciones se concede a PUBLIC por defecto en Postgres (a
-- diferencia de las tablas, que no conceden nada a PUBLIC) --
-- distribucion_prevista_pf() del Paso 1 nunca necesitó este GRANT explícito
-- por esa razón, y de hecho nunca fue la causa del bug de esa sesión (fue
-- el GRANT de tabla el que faltaba). Se añade aquí de todos modos, de forma
-- explícita, en vez de dar por hecho el default -- misma disciplina que
-- motivó la addenda de fix de permisos de la sesión anterior.
grant execute on function tanda_fifo_producto_final(bigint) to authenticated;
