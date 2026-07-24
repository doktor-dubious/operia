// impersonate-user — lader en platform-admin (DCA super-tenant) logge ind SOM en
// almindelig bruger for at teste appen med netop den brugers adgang. Browseren
// er utroværdig (se CLAUDE.md): funktionen genverificerer server-side, at
// kalderen er platform-admin, og at målet IKKE selv er platform-admin. Derefter
// genererer den — med service-role — et magic-link-token for målets e-mail
// (uden at sende mail) og indløser det HER i funktionen, så selve tokenet
// aldrig når klienten; kun de færdige session-tokens returneres. Handlingen
// logges i audit_log, så efterprøvning (NIS2/GDPR) altid kan se hvem der
// impersonerede hvem og hvornår.
//
// GoTrue sætter email_confirmed_at + last_sign_in_at ved indløsningen, men
// impersonering er hverken brugerens egen invitations-accept eller eget login —
// de forrige værdier genskabes derfor bagefter (impersonation_restore_auth_state),
// så Verificeret/Seneste login-kolonnerne ikke viser falske signaler.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isPlatformAdmin } from '../_shared/user-admin.ts'
import { maskRecipient } from '../_shared/notify.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Body = { userId?: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen ud fra deres egen JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
  const callerId = userData.user.id

  // 2) Validér input.
  const body = (await req.json().catch(() => ({}))) as Body
  const targetId = body.userId?.trim()
  if (!targetId) return json({ error: 'user_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Autorisation: kun platform-admins må impersonere.
  if (!(await isPlatformAdmin(admin, callerId))) {
    return json({ error: 'forbidden' }, 403)
  }

  // 4) Værn: kan ikke impersonere sig selv, og ALDRIG en anden platform-admin
  //    (en super-tenant må ikke overtage en anden super-tenants adgang).
  if (targetId === callerId) return json({ error: 'cannot_impersonate_self' }, 400)
  if (await isPlatformAdmin(admin, targetId)) {
    return json({ error: 'cannot_impersonate_platform_admin' }, 403)
  }

  // 5) Slå målets e-mail op (auth.users er sandheden for login-e-mailen), og
  //    tag et snapshot af verifikations-/login-tilstanden til genskabelse.
  const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(targetId)
  const email = targetUser?.user?.email
  if (targetErr || !email) return json({ error: 'user_not_found' }, 404)
  const prevEmailConfirmedAt = targetUser.user.email_confirmed_at ?? null
  const prevLastSignInAt = targetUser.user.last_sign_in_at ?? null

  // 6) Generér magic-link-token (sender IKKE mail) og indløs det med det samme
  //    server-side — tokenet forlader aldrig funktionen.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkErr || !tokenHash) return json({ error: 'link_failed' }, 500)

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  const session = otpData?.session
  if (otpErr || !session) return json({ error: 'link_failed' }, 500)

  // 7) Genskab email_confirmed_at/last_sign_in_at fra før indløsningen (se
  //    filens hoved). Fejler genskabelsen, afbrydes impersoneringen — ellers
  //    ville "Verificeret" lyve over for managers om ikke-accepterede invitationer.
  const { error: restoreErr } = await admin.rpc('impersonation_restore_auth_state', {
    p_user_id: targetId,
    p_email_confirmed_at: prevEmailConfirmedAt,
    p_last_sign_in_at: prevLastSignInAt,
  })
  if (restoreErr) return json({ error: 'link_failed' }, 500)

  // 8) Revisionsspor: hvem impersonerede hvem. entity_id/actor_user_id er bare
  //    uuid'er (ingen FK), så sporet overlever selv hvis en konto senere slettes.
  //    E-mailen maskeres (audit_log er append-only og kan aldrig GDPR-slettes),
  //    og uden audit-række udleveres der ingen session (fail closed, NIS2).
  const { data: appUser } = await admin
    .from('app_users')
    .select('company_id, full_name')
    .eq('user_id', targetId)
    .maybeSingle()
  const maskedEmail = maskRecipient(email)
  const { error: auditErr } = await admin.from('audit_log').insert({
    company_id: appUser?.company_id ?? null,
    actor_user_id: callerId,
    action: 'user.impersonated',
    entity_type: 'user',
    entity_id: targetId,
    summary: appUser?.full_name || maskedEmail,
    detail: { email: maskedEmail },
  })
  if (auditErr) return json({ error: 'audit_failed' }, 500)

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    email,
  })
})
