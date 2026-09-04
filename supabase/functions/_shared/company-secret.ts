// Opslag af en kunde-specifik hemmelighed (Slack-bottoken i dag) til
// SendContext.companySecret. Delt mellem dispatcheren og send-test-status, så
// de to ikke kan glide fra hinanden i hvad en manglende række betyder.
//
// Fejler opslaget, KASTES der — kanalen oversætter det til en forbigående
// fejl. Returnerede vi null, ville et databaseudfald ligne "kanalen er ikke
// installeret" og brænde et af de tre forsøg på en besked der intet fejler.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { SendContext } from './channels.ts'

export function companySecretLookup(
  admin: SupabaseClient,
  companyId: string,
): SendContext['companySecret'] {
  return async (table, column) => {
    const { data, error } = await admin
      .from(table)
      .select(column)
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) throw new Error(`secret_lookup_failed: ${error.message}`)
    const v = (data as Record<string, unknown> | null)?.[column]
    return typeof v === 'string' && v ? v : null
  }
}
