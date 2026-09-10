import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardFooter, Button, LinkAction, Badge, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer } from '../components/ui'
import ClienteForm from '../components/ClienteForm'

function Clientes() {
  const { t } = useTranslation(['common', 'enums', 'contactos_comun', 'clientes'])
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modoDrawer, setModoDrawer] = useState(null) // null | 'nuevo' | cliente

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

  function alGuardar() {
    setModoDrawer(null)
    cargarClientes()
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

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> {t('clientes:card_nuevo_titulo')}
        </Button>
      </div>

      <Card className="overflow-hidden">
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
                      <LinkAction tone="blue" onClick={() => setModoDrawer(c)} className="mr-3">{t('clientes:editar')}</LinkAction>
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

      <Drawer open={modoDrawer !== null} onClose={() => setModoDrawer(null)}
        title={modoDrawer && typeof modoDrawer === 'object' ? t('clientes:card_editar_titulo') : t('clientes:card_nuevo_titulo')}>
        {modoDrawer !== null && (
          <ClienteForm
            cliente={typeof modoDrawer === 'object' ? modoDrawer : null}
            onGuardado={alGuardar}
            onCancelar={() => setModoDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default Clientes
