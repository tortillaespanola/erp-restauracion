import { supabase } from './supabase'

// Config por tipo de receta -- las dos tablas (receta_semielaborado / receta_producto_final)
// comparten exactamente los mismos nombres de columna de ingrediente (articulo_id,
// ingrediente_semielaborado_id, ingrediente_id) y la misma invariante "exactamente uno relleno"
// (CHECK solo_un_tipo_ingrediente(_pf)), verificado contra el schema real. Solo difieren en el
// nombre de la tabla, el de su columna padre, y el nombre de la FK que hay que citar en el embed
// de `semielaborados` -- Postgres autogenera un nombre de constraint distinto por tabla
// (`receta_semielaborado_ingrediente_semielaborado_id_fkey` vs
// `receta_producto_final_ingrediente_semielaborado_id_fkey`), y PostgREST necesita ese nombre
// exacto para saber a qué FK te refieres.
const CONFIG_RECETA = {
  semielaborado: {
    tabla: 'receta_semielaborado',
    columnaPadre: 'semielaborado_id',
    fkSemielaborado: 'receta_semielaborado_ingrediente_semielaborado_id_fkey',
  },
  producto_final: {
    tabla: 'receta_producto_final',
    columnaPadre: 'producto_final_id',
    fkSemielaborado: 'receta_producto_final_ingrediente_semielaborado_id_fkey',
  },
}

// Validación previa de stock (CONTRATO_VISTA_DINAMICA_PRODUCCION.md): explota un único nivel de
// receta_semielaborado/receta_producto_final -- no hace falta recursividad manual más allá de eso,
// el disponible de stock_lotes_semielaborado ya solo cuenta producciones 'cerradas', así que la
// disponibilidad de niveles más profundos ya está resuelta por construcción. Devuelve las líneas
// que no cubren, vacío si todo cubre. Compartida por Producciones.jsx (Vista 2, aviso previo a
// iniciar) y PedidosDelDia.jsx (Vista 1 semielaborados + Tabla 2 productos finales, badges de
// bloqueo) -- generalizada por `tipo` en vez de duplicarla entre las dos recetas.
//
// `tipo` en cada resultado ('ingrediente_articulo' | 'semielaborado') es un añadido respecto a la
// versión original de Producciones.jsx -- mismo cálculo interno de siempre, solo se expone qué rama
// se tomó.
export async function validarStockReceta(tipo, itemId, cantidad) {
  const cfg = CONFIG_RECETA[tipo]
  const { data: receta } = await supabase
    .from(cfg.tabla)
    .select(`cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id, articulos_compra(nombre, unidad), semielaborados!${cfg.fkSemielaborado}(nombre, unidad), ingredientes(nombre, unidad)`)
    .eq(cfg.columnaPadre, itemId)

  const resultados = await Promise.all(
    (receta || []).map(async (linea) => {
      const necesario = Number(linea.cantidad) * cantidad
      let disponible = 0
      let nombre, unidad, tipoLinea

      if (linea.articulo_id) {
        tipoLinea = 'ingrediente_articulo'
        nombre = linea.articulos_compra?.nombre
        unidad = linea.articulos_compra?.unidad
        const { data } = await supabase.from('stock_lotes_articulo').select('stock_disponible').eq('articulo_id', linea.articulo_id)
        disponible = (data || []).reduce((s, l) => s + Number(l.stock_disponible), 0)
      } else if (linea.ingrediente_id) {
        tipoLinea = 'ingrediente_articulo'
        nombre = linea.ingredientes?.nombre
        unidad = linea.ingredientes?.unidad
        const { data: vinculos } = await supabase.from('articulo_ingrediente').select('articulo_id').eq('ingrediente_id', linea.ingrediente_id)
        const articuloIds = (vinculos || []).map((v) => v.articulo_id)
        if (articuloIds.length > 0) {
          const { data } = await supabase.from('stock_lotes_articulo').select('stock_disponible').in('articulo_id', articuloIds)
          disponible = (data || []).reduce((s, l) => s + Number(l.stock_disponible), 0)
        }
      } else {
        tipoLinea = 'semielaborado'
        nombre = linea.semielaborados?.nombre
        unidad = linea.semielaborados?.unidad
        const { data } = await supabase.from('stock_lotes_semielaborado').select('stock_disponible').eq('semielaborado_id', linea.ingrediente_semielaborado_id)
        disponible = (data || []).reduce((s, l) => s + Number(l.stock_disponible), 0)
      }

      return { nombre, unidad, necesario, disponible, tipo: tipoLinea }
    })
  )

  return resultados.filter((r) => r.necesario > r.disponible + 0.0001)
}
