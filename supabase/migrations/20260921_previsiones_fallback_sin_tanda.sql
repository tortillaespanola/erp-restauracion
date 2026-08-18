-- Fix real (reemplaza el intento fallido con `is not distinct from`, que resultó ser código
-- muerto: dentro del guard `NEW.produccion_pf_id is not null` que envuelve el UPDATE, ese
-- operador se comporta exactamente igual que `=` -- probado en BEGIN...ROLLBACK, 0 filas en
-- ambos casos, ver diagnóstico de sesión).
--
-- Caso real (OV-260101, línea de ZZ_AlbondigasconTomate): la previsión no tiene ninguna tanda
-- asignada (produccion_pf_id NULL, "previsión genérica sin repartir todavía") y el albarán real
-- que sirve la línea sí trae una tanda concreta (produccion_pf_id = 144) -- el match exacto por
-- tanda nunca puede encontrarla, porque NULL nunca es igual a un valor concreto en SQL sea cual
-- sea el operador de igualdad usado.
--
-- Estrategia acordada (match exacto -> fallback A -> fallback C), solo en la rama INSERT:
--   1. Match exacto por (linea_pedido_id, produccion_pf_id) -- sin cambios, sigue siendo lo
--      correcto cuando la previsión SÍ tenía la tanda real ya asignada (caso mayoritario, ver
--      Hamburguesas/Tortilla en el mismo pedido).
--   2. Fallback A: si el match exacto no encuentra nada, probar la previsión "sin tanda
--      asignada" (produccion_pf_id IS NULL) de la misma línea -- UPDATE separado, no un OR en
--      el WHERE original, para no arriesgar descontar de dos filas a la vez si algún día
--      coexistieran una previsión con tanda exacta ya en 0 y otra sin tanda con saldo.
--   3. Fallback C: si tampoco el fallback A encuentra nada (ni tanda exacta ni previsión sin
--      tanda), no hay ninguna previsión que absorba el descuento -- en vez de fallar en
--      silencio (comportamiento actual), deja una incidencia visible.
--
-- La rama DELETE/reversión NO se toca: ya tiene su propio fallback ("if not found then insert",
-- ver 20260916_previsiones_trigger_lineas_albaran.sql) que reconstruye la fila con el
-- produccion_pf_id de la línea borrada -- una estrategia distinta pero igual de completa (nunca
-- deja un borrado sin efecto), así que no aplica el mismo patrón A/C ni hace falta duplicarlo.
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

      if not found then
        -- Fallback A: sin previsión para la tanda exacta -- probar la previsión "sin tanda
        -- asignada" de la misma línea.
        update previsiones_distribucion_pf
        set cantidad_prevista = greatest(0, cantidad_prevista - NEW.cantidad)
        where linea_pedido_id = NEW.linea_pedido_id and produccion_pf_id is null;

        if not found then
          -- Fallback C: ni la tanda exacta ni la previsión "sin tanda" existen -- deja
          -- constancia en incidencias_reparto_pedido en vez de descontar en silencio de la
          -- nada. Mismas columnas/convención que registrar_incidencia_reparto_pedido()
          -- (negocio_id se deja al default de la tabla, igual que en esa función); motivo
          -- nuevo 'prevision_no_encontrada' añadido al CHECK más abajo -- este tipo de
          -- incidencia no es un desajuste pedido/cliente, es la ausencia total de previsión
          -- que descontar.
          insert into incidencias_reparto_pedido (produccion_pf_id, linea_albaran_venta_id, motivo, nota)
          values (
            NEW.produccion_pf_id,
            NEW.id,
            'prevision_no_encontrada',
            format(
              'Sin previsión que descontar (ni tanda exacta ni "sin tanda asignada") para linea_pedido_id=%s al llegar albarán con produccion_pf_id=%s, cantidad=%s',
              NEW.linea_pedido_id, NEW.produccion_pf_id, NEW.cantidad
            )
          );
        end if;
      end if;
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

-- El motivo de incidencias_reparto_pedido tenía un CHECK cerrado a ('pedido', 'cliente') --
-- se amplía para admitir el nuevo tipo de incidencia del fallback C. No se toca ninguna
-- columna ni ninguna fila existente.
alter table incidencias_reparto_pedido drop constraint incidencias_reparto_pedido_motivo_check;
alter table incidencias_reparto_pedido add constraint incidencias_reparto_pedido_motivo_check
  check (motivo = any (array['pedido', 'cliente', 'prevision_no_encontrada']));
