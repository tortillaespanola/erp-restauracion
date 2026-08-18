-- Capa C, Paso 2 (cierre del ciclo): al crear una línea de albarán real que cubre una línea de pedido
-- con previsión, la previsión debe reducirse en lo efectivamente albaranado; al borrar esa línea (ya
-- sea suelta o por cascade al borrar el albarán completo), la previsión debe reconstruirse.
--
-- Se implementa como trigger DB (no lógica en frontend), por decisión explícita: mismo patrón ya
-- establecido en esta tabla con trg_actualizar_estado_pedido_por_servicio (AFTER INSERT OR UPDATE OR
-- DELETE), atómico dentro de la misma transacción que el INSERT/DELETE real, y funciona igual sin
-- importar por qué vía desaparece la línea -- hoy solo existe el borrado del albarán completo
-- (lineas_albaran_venta_albaran_venta_id_fkey tiene ON DELETE CASCADE, confirmado), pero el trigger
-- cubre igual de bien un futuro borrado de línea suelta sin tener que replicar la lógica.
--
-- Identificación de a qué previsión pertenece cada línea: por linea_pedido_id únicamente (columna ya
-- presente en lineas_albaran_venta desde antes de este contrato). No hace falta cruzar también por
-- produccion_pf_id -- el UNIQUE(linea_pedido_id) de previsiones_distribucion_pf garantiza que como
-- mucho hay una previsión por línea de pedido, sea cual sea la tanda a la que apunte en cada momento
-- (incluso si se reasignó a otra tanda distinta después de crear la línea de albarán).
--
-- Solo aplica a líneas de tipo "producto final" ligadas a un pedido real: producto_final_id no es NULL
-- (equivalente en la práctica a produccion_pf_id no NULL, por el CHECK chk_lineas_albaran_venta_origen)
-- y linea_pedido_id no NULL. Líneas de mercadería, libres, o de producto sin pedido de origen (venta
-- directa) no participan de previsiones_distribucion_pf y no tocan nada.
create or replace function public.actualizar_previsiones_por_linea_albaran()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.linea_pedido_id is not null and NEW.produccion_pf_id is not null then
      -- greatest(0, ...): la previsión nunca queda negativa. Si lo albaranado supera lo previsto
      -- (el operador ajustó la cantidad al alza en AlbaranesVenta.jsx), la previsión simplemente
      -- queda en 0 -- ya no representa ninguna intención pendiente, no tiene sentido que sea negativa.
      update previsiones_distribucion_pf
      set cantidad_prevista = greatest(0, cantidad_prevista - NEW.cantidad)
      where linea_pedido_id = NEW.linea_pedido_id;
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    if OLD.linea_pedido_id is not null and OLD.produccion_pf_id is not null then
      update previsiones_distribucion_pf
      set cantidad_prevista = cantidad_prevista + OLD.cantidad
      where linea_pedido_id = OLD.linea_pedido_id;

      -- La fila de previsión pudo haber llegado a cantidad_prevista = 0 sin borrarse (decisión
      -- confirmada: se mantiene en 0 para trazabilidad, no se borra) -- por tanto, en el flujo normal,
      -- el UPDATE de arriba siempre encuentra la fila y esta rama casi nunca se ejecuta. Se deja como
      -- red de seguridad para el caso en que la fila sí falte por cualquier otro motivo (borrado manual,
      -- dato de sesiones anteriores a este trigger, etc.) -- recrea la previsión con el mismo
      -- produccion_pf_id de la línea que se borra, la mejor tanda conocida para volver a proponerla.
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

create trigger trg_actualizar_previsiones_por_linea_albaran
after insert or delete on lineas_albaran_venta
for each row execute function actualizar_previsiones_por_linea_albaran();
