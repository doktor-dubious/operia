// sftp-uploaded — SFTPGo fs-event hook. Handles every action configured in
// SFTPGo's execute_on:
//   • upload → record inbound_files, then run the Flow 0 employee import in the
//     BACKGROUND (EdgeRuntime.waitUntil) so we acknowledge SFTPGo instantly and
//     never hit its ~20s hook timeout on large files.
//   • download / delete / rename → log a data_transfer.* audit event.
// import_runs itself audit-logs import.applied/rejected; a trigger mirrors
// inbound_files inserts to data_transfer.received. Source object is removed on a
// successful import, kept on reject/failure for inspection.
//
// Deploy WITH --no-verify-jwt. Guarded by SFTP_HOOK_SECRET via hookAuthorized
// (header preferred, ?token= kept for backwards compatibility).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { hookAuthorized } from '../_shared/hook-auth.ts'
import { processInboundImport, runBackground } from '../_shared/import-runner.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

async function companyForUser(db: SupabaseClient, username: string): Promise<string | null> {
  const { data } = await db
    .from('company_data_transfer_secret')
    .select('company_id')
    .eq('sftp_username', username)
    .maybeSingle()
  return data?.company_id ?? null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!hookAuthorized(req, 'SFTP_HOOK_SECRET')) return json({ error: 'unauthorized' }, 401)

  let ev: Record<string, unknown>
  try {
    ev = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const action = String(ev.action ?? '')
  const username = String(ev.username ?? '')
  const virtualPath = String(ev.virtual_path ?? ev.path ?? '')
  const objectPath = String(ev.path ?? virtualPath)
  const fileName = virtualPath.split('/').pop() || null
  if (!username) return json({ ignored: 'no_user' })

  // Kun vellykkede hændelser (SFTPGo status=1) — en fejlet download/upload skal
  // hverken audit-logges som succes eller udløse en import.
  if (ev.status !== undefined && ev.status !== 1) return json({ ignored: 'status' })

  const db = admin()
  const companyId = await companyForUser(db, username)
  if (!companyId) return json({ ignored: 'unknown_user' })

  // Ikke-upload fs-hændelser: log blot til audit-loggen.
  if (action !== 'upload') {
    const map: Record<string, string> = {
      download: 'data_transfer.downloaded',
      delete: 'data_transfer.deleted',
      rename: 'data_transfer.renamed',
      mkdir: 'data_transfer.mkdir',
      rmdir: 'data_transfer.rmdir',
    }
    const auditAction = map[action]
    if (!auditAction) return json({ ignored: 'action' })
    await db.rpc('log_gateway_event', {
      p_company_id: companyId,
      p_action: auditAction,
      p_summary: fileName,
      p_detail: { path: objectPath, ip: ev.ip ?? null, protocol: ev.protocol ?? null },
    })
    return json({ ok: true, logged: auditAction })
  }

  const fileSize = typeof ev.file_size === 'number' ? ev.file_size : null

  // SFTP-gatewayen skriver til en fast sti (samme filnavn ⇒ samme nøgle), så
  // to hurtige leveringer af samme fil ville dele objekt mens deres imports
  // kører — den ene import kunne læse den andens indhold og slette det.
  // Kopiér straks til en unik behandlingsnøgle og importér den; originalen
  // bliver liggende og ryddes af imports-cleanup efter retention.
  let processPath = `${companyId}/${crypto.randomUUID()}-${fileName ?? 'inbound.csv'}`
  const { error: cpErr } = await db.storage.from('imports').copy(objectPath, processPath)
  if (cpErr) {
    console.error('kunne ikke kopiere til behandlingsnøgle:', cpErr)
    processPath = objectPath // fallback: behandl originalen direkte
  }

  const { data: inbound, error: inboundErr } = await db
    .from('inbound_files')
    .insert({ company_id: companyId, source: 'sftp', object_path: processPath, file_name: fileName, file_size: fileSize, status: 'received' })
    .select('id')
    .single()
  if (inboundErr || !inbound) return json({ error: 'insert_failed' }, 500)

  // Kvittér til SFTPGo med det samme; importér i baggrunden (store filer).
  const maybe = runBackground(
    processInboundImport(db, {
      companyId,
      objectPath: processPath,
      fileName,
      inboundId: inbound.id,
      actor: `sftp:${username}`,
    }),
  )
  if (maybe) await maybe // fallback uden waitUntil
  return json({ ok: true, queued: true })
})
