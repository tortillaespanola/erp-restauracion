-- Cierra la inconsistencia detectada al terminar Inventario: semielaborados/productos_finales
-- quedaron fuera de la parametrización de unidades_medida (Fase B/C sobre ingredientes/
-- articulos_compra, migraciones 20260923/20260924). Auditoría previa a esta migración
-- (solo lectura, ver conversación) confirmó que los dos casos son estructuralmente distintos --
-- se tratan por separado, con alcance distinto a propósito.
--
-- No hace falta ninguna validación cruzada tipo trg_validar_unidad_articulo_ingrediente aquí:
-- confirmado (Semielaborados.jsx, ProductosFinales.jsx, lib/validarStockReceta.js) que
-- receta_producto_final.cantidad / receta_semielaborado.cantidad siempre se interpretan en la
-- unidad del COMPONENTE (hijo), nunca en la del padre -- no hay dos filas representando la misma
-- cosa física que deban coincidir, a diferencia de articulo_ingrediente.

-- ===== SEMIELABORADOS: migración completa, mismo patrón que ingredientes/articulos_compra =====
-- unidad (texto) ya existente y limpia (auditoría: solo 'kg' y 'ud', sin abreviaturas ni NULLs) --
-- backfill directo, sin mapeo de sinónimos.
alter table semielaborados add column unidad_id bigint references unidades_medida(id);

update semielaborados set unidad_id = (
  select id from unidades_medida where codigo = semielaborados.unidad
);

do $$
declare
  v_null_semielaborados int;
begin
  select count(*) into v_null_semielaborados from semielaborados where unidad_id is null;
  if v_null_semielaborados > 0 then
    raise exception 'unidad_semielaborados: mapeo incompleto -- % semielaborados quedaron con unidad_id NULL tras el backfill',
      v_null_semielaborados;
  end if;
end $$;

alter table semielaborados alter column unidad_id set not null;

-- Trigger espejo: reutiliza sincronizar_unidad_texto() ya creada en 20260923_unidades_medida.sql
-- (genérica, funciona sobre cualquier tabla con unidad_id + unidad) -- Semielaborados.jsx sigue
-- leyendo `unidad` como texto sin ningún cambio.
create trigger trg_sincronizar_unidad_texto_semielaborados
before insert or update of unidad_id on semielaborados
for each row execute function sincronizar_unidad_texto();

-- ===== PRODUCTOS FINALES: alcance reducido, NO Select en Fase C todavía =====
-- productos_finales NUNCA tuvo columna `unidad` (ni texto ni ningún otro campo) -- no es
-- "falta migrar", el concepto no existía. Se añade unidad_id con DEFAULT 'ud' y se backfillean
-- todas las filas existentes a 'ud' -- es la única opción coherente hoy: al menos 8 sitios del
-- frontend dan por hecho, con el literal "uds" incrustado en el JSX (no leen ningún campo,
-- confirmado en la auditoría), que un producto final se cuenta en unidades:
--   PedidosDelDia.jsx:410  Producido hoy: ... uds
--   PedidosDelDia.jsx:411  Stock disponible: ... uds
--   PedidosDelDia.jsx:412  Distribuido: ... uds
--   PedidosDelDia.jsx:417  Residual libre: ... uds
--   PedidosDelDia.jsx:1257 necesidad ... uds
--   PedidosDelDia.jsx:1258 disponible ... uds
--   AlbaranesVenta.jsx:437 {l.cantidad} uds.
--   AlbaranesVenta.jsx:751 {linea.restante} uds. pendientes del pedido
--   ProduccionProductosFinales.jsx:859  {cantidad_producida} uds. de {nombre}
-- Ofrecer otra unidad en el alta sin corregir esos 8+ sitios generaría datos inconsistentes con
-- lo que se muestra en el resto de la app -- por eso NO se añade <Select> de unidad en
-- ProductosFinales.jsx en esta sesión (deuda documentada también en PENDIENTES_MODELO.md).
-- Sin trigger espejo aquí: no hay columna de texto legado que mantener sincronizada, no hace
-- falta uno.
-- Postgres no admite una subquery directamente en la cláusula DEFAULT de una columna -- se
-- calcula el id de 'ud' una vez y se fija como default literal vía SQL dinámico.
alter table productos_finales add column unidad_id bigint references unidades_medida(id);

do $$
declare
  v_id_ud bigint;
begin
  select id into v_id_ud from unidades_medida where codigo = 'ud';
  execute format('alter table productos_finales alter column unidad_id set default %s', v_id_ud);
  update productos_finales set unidad_id = v_id_ud where unidad_id is null;
end $$;

do $$
declare
  v_null_productos_finales int;
begin
  select count(*) into v_null_productos_finales from productos_finales where unidad_id is null;
  if v_null_productos_finales > 0 then
    raise exception 'unidad_productos_finales: mapeo incompleto -- % productos_finales quedaron con unidad_id NULL tras el backfill',
      v_null_productos_finales;
  end if;
end $$;

alter table productos_finales alter column unidad_id set not null;
