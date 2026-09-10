import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, EmptyState, LoadingState } from '../components/ui'

const vacio = { nombre: '', unidadId: '', categoriaId: '' }

function Ingredientes() {
  const { t } = useTranslation(['common', 'ingredientes'])
  const [ingredientes, setIngredientes] = useState([])
  const [categorias, setCategorias] = useState([])
  const [unidades, setUnidades] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarDatos() {
    setCargando(true)

    const [resIngredientes, resCategorias, resUnidades] = await Promise.all([
      supabase
        .from('ingredientes')
        .select('*, categorias_articulo(nombre), articulo_ingrediente(articulo_id, articulos_compra(id, nombre, unidad))')
        .order('nombre'),
      supabase.from('categorias_articulo').select('id, nombre').order('nombre'),
      supabase.from('unidades_medida').select('id, codigo, nombre').order('codigo'),
    ])

    if (resIngredientes.error) console.error('Error cargando ingredientes:', resIngredientes.error)
    else setIngredientes(resIngredientes.data)

    if (resCategorias.error) console.error('Error cargando categorías:', resCategorias.error)
    else setCategorias(resCategorias.data)

    if (resUnidades.error) console.error('Error cargando unidades:', resUnidades.error)
    else setUnidades(resUnidades.data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function handleEditar(i) {
    setForm({
      nombre: i.nombre ?? '',
      unidadId: i.unidad_id ? String(i.unidad_id) : '',
      categoriaId: i.categoria_id ? String(i.categoria_id) : '',
    })
    setEditandoId(i.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const payload = {
      nombre: form.nombre,
      unidad_id: parseInt(form.unidadId),
      categoria_id: parseInt(form.categoriaId),
    }

    // El trigger trg_validar_cambio_unidad_ingredientes bloquea cambiar unidad_id si el
    // ingrediente ya está vinculado (articulo_ingrediente) a un artículo con otra unidad -- el
    // mensaje de la excepción ya viene redactado en español para mostrarse tal cual, no hace
    // falta reescribirlo aquí.
    const { error } = editandoId
      ? await supabase.from('ingredientes').update(payload).eq('id', editandoId)
      : await supabase.from('ingredientes').insert(payload)

    if (error) {
      alert(t('ingredientes:alertas.error_guardar', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    setForm(vacio)
    setEditandoId(null)
    cargarDatos()
  }

  return (
    <div>
      <PageHeader
        title={t('ingredientes:titulo')}
        subtitle={t('ingredientes:subtitulo')}
      />

      <Card className="mb-6">
        <CardHeader title={editandoId ? t('ingredientes:card_editar_titulo') : t('ingredientes:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
            <Field label={t('ingredientes:campos.nombre')}>
              <Input type="text" placeholder={t('ingredientes:nombre_placeholder')} value={form.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)} required />
            </Field>
            <Field label={t('ingredientes:campos.categoria')}>
              <Select value={form.categoriaId} onChange={(e) => handleChange('categoriaId', e.target.value)} required>
                <option value="">{t('ingredientes:selecciona_categoria')}</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('ingredientes:campos.unidad')}>
              <Select value={form.unidadId} onChange={(e) => handleChange('unidadId', e.target.value)} required>
                <option value="">{t('ingredientes:selecciona_unidad')}</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button type="submit">
                {editandoId ? t('ingredientes:guardar_cambios') : <><IconPlus size={15} /> {t('ingredientes:guardar_ingrediente')}</>}
              </Button>
              {editandoId && (
                <Button type="button" variant="secondary" onClick={handleCancelar}>{t('common:actions.cancel')}</Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('common:listado_titulo')}</h2>

      {cargando ? (
        <LoadingState />
      ) : ingredientes.length === 0 ? (
        <Card><EmptyState>{t('ingredientes:sin_ingredientes')}</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {ingredientes.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-ink">{i.nombre}</p>
                  <p className="text-sm text-gray-500">{i.unidad} · {i.categorias_articulo?.nombre ?? t('ingredientes:sin_categoria')}</p>
                </div>
                <LinkAction tone="blue" onClick={() => handleEditar(i)} className="shrink-0">{t('ingredientes:editar')}</LinkAction>
              </div>

              <ArticulosDelIngrediente ingrediente={i} onCambio={cargarDatos} />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ArticulosDelIngrediente({ ingrediente, onCambio }) {
  const { t } = useTranslation(['ingredientes'])
  const [articulos, setArticulos] = useState([])
  const [articuloId, setArticuloId] = useState('')

  useEffect(() => {
    async function cargarArticulos() {
      const { data } = await supabase
        .from('articulos_compra')
        .select('id, nombre, unidad, categoria_id')
        .eq('categoria_id', ingrediente.categoria_id)
        .order('nombre')
      setArticulos(data || [])
    }
    cargarArticulos()
  }, [ingrediente.categoria_id])

  const yaVinculados = new Set(ingrediente.articulo_ingrediente.map((ai) => ai.articulo_id))
  const disponibles = articulos.filter((a) => !yaVinculados.has(a.id))

  async function handleVincular() {
    if (!articuloId) {
      alert(t('ingredientes:alertas.selecciona_articulo'))
      return
    }

    const { error } = await supabase.from('articulo_ingrediente').insert({
      articulo_id: parseInt(articuloId),
      ingrediente_id: ingrediente.id,
    })

    if (error) {
      alert(t('ingredientes:alertas.error_vincular', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.guardado'))
    setArticuloId('')
    onCambio()
  }

  async function handleDesvincular(articuloIdAQuitar) {
    if (!confirm(t('ingredientes:alertas.confirmar_desvincular'))) return

    const { error } = await supabase
      .from('articulo_ingrediente')
      .delete()
      .eq('articulo_id', articuloIdAQuitar)
      .eq('ingrediente_id', ingrediente.id)

    if (error) {
      alert(t('ingredientes:alertas.error_desvincular', { mensaje: error.message }))
      return
    }

    toast.success(t('common:feedback.eliminado'))
    onCambio()
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('ingredientes:articulos_vinculados_titulo')}</p>

      {ingrediente.articulo_ingrediente.length === 0 ? (
        <p className="text-sm text-gray-400 mb-2">{t('ingredientes:sin_articulos_vinculados')}</p>
      ) : (
        <table className="w-full text-sm mb-2">
          <tbody className="divide-y divide-gray-100">
            {ingrediente.articulo_ingrediente.map((ai) => (
              <tr key={ai.articulo_id} className="hover:bg-blue-50/40">
                <td className="py-1.5">{ai.articulos_compra?.nombre}</td>
                <td className="py-1.5 text-gray-400">{ai.articulos_compra?.unidad}</td>
                <td className="py-1.5 text-right">
                  <LinkAction tone="red" onClick={() => handleDesvincular(ai.articulo_id)} className="text-xs">{t('ingredientes:desvincular')}</LinkAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {disponibles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_auto] gap-2">
          <Select value={articuloId} onChange={(e) => setArticuloId(e.target.value)} className="text-sm">
            <option value="">{t('ingredientes:vincular_articulo_placeholder')}</option>
            {disponibles.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
            ))}
          </Select>
          <LinkAction tone="blue" onClick={handleVincular}>{t('ingredientes:vincular')}</LinkAction>
        </div>
      )}
    </div>
  )
}

export default Ingredientes
