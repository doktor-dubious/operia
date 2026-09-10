// Fælles Brevo-adgang: hvor nøglen kommer fra, og hvordan en indgående
// vedhæftning hentes.
//
// Nøglen indtastes på Operia → Integrationer → E-mail og ligger i
// platform_secrets['brevo_api_key'] (ingen RLS-politikker, ingen grants — kun
// service-role kan læse den). Edge-secret'en BREVO_API_KEY er reservesporet:
// den bruges lokalt og hvis databaseopslaget skulle fejle.
//
// Bemærk at nøglen bruges af BEGGE ender uafhængigt af hinanden: udgående mail
// kun når email_provider = 'brevo', indgående når MX peger på Brevo. Derfor
// slås den op her og ikke i send-email.ts' udbyderkonfiguration.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { platformSecret } from './platform-secret.ts'

export const BREVO_API = 'https://api.brevo.com/v3'

export function brevoApiKey(db: SupabaseClient | null): Promise<string | null> {
  return platformSecret(db, 'brevo_api_key')
}

/**
 * Hent en indgående vedhæftning. Brevo lægger IKKE filen i webhook-nyttelasten
 * (modsat Postmark, der sender den base64-kodet) — kun et engangs-token pr.
 * vedhæftning, som byttes til bytes her.
 */
export async function fetchInboundAttachment(
  apiKey: string,
  downloadToken: string,
): Promise<Uint8Array> {
  const res = await fetch(`${BREVO_API}/inbound/attachments/${encodeURIComponent(downloadToken)}`, {
    headers: { 'api-key': apiKey },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`brevo_attachment_${res.status}: ${detail.slice(0, 200)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}
