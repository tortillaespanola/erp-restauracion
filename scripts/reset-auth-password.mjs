// Uso puntual: resetea la contraseña de un usuario de Supabase Auth vía Admin API,
// sin conocer la contraseña anterior. Vive fuera de frontend/ a propósito -- la
// SUPABASE_SERVICE_ROLE_KEY se pasa SOLO como variable de entorno en el comando,
// nunca se escribe en ningún archivo del repo (ni aquí, ni en frontend/.env*).
//
// Uso:
//   SUPABASE_SERVICE_ROLE_KEY='sb_secret_...' node scripts/reset-auth-password.mjs <email> <nueva_password>
import fs from 'fs'

const EMAIL = process.argv[2]
const NEW_PASSWORD = process.argv[3]
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!EMAIL || !NEW_PASSWORD) {
  console.error('Uso: SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-auth-password.mjs <email> <nueva_password>')
  process.exit(1)
}
if (!SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (nunca la pases como argumento ni la guardes en un archivo).')
  process.exit(1)
}

// VITE_SUPABASE_URL no es secreto (ya viaja al frontend en cada build), así que sí
// se puede leer del .env existente sin problema.
const envContent = fs.readFileSync(new URL('../frontend/.env', import.meta.url), 'utf8')
const SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()

async function buscarUserId(email) {
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    if (!res.ok) throw new Error(`listUsers falló (page ${page}): ${res.status} ${await res.text()}`)
    const { users } = await res.json()
    if (!users || users.length === 0) break
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match.id
    if (users.length < 200) break // última página
  }
  return null
}

async function main() {
  const userId = await buscarUserId(EMAIL)
  if (!userId) throw new Error(`No se encontró ningún usuario con email ${EMAIL}`)
  console.log(`Usuario encontrado: ${userId} (${EMAIL})`)

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: NEW_PASSWORD }),
  })
  if (!res.ok) throw new Error(`updateUserById falló: ${res.status} ${await res.text()}`)
  const updated = await res.json()
  console.log(`OK -- contraseña actualizada para ${updated.email} (id ${updated.id}), updated_at=${updated.updated_at}`)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
