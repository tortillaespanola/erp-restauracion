import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, CardFooter, Button, LinkAction, Field, Input, Badge, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

const vacio = { tipo: 'particular', nombre: '', razon_fiscal: '', cif: '', direccion: '', email: '', telefono: '' }

function Clientes() {
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)

  async function cargarClientes() {
    setCargando(true)
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) console.error('Error cargando clientes:', error)
    else setClientes(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarClientes()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Si es particular, no guardamos datos fiscales aunque queden restos en el formulario
    const payload = {
      ...form,
      razon_fiscal: form.tipo === 'empresa' ? form.razon_fiscal : null,
      cif: form.tipo === 'empresa' ? form.cif : null,
    }

    if (editandoId) {
      const { error } = await supabase
        .from('clientes')
        .update(payload)
        .eq('id', editandoId)

      if (error) {
        alert('Error al actualizar: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('clientes')
        .insert(payload)

      if (error) {
        alert('Error al guardar: ' + error.message)
        return
      }
    }

    setForm(vacio)
    setEditandoId(null)
    cargarClientes()
  }

  function handleEditar(c) {
    setForm({
      tipo: c.tipo ?? 'particular',
      nombre: c.nombre ?? '',
      razon_fiscal: c.razon_fiscal ?? '',
      cif: c.cif ?? '',
      direccion: c.direccion ?? '',
      email: c.email ?? '',
      telefono: c.telefono ?? '',
    })
    setEditandoId(c.id)
  }

  function handleCancelar() {
    setForm(vacio)
    setEditandoId(null)
  }

  async function handleBorrar(id) {
    if (!confirm('¿Seguro que quieres borrar este cliente?')) return

    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarClientes()
  }

  async function handleToggleActivo(c) {
    const { error } = await supabase
      .from('clientes')
      .update({ activo: !c.activo })
      .eq('id', c.id)

    if (error) {
      alert('Error al cambiar el estado: ' + error.message)
      return
    }
    cargarClientes()
  }

  return (
    <div>
      <PageHeader title="Clientes" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader title="Listado" />
          {cargando ? (
            <LoadingState />
          ) : clientes.length === 0 ? (
            <EmptyState>Todavía no hay clientes dados de alta.</EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Th>Tipo</Th>
                  <Th>Nombre</Th>
                  <Th>CIF</Th>
                  <Th>Email</Th>
                  <Th>Teléfono</Th>
                  <Th>Estado</Th>
                  <Th></Th>
                </Thead>
                <tbody className="divide-y divide-gray-100">
                  {clientes.map((c) => (
                    <tr key={c.id} className={`hover:bg-blue-50/40 ${c.activo === false ? 'opacity-60' : ''}`}>
                      <Td>
                        <Badge color={c.tipo === 'empresa' ? 'blue' : 'gray'}>
                          {c.tipo === 'empresa' ? 'Empresa' : 'Particular'}
                        </Badge>
                      </Td>
                      <Td className="font-medium">{c.nombre}</Td>
                      <Td className="text-gray-500">{c.cif ?? '-'}</Td>
                      <Td className="text-gray-500">{c.email ?? '-'}</Td>
                      <Td className="text-gray-500">{c.telefono ?? '-'}</Td>
                      <Td>
                        <button type="button" onClick={() => handleToggleActivo(c)} title="Clic para cambiar el estado">
                          <Badge color={c.activo === false ? 'gray' : 'green'}>
                            {c.activo === false ? 'Inactivo' : 'Activo'}
                          </Badge>
                        </button>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <LinkAction tone="blue" onClick={() => handleEditar(c)} className="mr-3">Editar</LinkAction>
                        <LinkAction tone="red" onClick={() => handleBorrar(c.id)}>Borrar</LinkAction>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              </div>
              <CardFooter>{clientes.length} cliente{clientes.length === 1 ? '' : 's'}</CardFooter>
            </>
          )}
        </Card>

        <Card className="h-fit sticky top-0">
          <CardHeader title={editandoId ? 'Editar cliente' : 'Nuevo cliente'} />
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="tipo" checked={form.tipo === 'particular'}
                    onChange={() => handleChange('tipo', 'particular')} />
                  Particular
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="tipo" checked={form.tipo === 'empresa'}
                    onChange={() => handleChange('tipo', 'empresa')} />
                  Empresa
                </label>
              </div>

              <Field label={form.tipo === 'empresa' ? 'Nombre comercial' : 'Nombre y apellidos'}>
                <Input type="text" value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)} required />
              </Field>

              {form.tipo === 'empresa' && (
                <>
                  <Field label="Razón fiscal">
                    <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
                  </Field>
                  <Field label="CIF">
                    <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
                  </Field>
                </>
              )}

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
                  {editandoId ? <>Guardar cambios</> : <><IconPlus size={15} /> Guardar cliente</>}
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

export default Clientes
