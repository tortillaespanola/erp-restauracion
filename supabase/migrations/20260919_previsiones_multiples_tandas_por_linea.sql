-- Reapertura de decisión de diseño: previsiones_distribucion_pf pasa de "una tanda por línea de
-- pedido" a "varias tandas por línea de pedido" (reparto real: ej. pedido de 5, tanda A con 2
-- disponibles + tanda B con 3, cubriendo el total entre ambas). Auditoría previa (sesión anterior)
-- confirmó el blast radius exacto: trigger de reparto/reconstrucción (identificaba por linea_pedido_id
-- a secas, ahora ambiguo con varias filas por línea), distribucion_prevista_pf() (efecto colateral
-- automático y favorable del LEFT JOIN ya existente), y UI de AlbaranesVenta.jsx/PedidosDelDia.jsx
-- (fuera de alcance de esta migración, Paso 2 aparte).
--
-- 1. Esquema: sustituye UNIQUE(linea_pedido_id) por UNIQUE(linea_pedido_id, produccion_pf_id) -- ya no
-- "una previsión por línea", sino "una previsión por línea Y tanda" (no tiene sentido tener dos filas
-- separadas repitiendo la misma tanda para la misma línea, se sumarían/confundirían al restar).
alter table previsiones_distribucion_pf
  drop constraint previsiones_distribucion_pf_linea_pedido_id_key;

alter table previsiones_distribucion_pf
  add constraint previsiones_distribucion_pf_linea_pedido_id_produccion_pf_key
  unique (linea_pedido_id, produccion_pf_id);

-- 2. Trigger: identificar la fila a restar/reconstruir por (linea_pedido_id, produccion_pf_id), no solo
-- linea_pedido_id -- con varias previsiones por línea, filtrar solo por linea_pedido_id afectaría a
-- TODAS las tandas de esa línea en vez de únicamente a la que cubrió (o dejó de cubrir) el albarán real.
-- lineas_albaran_venta ya tiene produccion_pf_id en cada fila, así que el dato para emparejar existe.
-- La rama defensiva "if not found then insert" no cambia: ya insertaba con un produccion_pf_id
-- concreto (OLD.produccion_pf_id), coherente con la nueva restricción compuesta.
create or replace function public.actualizar_previsiones_por_linea_albaran()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.linea_pedido_id is not null and NEW.produccion_pf_id is not null then
      update previsiones_distribucion_pf
      set cantidad_prevista = greatest(0, cantidad_prevista - NEW.cantidad)
      where linea_pedido_id = NEW.linea_pedido_id and produccion_pf_id = NEW.produccion_pf_id;
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    if OLD.linea_pedido_id is not null and OLD.produccion_pf_id is not null then
      update previsiones_distribucion_pf
      set cantidad_prevista = cantidad_prevista + OLD.cantidad
      where linea_pedido_id = OLD.linea_pedido_id and produccion_pf_id = OLD.produccion_pf_id;

      if not found then
        insert into previsiones_distribucion_pf (producto_final_id, linea_pedido_id, cantidad_prevista, produccion_pf_id)
        values (OLD.producto_final_id, OLD.linea_pedido_id, OLD.cantidad, OLD.produccion_pf_id);
      end if;
    end if;
    return OLD;
  end if;

  return null;
end;
$$;

-- 3. distribucion_prevista_pf(): sin cambios -- el LEFT JOIN de la CTE lineas_pendientes
-- (pd.linea_pedido_id = lpv.id) ya devuelve automáticamente una fila por cada previsión que
-- encuentre para esa línea en cuanto exista más de una; no requiere ningún ajuste de SQL. Confirmado
-- con prueba real antes de aplicar (ver resultados de la transacción de prueba), no se asume.
--
-- 4. Índice único parcial: el UNIQUE(linea_pedido_id, produccion_pf_id) del punto 1 NO bloquea dos
-- previsiones "sin tanda asignada" para la misma línea -- en Postgres, NULL nunca se considera igual a
-- NULL a efectos de UNIQUE, así que dos filas con produccion_pf_id = NULL para la misma línea pasarían
-- sin problema. Antes de esta migración eso era imposible (el UNIQUE(linea_pedido_id) simple lo cubría
-- sin distinguir NULL). Este índice parcial (solo sobre las filas con produccion_pf_id is null) cierra
-- ese hueco -- sigue permitiendo varias previsiones por línea siempre que tengan tanda asignada
-- (produccion_pf_id no nulo), que es el caso que sí queremos soportar.
create unique index previsiones_distribucion_pf_linea_sin_tanda_key
  on previsiones_distribucion_pf (linea_pedido_id)
  where produccion_pf_id is null;
