import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { IconPlus } from '@tabler/icons-react'
import { PageHeader, Card, CardFooter, Button, LinkAction, Table, Thead, Th, Td, EmptyState, LoadingState, Drawer } from '../components/ui'
import ProveedorForm from '../components/ProveedorForm'

function Proveedores() {
  const { t } = useTranslation(['common', 'contactos_comun', 'proveedores'])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modoDrawer, setModoDrawer] = useState(null) // null | 'nuevo' | proveedor

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

  function alGuardar() {
    setModoDrawer(null)
    cargarProveedores()
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

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{t('common:listado_titulo')}</h2>
        <Button onClick={() => setModoDrawer('nuevo')}>
          <IconPlus size={15} /> {t('proveedores:card_nuevo_titulo')}
        </Button>
      </div>

      <Card className="overflow-hidden">
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
                      <LinkAction tone="blue" onClick={() => setModoDrawer(p)} className="mr-3">{t('proveedores:editar')}</LinkAction>
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

      <Drawer open={modoDrawer !== null} onClose={() => setModoDrawer(null)}
        title={modoDrawer && typeof modoDrawer === 'object' ? t('proveedores:card_editar_titulo') : t('proveedores:card_nuevo_titulo')}>
        {modoDrawer !== null && (
          <ProveedorForm
            proveedor={typeof modoDrawer === 'object' ? modoDrawer : null}
            onGuardado={alGuardar}
            onCancelar={() => setModoDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

export default Proveedores
