// create-customer — opretter en ny tenant atomisk (kun platform-admins).
//
// Browseren er utroværdig (se CLAUDE.md): denne funktion genverificerer at
// kalderen er platform-admin server-side og bruger service-role-nøglen til at
// oprette auth-brugeren + virksomheden + entitlements. Fejler noget undervejs,
// rulles alt tilbage (auth-bruger + virksomhed slettes; cascade rydder resten).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendInviteEmail } from '../_shared/invite-email.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Body = {
  companyName?: string
  adminEmail?: string
  sendInvitation?: boolean
  password?: string
  products?: string[]
  features?: string[]
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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: isAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!isAdmin) return json({ error: 'forbidden' }, 403)

  // 2) Validér input.
  const body = (await req.json().catch(() => ({}))) as Body
  const companyName = body.companyName?.trim()
  const adminEmail = body.adminEmail?.trim()
  const products = Array.isArray(body.products) ? [...new Set(body.products)] : []
  const features = Array.isArray(body.features) ? [...new Set(body.features)] : []
  if (!companyName) return json({ error: 'company_name_required' }, 400)
  if (!adminEmail) return json({ error: 'admin_email_required' }, 400)

  // 3) Opret auth-brugeren (invitation eller fast/genereret adgangskode).
  //    Ved invitation genererer vi selv accept-linket (generateLink sender
  //    ingen e-mail) og udsender via Resend efter provisioneringen.
  let newUserId: string | null = null
  let inviteLink: string | null = null
  try {
    if (body.sendInvitation) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: adminEmail,
      })
      if (error) throw error
      newUserId = data.user.id
      inviteLink = data.properties?.action_link ?? null
    } else {
      const password = body.password && body.password.length >= 8
        ? body.password
        : crypto.randomUUID() + 'Aa1!'
      const { data, error } = await admin.auth.admin.createUser({
        email: adminEmail,
        password,
        email_confirm: true,
      })
      if (error) throw error
      newUserId = data.user.id
    }
  } catch (e) {
    return json({ error: 'create_user_failed', detail: String((e as Error).message) }, 400)
  }

  // 4) Opret virksomhed + admin-binding + roller + entitlements. Rul tilbage
  //    ved enhver fejl (slet auth-bruger; virksomhed cascader resten væk).
  let companyId: string | null = null
  try {
    const { data: company, error: companyErr } = await admin
      .from('companies')
      .insert({ name: companyName })
      .select('id')
      .single()
    if (companyErr) throw companyErr
    companyId = company.id

    const { error: auErr } = await admin.from('app_users').insert({
      user_id: newUserId!,
      company_id: companyId,
      full_name: '',
      email: adminEmail,
    })
    if (auErr) throw auErr

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: newUserId!, role: 'manager' })
    if (roleErr) throw roleErr

    if (products.length) {
      const { error } = await admin
        .from('company_products')
        .insert(products.map((product_key) => ({ company_id: companyId, product_key })))
      if (error) throw error
    }
    if (features.length) {
      const { error } = await admin
        .from('company_features')
        .insert(features.map((feature_key) => ({ company_id: companyId, feature_key })))
      if (error) throw error
    }
  } catch (e) {
    if (companyId) await admin.from('companies').delete().eq('id', companyId)
    if (newUserId) await admin.auth.admin.deleteUser(newUserId)
    return json({ error: 'provisioning_failed', detail: String((e as Error).message) }, 400)
  }

  // 6) Send invitations-e-mailen via Resend (efter alt andet er lykkedes).
  //    Fejler e-mailen, ruller vi IKKE tilbage — kunden findes; vi melder blot
  //    at e-mailen ikke kom afsted, så manageren kan sende linket manuelt.
  let emailSent = false
  let emailError: string | undefined
  if (body.sendInvitation && inviteLink) {
    const r = await sendInviteEmail(admin, adminEmail, inviteLink)
    emailSent = r.ok
    emailError = r.error
  }

  return json({ companyId, userId: newUserId, emailSent, emailError })
})
