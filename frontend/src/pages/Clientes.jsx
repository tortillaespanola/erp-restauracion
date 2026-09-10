import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, CardFooter, Button, LinkAction, Field, Input, Badge, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

const vacio = { tipo: 'particular', nombre: '', razon_fiscal: '', cif: '', direccion: '', email: '', telefono: '' }

function Clientes() {
  const { t } = useTranslation(['common', 'enums', 'contactos_comun', 'clientes'])
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
        alert(t('clientes:alertas.error_actualizar', { mensaje: error.message }))
        return
      }
    } else {
      const { error } = await supabase
        .from('clientes')
        .insert(payload)

      if (error) {
        alert(t('clientes:alertas.error_guardar', { mensaje: error.message }))
        return
      }
    }

    toast.success(t('common:feedback.guardado'))
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
    if (!confirm(t('clientes:alertas.confirmar_borrar'))) return

    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) {
      alert(t('clientes:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    cargarClientes()
  }

  async function handleToggleActivo(c) {
    const { error } = await supabase
      .from('clientes')
      .update({ activo: !c.activo })
      .eq('id', c.id)

    if (error) {
      alert(t('clientes:alertas.error_cambiar_estado', { mensaje: error.message }))
      return
    }
    cargarClientes()
  }

  return (
    <div>
      <PageHeader title={t('clientes:titulo')} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader title={t('common:listado_titulo')} />
          {cargando ? (
            <LoadingState />
          ) : clientes.length === 0 ? (
            <EmptyState>{t('clientes:sin_clientes')}</EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Th>{t('clientes:tabla.tipo')}</Th>
                  <Th>{t('clientes:tabla.nombre')}</Th>
                  <Th>{t('contactos_comun:cif')}</Th>
                  <Th>{t('contactos_comun:email')}</Th>
                  <Th>{t('contactos_comun:telefono')}</Th>
                  <Th>{t('clientes:tabla.estado')}</Th>
                  <Th></Th>
                </Thead>
                <tbody className="divide-y divide-gray-100">
                  {clientes.map((c) => (
                    <tr key={c.id} className={`hover:bg-blue-50/40 ${c.activo === false ? 'opacity-60' : ''}`}>
                      <Td>
                        <Badge color={c.tipo === 'empresa' ? 'blue' : 'gray'}>
                          {t(`enums:tipo_cliente.${c.tipo === 'empresa' ? 'empresa' : 'particular'}`)}
                        </Badge>
                      </Td>
                      <Td className="font-medium">{c.nombre}</Td>
                      <Td className="text-gray-500">{c.cif ?? '-'}</Td>
                      <Td className="text-gray-500">{c.email ?? '-'}</Td>
                      <Td className="text-gray-500">{c.telefono ?? '-'}</Td>
                      <Td>
                        <button type="button" onClick={() => handleToggleActivo(c)} title={t('clientes:clic_cambiar_estado_title')}>
                          <Badge color={c.activo === false ? 'gray' : 'green'}>
                            {c.activo === false ? t('clientes:inactivo') : t('clientes:activo')}
                          </Badge>
                        </button>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <LinkAction tone="blue" onClick={() => handleEditar(c)} className="mr-3">{t('clientes:editar')}</LinkAction>
                        <LinkAction tone="red" onClick={() => handleBorrar(c.id)}>{t('clientes:borrar')}</LinkAction>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              </div>
              <CardFooter>{t('clientes:cliente_count', { count: clientes.length })}</CardFooter>
            </>
          )}
        </Card>

        <Card className="h-fit sticky top-0">
          <CardHeader title={editandoId ? t('clientes:card_editar_titulo') : t('clientes:card_nuevo_titulo')} />
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="tipo" checked={form.tipo === 'particular'}
                    onChange={() => handleChange('tipo', 'particular')} />
                  {t('enums:tipo_cliente.particular')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="tipo" checked={form.tipo === 'empresa'}
                    onChange={() => handleChange('tipo', 'empresa')} />
                  {t('enums:tipo_cliente.empresa')}
                </label>
              </div>

              <Field label={form.tipo === 'empresa' ? t('clientes:campos.nombre_comercial') : t('clientes:campos.nombre_y_apellidos')}>
                <Input type="text" value={form.nombre} onChange={(e) => handleChange('nombre', e.target.value)} required />
              </Field>

              {form.tipo === 'empresa' && (
                <>
                  <Field label={t('contactos_comun:razon_fiscal')}>
                    <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} />
                  </Field>
                  <Field label={t('contactos_comun:cif')}>
                    <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
                  </Field>
                </>
              )}

              <Field label={t('contactos_comun:direccion')}>
                <Input type="text" value={form.direccion} onChange={(e) => handleChange('direccion', e.target.value)} />
              </Field>
              <Field label={t('contactos_comun:email')}>
                <Input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} />
              </Field>
              <Field label={t('contactos_comun:telefono')}>
                <Input type="text" value={form.telefono} onChange={(e) => handleChange('telefono', e.target.value)} />
              </Field>

              <div className="flex gap-2 mt-1">
                <Button type="submit" className="flex-1">
                  {editandoId ? <>{t('clientes:guardar_cambios')}</> : <><IconPlus size={15} /> {t('clientes:guardar_cliente')}</>}
                </Button>
                {editandoId && (
                  <Button type="button" variant="secondary" onClick={handleCancelar}>{t('common:actions.cancel')}</Button>
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
