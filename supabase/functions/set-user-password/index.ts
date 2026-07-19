// set-user-password — nulstiller adgangskoden for en eksisterende bruger, enten
// ved at sætte en (indtastet/genereret) adgangskode direkte, eller ved at sende
// brugeren et nulstillingslink så de selv vælger en ny.
//
// Browseren er utroværdig (se CLAUDE.md): funktionen genverificerer server-side
// at kalderen må administrere målbrugeren — platform-admin (enhver virksomhed)
// eller manager for netop målbrugerens virksomhed — og bruger derefter service-
// role-nøglen. Målbrugerens e-mail/virksomhed slås op server-side ud fra userId;
// klienten sender aldrig e-mailen selv.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendInviteEmail } from '../_shared/invite-email.ts'
import { callerCanManageCompany, isPlatformAdmin } from '../_shared/user-admin.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Body = {
  userId?: string
  mode?: 'set' | 'invite'
  password?: string
}

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
  const userId = body.userId?.trim()
  const mode = body.mode === 'invite' ? 'invite' : 'set'
  if (!userId) return json({ error: 'user_required' }, 400)
  if (mode === 'set') {
    if (!body.password || body.password.length < 8) {
      return json({ error: 'password_too_short' }, 400)
    }
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Slå målbrugeren op (e-mail + virksomhed) server-side — klienten er utroværdig.
  const { data: target } = await admin
    .from('app_users')
    .select('user_id, email, company_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return json({ error: 'user_not_found' }, 404)

  // 4) Autorisation: platform-admin (enhver virksomhed) eller manager for
  //    netop målbrugerens virksomhed.
  const callerIsPlatformAdmin = await isPlatformAdmin(admin, callerId)
  if (!callerIsPlatformAdmin) {
    // En manager må ikke overtage en platform-admins konto, selv om admin'en
    // har en app_users-række i managerens virksomhed (fx support-/demo-
    // medlemskab) — ellers kunne manageren logge ind som DCA-personale og få
    // adgang på tværs af alle kunder. Kun platform-admins nulstiller
    // platform-admins.
    if (await isPlatformAdmin(admin, target.user_id)) {
      return json({ error: 'forbidden' }, 403)
    }
    if (!(await callerCanManageCompany(admin, callerId, target.company_id))) {
      return json({ error: 'forbidden' }, 403)
    }
  }

  // 5a) Direkte: sæt den indtastede/genererede adgangskode.
  if (mode === 'set') {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: body.password,
    })
    if (error) return json({ error: 'update_failed', detail: error.message }, 400)
    return json({ ok: true })
  }

  // 5b) Nulstillingslink: generér et recovery-link til /welcome og send det.
  if (!target.email) return json({ error: 'no_email' }, 400)
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
    options: { redirectTo: `${appUrl}/welcome` },
  })
  if (linkErr) return json({ error: 'link_failed', detail: linkErr.message }, 400)
  const actionLink = linkData.properties?.action_link
  if (!actionLink) return json({ error: 'link_failed' }, 400)

  const r = await sendInviteEmail(admin, target.email, actionLink)
  return json({ ok: true, emailSent: r.ok, emailError: r.error })
})
