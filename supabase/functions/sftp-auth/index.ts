// sftp-auth — SFTPGo external auth hook. Operia er kilde-til-sandhed for SFTP-
// login: SFTPGo POSTer brugernavn+adgangskode hertil, vi verificerer mod
// company_data_transfer_secret (bcrypt via sftp_auth_lookup) og returnerer en
// SFTPGo-bruger med S3-backend mod Supabase Storage og et pr.-virksomhed-prefix
// ({company_id}/), så hver kunde er isoleret til sin egen mappe.
//
// Deploy MED --no-verify-jwt (SFTPGo sender ingen Supabase-JWT). Beskyttes i
// stedet af SFTP_HOOK_SECRET via hookAuthorized (header foretrukket, ?token=
// bagudkompatibelt).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { hookAuthorized } from '../_shared/hook-auth.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Tom brugernavn ⇒ SFTPGo afviser login.
const DENY = { username: '' }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(DENY, 405)
  if (!hookAuthorized(req, 'SFTP_HOOK_SECRET')) return json(DENY, 401)

  let body: { username?: string; password?: string; ip?: string; protocol?: string }
  try {
    body = await req.json()
  } catch {
    return json(DENY, 400)
  }
  const username = String(body.username ?? '')
  const password = String(body.password ?? '')
  if (!username || !password) return json(DENY) // kun password-auth understøttes

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.rpc('sftp_auth_lookup', {
    p_username: username,
    p_password: password,
  })
  if (error || !data || data.length === 0) return json(DENY)
  const companyId = data[0].company_id

  // Log vellykket login (baggrund — må ikke forsinke svaret SFTPGo venter på).
  const loginLog = admin
    .rpc('log_gateway_event', {
      p_company_id: companyId,
      p_action: 'data_transfer.login',
      p_summary: username,
      p_detail: { ip: body.ip ?? null, protocol: body.protocol ?? null },
    })
    .then(() => {})
    .catch((e) => console.error('login log failed:', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(loginLog)

  const bucket = Deno.env.get('SFTP_S3_BUCKET') ?? 'imports'
  const region = Deno.env.get('SFTP_S3_REGION') ?? 'eu-north-1'
  const endpoint = Deno.env.get('SFTP_S3_ENDPOINT') ?? `${url}/storage/v1/s3`

  return json({
    status: 1,
    username,
    // Under den skrivbare named volume; for S3 er home_dir kun scratch/temp.
    home_dir: `/var/lib/sftpgo/data/${username}`,
    // delete/rename med, så kunden kan rydde op i egne fejl-uploads — og så
    // sftp-uploaded's audit-mapping for de hændelser faktisk kan udløses.
    permissions: { '/': ['list', 'download', 'upload', 'overwrite', 'create_dirs', 'delete', 'rename'] },
    filesystem: {
      provider: 1, // 1 = S3
      s3config: {
        bucket,
        region,
        endpoint,
        access_key: Deno.env.get('SFTP_S3_KEY_ID')!,
        access_secret: { status: 'Plain', payload: Deno.env.get('SFTP_S3_SECRET')! },
        key_prefix: `${companyId}/`,
        force_path_style: true,
      },
    },
  })
})
