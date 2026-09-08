import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatMoneda } from '../lib/formatCantidad'
import { IconThermometer, IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, Badge, EmptyState, LoadingState } from '../components/ui'
import { useNegocio } from '../context/useNegocio'

const NUEVO_INGREDIENTE = '__nuevo__'

const vacio = {
  nombre: '', unidadId: '', categoriaId: '', iva: '', tipo_material: 'RM',
  requiere_control_temperatura: false, temperatura_min: '', temperatura_max: '',
  ingredienteId: '', ingredienteNuevoNombre: '', ingredienteNuevoUnidadId: '',
}

async function generarCodigoArticulo(categoriaId, categorias, ingredienteId) {
  const categoria = categorias.find((c) => c.id === parseInt(categoriaId))
  let contadorProveedor = 1
  if (ingredienteId) {
    const { count } = await supabase
      .from('articulo_ingrediente')
      .select('*', { count: 'exact', head: true })
      .eq('ingrediente_id', ingredienteId)
    contadorProveedor = (count ?? 0) + 1
  }
  const contadorCalidad = 1
  return `${categoria.acronimo}-${String(contadorProveedor).padStart(2, '0')}-${String(contadorCalidad).padStart(2, '0')}`
}

const TIPOS_MATERIAL = ['RM', 'AUX', 'TRD']

