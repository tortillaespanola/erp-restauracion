import { useState, useEffect, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/formatFecha'
import { formatCantidad, formatMoneda } from '../lib/formatCantidad'
import { useNegocio } from '../context/useNegocio'
import { IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import { PageHeader, Card, CardBody, Field, MultiSelect, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer, LinkAction } from '../components/ui'
import AjusteStockForm from '../components/AjusteStockForm'

const datosVacios = {
  ingredientes: [], articuloIngrediente: [], stockArticulos: [], articuloProveedor: [],
  proveedores: [], stockLotes: [], entradaMaterial: [], recetaPF: [], recetaSemi: [],
  productosFinales: [], semielaborados: [], ajustesArticulo: [], consumoProduccion: [],
  consumoProduccionPF: [],
}

function Inventario() {
  const { t } = useTranslation(['common', 'inventario'])
  const { negocio } = useNegocio()
  const [datos, setDatos] = useState(datosVacios)
  const [demandaPorIngrediente, setDemandaPorIngrediente] = useState(new Map())
  const [cargando, setCargando] = useState(true)
  const [cargandoNecesidad, setCargandoNecesidad] = useState(true)

  const [proveedorSel, setProveedorSel] = useState([])
  const [ingredienteSel, setIngredienteSel] = useState([])
  const [semiSel, setSemiSel] = useState([])
  const [pfSel, setPfSel] = useState([])
  const [soloConNecesidad, setSoloConNecesidad] = useState(false)

  const [expandidosIngrediente, setExpandidosIngrediente] = useState(new Set())
  const [expandidosArticulo, setExpandidosArticulo] = useState(new Set())
  const [expandidosDupla, setExpandidosDupla] = useState(new Set())

  // Ajuste rápido desde una fila de Inventario (CONTRATO_AJUSTE_RAPIDO_INVENTARIO.md, Parte A) --
  // `null` = drawer cerrado, objeto = contexto fijo (artículo + lote) que precarga el formulario.
  const [ajusteDrawer, setAjusteDrawer] = useState(null)

  async function cargarDatos() {
    setCargando(true)
    setCargandoNecesidad(true)

    const [
      resIngredientes, resArticuloIngrediente, resStockArticulos, resArticuloProveedor,
      resProveedores, resStockLotes, resEntradaMaterial, resRecetaPF, resRecetaSemi,
      resProductosFinales, resSemielaborados, resAjustesArticulo, resConsumoProduccion,
      resConsumoProduccionPF,
    ] = await Promise.all([
      supabase.from('ingredientes').select('id, nombre, unidad').order('nombre'),
      supabase.from('articulo_ingrediente').select('articulo_id, ingrediente_id'),
      supabase.from('stock_articulos').select('articulo_id, nombre, unidad, stock'),
      supabase.from('articulo_proveedor').select('id, articulo_id, proveedor_id, precio, preferente'),
      supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial'),
      supabase.from('stock_lotes_articulo').select('entrada_material_id, articulo_id, stock_disponible'),
      supabase.from('entrada_material').select('id, articulo_id, cantidad, precio, codigo_lote, albaranes_compra(proveedor_id, fecha)'),
      supabase.from('receta_producto_final').select('producto_final_id, articulo_id, ingrediente_id, ingrediente_semielaborado_id, cantidad'),
      supabase.from('receta_semielaborado').select('semielaborado_id, articulo_id, ingrediente_id, ingrediente_semielaborado_id, cantidad'),
      supabase.from('productos_finales').select('id, nombre').order('nombre'),
      supabase.from('semielaborados').select('id, nombre').order('nombre'),
      supabase.from('ajustes_articulo').select('entrada_material_id, cantidad'),
      supabase.from('consumo_produccion').select('entrada_material_id, cantidad').not('entrada_material_id', 'is', null),
      supabase.from('consumo_produccion_pf').select('entrada_material_id, cantidad').not('entrada_material_id', 'is', null),
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
      ajustesArticulo: resAjustesArticulo.data || [],
      consumoProduccion: resConsumoProduccion.data || [],
      consumoProduccionPF: resConsumoProduccionPF.data || [],
    }
    setDatos(nuevosDatos)
    setCargando(false)

    // Demanda pendiente (sin restar stock -- eso lo hace filasVisibles reutilizando el subtotal
    // de stock ya calculado, ver Necesidad agregada = demanda - stock más abajo): una RPC por
    // ingrediente, en paralelo -- volumen bajo (decenas), no hace falta una función bulk.
    const demandas = await Promise.all(
      nuevosDatos.ingredientes.map((i) =>
        supabase.rpc('demanda_pendiente_ingrediente', { p_ingrediente_id: i.id }).then((r) => [i.id, r.error ? null : Number(r.data)])
      )
    )
    setDemandaPorIngrediente(new Map(demandas))
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

  // Nivel 4: lotes vivos por dupla artículo-proveedor, con el desglose Entrado/Consumido que debe
  // cuadrar contra stock_disponible (identidad verificada 57/57 en Fase A, migración de referencia
  // ver stock_lotes_articulo). Ajuste positivo = entrada más (nunca "consumo negativo"); solo el
  // ajuste que reduce el lote cuenta como Consumido.
  const ajustesPorEntrada = useMemo(() => {
    const m = new Map()
    for (const aj of datos.ajustesArticulo) {
      const actual = m.get(aj.entrada_material_id) || { positivos: 0, negativos: 0 }
      const cantidad = Number(aj.cantidad)
      if (cantidad > 0) actual.positivos += cantidad
      else actual.negativos += -cantidad
      m.set(aj.entrada_material_id, actual)
    }
    return m
  }, [datos.ajustesArticulo])

  const consumoPorEntrada = useMemo(() => {
    const m = new Map()
    for (const c of [...datos.consumoProduccion, ...datos.consumoProduccionPF]) {
      m.set(c.entrada_material_id, (m.get(c.entrada_material_id) || 0) + Number(c.cantidad))
    }
    return m
  }, [datos.consumoProduccion, datos.consumoProduccionPF])

  const lotesPorDupla = useMemo(() => {
    const m = new Map()
    for (const lote of datos.stockLotes) {
      if (Number(lote.stock_disponible) <= 0) continue
      const proveedorId = proveedorDeEntrada.get(lote.entrada_material_id)
      if (proveedorId == null) continue
      const em = datos.entradaMaterial.find((e) => e.id === lote.entrada_material_id)
      if (!em) continue
      const ajustes = ajustesPorEntrada.get(lote.entrada_material_id) || { positivos: 0, negativos: 0 }
      const consumoProduccionTotal = consumoPorEntrada.get(lote.entrada_material_id) || 0
      const clave = `${lote.articulo_id}:${proveedorId}`
      if (!m.has(clave)) m.set(clave, [])
      m.get(clave).push({
        entradaMaterialId: lote.entrada_material_id,
        codigoLote: em.codigo_lote,
        fechaRecepcion: em.albaranes_compra?.fecha,
        cantidadRecibida: Number(em.cantidad),
        ajustesPositivos: ajustes.positivos,
        entrado: Number(em.cantidad) + ajustes.positivos,
        consumoProduccionTotal,
        ajustesNegativos: ajustes.negativos,
        consumido: consumoProduccionTotal + ajustes.negativos,
        stock: Number(lote.stock_disponible),
      })
    }
    return m
  }, [datos.stockLotes, datos.entradaMaterial, proveedorDeEntrada, ajustesPorEntrada, consumoPorEntrada])

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
                  lotes: lotesPorDupla.get(clave) ?? [],
                }
              })
            return { ...art, duplas, ocultarPorFiltro: proveedorFiltroActivo && duplasTodas.length > 0 && duplas.length === 0 }
          })
          .filter((art) => !art.ocultarPorFiltro)

        const stock = articulos.reduce((sum, a) => sum + Number(a.stock), 0)
        const demanda = demandaPorIngrediente.get(i.id)
        // Necesidad agregada = demanda pendiente de fabricar - stock actual de ingrediente ya en
        // almacén (reutiliza `stock`, no una segunda agregación), clampeada a 0 -- "negativo" no
        // existe en esta columna: 0 es "no hace falta comprar", positivo es "esto falta" (ver
        // migración 20260925 para la parte de demanda, sin acumulado histórico).
        const necesidad = demanda == null ? null : Math.max(demanda - stock, 0)
        return {
          ...i,
          articulos,
          stock,
          necesidad,
          ocultarPorFiltro:
            (proveedorFiltroActivo && articuloIds.length > 0 && articulos.length === 0) ||
            (soloConNecesidad && !(necesidad > 0)),
        }
      })
      .filter((i) => !i.ocultarPorFiltro)
  }, [
    datos.ingredientes, ingredienteSel, ingredientesAlcanzables, articulosPorIngrediente,
    articuloPorId, duplasPorArticulo, proveedorSel, proveedorNombrePorId, ultimoPrecioPorDupla,
    stockPorDupla, lotesPorDupla, demandaPorIngrediente, soloConNecesidad,
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

  function toggleDupla(clave) {
    setExpandidosDupla((prev) => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title={t('inventario:titulo')}
        subtitle={t('inventario:subtitulo')}
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap gap-3">
          <Field label={t('inventario:filtros.proveedor')} className="w-56">
            <MultiSelect
              options={datos.proveedores.map((p) => ({ value: p.id, label: p.nombre_comercial }))}
              selected={proveedorSel}
              onChange={setProveedorSel}
              placeholder={t('common:actions.all')}
            />
          </Field>
          <Field label={t('inventario:filtros.ingredientes')} className="w-56">
            <MultiSelect
              options={datos.ingredientes.map((i) => ({ value: i.id, label: i.nombre }))}
              selected={ingredienteSel}
              onChange={setIngredienteSel}
              placeholder={t('common:actions.all')}
            />
          </Field>
          <Field label={t('inventario:filtros.semielaborados')} className="w-56">
            <MultiSelect
              options={datos.semielaborados.map((s) => ({ value: s.id, label: s.nombre }))}
              selected={semiSel}
              onChange={setSemiSel}
              placeholder={t('common:actions.all')}
            />
          </Field>
          <Field label={t('inventario:filtros.productos_finales')} className="w-56">
            <MultiSelect
              options={datos.productosFinales.map((p) => ({ value: p.id, label: p.nombre }))}
              selected={pfSel}
              onChange={setPfSel}
              placeholder={t('common:actions.all')}
            />
          </Field>
          <Field label={t('inventario:filtros.solo_con_necesidad')} className="w-52">
            <label className="flex items-center gap-2 border border-border rounded-control px-3 py-2 text-sm text-ink-body bg-surface cursor-pointer">
              <input type="checkbox" checked={soloConNecesidad} onChange={(e) => setSoloConNecesidad(e.target.checked)} />
              {t('inventario:necesidad_mayor_cero')}
            </label>
          </Field>
        </CardBody>
      </Card>

      {cargando ? (
        <LoadingState />
      ) : filasVisibles.length === 0 ? (
        <Card>
          <EmptyState>
            {soloConNecesidad ? t('inventario:nada_pendiente_comprar') : t('inventario:sin_coincidencias_filtros')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <Thead>
              <Th></Th>
              <Th>{t('inventario:tabla.ingrediente')}</Th>
              <Th className="text-right">{t('inventario:tabla.stock')}</Th>
              <Th className="text-right">{t('inventario:tabla.necesidad_agregada')}</Th>
            </Thead>
            <tbody className="divide-y divide-border-subtle">
              {filasVisibles.map((ing) => {
                const expandido = expandidosIngrediente.has(ing.id)
                return (
                  <Fragment key={ing.id}>
                    <tr className="hover:bg-primary-50/40">
                      <Td className="w-8">
                        <button type="button" onClick={() => toggleIngrediente(ing.id)} className="text-ink-faint hover:text-ink-body">
                          {expandido ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </button>
                      </Td>
                      <Td className="font-medium">{ing.nombre}</Td>
                      <Td className="font-mono tabular-nums text-right">{formatCantidad(ing.stock, ing.unidad)} {ing.unidad}</Td>
                      <Td className="font-mono tabular-nums text-right">
                        {cargandoNecesidad ? (
                          <span className="text-ink-faint">…</span>
                        ) : ing.necesidad == null ? (
                          '—'
                        ) : (
                          <span className={ing.necesidad > 0 ? 'text-danger-600 font-medium' : ''}>
                            {formatCantidad(ing.necesidad, ing.unidad)} {ing.unidad}
                          </span>
                        )}
                      </Td>
                    </tr>
                    {expandido && (
                      <tr>
                        <Td colSpan={4} className="bg-canvas/60 py-2">
                          {ing.articulos.length === 0 ? (
                            <p className="text-sm text-ink-faint px-2 py-1">{t('inventario:sin_articulos_vinculados')}</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-overline text-ink-subtle">
                                  <th className="pl-8 pr-2 py-1 font-medium"></th>
                                  <th className="px-2 py-1 font-medium">{t('inventario:tabla.articulo')}</th>
                                  <th className="px-2 py-1 font-medium">{t('inventario:tabla.stock')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border-subtle">
                                {ing.articulos.map((art) => {
                                  const claveArt = `${ing.id}:${art.articulo_id}`
                                  const expandidoArt = expandidosArticulo.has(claveArt)
                                  return (
                                    <Fragment key={art.articulo_id}>
                                      <tr className="hover:bg-primary-50/30">
                                        <td className="pl-8 pr-2 py-1.5">
                                          <button type="button" onClick={() => toggleArticulo(claveArt)} className="text-ink-faint hover:text-ink-body">
                                            {expandidoArt ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                                          </button>
                                        </td>
                                        <td className="px-2 py-1.5">{art.nombre}</td>
                                        <td className="px-2 py-1.5">{formatCantidad(art.stock, art.unidad)} {art.unidad}</td>
                                      </tr>
                                      {expandidoArt && (
                                        <tr>
                                          <td colSpan={3} className="bg-surface py-1.5">
                                            {art.duplas.length === 0 ? (
                                              <p className="text-xs text-ink-faint pl-16 py-1">{t('inventario:sin_proveedores_asignados')}</p>
                                            ) : (
                                              <table className="w-full text-sm">
                                                <thead>
                                                  <tr className="text-left text-overline text-ink-subtle">
                                                    <th className="pl-16 pr-2 py-1 font-medium"></th>
                                                    <th className="px-2 py-1 font-medium">{t('inventario:tabla.proveedor')}</th>
                                                    <th className="px-2 py-1 font-medium">{t('inventario:tabla.precio')}</th>
                                                    <th className="px-2 py-1 font-medium">{t('inventario:tabla.ultimo_precio_compra')}</th>
                                                    <th className="px-2 py-1 font-medium">{t('inventario:tabla.stock')}</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border-subtle">
                                                  {art.duplas.map((d) => {
                                                    const claveDupla = `${claveArt}:${d.proveedorId}`
                                                    const expandidoDupla = expandidosDupla.has(claveDupla)
                                                    return (
                                                      <Fragment key={d.proveedorId}>
                                                        <tr className="hover:bg-primary-50/20">
                                                          <td className="pl-16 pr-2 py-1.5">
                                                            {d.lotes.length > 0 && (
                                                              <button type="button" onClick={() => toggleDupla(claveDupla)} className="text-ink-faint hover:text-ink-body">
                                                                {expandidoDupla ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                                                              </button>
                                                            )}
                                                          </td>
                                                          <td className="px-2 py-1.5">{d.proveedorNombre}</td>
                                                          <td className="px-2 py-1.5">{d.precio != null ? `${formatMoneda(d.precio, negocio?.moneda)}/${art.unidad}` : '—'}</td>
                                                          <td className="px-2 py-1.5">
                                                            {d.ultimoPrecio ? `${formatMoneda(d.ultimoPrecio.precio, negocio?.moneda)}/${art.unidad} (${formatFecha(d.ultimoPrecio.fecha)})` : '—'}
                                                          </td>
                                                          <td className="px-2 py-1.5">{formatCantidad(d.stock, art.unidad)} {art.unidad}</td>
                                                        </tr>
                                                        {expandidoDupla && (
                                                          <tr>
                                                            <td colSpan={5} className="bg-canvas/40 py-1.5">
                                                              {d.lotes.length === 0 ? (
                                                                <p className="text-xs text-ink-faint pl-24 py-1">{t('inventario:sin_lotes_vivos')}</p>
                                                              ) : (
                                                                <table className="w-full text-sm">
                                                                  <thead>
                                                                    <tr className="text-left text-overline text-ink-subtle">
                                                                      <th className="pl-24 pr-2 py-1 font-medium">{t('inventario:tabla.recepcion')}</th>
                                                                      <th className="px-2 py-1 font-medium">{t('inventario:tabla.lote')}</th>
                                                                      <th className="px-2 py-1 font-medium">{t('inventario:tabla.entrado')}</th>
                                                                      <th className="px-2 py-1 font-medium">{t('inventario:tabla.consumido')}</th>
                                                                      <th className="px-2 py-1 font-medium">{t('inventario:tabla.stock')}</th>
                                                                      <th className="px-2 py-1 font-medium"></th>
                                                                    </tr>
                                                                  </thead>
                                                                  <tbody className="divide-y divide-border-subtle">
                                                                    {d.lotes.map((lote) => (
                                                                      <tr key={lote.entradaMaterialId}>
                                                                        <td className="pl-24 pr-2 py-1.5">{lote.fechaRecepcion ? formatFecha(lote.fechaRecepcion) : '—'}</td>
                                                                        <td className="px-2 py-1.5">{lote.codigoLote || '—'}</td>
                                                                        <td className="px-2 py-1.5">
                                                                          {formatCantidad(lote.entrado, art.unidad)} {art.unidad}
                                                                          {lote.ajustesPositivos > 0 && (
                                                                            <div className="text-[10px] text-ink-faint">
                                                                              {t('inventario:recibido_ajuste', { cantidad: formatCantidad(lote.cantidadRecibida, art.unidad), ajuste: formatCantidad(lote.ajustesPositivos, art.unidad) })}
                                                                            </div>
                                                                          )}
                                                                        </td>
                                                                        <td className="px-2 py-1.5">
                                                                          {formatCantidad(lote.consumido, art.unidad)} {art.unidad}
                                                                          {lote.ajustesNegativos > 0 && (
                                                                            <div className="text-[10px] text-ink-faint">
                                                                              {t('inventario:produccion_ajuste', { cantidad: formatCantidad(lote.consumoProduccionTotal, art.unidad), ajuste: formatCantidad(lote.ajustesNegativos, art.unidad) })}
                                                                            </div>
                                                                          )}
                                                                        </td>
                                                                        <td className="px-2 py-1.5">{formatCantidad(lote.stock, art.unidad)} {art.unidad}</td>
                                                                        <td className="px-2 py-1.5 text-right">
                                                                          <LinkAction
                                                                            className="text-xs"
                                                                            onClick={() => setAjusteDrawer({
                                                                              tipo: 'articulo',
                                                                              itemId: art.articulo_id,
                                                                              itemNombre: art.nombre,
                                                                              itemUnidad: art.unidad,
                                                                              loteId: lote.entradaMaterialId,
                                                                              loteLabel: `${lote.codigoLote ? lote.codigoLote + ' · ' : ''}${t('inventario:recepcion_lote_label', { fecha: lote.fechaRecepcion ? formatFecha(lote.fechaRecepcion) : '—' })}`,
                                                                              stockActual: lote.stock,
                                                                            })}
                                                                          >
                                                                            {t('inventario:ajustar')}
                                                                          </LinkAction>
                                                                        </td>
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

      <Drawer open={!!ajusteDrawer} onClose={() => setAjusteDrawer(null)} title={t('inventario:drawer_ajustar_stock_titulo')}>
        {ajusteDrawer && (
          <AjusteStockForm
            fijo={ajusteDrawer}
            onCancelar={() => setAjusteDrawer(null)}
            onGuardado={() => {
              setAjusteDrawer(null)
              cargarDatos()
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

export default Inventario
