// CONTRATO_SUPERADMIN_EMPRESAS.md, Fase 2: orquestación pura de "crear-empresa", separada del
// entrypoint Deno (index.ts) a propósito -- este módulo no importa nada específico de Deno ni de
// supabase-js, solo recibe `deps` con las operaciones ya inyectadas. Así es testeable con
// `node --test` sin Docker ni el runtime de Edge Functions (ninguno disponible en este entorno de
// desarrollo), en vez de escribir tests de Deno que nadie puede ejecutar aquí.

const CODIGO_CORTO_REGEX = /^[A-Z0-9]{2,4}$/

export class ErrorHttp extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function validarEntrada(input) {
  const { nombre_negocio, codigo_corto, email_admin, redirect_to } = input || {}
  if (!nombre_negocio || typeof nombre_negocio !== 'string' || !nombre_negocio.trim()) {
    throw new ErrorHttp(400, 'nombre_negocio es obligatorio.')
  }
  if (!codigo_corto || !CODIGO_CORTO_REGEX.test(codigo_corto)) {
    throw new ErrorHttp(400, 'codigo_corto es obligatorio: 2 a 4 letras/dígitos en mayúscula.')
  }
  if (!email_admin || typeof email_admin !== 'string' || !email_admin.includes('@')) {
    throw new ErrorHttp(400, 'email_admin es obligatorio y debe ser un email válido.')
  }
  // El frontend manda el origin desde el que se está invitando (window.location.origin) en vez
  // de que la función asuma una URL fija -- así el link del email funciona igual en local (con
  // el puerto de turno) que en producción, sin tocar código. Supabase igualmente valida este
  // valor contra su propia lista de Redirect URLs permitidas en el dashboard del proyecto.
  if (!redirect_to || typeof redirect_to !== 'string') {
    throw new ErrorHttp(400, 'redirect_to es obligatorio.')
  }
  return { nombre_negocio: nombre_negocio.trim(), codigo_corto, email_admin: email_admin.trim(), redirect_to }
}

// deps: { esSuperAdmin, crearNegocio, borrarNegocio, invitarUsuario, borrarUsuario,
//         crearPertenencia, borrarPertenencia, crearEmpresaConfig }
// Cada creación empuja su reverso a `deshacer`; si algo falla a mitad de proceso, se deshace
// todo en orden inverso (LIFO) antes de propagar el error -- ningún negocio/usuario huérfano
// queda a medio crear.
export async function crearEmpresa(deps, callerUserId, input) {
  if (!(await deps.esSuperAdmin(callerUserId))) {
    throw new ErrorHttp(403, 'Solo un super_admin puede crear empresas nuevas.')
  }

  const { nombre_negocio, codigo_corto, email_admin, redirect_to } = validarEntrada(input)

  const deshacer = []
  try {
    const negocioId = crypto.randomUUID()
    await deps.crearNegocio({ id: negocioId, nombre: nombre_negocio, codigo_corto })
    deshacer.push(() => deps.borrarNegocio(negocioId))

    const usuario = await deps.invitarUsuario(email_admin, redirect_to)
    deshacer.push(() => deps.borrarUsuario(usuario.id))

    await deps.crearPertenencia({ usuario_id: usuario.id, negocio_id: negocioId })
    deshacer.push(() => deps.borrarPertenencia({ usuario_id: usuario.id, negocio_id: negocioId }))

    await deps.crearEmpresaConfig({ nombre: nombre_negocio, negocio_id: negocioId })

    return { negocio_id: negocioId, usuario_id: usuario.id }
  } catch (e) {
    for (const deshacerPaso of deshacer.reverse()) {
      await deshacerPaso().catch(() => {})
    }
    if (e instanceof ErrorHttp) throw e
    throw new ErrorHttp(500, `No se pudo crear la empresa, se revirtió todo lo creado hasta ahora: ${e.message}`)
  }
}
