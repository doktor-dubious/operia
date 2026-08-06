import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY skal være sat i web/.env')
}

// experimental.passkey: Supabase-beta for passkey-login (biometrisk login på
// login-siden + enrollment under /settings). API'et kan ændre sig uden varsel.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { experimental: { passkey: true } },
})
