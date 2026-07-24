// delete-user — fjerner en bruger fuldstændigt: både auth.users-login og
// (via FK on delete cascade) app_users, user_roles m.m. Browseren kan ikke
// slette auth-konti (kræver service-role/admin-API), så funktionen findes til
// oprydning dér, hvor en konto reelt skal nedlægges.
//
// Hård sletning er PLATFORM-ADMIN-ONLY (CLAUDE.md: hard delete af personer er
// forbeholdt DCA/test-oprydning). Managers "fjerner" i stedet adgang på
// Konfiguration → Brugere ved at slette app_users-rækken (RLS) — login-kontoen
// bevares, så den kan genbruges og intet historik-ophæng mistes utilsigtet.
// Browseren er utroværdig (se CLAUDE.md): autorisationen genverificeres
// server-side her.
//
// Bevidste værn:
//  - kalderen kan ikke slette sin egen konto (self-lockout),
//  - platform-admins (DCA-personale) kan ikke slettes herfra — deres konti
//    administreres bevidst i Supabase, ikke via en brugerliste.
// parcel_events/audit_log.actor_user_id er bare uuid'er (ingen FK), så
// chain-of-custody bevarer det loggede id efter sletning; alle rigtige FK'er til
// auth.users er "on delete set null", så intet blokerer sletningen.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isPlatformAdmin } from '../_shared/user-admin.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Body = { userIds?: unknown }

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
  const userIds = Array.isArray(body.userIds)
    ? [...new Set(body.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0))]
    : []
  if (userIds.length === 0) return json({ error: 'users_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Autorisation: hård sletning er platform-admin-only (se filens hoved).
  if (!(await isPlatformAdmin(admin, callerId))) {
    return json({ error: 'forbidden' }, 403)
  }

  const deleted: string[] = []
  const errors: { userId: string; error: string }[] = []

  for (const userId of userIds) {
    // Selvsletning ville låse kalderen ude — afvis.
    if (userId === callerId) {
      errors.push({ userId, error: 'cannot_delete_self' })
      continue
    }

    // Platform-admins slettes ikke herfra (se filens hoved).
    if (await isPlatformAdmin(admin, userId)) {
      errors.push({ userId, error: 'cannot_delete_platform_admin' })
      continue
    }

    // Slet auth-kontoen; FK on delete cascade fjerner app_users + user_roles.
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      errors.push({ userId, error: error.message })
      continue
    }
    deleted.push(userId)
  }

  return json({ deleted, errors })
})
