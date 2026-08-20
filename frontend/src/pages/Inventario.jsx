import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import { PageHeader, Card, CardBody, Field, MultiSelect, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

const datosVacios = {
  ingredientes: [], articuloIngrediente: [], stockArticulos: [], articuloProveedor: [],
  proveedores: [], stockLotes: [], entradaMaterial: [], recetaPF: [], recetaSemi: [],
  productosFinales: [], semielaborados: [],
}

function Inventario() {
  const [datos, setDatos] = useState(datosVacios)
  const [necesidadPorIngrediente, setNecesidadPorIngrediente] = useState(new Map())
  const [cargando, setCargando] = useState(true)
  const [cargandoNecesidad, setCargandoNecesidad] = useState(true)

  const [proveedorSel, setProveedorSel] = useState([])
  const [ingredienteSel, setIngredienteSel] = useState([])
  const [semiSel, setSemiSel] = useState([])
  const [pfSel, setPfSel] = useState([])

  const [expandidosIngrediente, setExpandidosIngrediente] = useState(new Set())
  const [expandidosArticulo, setExpandidosArticulo] = useState(new Set())

  async function cargarDatos() {
    setCargando(true)
    setCargandoNecesidad(true)

    const [
      resIngredientes, resArticuloIngrediente, resStockArticulos, resArticuloProveedor,
      resProveedores, resStockLotes, resEntradaMaterial, resRecetaPF, resRecetaSemi,
      resProductosFinales, resSemielaborados,
    ] = await Promise.all([
      supabase.from('ingredientes').select('id, nombre, unidad').order('nombre'),
      supabase.from('articulo_ingrediente').select('articulo_id, ingrediente_id'),
      supabase.from('stock_articulos').select('articulo_id, nombre, unidad, stock'),
      supabase.from('articulo_proveedor').select('id, articulo_id, proveedor_id, precio, preferente'),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
      supabase.from('stock_lotes_articulo').select('entrada_material_id, articulo_id, stock_disponible'),
      supabase.from('entrada_material').select('id, articulo_id, precio, albaranes_compra(proveedor_id, fecha)').not('precio', 'is', null),
      supabase.from('receta_producto_final').select('producto_final_id, articulo_id, ingrediente_id, ingrediente_semielaborado_id, cantidad'),
      supabase.from('receta_semielaborado').select('semielaborado_id, articulo_id, ingrediente_id, ingrediente_semielaborado_id, cantidad'),
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('semielaborados').select('id, nombre').order('nombre'),
    ])

    const nuevosDatos = {
      ingredientes: resIngredientes.data || [],
      articuloIngrediente: resArticuloIngrediente.data || [],
      stockArticulos: resStockArticulos.data || [],
      articuloProveedor: resArticuloProveedor.data || [],
      proveedores: resProveedores.data || [],
      stockLotes: resStockLotes.data || [],
      entradaMaterial: resEntradaMaterial.data || [],
      recetaPF: resRecetaPF.data || [],
      recetaSemi: resRecetaSemi.data || [],
      productosFinales: resProductosFinales.data || [],
      semielaborados: resSemielaborados.data || [],
    }
    setDatos(nuevosDatos)
    setCargando(false)

    // Necesidad agregada: una RPC por ingrediente, en paralelo -- volumen bajo (decenas), no
    // hace falta una función bulk (ver diagnóstico de sesión).
    const necesidades = await Promise.all(
      nuevosDatos.ingredientes.map((i) =>
        supabase.rpc('necesidad_agregada_ingrediente', { p_ingrediente_id: i.id }).then((r) => [i.id, r.error ? null : Number(r.data)])
      )
    )
    setNecesidadPorIngrediente(new Map(necesidades))
    setCargandoNecesidad(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // ---- Derivados en memoria (sin consultas nuevas) ----

  const articulosPorIngrediente = useMemo(() => {
    const m = new Map()
    for (const ai of datos.articuloIngrediente) {
      if (!m.has(ai.ingrediente_id)) m.set(ai.ingrediente_id, [])
      m.get(ai.ingrediente_id).push(ai.articulo_id)
    }
    return m
  }, [datos.articuloIngrediente])

  const articuloPorId = useMemo(() => new Map(datos.stockArticulos.map((a) => [a.articulo_id, a])), [datos.stockArticulos])

  const duplasPorArticulo = useMemo(() => {
    const m = new Map()
    for (const ap of datos.articuloProveedor) {
      if (!m.has(ap.articulo_id)) m.set(ap.articulo_id, [])
      m.get(ap.articulo_id).push(ap)
    }
    return m
  }, [datos.articuloProveedor])

  const proveedorNombrePorId = useMemo(() => new Map(datos.proveedores.map((p) => [p.id, p.nombre_comercial])), [datos.proveedores])

  // Fix: no me fío del texto `proveedor` que ya trae stock_lotes_articulo -- lo reconstruyo por
  // proveedor_id real (vía entrada_material.albaranes_compra.proveedor_id) para que el cruce con
  // articulo_proveedor sea exacto, no por coincidencia de nombre.
  const proveedorDeEntrada = useMemo(() => {
    const m = new Map()
    for (const em of datos.entradaMaterial) {
      if (em.albaranes_compra?.proveedor_id != null) m.set(em.id, em.albaranes_compra.proveedor_id)
    }
    return m
  }, [datos.entradaMaterial])

  const stockPorDupla = useMemo(() => {
    const m = new Map()
    for (const lote of datos.stockLotes) {
      const proveedorId = proveedorDeEntrada.get(lote.entrada_material_id)
      if (proveedorId == null) continue
      const clave = `${lote.articulo_id}:${proveedorId}`
      m.set(clave, (m.get(clave) || 0) + Number(lote.stock_disponible))
    }
    return m
  }, [datos.stockLotes, proveedorDeEntrada])

  // "Último precio de compra" -- entrada_material.precio real recibido, el más reciente por
  // articulo_id + proveedor (vía albaranes_compra.fecha), NUNCA lineas_pedido_compra (lo pedido,
  // no lo recibido).
  const ultimoPrecioPorDupla = useMemo(() => {
    const m = new Map()
    for (const em of datos.entradaMaterial) {
      const proveedorId = em.albaranes_compra?.proveedor_id
      const fecha = em.albaranes_compra?.fecha
      if (proveedorId == null || fecha == null) continue
      const clave = `${em.articulo_id}:${proveedorId}`
      const actual = m.get(clave)
      if (!actual || fecha > actual.fecha) m.set(clave, { precio: Number(em.precio), fecha })
    }
    return m
  }, [datos.entradaMaterial])

  // Ingredientes alcanzables desde los semielaborados/productos finales seleccionados -- BFS
  // sobre receta_producto_final/receta_semielaborado ya cargadas, sin consulta nueva. `null` =
  // sin filtro de semi/PF activo, no restringe nada.
  const ingredientesAlcanzables = useMemo(() => {
    if (semiSel.length === 0 && pfSel.length === 0) return null
    const alcanzados = new Set()
    const semisVisitados = new Set()
    const cola = [
      ...semiSel.map((id) => ({ tipo: 'semi', id })),
      ...pfSel.map((id) => ({ tipo: 'pf', id })),
    ]
    while (cola.length > 0) {
      const nodo = cola.shift()
      const filas = nodo.tipo === 'pf'
        ? datos.recetaPF.filter((r) => r.producto_final_id === nodo.id)
        : datos.recetaSemi.filter((r) => r.semielaborado_id === nodo.id)
      for (const f of filas) {
        if (f.ingrediente_id != null) alcanzados.add(f.ingrediente_id)
        if (f.ingrediente_semielaborado_id != null && !semisVisitados.has(f.ingrediente_semielaborado_id)) {
          semisVisitados.add(f.ingrediente_semielaborado_id)
          cola.push({ tipo: 'semi', id: f.ingrediente_semielaborado_id })
        }
      }
    }
    return alcanzados
  }, [semiSel, pfSel, datos.recetaPF, datos.recetaSemi])

  // Jerarquía de 3 niveles con filtros ya aplicados. Combinación AND entre los 4 filtros.
  // Cascada de ocultación: SOLO el filtro de Proveedor puede dejar un padre sin hijos visibles
  // (Ingrediente/Semielaborado/Producto final ya filtran directamente qué ingredientes se
  // muestran, no dejan "cáscaras vacías") -- un ingrediente/artículo que genuinamente no tiene
  // nada vinculado (sin filtro de proveedor activo) se sigue mostrando, no se oculta.
  const filasVisibles = useMemo(() => {
    const proveedorFiltroActivo = proveedorSel.length > 0

    return datos.ingredientes
      .filter((i) => ingredienteSel.length === 0 || ingredienteSel.includes(i.id))
      .filter((i) => ingredientesAlcanzables === null || ingredientesAlcanzables.has(i.id))
      .map((i) => {
        const articuloIds = articulosPorIngrediente.get(i.id) || []
        const articulos = articuloIds
          .map((aid) => articuloPorId.get(aid))
          .filter(Boolean)
          .map((art) => {
            const duplasTodas = duplasPorArticulo.get(art.articulo_id) || []
            const duplas = duplasTodas
              .filter((d) => !proveedorFiltroActivo || proveedorSel.includes(d.proveedor_id))
              .map((d) => {
                const clave = `${art.articulo_id}:${d.proveedor_id}`
                return {
                  proveedorId: d.proveedor_id,
                  proveedorNombre: proveedorNombrePorId.get(d.proveedor_id) ?? '—',
                  precio: d.precio,
                  ultimoPrecio: ultimoPrecioPorDupla.get(clave) ?? null,
                  stock: stockPorDupla.get(clave) ?? 0,
                }
              })
            return { ...art, duplas, ocultarPorFiltro: proveedorFiltroActivo && duplasTodas.length > 0 && duplas.length === 0 }
          })
          .filter((art) => !art.ocultarPorFiltro)

        return {
          ...i,
          articulos,
          stock: articulos.reduce((sum, a) => sum + Number(a.stock), 0),
          necesidad: necesidadPorIngrediente.get(i.id) ?? null,
          ocultarPorFiltro: proveedorFiltroActivo && articuloIds.length > 0 && articulos.length === 0,
        }
      })
      .filter((i) => !i.ocultarPorFiltro)
  }, [
    datos.ingredientes, ingredienteSel, ingredientesAlcanzables, articulosPorIngrediente,
    articuloPorId, duplasPorArticulo, proveedorSel, proveedorNombrePorId, ultimoPrecioPorDupla,
    stockPorDupla, necesidadPorIngrediente,
  ])

  function toggleIngrediente(id) {
    setExpandidosIngrediente((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleArticulo(clave) {
    setExpandidosArticulo((prev) => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle="Stock y necesidad agregada por ingrediente, con desglose hasta la dupla artículo-proveedor."
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3">
          <Field label="Proveedor" className="w-56">
            <MultiSelect
              options={datos.proveedores.map((p) => ({ value: p.id, label: p.nombre_comercial }))}
              selected={proveedorSel}
              onChange={setProveedorSel}
            />
          </Field>
          <Field label="Ingrediente(s)" className="w-56">
            <MultiSelect
              options={datos.ingredientes.map((i) => ({ value: i.id, label: i.nombre }))}
              selected={ingredienteSel}
              onChange={setIngredienteSel}
            />
          </Field>
          <Field label="Semielaborado(s)" className="w-56">
            <MultiSelect
              options={datos.semielaborados.map((s) => ({ value: s.id, label: s.nombre }))}
              selected={semiSel}
              onChange={setSemiSel}
            />
          </Field>
          <Field label="Producto(s) final(es)" className="w-56">
            <MultiSelect
              options={datos.productosFinales.map((p) => ({ value: p.id, label: p.nombre }))}
              selected={pfSel}
              onChange={setPfSel}
            />
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : filasVisibles.length === 0 ? (
        <Card><EmptyState>Ningún ingrediente coincide con los filtros seleccionados.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <Thead>
              <Th></Th>
              <Th>Ingrediente</Th>
              <Th>Stock</Th>
              <Th>Necesidad agregada</Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {filasVisibles.map((ing) => {
                const expandido = expandidosIngrediente.has(ing.id)
                return (
                  <Fragment key={ing.id}>
                    <tr className="hover:bg-blue-50/40">
                      <Td className="w-8">
                        <button type="button" onClick={() => toggleIngrediente(ing.id)} className="text-gray-400 hover:text-gray-600">
                          {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </button>
                      </Td>
                      <Td className="font-medium">{ing.nombre}</Td>
                      <Td>{ing.stock.toFixed(3)} {ing.unidad}</Td>
                      <Td>
                        {cargandoNecesidad ? (
                          <span className="text-gray-400">…</span>
                        ) : ing.necesidad == null ? (
                          '—'
                        ) : (
                          <span className={ing.necesidad > 0 ? 'text-red-600 font-medium' : ''}>
                            {ing.necesidad.toFixed(3)} {ing.unidad}
                          </span>
                        )}
                      </Td>
                    </tr>
                    {expandido && (
                      <tr>
                        <Td colSpan={4} className="bg-gray-50/60 py-2">
                          {ing.articulos.length === 0 ? (
                            <p className="text-sm text-gray-400 px-2 py-1">Sin artículos vinculados todavía.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                                  <th className="pl-8 pr-2 py-1 font-medium"></th>
                                  <th className="px-2 py-1 font-medium">Artículo</th>
                                  <th className="px-2 py-1 font-medium">Stock</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {ing.articulos.map((art) => {
                                  const claveArt = `${ing.id}:${art.articulo_id}`
                                  const expandidoArt = expandidosArticulo.has(claveArt)
                                  return (
                                    <Fragment key={art.articulo_id}>
                                      <tr className="hover:bg-blue-50/30">
                                        <td className="pl-8 pr-2 py-1.5">
                                          <button type="button" onClick={() => toggleArticulo(claveArt)} className="text-gray-400 hover:text-gray-600">
                                            {expandidoArt ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                                          </button>
                                        </td>
                                        <td className="px-2 py-1.5">{art.nombre}</td>
                                        <td className="px-2 py-1.5">{Number(art.stock).toFixed(3)} {art.unidad}</td>
                                      </tr>
                                      {expandidoArt && (
                                        <tr>
                                          <td colSpan={3} className="bg-white py-1.5">
                                            {art.duplas.length === 0 ? (
                                              <p className="text-xs text-gray-400 pl-16 py-1">Sin proveedores asignados todavía.</p>
                                            ) : (
                                              <table className="w-full text-sm">
                                                <thead>
                                                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                                                    <th className="pl-16 pr-2 py-1 font-medium">Proveedor</th>
                                                    <th className="px-2 py-1 font-medium">Precio</th>
                                                    <th className="px-2 py-1 font-medium">Último precio de compra</th>
                                                    <th className="px-2 py-1 font-medium">Stock</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                  {art.duplas.map((d) => (
                                                    <tr key={d.proveedorId}>
                                                      <td className="pl-16 pr-2 py-1.5">{d.proveedorNombre}</td>
                                                      <td className="px-2 py-1.5">{d.precio != null ? `${d.precio} €/${art.unidad}` : '—'}</td>
                                                      <td className="px-2 py-1.5">
                                                        {d.ultimoPrecio ? `${d.ultimoPrecio.precio} €/${art.unidad} (${formatFecha(d.ultimoPrecio.fecha)})` : '—'}
                                                      </td>
                                                      <td className="px-2 py-1.5">{Number(d.stock).toFixed(3)} {art.unidad}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  )
                                })}
                              </tbody>
                            </table>
                          )}
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export default Inventario