function Articulos() {
  const { t } = useTranslation(['common', 'enums', 'compras_comun', 'articulos'])
  const [articulos, setArticulos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [unidades, setUnidades] = useState([])
  const [ingredientesDeCategoria, setIngredientesDeCategoria] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resArticulos, resCategorias, resUnidades] = await Promise.all([
      supabase
        .from('articulos_compra')
        .select('*, articulo_proveedor(id, precio, preferente, referencia_proveedor, proveedores(id, nombre_comercial)), categorias_articulo(nombre, acronimo)')
        .order('created_at', { ascending: false }),
      supabase.from('categorias_articulo').select('id, nombre, acronimo').order('nombre'),
      supabase.from('unidades_medida').select('id, codigo, nombre').order('codigo'),
    ])

    if (resArticulos.error) console.error('Error cargando artículos:', resArticulos.error)
    else setArticulos(resArticulos.data)

    if (resCategorias.error) console.error('Error cargando categorías:', resCategorias.error)
    else setCategorias(resCategorias.data)

    if (resUnidades.error) console.error('Error cargando unidades:', resUnidades.error)
    else setUnidades(resUnidades.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  useEffect(() => {
    async function cargarIngredientes() {
      if (!form.categoriaId) {
        setIngredientesDeCategoria([])
        return
      }
      const { data } = await supabase
        .from('ingredientes')
        .select('id, nombre, unidad')
        .eq('categoria_id', form.categoriaId)
        .order('nombre')
      setIngredientesDeCategoria(data || [])
    }
    cargarIngredientes()
  }, [form.categoriaId])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function handleChangeCategoria(valor) {
    setForm((prev) => ({ ...prev, categoriaId: valor, ingredienteId: '', ingredienteNuevoNombre: '', ingredienteNuevoUnidadId: '' }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const payload = {
      nombre: form.nombre,
      unidad_id: parseInt(form.unidadId),
      categoria_id: parseInt(form.categoriaId),
      iva: form.iva ? parseFloat(form.iva) : null,
      tipo_material: form.tipo_material,
      requiere_control_temperatura: form.requiere_control_temperatura,
      temperatura_min: form.requiere_control_temperatura && form.temperatura_min ? parseFloat(form.temperatura_min) : null,
      temperatura_max: form.requiere_control_temperatura && form.temperatura_max ? parseFloat(form.temperatura_max) : null,
    }

    if (editandoId) {
      // trg_validar_cambio_unidad_articulos bloquea el UPDATE si este artículo está vinculado a
      // un ingrediente con otra unidad -- el mensaje de la excepción ya viene redactado en
      // español, se muestra tal cual.
      const { error } = await supabase.from('articulos_compra').update(payload).eq('id', editandoId)
      if (error) {
        alert(t('articulos:alertas.error_actualizar', { mensaje: error.message }))
        return
      }
    } else {
      let ingredienteId = form.ingredienteId && form.ingredienteId !== NUEVO_INGREDIENTE ? parseInt(form.ingredienteId) : null

      if (form.ingredienteId === NUEVO_INGREDIENTE) {
        if (!form.ingredienteNuevoNombre || !form.ingredienteNuevoUnidadId) {
          alert(t('articulos:alertas.sin_nombre_unidad_ingrediente'))
          return
        }
        const { data: nuevoIngrediente, error: errorIngrediente } = await supabase
          .from('ingredientes')
          .insert({ nombre: form.ingredienteNuevoNombre, unidad_id: parseInt(form.ingredienteNuevoUnidadId), categoria_id: parseInt(form.categoriaId) })
          .select()
          .single()
        if (errorIngrediente) {
          alert(t('articulos:alertas.error_crear_ingrediente', { mensaje: errorIngrediente.message }))
          return
        }
        ingredienteId = nuevoIngrediente.id
      }

      const codigo = await generarCodigoArticulo(form.categoriaId, categorias, ingredienteId)

      const { data: nuevoArticulo, error } = await supabase
        .from('articulos_compra')
        .insert({ ...payload, codigo })
        .select()
        .single()
      if (error) {
        alert(t('articulos:alertas.error_guardar', { mensaje: error.message }))
        return
      }

      if (ingredienteId) {
        const { error: errorVinculo } = await supabase
          .from('articulo_ingrediente')
          .insert({ articulo_id: nuevoArticulo.id, ingrediente_id: ingredienteId })
        if (errorVinculo) {
          alert(t('articulos:alertas.error_vincular_ingrediente', { mensaje: errorVinculo.message }))
        }
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarDatos()
  }

  function handleEditar(a) {
    setForm({
      nombre: a.nombre ?? '',
      unidadId: a.unidad_id ? String(a.unidad_id) : '',
      categoriaId: a.categoria_id ? String(a.categoria_id) : '',
      iva: a.iva ?? '',
      tipo_material: a.tipo_material ?? 'RM',
      requiere_control_temperatura: a.requiere_control_temperatura ?? false,
      temperatura_min: a.temperatura_min ?? '',
      temperatura_max: a.temperatura_max ?? '',
      ingredienteId: '', ingredienteNuevoNombre: '', ingredienteNuevoUnidadId: '',
    })
    setEditandoId(a.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm(t('articulos:alertas.confirmar_borrar'))) return
    const { error } = await supabase.from('articulos_compra').delete().eq('id', id)
    if (error) {
      alert(t('articulos:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    cargarDatos()
  }

  return (
    <div>
      <PageHeader title={t('articulos:titulo')} />

      <Card className="mb-6">
        <CardHeader title={editandoId ? t('articulos:card_editar_titulo') : t('articulos:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field label={t('articulos:campos.nombre')}>
              <Input type="text" placeholder={t('articulos:nombre_placeholder')} value={form.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)} required />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t('articulos:campos.categoria')}>
                <Select value={form.categoriaId} onChange={(e) => handleChangeCategoria(e.target.value)} required>
                  <option value="">{t('articulos:selecciona_categoria')}</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('articulos:campos.tipo_material')}>
                <Select value={form.tipo_material} onChange={(e) => handleChange('tipo_material', e.target.value)}>
                  {TIPOS_MATERIAL.map((valor) => (
                    <option key={valor} value={valor}>{t(`enums:tipo_material.${valor}`)}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label={t('articulos:campos.unidad')}>
              <Select value={form.unidadId} onChange={(e) => handleChange('unidadId', e.target.value)} required>
                <option value="">{t('articulos:selecciona_unidad')}</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
                ))}
              </Select>
            </Field>

            {!editandoId && (
              <Field label={t('articulos:campos.ingrediente_opcional')}>
                <Select value={form.ingredienteId} onChange={(e) => handleChange('ingredienteId', e.target.value)} disabled={!form.categoriaId}>
                  <option value="">{form.categoriaId ? t('articulos:sin_ingrediente') : t('articulos:elige_categoria_primero')}</option>
                  {form.categoriaId && <option value={NUEVO_INGREDIENTE}>{t('articulos:crear_ingrediente_nuevo')}</option>}
                  {ingredientesDeCategoria.map((i) => (
                    <option key={i.id} value={i.id}>{i.nombre}</option>
                  ))}
                </Select>
                {form.ingredienteId === NUEVO_INGREDIENTE && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Input type="text" placeholder={t('articulos:ingrediente_nuevo_nombre_placeholder')} value={form.ingredienteNuevoNombre}
                      onChange={(e) => handleChange('ingredienteNuevoNombre', e.target.value)} />
                    <Select value={form.ingredienteNuevoUnidadId || form.unidadId} onChange={(e) => handleChange('ingredienteNuevoUnidadId', e.target.value)}>
                      <option value="">{t('articulos:selecciona_unidad')}</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </Field>
            )}

            <Field label={t('articulos:campos.iva')}>
              <Input type="number" step="0.01" placeholder="0.00" value={form.iva}
                onChange={(e) => handleChange('iva', e.target.value)} />
            </Field>

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.requiere_control_temperatura}
                onChange={(e) => handleChange('requiere_control_temperatura', e.target.checked)} />
              {t('articulos:requiere_control_temperatura')}
            </label>

            {form.requiere_control_temperatura && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
                <Field label={t('articulos:campos.temperatura_min')}>
                  <Input type="number" step="0.1" value={form.temperatura_min}
                    onChange={(e) => handleChange('temperatura_min', e.target.value)} />
                </Field>
                <Field label={t('articulos:campos.temperatura_max')}>
                  <Input type="number" step="0.1" value={form.temperatura_max}
                    onChange={(e) => handleChange('temperatura_max', e.target.value)} />
                </Field>
              </div>
            )}

            <div className="flex gap-2 mt-1 items-center">
              <Button type="submit">
                {editandoId ? t('articulos:guardar_cambios') : <><IconPlus size={15} /> {t('articulos:guardar_articulo')}</>}
              </Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={handleCancelar}>{t('common:actions.cancel')}</Button>
              )}
              {!editandoId && (
                <p className="text-xs text-gray-400">{t('articulos:codigo_automatico_aviso')}</p>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('common:listado_titulo')}</h2>

      {cargando ? (
        <LoadingState />
      ) : articulos.length === 0 ? (
        <Card><EmptyState>{t('articulos:sin_articulos')}</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {articulos.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-ink">
                    {a.nombre} {a.codigo && <span className="text-gray-400 font-mono text-xs">({a.codigo})</span>}
                  </p>
                  <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{a.unidad} · {a.categorias_articulo?.nombre ?? t('articulos:sin_categoria')} · IVA {a.iva != null ? `${a.iva}%` : '-'}</span>
                    <Badge color="gray">{a.tipo_material}</Badge>
                    {a.requiere_control_temperatura && (
                      <span className="text-primary-600 flex items-center gap-1">
                        <IconThermometer size={14} /> {t('articulos:control_temperatura_badge')}
                        {a.temperatura_min != null && a.temperatura_max != null && ` (${a.temperatura_min}°C a ${a.temperatura_max}°C)`}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <LinkAction tone="blue" onClick={() => handleEditar(a)}>{t('articulos:editar')}</LinkAction>
                  <LinkAction tone="red" onClick={() => handleBorrar(a.id)}>{t('articulos:borrar')}</LinkAction>
                </div>
              </div>

              <ProveedoresDelArticulo articulo={a} onCambio={cargarDatos} />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ProveedoresDelArticulo({ articulo, onCambio }) {
  const { t } = useTranslation(['articulos'])
  const { negocio } = useNegocio()
  const [proveedores, setProveedores] = useState([])
  const [proveedorId, setProveedorId] = useState('')
  const [precio, setPrecio] = useState('')
  const [referencia, setReferencia] = useState('')
  const [editandoRelacionId, setEditandoRelacionId] = useState(null)
  const [precioEdit, setPrecioEdit] = useState('')
  const [referenciaEdit, setReferenciaEdit] = useState('')

  useEffect(() => {
    async function cargarProveedores() {
      const { data } = await supabase.from('proveedores').select('id, nombre_comercial').order('nombre_comercial')
      setProveedores(data || [])
    }
    cargarProveedores()
  }, [])

  const yaAsignados = new Set(articulo.articulo_proveedor.map((ap) => ap.proveedores?.id))
  const disponibles = proveedores.filter((p) => !yaAsignados.has(p.id))

  async function handleAdd() {
    if (!proveedorId) {
      alert(t('articulos:alertas.selecciona_proveedor'))
      return
    }

    const esPrimero = articulo.articulo_proveedor.length === 0

    const { error } = await supabase.from('articulo_proveedor').insert({
      articulo_id: articulo.id,
      proveedor_id: parseInt(proveedorId),
      precio: precio ? parseFloat(precio) : null,
      referencia_proveedor: referencia || null,
      preferente: esPrimero,
    })

    if (error) {
      alert(t('articulos:alertas.error_asignar_proveedor', { mensaje: error.message }))
      return
    }

    setProveedorId('')
    setPrecio('')
    setReferencia('')
    onCambio()
  }

  function handleEmpezarEdicion(ap) {
    setEditandoRelacionId(ap.id)
    setPrecioEdit(ap.precio ?? '')
    setReferenciaEdit(ap.referencia_proveedor ?? '')
  }

  function handleCancelarEdicion() {
    setEditandoRelacionId(null)
    setPrecioEdit('')
    setReferenciaEdit('')
  }

  async function handleGuardarEdicion(id) {
    const { error } = await supabase
      .from('articulo_proveedor')
      .update({
        precio: precioEdit ? parseFloat(precioEdit) : null,
        referencia_proveedor: referenciaEdit || null,
      })
      .eq('id', id)

    if (error) {
      alert(t('articulos:alertas.error_actualizar_relacion', { mensaje: error.message }))
      return
    }

    handleCancelarEdicion()
    onCambio()
  }

  async function handleMarcarPreferente(id) {
    const { error } = await supabase.from('articulo_proveedor').update({ preferente: true }).eq('id', id)
    if (error) {
      alert(t('articulos:alertas.error_marcar_preferente', { mensaje: error.message }))
      return
    }
    onCambio()
  }

  async function handleQuitar(id) {
    if (!confirm(t('articulos:alertas.confirmar_quitar_proveedor'))) return
    const { error } = await supabase.from('articulo_proveedor').delete().eq('id', id)
    if (error) {
      alert(t('articulos:alertas.error_quitar_proveedor', { mensaje: error.message }))
      return
    }
    onCambio()
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('articulos:proveedores.titulo')}</p>

      {articulo.articulo_proveedor.length === 0 ? (
        <p className="text-sm text-gray-400 mb-2">{t('articulos:proveedores.sin_proveedores')}</p>
      ) : (
        <table className="w-full text-sm mb-2">
          <tbody className="divide-y divide-gray-100">
            {articulo.articulo_proveedor.map((ap) => {
              const enEdicion = editandoRelacionId === ap.id

              if (enEdicion) {
                return (
                  <tr key={ap.id} className="bg-blue-50/50">
                    <td className="py-1.5">
                      {ap.preferente && <span className="text-amber-500 mr-1">★</span>}
                      {ap.proveedores?.nombre_comercial}
                    </td>
                    <td className="py-1.5">
                      <Input type="number" step="0.01" value={precioEdit}
                        onChange={(e) => setPrecioEdit(e.target.value)}
                        placeholder={t('articulos:proveedores.precio_placeholder')} className="w-24" />
                    </td>
                    <td className="py-1.5">
                      <Input type="text" value={referenciaEdit}
                        onChange={(e) => setReferenciaEdit(e.target.value)}
                        placeholder={t('articulos:proveedores.referencia_placeholder')} />
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <LinkAction tone="green" onClick={() => handleGuardarEdicion(ap.id)} className="text-xs mr-3">{t('articulos:proveedores.guardar')}</LinkAction>
                      <LinkAction tone="gray" onClick={handleCancelarEdicion} className="text-xs">{t('common:actions.cancel')}</LinkAction>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={ap.id} className="hover:bg-blue-50/40">
                  <td className="py-1.5">
                    {ap.preferente && <span className="text-amber-500 mr-1">★</span>}
                    {ap.proveedores?.nombre_comercial}
                  </td>
                  <td className="py-1.5">{ap.precio != null ? formatMoneda(ap.precio, negocio?.moneda) : '-'}</td>
                  <td className="py-1.5 text-gray-400">{ap.referencia_proveedor ?? '-'}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <LinkAction tone="blue" onClick={() => handleEmpezarEdicion(ap)} className="text-xs mr-3">{t('articulos:proveedores.editar')}</LinkAction>
                    {!ap.preferente && (
                      <LinkAction tone="amber" onClick={() => handleMarcarPreferente(ap.id)} className="text-xs mr-3">{t('articulos:proveedores.marcar_preferente')}</LinkAction>
                    )}
                    <LinkAction tone="red" onClick={() => handleQuitar(ap.id)} className="text-xs">{t('articulos:proveedores.quitar')}</LinkAction>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {disponibles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2">
          <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="text-sm">
            <option value="">{t('articulos:proveedores.anadir_proveedor_placeholder')}</option>
            {disponibles.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_comercial}</option>
            ))}
          </Select>
          <Input type="number" step="0.01" placeholder={t('articulos:proveedores.precio_placeholder')} value={precio}
            onChange={(e) => setPrecio(e.target.value)} className="text-sm" />
          <Input type="text" placeholder={t('articulos:proveedores.referencia_proveedor_placeholder')} value={referencia}
            onChange={(e) => setReferencia(e.target.value)} className="text-sm" />
          <LinkAction tone="blue" onClick={handleAdd}>{t('articulos:proveedores.anadir')}</LinkAction>
        </div>
      )}
    </div>
  )
}

export default Articulos
