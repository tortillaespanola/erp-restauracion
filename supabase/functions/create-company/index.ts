// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 2. Entrypoint Deno -- solo glue: HTTP, los dos clientes
// de supabase-js, y las implementaciones reales de `deps` que consume crearEmpresa() (logic.js).
// La orquestación/rollback vive en logic.js porque es testeable con `node --test` sin Deno; este
// archivo no tiene tests propios (no hay Deno/Docker en este entorno de desarrollo) y se
// mantiene deliberadamente delgado para que el riesgo no probado quede acotado a "llamadas
// directas a supabase-js", no a lógica de negocio.
//
// Despliegue (fuera de lo que yo puedo ejecutar aquí): `supabase functions deploy create-company`
// -- mismo patrón que las migraciones SQL de este proyecto, el usuario lo ejecuta con su propio
// `supabase login`/`supabase link`. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase
// solo en runtime; PROJECT_ANON_KEY hay que fijarla como secret del proyecto
// (`supabase secrets set PROJECT_ANON_KEY=...`) porque Supabase no la inyecta por defecto -- y
// reserva cualquier nombre de secret que empiece por SUPABASE_ (confirmado al desplegar: falla
// con "Env name cannot start with SUPABASE_"), de ahí el prefijo distinto solo para esta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { crearEmpresa, ErrorHttp } from './logic.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('PROJECT_ANON_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'Falta token de autenticación' }, 401)
  }

  // Cliente "del que llama": solo para resolver quién es (auth.getUser válida la firma del JWT),
  // nunca para leer/escribir tablas -- eso lo hace siempre adminClient más abajo.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userData, error: authError } = await callerClient.auth.getUser()
  if (authError || !userData?.user) {
    return jsonResponse({ error: 'Token inválido' }, 401)
  }
  const callerUserId = userData.user.id

  // service_role key: nunca expuesta al cliente, vive solo aquí en runtime -- es la única vía
  // por la que esta función puede crear un negocio/usuario/pertenencia sin las restricciones de
  // RLS pensadas para el tráfico normal del ERP.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const deps = {
    esSuperAdmin: async (usuarioId) => {
      const { data, error } = await adminClient.from('super_admins').select('usuario_id').eq('usuario_id', usuarioId).maybeSingle()
      if (error) throw error
      return !!data
    },
    crearNegocio: async ({ id, nombre, codigo_corto }) => {
      const { error } = await adminClient.from('negocios').insert({ id, nombre, codigo_corto })
      if (error) throw error
    },
    borrarNegocio: async (id) => {
      await adminClient.from('negocios').delete().eq('id', id)
    },
    invitarUsuario: async (email, redirectTo) => {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo })
      if (error) throw error
      return { id: data.user.id }
    },
    borrarUsuario: async (id) => {
      await adminClient.auth.admin.deleteUser(id)
    },
    crearPertenencia: async ({ usuario_id, negocio_id }) => {
      const { error } = await adminClient.from('usuarios_negocios').insert({ usuario_id, negocio_id })
      if (error) throw error
    },
    borrarPertenencia: async ({ usuario_id, negocio_id }) => {
      await adminClient.from('usuarios_negocios').delete().eq('usuario_id', usuario_id).eq('negocio_id', negocio_id)
    },
    crearEmpresaConfig: async ({ nombre, negocio_id }) => {
      const { error } = await adminClient.from('empresa_config').insert({ nombre, negocio_id })
      if (error) throw error
    },
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo JSON inválido' }, 400)
  }

  try {
    const resultado = await crearEmpresa(deps, callerUserId, body)
    return jsonResponse(resultado, 200)
  } catch (e) {
    const status = e instanceof ErrorHttp ? e.status : 500
    return jsonResponse({ error: e.message }, status)
  }
})
