import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, CardFooter, Button, LinkAction, Field, Input, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

const vacio = { razon_fiscal: '', nombre_comercial: '', cif: '', direccion: '', email: '', telefono: '' }

function Proveedores() {
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarProveedores() {
    setCargando(true)
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('nombre_comercial', { ascending: true })

    if (error) console.error('Error cargando proveedores:', error)
    else setProveedores(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarProveedores()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (editandoId) {
      const { error } = await supabase
        .from('proveedores')
        .update(form)
        .eq('id', editandoId)

      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('proveedores')
        .insert(form)

      if (error) {
        alert('Error al guardar: ' + error.message)
        return
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarProveedores()
  }

  function handleEditar(p) {
    setForm({
      razon_fiscal: p.razon_fiscal ?? '',
      nombre_comercial: p.nombre_comercial ?? '',
      cif: p.cif ?? '',
      direccion: p.direccion ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
    })
    setEditandoId(p.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este proveedor?')) return

    const { error } = await supabase
      .from('proveedores')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarProveedores()
  }

  return (
    <div>
      <PageHeader title="Proveedores" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader title="Listado" />
          {cargando ? (
            <LoadingState />
          ) : proveedores.length === 0 ? (
            <EmptyState>Todavía no hay proveedores dados de alta.</EmptyState>
          ) : (
            <>
              <Table>
                <Thead>
                  <Th>Razón fiscal</Th>
                  <Th>Nombre comercial</Th>
                  <Th>CIF</Th>
                  <Th>Email</Th>
                  <Th>Teléfono</Th>
                  <Th></Th>
                </Thead>
                <tbody className="divide-y divide-gray-100">
                  {proveedores.map((p) => (
                    <tr key={p.id} className="hover:bg-blue-50/40">
                      <Td className="font-medium">{p.razon_fiscal}</Td>
                      <Td className="text-gray-500">{p.nombre_comercial}</Td>
                      <Td className="text-gray-500">{p.cif ?? '-'}</Td>
                      <Td className="text-gray-500">{p.email ?? '-'}</Td>
                      <Td className="text-gray-500">{p.telefono ?? '-'}</Td>
                      <Td className="text-right whitespace-nowrap">
                        <LinkAction tone="blue" onClick={() => handleEditar(p)} className="mr-3">Editar</LinkAction>
                        <LinkAction tone="red" onClick={() => handleBorrar(p.id)}>Borrar</LinkAction>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <CardFooter>{proveedores.length} proveedor{proveedores.length === 1 ? '' : 'es'}</CardFooter>
            </>
          )}
        </Card>

        <Card className="h-fit sticky top-0">
          <CardHeader title={editandoId ? 'Editar proveedor' : 'Nuevo proveedor'} />
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Field label="Razón fiscal">
                <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} required />
              </Field>
              <Field label="Nombre comercial">
                <Input type="text" value={form.nombre_comercial} onChange={(e) => handleChange('nombre_comercial', e.target.value)} required />
              </Field>
              <Field label="CIF">
                <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
              </Field>
              <Field label="Dirección">
                <Input type="text" value={form.direccion} onChange={(e) => handleChange('direccion', e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} />
              </Field>
              <Field label="Teléfono">
                <Input type="text" value={form.telefono} onChange={(e) => handleChange('telefono', e.target.value)} />
              </Field>

              <div className="flex gap-2 mt-1">
                <Button type="submit" className="flex-1">
                  {editandoId ? <>Guardar cambios</> : <><IconPlus size={15} /> Guardar proveedor</>}
                </Button>
                {editandoId && (
                  <Button type="button" variant="secondary" onClick={handleCancelar}>Cancelar</Button>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

export default Proveedores
