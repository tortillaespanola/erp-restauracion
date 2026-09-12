import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter, Button, Field, Input,
  Table, Thead, Th, Td, EmptyState, LoadingState,
} from '../components/ui'

const CODIGO_CORTO_REGEX = /^[A-Z0-9]{2,4}$/
const FORM_VACIO = { nombre_negocio: '', codigo_corto: '', email_admin: '' }

// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 4. Único punto del frontend que crea un negocio: llama
// siempre a la Edge Function create-company (service_role, verifica is_super_admin server-side)
// -- nunca un insert directo a `negocios` desde aquí, aunque la policy RLS de la Fase 1 también
// lo permitiría para un super_admin. La función es la que además crea el usuario admin inicial
// (inviteUserByEmail) y su pertenencia, en una única operación con rollback si algo falla a
// mitad de proceso -- repetir esos pasos a mano desde el cliente perdería esa atomicidad.
function AdminEmpresas() {
  const { t } = useTranslation(['admin_empresas', 'common'])
  const [negocios, setNegocios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState(FORM_VACIO)
  const [creando, setCreando] = useState(false)

  async function cargarNegocios() {
    setCargando(true)
    const { data, error } = await supabase.from('negocios').select('*').order('created_at', { ascending: false })
    if (error) console.error('Error cargando negocios:', error)
    else setNegocios(data)
    setCargando(false)
  }

  useEffect(() => {
    cargarNegocios()
  }, [])

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!CODIGO_CORTO_REGEX.test(form.codigo_corto)) {
      toast.error(t('admin_empresas:campos.codigo_corto_ayuda'))
      return
    }

    setCreando(true)
    // redirect_to: el link de invitación por email debe volver al mismo origen desde el que se
    // está creando la empresa (local con el puerto de turno, o el dominio real en producción) --
    // nunca una URL fija, o se rompe en cuanto cambia el puerto o el entorno.
    const { error } = await supabase.functions.invoke('create-company', {
      body: { ...form, redirect_to: window.location.origin },
    })
    setCreando(false)

    if (error) {
      // `error.message` de supabase-js es siempre el texto genérico "Edge Function returned a
      // non-2xx status code" -- nunca el body real. El body ({ error: '<texto>' }) solo está en
      // `error.context`, que es la Response cruda y hay que leerla de forma asíncrona.
      let mensaje = error.message
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json()
          if (body?.error) mensaje = body.error
        } catch {
          // body no era JSON parseable -- nos quedamos con el mensaje genérico
        }
      }
      toast.error(t('admin_empresas:error', { mensaje }))
      return
    }

    toast.success(t('admin_empresas:exito', { email: form.email_admin }))
    setForm(FORM_VACIO)
    cargarNegocios()
  }

  return (
    <div>
      <PageHeader title={t('admin_empresas:titulo')} />

      <Card className="mb-6">
        <CardHeader title={t('admin_empresas:card_nuevo_titulo')} />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md">
            <Field label={t('admin_empresas:campos.nombre_negocio')}>
              <Input
                type="text"
                required
                value={form.nombre_negocio}
                onChange={(e) => handleChange('nombre_negocio', e.target.value)}
              />
            </Field>
            <Field label={t('admin_empresas:campos.codigo_corto')}>
              <Input
                type="text"
                required
                maxLength={4}
                value={form.codigo_corto}
                onChange={(e) => handleChange('codigo_corto', e.target.value.toUpperCase())}
              />
              <p className="text-micro text-ink-subtle mt-1">{t('admin_empresas:campos.codigo_corto_ayuda')}</p>
            </Field>
            <Field label={t('admin_empresas:campos.email_admin')}>
              <Input
                type="email"
                required
                value={form.email_admin}
                onChange={(e) => handleChange('email_admin', e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={creando} className="self-start mt-1">
              {creando ? t('admin_empresas:creando') : t('admin_empresas:crear')}
            </Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-ink mb-3">{t('admin_empresas:listado_titulo')}</h2>
      <Card className="overflow-hidden">
        {cargando ? (
          <LoadingState />
        ) : negocios.length === 0 ? (
          <EmptyState>{t('admin_empresas:sin_empresas')}</EmptyState>
        ) : (
          <>
            <Table>
              <Thead>
                <Th>{t('admin_empresas:tabla.nombre')}</Th>
                <Th>{t('admin_empresas:tabla.codigo_corto')}</Th>
                <Th>{t('admin_empresas:tabla.creado')}</Th>
              </Thead>
              <tbody className="divide-y divide-gray-100">
                {negocios.map((n) => (
                  <tr key={n.id} className="hover:bg-blue-50/40">
                    <Td className="font-medium">{n.nombre}</Td>
                    <Td className="text-gray-500">{n.codigo_corto ?? '-'}</Td>
                    <Td className="text-gray-500">{new Date(n.created_at).toLocaleDateString()}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <CardFooter>{negocios.length}</CardFooter>
          </>
        )}
      </Card>
    </div>
  )
}

export default AdminEmpresas
