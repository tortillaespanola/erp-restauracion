import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardHeader, CardBody, CardFooter, Button, LinkAction, Field, Input, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

const vacio = { razon_fiscal: '', nombre_comercial: '', cif: '', direccion: '', email: '', telefono: '' }

function Proveedores() {
  const { t } = useTranslation(['common', 'contactos_comun', 'proveedores'])
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
        alert(t('proveedores:alertas.error_actualizar', { mensaje: error.message }))
        return
      }
    } else {
      const { error } = await supabase
        .from('proveedores')
        .insert(form)

      if (error) {
        alert(t('proveedores:alertas.error_guardar', { mensaje: error.message }))
        return
      }
    }

    toast.success(t('common:feedback.guardado'))
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
    if (!confirm(t('proveedores:alertas.confirmar_borrar'))) return

    const { error } = await supabase
      .from('proveedores')
      .delete()
      .eq('id', id)

    if (error) {
      alert(t('proveedores:alertas.error_borrar', { mensaje: error.message }))
      return
    }
    toast.success(t('common:feedback.eliminado'))
    cargarProveedores()
  }

  return (
    <div>
      <PageHeader title={t('proveedores:titulo')} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader title={t('common:listado_titulo')} />
          {cargando ? (
            <LoadingState />
          ) : proveedores.length === 0 ? (
            <EmptyState>{t('proveedores:sin_proveedores')}</EmptyState>
          ) : (
            <>
              <Table>
                <Thead>
                  <Th>{t('proveedores:tabla.razon_fiscal')}</Th>
                  <Th>{t('proveedores:tabla.nombre_comercial')}</Th>
                  <Th>{t('contactos_comun:cif')}</Th>
                  <Th>{t('contactos_comun:email')}</Th>
                  <Th>{t('contactos_comun:telefono')}</Th>
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
                        <LinkAction tone="blue" onClick={() => handleEditar(p)} className="mr-3">{t('proveedores:editar')}</LinkAction>
                        <LinkAction tone="red" onClick={() => handleBorrar(p.id)}>{t('proveedores:borrar')}</LinkAction>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <CardFooter>{t('proveedores:proveedor_count', { count: proveedores.length })}</CardFooter>
            </>
          )}
        </Card>

        <Card className="h-fit sticky top-0">
          <CardHeader title={editandoId ? t('proveedores:card_editar_titulo') : t('proveedores:card_nuevo_titulo')} />
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Field label={t('proveedores:tabla.razon_fiscal')}>
                <Input type="text" value={form.razon_fiscal} onChange={(e) => handleChange('razon_fiscal', e.target.value)} required />
              </Field>
              <Field label={t('proveedores:campos.nombre_comercial')}>
                <Input type="text" value={form.nombre_comercial} onChange={(e) => handleChange('nombre_comercial', e.target.value)} required />
              </Field>
              <Field label={t('contactos_comun:cif')}>
                <Input type="text" value={form.cif} onChange={(e) => handleChange('cif', e.target.value)} />
              </Field>
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
                  {editandoId ? <>{t('proveedores:guardar_cambios')}</> : <><IconPlus size={15} /> {t('proveedores:guardar_proveedor')}</>}
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

export default Proveedores
