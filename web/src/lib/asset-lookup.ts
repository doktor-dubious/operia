import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { AssetStatus } from '@/components/asset-status-badge'

// Opslag af aktiver på identifikator — stregkode, serienummer ELLER aktiv-nr.
// (spec: alle tre skal virke på flow-siderne). Eksakt match; flere træffere kan
// forekomme (serienumre er ikke garanteret unikke på tværs af producenter), så
// kalderen viser en flertydighedsliste i stedet for at antage én.

// Håndskrevet rækketype (embeds + FK-hint knækker select-string-inferensen —
// samme cast-idiom som pakkesiderne).
export type AssetHit = {
  id: string
  company_id: string
  asset_tag: string | null
  name: string
  serial_no: string | null
  barcode: string | null
  status: AssetStatus
  condition: string | null
  is_active: boolean
  category_id: string | null
  location_id: string | null
  assigned_to_employee_id: string | null
  assigned_at: string | null
  service_vendor: string | null
  service_expected_back: string | null
  retired_at: string | null
  retired_reason: string | null
  written_off_at: string | null
  created_at: string
  category: { name: string } | null
  location: { name: string } | null
  assigned: { full_name: string } | null
}

// FK-hintet er nødvendigt fra dag ét: employees er i forvejen embed-tungt, og
// et ukvalificeret embed knækker den dag assets får endnu en employee-FK
// (jf. PGRST201-fælden på parcels).
export const ASSET_LOOKUP_COLUMNS =
  'id, company_id, asset_tag, name, serial_no, barcode, status, condition, is_active, ' +
  'category_id, location_id, assigned_to_employee_id, assigned_at, service_vendor, ' +
  'service_expected_back, retired_at, retired_reason, written_off_at, created_at, ' +
  'category:asset_categories (name), location:asset_locations (name), ' +
  'assigned:employees!assets_assigned_to_employee_id_fkey (full_name)'

// PostgREST-værdi i .or(): dobbelt-citeret så kommaer/parenteser i en scannet
// kode ikke læses som syntaks (samme tilgang som employee-picker).
const quoted = (raw: string) => `"${raw.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

export async function findAssetsByCode(
  companyId: string,
  code: string,
  opts?: { includeNameSearch?: boolean },
): Promise<AssetHit[]> {
  const v = quoted(code)
  const parts = [`barcode.eq.${v}`, `serial_no.eq.${v}`, `asset_tag.eq.${v}`]
  if (opts?.includeNameSearch) {
    parts.push(`name.ilike.${quoted(`%${code}%`)}`)
  }
  const { data, error } = await supabase
    .from('assets')
    .select(ASSET_LOOKUP_COLUMNS)
    .eq('company_id', companyId)
    .or(parts.join(','))
    .order('name')
    .limit(20)
  if (error) throw error
  return (data ?? []) as unknown as AssetHit[]
}

// Den kode et fundet aktiv genfindes på (til ?code=-deep-links mellem
// flow-siderne): stregkoden hvis den findes, ellers aktiv-nr., ellers serienr.
export function assetCode(asset: Pick<AssetHit, 'barcode' | 'asset_tag' | 'serial_no'>): string | undefined {
  return asset.barcode ?? asset.asset_tag ?? asset.serial_no ?? undefined
}

// Alle aktiv-relaterede queries starter med 'asset'/'assets' — én invalidering
// efter hver flow-handling holder register, oversigt, lån og historik i takt.
export function invalidateAssetQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('asset'),
  })
}

// Fejlkoder fra flow-RPC'erne (raise exception '<kode>') → i18n. Kaldes før
// describeError, som tager sig af SQLSTATE-fejl og alt andet.
export const ASSET_RPC_ERRORS: Record<string, string> = {
  asset_not_found: 'assetFlow.errAssetNotFound',
  asset_inactive: 'assetFlow.errAssetInactive',
  asset_not_in_stock: 'assetsPage.notInStock',
  asset_not_out: 'assetFlow.errAssetNotOut',
  asset_on_loan: 'assetFlow.errAssetOnLoan',
  asset_written_off: 'assetFlow.errAssetWrittenOff',
  asset_not_serviceable: 'assetFlow.errAssetNotServiceable',
  already_retired: 'assetFlow.errAlreadyRetired',
  not_retired: 'assetFlow.errNotRetired',
  employee_not_found: 'assetFlow.errEmployeeNotFound',
  employee_inactive: 'assetFlow.errEmployeeInactive',
  location_not_found: 'assetFlow.errLocationNotFound',
  location_required: 'assetFlow.errLocationRequired',
  same_location: 'assetFlow.errSameLocation',
  no_open_loan: 'assetsPage.noOpenLoan',
  barcode_taken: 'assetsPage.barcodeTaken',
  name_required: 'assetFlow.errNameRequired',
  contact_required: 'assetFlow.errContactRequired',
  bad_email: 'assetsPage.lendEmailInvalid',
  bad_reason: 'assetFlow.errBadReason',
  not_authorized: 'common.noPermission',
}

export function assetRpcErrorKey(error: { message?: string } | null): string | null {
  const msg = error?.message ?? ''
  for (const [code, key] of Object.entries(ASSET_RPC_ERRORS)) {
    if (msg.includes(code)) return key
  }
  return null
}
