import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

// Se lee ANTES de crear el cliente, a propósito: createClient() con detectSessionInUrl (default)
// consume y limpia este hash de forma asíncrona en cuanto lo detecta, así que leerlo después
// sería una carrera. type=invite (alta de admin nuevo) y type=recovery (recuperar contraseña)
// son los dos casos en los que el usuario llega sin contraseña propia todavía y AuthGate debe
// mostrar el formulario de "crear contraseña" en vez del login normal.
const tipoEnlaceAuth = new URLSearchParams(window.location.hash.slice(1)).get('type')
export const requiereNuevaContrasena = tipoEnlaceAuth === 'invite' || tipoEnlaceAuth === 'recovery'

export const supabase = createClient(supabaseUrl, supabaseKey)