// Ét sted at hente en platform-hemmelighed.
//
// platform_secrets har hverken RLS-politikker eller PostgREST-grants ud over
// service-rollen, så kun edge-funktioner når den. Nøglerne i dag:
//   economic_app_secret_token · brevo_api_key · ahasend_api_key
//
// Edge-secret'en med samme navn i STORE bogstaver er reservesporet: den bruges
// lokalt (hvor databasen ikke nødvendigvis har værdien) og hvis opslaget fejler.
// Rækkefølgen er bevidst database FØRST — det er den UI'et skriver til.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export async function platformSecret(
  db: SupabaseClient | null,
  key: string,
  envName = key.toUpperCase(),
): Promise<string | null> {
  if (db) {
    try {
      const { data } = await db
        .from('platform_secrets')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      const value = (data?.value ?? '').trim()
      if (value) return value
    } catch (err) {
      console.error(`platformSecret(${key}) fejlede, prøver edge-secret:`, err)
    }
  }
  return Deno.env.get(envName) ?? null
}
