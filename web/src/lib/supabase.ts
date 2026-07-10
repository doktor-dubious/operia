import { createClient } from '@supabase/supabase-js'
// Når schemaet lander: `npm run gen:types` og importér Database-typen her:
// import type { Database } from '@/lib/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY skal være sat i web/.env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
