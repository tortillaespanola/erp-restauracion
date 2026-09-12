// Ejecutar con: node --test supabase/functions/create-company/logic.test.js
// (sin dependencias externas -- node:test/node:assert, igual de "cero setup" que el resto de
// tests unitarios del proyecto, pero fuera del árbol frontend/ porque este módulo lo importa
// también el entrypoint Deno de la función).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearEmpresa, ErrorHttp } from './logic.js'

function depsFalsos(overrides = {}) {
  const llamadas = []
  const negocios = new Set()
  const usuarios = new Set()
  const pertenencias = new Set()
  const empresaConfig = new Set()
  const base = {
    esSuperAdmin: async (id) => {
      llamadas.push(['esSuperAdmin', id])
      return id === 'super-admin-id'
    },
    crearNegocio: async ({ id, nombre, codigo_corto }) => {
      llamadas.push(['crearNegocio', { id, nombre, codigo_corto }])
      negocios.add(id)
    },
    borrarNegocio: async (id) => {
      llamadas.push(['borrarNegocio', id])
      negocios.delete(id)
    },
    invitarUsuario: async (email) => {
      llamadas.push(['invitarUsuario', email])
      const id = 'usuario-invitado-' + email
      usuarios.add(id)
      return { id }
    },
    borrarUsuario: async (id) => {
      llamadas.push(['borrarUsuario', id])
      usuarios.delete(id)
    },
    crearPertenencia: async ({ usuario_id, negocio_id }) => {
      llamadas.push(['crearPertenencia', { usuario_id, negocio_id }])
      pertenencias.add(usuario_id + ':' + negocio_id)
    },
    borrarPertenencia: async ({ usuario_id, negocio_id }) => {
      llamadas.push(['borrarPertenencia', { usuario_id, negocio_id }])
      pertenencias.delete(usuario_id + ':' + negocio_id)
    },
    crearEmpresaConfig: async ({ nombre, negocio_id }) => {
      llamadas.push(['crearEmpresaConfig', { nombre, negocio_id }])
      empresaConfig.add(negocio_id)
    },
    ...overrides,
  }
  return { deps: base, llamadas, negocios, usuarios, pertenencias, empresaConfig }
}

const ENTRADA_VALIDA = { nombre_negocio: 'Empresa Nueva SA', codigo_corto: 'ENS', email_admin: 'admin@nueva.example' }

test('rechaza con 403 si el usuario no es super_admin, sin crear nada', async () => {
  const { deps, llamadas, negocios } = depsFalsos()
  await assert.rejects(
    () => crearEmpresa(deps, 'usuario-normal', ENTRADA_VALIDA),
    (e) => e instanceof ErrorHttp && e.status === 403
  )
  assert.deepEqual(llamadas, [['esSuperAdmin', 'usuario-normal']])
  assert.equal(negocios.size, 0)
})

test('camino feliz: crea negocio, invita usuario, pertenencia y empresa_config en orden', async () => {
  const { deps, llamadas, negocios, usuarios, pertenencias, empresaConfig } = depsFalsos()
  const resultado = await crearEmpresa(deps, 'super-admin-id', ENTRADA_VALIDA)

  assert.ok(resultado.negocio_id)
  assert.equal(resultado.usuario_id, 'usuario-invitado-admin@nueva.example')
  assert.equal(negocios.size, 1)
  assert.equal(usuarios.size, 1)
  assert.equal(pertenencias.size, 1)
  assert.equal(empresaConfig.size, 1)

  const orden = llamadas.map(([nombre]) => nombre)
  assert.deepEqual(orden, ['esSuperAdmin', 'crearNegocio', 'invitarUsuario', 'crearPertenencia', 'crearEmpresaConfig'])
})

test('valida nombre_negocio antes de tocar nada', async () => {
  const { deps, llamadas } = depsFalsos()
  await assert.rejects(
    () => crearEmpresa(deps, 'super-admin-id', { ...ENTRADA_VALIDA, nombre_negocio: '' }),
    (e) => e instanceof ErrorHttp && e.status === 400
  )
  // esSuperAdmin sí se llama (la autorización se comprueba primero que la validación de body),
  // pero ninguna operación de creación.
  assert.deepEqual(llamadas.map(([n]) => n), ['esSuperAdmin'])
})

test('valida el formato de codigo_corto (2-4 alfanuméricos en mayúscula)', async () => {
  const { deps } = depsFalsos()
  await assert.rejects(
    () => crearEmpresa(deps, 'super-admin-id', { ...ENTRADA_VALIDA, codigo_corto: 'demasiadolargo' }),
    (e) => e instanceof ErrorHttp && e.status === 400
  )
})

test('si falla crear la pertenencia, deshace en orden inverso: borra usuario y negocio, nunca llega a empresa_config', async () => {
  const { deps, llamadas, negocios, usuarios, empresaConfig } = depsFalsos({
    crearPertenencia: async () => {
      throw new Error('fallo simulado a mitad de proceso')
    },
  })

  await assert.rejects(
    () => crearEmpresa(deps, 'super-admin-id', ENTRADA_VALIDA),
    (e) => e instanceof ErrorHttp && e.status === 500
  )

  // Rollback completo: nada queda huérfano.
  assert.equal(negocios.size, 0)
  assert.equal(usuarios.size, 0)
  assert.equal(empresaConfig.size, 0)

  // crearPertenencia (el override que falla) lanza antes de registrar su propia llamada en
  // `llamadas` -- por eso no aparece en la lista, solo el deshacer que dispara.
  const orden = llamadas.map(([nombre]) => nombre)
  assert.deepEqual(orden, [
    'esSuperAdmin',
    'crearNegocio',
    'invitarUsuario',
    'borrarUsuario', // deshacer en orden inverso al de creación
    'borrarNegocio',
  ])
})

test('si falla crear empresa_config (último paso), deshace pertenencia, usuario y negocio', async () => {
  const { deps, negocios, usuarios, pertenencias } = depsFalsos({
    crearEmpresaConfig: async () => {
      throw new Error('fallo simulado en el último paso')
    },
  })

  await assert.rejects(() => crearEmpresa(deps, 'super-admin-id', ENTRADA_VALIDA))

  assert.equal(negocios.size, 0)
  assert.equal(usuarios.size, 0)
  assert.equal(pertenencias.size, 0)
})

test('un fallo al deshacer un paso no interrumpe el deshacer de los pasos anteriores', async () => {
  const { deps, negocios, usuarios } = depsFalsos({
    crearEmpresaConfig: async () => {
      throw new Error('fallo simulado')
    },
    borrarPertenencia: async () => {
      throw new Error('el propio deshacer también falla')
    },
  })

  await assert.rejects(() => crearEmpresa(deps, 'super-admin-id', ENTRADA_VALIDA))

  // A pesar de que deshacer la pertenencia falló, el negocio y el usuario igualmente se borran.
  assert.equal(negocios.size, 0)
  assert.equal(usuarios.size, 0)
})
