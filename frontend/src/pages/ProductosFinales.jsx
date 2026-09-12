import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { formatMoneda } from '../lib/formatCantidad'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, SectionLabel, EmptyState, LoadingState } from '../components/ui'
import { useNegocio } from '../context/useNegocio'

const lineaVacia = { tipo: 'articulo', articulo_id: '', ingrediente_semielaborado_id: '', ingrediente_id: '', cantidad: '' }

function ProductosFinales() {
  const { t } = useTranslation(['common', 'recetas_comun', 'productos_finales'])
  const { negocio } = useNegocio()
  const [productos, setProductos] = useState([])
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [ingredientes, setIngredientes] = useState([])
  const [categorias, setCategorias] = useState([])
  const [cargando, setCargando] = useState(true)

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [diasCaducidadDefault, setDiasCaducidadDefault] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState([{ ...lineaVacia }])
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resProd, resArt, resSemi, resIngredientes, resCategorias] = await Promise.all([
      supabase
        .from('productos_finales')
        .select(`
          *,
          categorias_articulo(nombre),
          receta_producto_final(
            id, cantidad, articulo_id, ingrediente_semielaborado_id, ingrediente_id,
            articulos_compra(nombre, unidad),
            semielaborados(nombre, unidad),
            ingredientes(nombre, unidad)
          )
        `)
        .order('nombre', { ascending: true }),
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('ingredientes').select('id, nombre, unidad').order('nombre'),
      supabase.from('categorias_articulo').select('id, nombre').order('nombre'),
    ])

    if (resProd.error) console.error(resProd.error)
    else setProductos(resProd.data)

    if (resArt.error) console.error(resArt.error)
    else setArticulos(resArt.data)

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    if (resIngredientes.error) console.error(resIngredientes.error)
    else setIngredientes(resIngredientes.data)

    if (resCategorias.error) console.error('Error cargando categorías:', resCategorias.error)
    else setCategorias(resCategorias.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleLineaChange(index, campo, valor) {
    setLineas((prev) => {
      const copia = [...prev]
      copia[index] = { ...copia[index], [campo]: valor }
      if (campo === 'tipo') {
        copia[index].articulo_id = ''
        copia[index].ingrediente_semielaborado_id = ''
        copia[index].ingrediente_id = ''
      }
      return copia
    })
  }

  function addLinea() {
    setLineas((prev) => [...prev, { ...lineaVacia }])
  }

  function removeLinea(index) {
    setLineas((prev) => prev.filter((_, i) => i !== index))
  }

  function resetForm() {
    setNombre('')
    setCodigo('')
    setCategoriaId('')
    setPrecioVenta('')
    setDiasCaducidadDefault('')
    setNotas('')
    setLineas([{ ...lineaVacia }])
    setEditandoId(null)
  }

  function handleEditar(p) {
    setNombre(p.nombre ?? '')
    setCodigo(p.codigo ?? '')
    setCategoriaId(p.categoria_id ? String(p.categoria_id) : '')
    setPrecioVenta(p.precio_venta ?? '')
    setDiasCaducidadDefault(p.dias_caducidad_default ?? '')
    setNotas(p.notas ?? '')

    const lineasCargadas = p.receta_producto_final.map((l) => ({
      tipo: l.articulo_id ? 'articulo' : l.ingrediente_id ? 'ingrediente' : 'semielaborado',
      articulo_id: l.articulo_id ?? '',
      ingrediente_semielaborado_id: l.ingrediente_semielaborado_id ?? '',
      ingrediente_id: l.ingrediente_id ?? '',
      cantidad: l.cantidad ?? '',
    }))

    setLineas(lineasCargadas.length > 0 ? lineasCargadas : [{ ...lineaVacia }])
    setEditandoId(p.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const lineasValidas = lineas.filter(
      (l) => l.cantidad && (l.articulo_id || l.ingrediente_semielaborado_id || l.ingrediente_id)
    )
    if (lineasValidas.length === 0) {
      alert(t('recetas_comun:alertas.sin_ingredientes_receta'))
      return
    }

    let productoId = editandoId

    if (editandoId) {
      const { error: errorUpdate } = await supabase
        .from('productos_finales')
        .update({
          nombre,
          codigo: codigo || null,
          categoria_id: categoriaId ? parseInt(categoriaId) : null,
          precio_venta: precioVenta ? parseFloat(precioVenta) : null,
          dias_caducidad_default: diasCaducidadDefault ? parseInt(diasCaducidadDefault) : null,
          notas: notas || null,
        })
        .eq('id', editandoId)

      if (errorUpdate) {
        alert(t('recetas_comun:alertas.error_actualizar', { mensaje: errorUpdate.message }))
        return
      }

      const { error: errorDelete } = await supabase
        .from('receta_producto_final')
        .delete()
        .eq('producto_final_id', editandoId)

      if (errorDelete) {
        alert(t('recetas_comun:alertas.error_actualizar_receta', { mensaje: errorDelete.message }))
        return
      }
    } else {
      const { data: prodCreado, error: errorProd } = await supabase
        .from('productos_finales')
        .insert({
          nombre,
          codigo: codigo || null,
          categoria_id: categoriaId ? parseInt(categoriaId) : null,
          precio_venta: precioVenta ? parseFloat(precioVenta) : null,
          dias_caducidad_default: diasCaducidadDefault ? parseInt(diasCaducidadDefault) : null,
          notas: notas || null,
        })
        .select()
        .single()

      if (errorProd) {
        alert(t('productos_finales:alertas.error_crear_producto', { mensaje: errorProd.message }))
        return
      }
      productoId = prodCreado.id
    }

    const lineasParaInsertar = lineasValidas.map((l) => ({
      producto_final_id: productoId,
      articulo_id: l.tipo === 'articulo' ? parseInt(l.articulo_id) : null,
      ingrediente_semielaborado_id: l.tipo === 'semielaborado' ? parseInt(l.ingrediente_semielaborado_id) : null,
      ingrediente_id: l.tipo === 'ingrediente' ? parseInt(l.ingrediente_id) : null,
      cantidad: parseFloat(l.cantidad),
    }))

    const { error: errorLineas } = await supabase
      .from('receta_producto_final')
      .insert(lineasParaInsertar)

    if (errorLineas) {
      alert(t('recetas_comun:alertas.error_guardar_receta', { mensaje: errorLineas.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    resetForm()
    cargarDatos()
  }

  async function handleBorrar(id) {
    const { count } = await supabase
      .from('producciones_producto_final')
      .select('*', { count: 'exact', head: true })
      .eq('producto_final_id', id)

    if (count > 0) {
      alert(t('productos_finales:alertas.tiene_producciones', { count }))
      return
    }

    if (!confirm(t('productos_finales:alertas.confirmar_borrar'))) return

    const { error } = await supabase.from('productos_finales').delete().eq('id', id)
    if (error) {
      alert(t('recetas_comun:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    if (editandoId === id) resetForm()
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('productos_finales:titulo')} />

      <Card className="mb-6">
        <CardHeader title={editandoId ? t('productos_finales:card_editar_titulo') : t('productos_finales:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={t('recetas_comun:campos.nombre')}>
                <Input type="text" placeholder={t('productos_finales:nombre_placeholder')} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </Field>
              <Field label={t('recetas_comun:campos.codigo_corto')}>
                <Input type="text" placeholder={t('productos_finales:codigo_placeholder')} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </Field>
              <Field label={t('productos_finales:campos.categoria')}>
                <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                  <option value="">{t('productos_finales:selecciona_categoria')}</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('productos_finales:campos.precio_venta')}>
                <Input type="number" step="0.01" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} />
              </Field>
              <Field label={t('recetas_comun:campos.dias_caducidad_opcional')}>
                <Input type="number" step="1" min="0" placeholder="Ej. 3" value={diasCaducidadDefault}
                  onChange={(e) => setDiasCaducidadDefault(e.target.value)} />
              </Field>
            </div>
            <Field label={t('recetas_comun:campos.notas_opcional')}>
              <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Field>

            <div>
              <SectionLabel>{t('recetas_comun:receta_titulo')}</SectionLabel>
              <div className="flex flex-col gap-3">
                {lineas.map((linea, index) => (
                  <div key={index} className="border border-border rounded-control p-3 flex flex-col gap-2">
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'articulo'}
                          onChange={() => handleLineaChange(index, 'tipo', 'articulo')} />
                        {t('recetas_comun:tipo_articulo')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'ingrediente'}
                          onChange={() => handleLineaChange(index, 'tipo', 'ingrediente')} />
                        {t('recetas_comun:tipo_ingrediente')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={linea.tipo === 'semielaborado'}
                          onChange={() => handleLineaChange(index, 'tipo', 'semielaborado')} />
                        {t('recetas_comun:tipo_label.semielaborado')}
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-center">
                      {linea.tipo === 'articulo' && (
                        <Select value={linea.articulo_id}
                          onChange={(e) => handleLineaChange(index, 'articulo_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_articulo')}</option>
                          {articulos.map((a) => (
                            <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'ingrediente' && (
                        <Select value={linea.ingrediente_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_ingrediente')}</option>
                          {ingredientes.map((i) => (
                            <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
                          ))}
                        </Select>
                      )}
                      {linea.tipo === 'semielaborado' && (
                        <Select value={linea.ingrediente_semielaborado_id}
                          onChange={(e) => handleLineaChange(index, 'ingrediente_semielaborado_id', e.target.value)}
                          required>
                          <option value="">{t('recetas_comun:selecciona_semielaborado')}</option>
                          {semielaborados.map((s) => (
                            <option key={s.id} value={s.id}>{s.nombre} ({s.unidad})</option>
                          ))}
                        </Select>
                      )}
                      <Input type="number" step="0.001" placeholder={t('recetas_comun:tabla.cantidad')} value={linea.cantidad}
                        onChange={(e) => handleLineaChange(index, 'cantidad', e.target.value)}
                        required title={t('common:redondea_3_decimales')} />
                      <button type="button" onClick={() => removeLinea(index)}
                        className="text-ink-faint hover:text-danger-600 justify-self-center">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLinea}
                className="mt-2 text-sm text-primary-600 font-medium flex items-center gap-1 hover:underline">
                <IconPlus size={15} /> {t('recetas_comun:anadir_ingrediente')}
              </button>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editandoId ? t('productos_finales:guardar_cambios') : t('productos_finales:guardar_producto')}</Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={resetForm}>{t('common:actions.cancel')}</Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('common:listado_titulo')}</h2>

      {cargando ? (
        <LoadingState />
      ) : productos.length === 0 ? (
        <Card><EmptyState>{t('productos_finales:sin_productos')}</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {productos.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-ink">
                    {p.nombre} {p.codigo && <span className="text-ink-faint font-mono text-xs">({p.codigo})</span>}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {p.categorias_articulo?.nombre ?? t('productos_finales:sin_categoria')}
                    {p.precio_venta != null && ` · ${t('productos_finales:precio_label', { precio: formatMoneda(p.precio_venta, negocio?.moneda) })}`}
                  </p>
                  {p.notas && <p className="text-sm text-ink-faint italic">{p.notas}</p>}
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(p)}>{t('recetas_comun:editar')}</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(p.id)}>{t('recetas_comun:borrar')}</LinkAction>
                </div>
              </div>

              <table className="w-full mt-3 text-sm">
                <thead>
                  <tr className="text-left text-overline text-ink-subtle border-b border-border-subtle">
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.ingrediente')}</th>
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.tipo')}</th>
                    <th className="py-1.5 font-medium">{t('recetas_comun:tabla.cantidad')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {p.receta_producto_final.map((linea) => {
                    const tipo = linea.articulos_compra ? t('recetas_comun:tipo_label.articulo') : linea.ingredientes ? t('recetas_comun:tipo_label.ingrediente') : t('recetas_comun:tipo_label.semielaborado')
                    const fuente = linea.articulos_compra ?? linea.ingredientes ?? linea.semielaborados
                    return (
                      <tr key={linea.id}>
                        <td className="py-1.5">{fuente?.nombre ?? '—'}</td>
                        <td className="py-1.5 text-ink-faint">{tipo}</td>
                        <td className="py-1.5">{linea.cantidad} {fuente?.unidad}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProductosFinales
