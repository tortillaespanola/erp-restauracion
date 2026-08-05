import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, EmptyState, LoadingState } from '../components/ui'

const vacio = { nombre: '', unidad: '' }

function Ingredientes() {
  const [ingredientes, setIngredientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)

  async function cargarDatos() {
    setCargando(true)

    const { data, error } = await supabase
      .from('ingredientes')
      .select('*, articulo_ingrediente(articulo_id, articulos_compra(id, nombre, unidad))')
      .order('nombre')

    if (error) console.error('Error cargando ingredientes:', error)
    else setIngredientes(data)

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const { error } = await supabase.from('ingredientes').insert({
      nombre: form.nombre,
      unidad: form.unidad,
    })

    if (error) {
      alert('Error al guardar: ' + error.message)
      return
    }

    setForm(vacio)
    cargarDatos()
  }

  return (
    <div>
      <PageHeader
        title="Ingredientes"
        subtitle="Agrupa artículos de compra intercambiables entre sí (ej. distintas variantes del mismo producto) para que las recetas puedan referenciar el ingrediente en vez de un artículo concreto."
      />

      <Card className="mb-6">
        <CardHeader title="Nuevo ingrediente" />
        <CardBody>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
            <Field label="Nombre">
              <Input type="text" placeholder="Ej. Huevina" value={form.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)} required />
            </Field>
            <Field label="Unidad">
              <Input type="text" placeholder="kg, l, ud..." value={form.unidad}
                onChange={(e) => handleChange('unidad', e.target.value)} required />
            </Field>
            <Button type="submit"><IconPlus size={15} /> Guardar ingrediente</Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Listado</h2>

      {cargando ? (
        <LoadingState />
      ) : ingredientes.length === 0 ? (
        <Card><EmptyState>Todavía no hay ingredientes dados de alta.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {ingredientes.map((i) => (
            <Card key={i.id} className="p-4">
              <p className="font-semibold text-[#1C2938]">{i.nombre}</p>
              <p className="text-sm text-gray-500">{i.unidad}</p>

              <ArticulosDelIngrediente ingrediente={i} onCambio={cargarDatos} />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ArticulosDelIngrediente({ ingrediente, onCambio }) {
  const [articulos, setArticulos] = useState([])
  const [articuloId, setArticuloId] = useState('')

  useEffect(() => {
    async function cargarArticulos() {
      const { data } = await supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre')
      setArticulos(data || [])
    }
    cargarArticulos()
  }, [])

  const yaVinculados = new Set(ingrediente.articulo_ingrediente.map((ai) => ai.articulo_id))
  const disponibles = articulos.filter((a) => !yaVinculados.has(a.id))

  async function handleVincular() {
    if (!articuloId) {
      alert('Selecciona un artículo')
      return
    }

    const { error } = await supabase.from('articulo_ingrediente').insert({
      articulo_id: parseInt(articuloId),
      ingrediente_id: ingrediente.id,
    })

    if (error) {
      alert('Error al vincular: ' + error.message)
      return
    }

    setArticuloId('')
    onCambio()
  }

  async function handleDesvincular(articuloIdAQuitar) {
    if (!confirm('¿Desvincular este artículo del ingrediente? Dejará de aparecer como variante disponible en las recetas que usen este ingrediente.')) return

    const { error } = await supabase
      .from('articulo_ingrediente')
      .delete()
      .eq('articulo_id', articuloIdAQuitar)
      .eq('ingrediente_id', ingrediente.id)

    if (error) {
      alert('Error al desvincular: ' + error.message)
      return
    }

    onCambio()
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Artículos vinculados</p>

      {ingrediente.articulo_ingrediente.length === 0 ? (
        <p className="text-sm text-gray-400 mb-2">Sin artículos vinculados todavía.</p>
      ) : (
        <table className="w-full text-sm mb-2">
          <tbody className="divide-y divide-gray-100">
            {ingrediente.articulo_ingrediente.map((ai) => (
              <tr key={ai.articulo_id} className="hover:bg-blue-50/40">
                <td className="py-1.5">{ai.articulos_compra?.nombre}</td>
                <td className="py-1.5 text-gray-400">{ai.articulos_compra?.unidad}</td>
                <td className="py-1.5 text-right">
                  <LinkAction tone="red" onClick={() => handleDesvincular(ai.articulo_id)} className="text-xs">Desvincular</LinkAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {disponibles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_auto] gap-2">
          <Select value={articuloId} onChange={(e) => setArticuloId(e.target.value)} className="text-sm">
            <option value="">Vincular artículo...</option>
            {disponibles.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre} ({a.unidad})</option>
            ))}
          </Select>
          <LinkAction tone="blue" onClick={handleVincular}>+ Vincular</LinkAction>
        </div>
      )}
    </div>
  )
}

export default Ingredientes
