-- Amplía registrar_incidencia_reparto_pedido() para detectar también un
-- desajuste de CLIENTE, no solo de pedido.
--
-- Contexto: caso real OV-260023/OV-260021 (Berger Family / Zum Kuss) —
-- una línea de albarán quedó atribuida a linea_pedido_id de un pedido
-- ajeno, pero ese pedido resultó ser justo el mismo que
-- producciones_producto_final.pedido_id esperaba (pedido_esperado ==
-- pedido_real), así que el trigger original no lo detectó: nunca compara
-- el cliente del albarán contra el cliente del pedido atribuido, solo
-- compara IDs de pedido entre sí. Verificado contra los datos reales:
-- 0 falsos positivos sobre las 52 líneas de albarán con producción
-- vinculada existentes hoy, y confirmado en transacción de prueba (con
-- ROLLBACK) que el trigger ampliado sí detecta el caso ya corregido si
-- se revierte artificialmente.
--
-- Mismo trigger y misma tabla, no una tabla separada: ambas
-- comprobaciones se disparan sobre la misma fila de lineas_albaran_venta
-- y comparten las mismas claves foráneas (produccion_pf_id,
-- linea_albaran_venta_id) — la única diferencia es el motivo detectado,
-- de ahí la columna nueva en vez de otra tabla. Las dos ramas son
-- mutuamente excluyentes (if/elsif): la comprobación de cliente solo
-- corre cuando la de pedido ya no habría disparado nada, para no
-- duplicar aviso sobre el mismo problema de fondo.
--
-- Alcance igual que el trigger original: solo líneas de producto final
-- (produccion_pf_id NOT NULL en la tabla) — mercadería queda fuera,
-- ampliarlo requeriría un cambio estructural distinto.

alter table incidencias_reparto_pedido
  add column motivo text not null default 'pedido' check (motivo in ('pedido', 'cliente'));

alter table incidencias_reparto_pedido
  add column nota text;

create or replace function public.registrar_incidencia_reparto_pedido()
returns trigger
language plpgsql
as $$
declare
  v_pedido_esperado bigint;
  v_pedido_real bigint;
  v_cliente_esperado bigint;
  v_cliente_real bigint;
begin
  if NEW.produccion_pf_id is null then
    return NEW;
  end if;

  select pedido_id into v_pedido_esperado
  from producciones_producto_final
  where id = NEW.produccion_pf_id;

  if NEW.linea_pedido_id is not null then
    select pedido_id into v_pedido_real
    from lineas_pedido_venta
    where id = NEW.linea_pedido_id;
  else
    v_pedido_real := null;
  end if;

  if v_pedido_esperado is distinct from v_pedido_real then
    insert into incidencias_reparto_pedido (produccion_pf_id, linea_albaran_venta_id, pedido_esperado_id, pedido_real_id, motivo)
    values (NEW.produccion_pf_id, NEW.id, v_pedido_esperado, v_pedido_real, 'pedido');
  elsif v_pedido_real is not null then
    select cliente_id into v_cliente_esperado from pedidos_venta where id = v_pedido_real;
    select cliente_id into v_cliente_real from albaranes_venta where id = NEW.albaran_venta_id;

    if v_cliente_esperado is distinct from v_cliente_real then
      insert into incidencias_reparto_pedido (produccion_pf_id, linea_albaran_venta_id, pedido_esperado_id, pedido_real_id, motivo)
      values (NEW.produccion_pf_id, NEW.id, v_pedido_esperado, v_pedido_real, 'cliente');
    end if;
  end if;

  return NEW;
end;
$$;
