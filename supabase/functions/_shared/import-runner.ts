// import-runner — shared background pipeline for inbound employee-CSV imports,
// used by both transport legs (SFTP: sftp-uploaded, email: email-inbound). Given
// a file already landed in the `imports` bucket and its inbound_files row, it:
//   1. takes the per-company import lock (concurrent runs would race the
//      read-then-write diff), marks the row processing
//   2. downloads the CSV, loads the company's import config
//   3. runs the Flow 0 engine (processEmployeeCsv) with the mass-deactivation
//      guard on (unattended run — no human dry-run preview)
//   4. records an import_run (which audit-logs import.applied/rejected)
//   5. sets inbound_files status + links the import_run
//   6. removes the source object on a successful import (kept on reject/failure
//      for inspection; imports-cleanup prunes them after retention)
// Runs AFTER the HTTP response (EdgeRuntime.waitUntil) so large files never hit
// the gateway/webhook timeout.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { processEmployeeCsv, type ImportApplyError, type ImportResult } from './employee-import.ts'

// Supabase edge-runtime baggrundsopgaver: hold funktionen i live indtil løftet er
// færdigt, EFTER svaret er sendt. Falder tilbage til await hvis utilgængelig.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
export function runBackground(p: Promise<unknown>): Promise<unknown> | void {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(p.catch((e) => console.error('background task failed:', e)))
    return
  }
  // fallback: kalderen await'er (synkront) — fejl er allerede logget som
  // import_run, så svaret skal ikke også fejle (undgår webhook-retry-løkker).
  return p.catch((e) => console.error('inbound import failed:', e))
}

export type ImportJob = {
  companyId: string
  objectPath: string
  fileName: string | null
  inboundId: string
  // Hvem/hvad leverede filen — vises i import_runs.created_by_email, fx
  // `sftp:daniel` eller `email:hr@kunde.dk`.
  actor: string
}

const LOCK_ATTEMPTS = 12
const LOCK_RETRY_MS = 5000

export async function processInboundImport(db: SupabaseClient, job: ImportJob) {
  const { companyId, objectPath, fileName, inboundId, actor } = job

  // Fejlet kørsel logges ALTID som import_run (kundens alarmflade) — med de
  // delvist anvendte tal hvis anvendelsen knækkede halvvejs.
  const recordFailure = async (code: string, message?: string, partial?: ImportResult['counts']) => {
    const upd = await db.from('inbound_files').update({ status: 'failed' }).eq('id', inboundId)
    if (upd.error) console.error('kunne ikke opdatere inbound_files:', upd.error)
    const ins = await db.from('import_runs').insert({
      company_id: companyId,
      kind: 'employees_csv',
      file_name: fileName,
      status: 'failed',
      rows_total: partial?.rows_total ?? 0,
      created_count: partial?.created ?? 0,
      updated_count: partial?.updated ?? 0,
      unchanged_count: partial?.unchanged ?? 0,
      deactivated_count: partial?.deactivated ?? 0,
      skipped_manual_count: partial?.skippedManual ?? 0,
      departments_created: partial?.departments ?? 0,
      errors: [{ row: 0, code, ...(message ? { params: { message: message.slice(0, 300) } } : {}) }],
      created_by_email: actor,
    })
    if (ins.error) console.error('kunne ikke logge fejlet import:', ins.error)
  }

  // Én import ad gangen pr. virksomhed. try_import_lock rydder selv forældede
  // låse (>15 min), så en crashet runner aldrig blokerer permanent.
  let locked = false
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !locked; attempt++) {
    const { data, error } = await db.rpc('try_import_lock', { p_company_id: companyId })
    if (error) console.error('try_import_lock fejlede:', error)
    else if (data === true) { locked = true; break }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
  }
  if (!locked) {
    await recordFailure('importBusy')
    return
  }

  try {
    await db.from('inbound_files').update({ status: 'processing' }).eq('id', inboundId)

    const { data: blob, error: dlErr } = await db.storage.from('imports').download(objectPath)
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? 'no data'}`)
    const text = await blob.text()

    const { data: cfg } = await db
      .from('import_configs')
      .select('has_header, has_footer, separator, fields')
      .eq('company_id', companyId)
      .eq('import_type', 'employees')
      .maybeSingle()

    const result = await processEmployeeCsv(db, companyId, text, cfg, { guardDeactivations: true })

    const { data: run, error: runErr } = await db
      .from('import_runs')
      .insert({
        company_id: companyId,
        kind: 'employees_csv',
        file_name: fileName,
        status: result.status,
        rows_total: result.counts.rows_total,
        created_count: result.counts.created,
        updated_count: result.counts.updated,
        unchanged_count: result.counts.unchanged,
        deactivated_count: result.counts.deactivated,
        skipped_manual_count: result.counts.skippedManual,
        departments_created: result.counts.departments,
        rejected_count: result.errors.length,
        errors: result.errors,
        created_by_email: actor,
      })
      .select('id')
      .single()
    if (runErr) throw runErr

    await db
      .from('inbound_files')
      .update({ status: result.status === 'applied' ? 'processed' : 'rejected', import_run_id: run?.id ?? null })
      .eq('id', inboundId)

    if (result.status === 'applied') await db.storage.from('imports').remove([objectPath])
    return result
  } catch (e) {
    console.error('auto-import failed:', e)
    const partial = e instanceof Error ? (e as ImportApplyError).partialCounts : undefined
    await recordFailure('exception', String(e instanceof Error ? e.message : e), partial)
    throw e
  } finally {
    const { error } = await db.rpc('release_import_lock', { p_company_id: companyId })
    if (error) console.error('release_import_lock fejlede:', error)
  }
}
