// invite-user — opretter en login-konto og binder den til én virksomhed med
// de valgte roller (managers for egen virksomhed; platform-admins for enhver).
//
// Browseren er utroværdig (se CLAUDE.md): funktionen genverificerer server-side
// at kalderen må tilføje brugere til den valgte virksomhed, og bruger derefter
// service-role-nøglen til at oprette auth-brugeren + app_users + roller. Fejler
// noget, rulles auth-brugeren tilbage (cascade rydder app_users/roller).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendInviteEmail } from '../_shared/invite-email.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_ROLES = new Set(['manager', 'parcel_handler', 'final_receiver'])

type Body = {
  companyId?: string
  email?: string
  fullName?: string
  roles?: string[]
  sendInvitation?: boolean
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
  const companyId = body.companyId?.trim()
  const email = body.email?.trim()
  const fullName = body.fullName?.trim() ?? ''
  const roles = Array.isArray(body.roles)
    ? [...new Set(body.roles)].filter((r) => VALID_ROLES.has(r))
    : []
  if (!companyId) return json({ error: 'company_required' }, 400)
  if (!email) return json({ error: 'email_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Autorisation: platform-admin (enhver virksomhed) eller manager for
  //    netop denne virksomhed.
  const { data: isPlatformAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle()

  let allowed = !!isPlatformAdmin
  if (!allowed) {
    const { data: callerAppUser } = await admin
      .from('app_users')
      .select('company_id')
      .eq('user_id', callerId)
      .maybeSingle()
    if (callerAppUser?.company_id === companyId) {
      const { data: managerRole } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', callerId)
        .eq('role', 'manager')
        .maybeSingle()
      allowed = !!managerRole
    }
  }
  if (!allowed) return json({ error: 'forbidden' }, 403)

  // 4) Opret auth-brugeren (invitation eller fast/genereret adgangskode).
  //    Ved invitation genererer vi selv accept-linket og sender via Resend.
  let newUserId: string | null = null
  let inviteLink: string | null = null
  try {
    if (body.sendInvitation) {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email })
      if (error) throw error
      newUserId = data.user.id
      inviteLink = data.properties?.action_link ?? null
    } else {
      const password = body.password && body.password.length >= 8
        ? body.password
        : crypto.randomUUID() + 'Aa1!'
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) throw error
      newUserId = data.user.id
    }
  } catch (e) {
    return json({ error: 'create_user_failed', detail: String((e as Error).message) }, 400)
  }

  // 5) Bind til virksomheden + tildel roller. Rul tilbage ved fejl.
  try {
    const { error: auErr } = await admin.from('app_users').insert({
      user_id: newUserId!,
      company_id: companyId,
      full_name: fullName,
      email,
    })
    if (auErr) throw auErr

    if (roles.length) {
      const { error: roleErr } = await admin
        .from('user_roles')
        .insert(roles.map((role) => ({ user_id: newUserId!, role })))
      if (roleErr) throw roleErr
    }
  } catch (e) {
    if (newUserId) await admin.auth.admin.deleteUser(newUserId)
    return json({ error: 'provisioning_failed', detail: String((e as Error).message) }, 400)
  }

  // 6) Send invitations-e-mailen via Resend (uden rollback ved e-mailfejl).
  let emailSent = false
  let emailError: string | undefined
  if (body.sendInvitation && inviteLink) {
    const r = await sendInviteEmail(admin, email, inviteLink)
    emailSent = r.ok
    emailError = r.error
  }

  return json({ userId: newUserId, emailSent, emailError })
})
