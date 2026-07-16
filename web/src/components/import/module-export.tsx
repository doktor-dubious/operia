import { useTranslation } from 'react-i18next'
import { CsvExportPanel, type ExportLoad } from '@/components/import/csv-export-panel'
import { fetchAllPages } from '@/lib/import-utils'
import { moduleFieldMap, type ModuleSpec } from '@/lib/module-import'
import { supabase } from '@/lib/supabase'

// Eksport for Aktiver-/Lager-modulet — genbruger CsvExportPanel med modulets
// felter. Kategori/placering skrives med navn (ikke id), så en eksport →
// re-import round-tripper mod de samme opslagsregistre.
// Sidevis hentning (fetchAllPages) — ellers capper PostgREST tavst ved 1000
// rækker, og en "komplet" eksport ville mangle resten.
function moduleLoad(spec: ModuleSpec): ExportLoad {
  return async (companyId, fields) => {
    const [rows, cats, locs] = await Promise.all([
      fetchAllPages((from, to) =>
        supabase
          .from(spec.table)
          .select(spec.selectColumns)
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order(spec.keyField)
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        supabase.from('asset_categories').select('id, name').eq('company_id', companyId).order('id').range(from, to),
      ),
      fetchAllPages((from, to) =>
        supabase.from('asset_locations').select('id, name').eq('company_id', companyId).order('id').range(from, to),
      ),
    ])

    const catName = new Map(cats.map((c) => [c.id, c.name]))
    const locName = new Map(locs.map((l) => [l.id, l.name]))
    const fieldMap = moduleFieldMap(spec)

    const records = (rows as unknown as Record<string, unknown>[]).map((r) => {
      const rec: Record<string, string | number | null> = {}
      for (const key of fields) {
        const f = fieldMap[key]
        if (!f) continue
        if (f.kind === 'category') {
          rec[key] = r.category_id ? (catName.get(r.category_id as string) ?? null) : null
        } else if (f.kind === 'location') {
          rec[key] = r.location_id ? (locName.get(r.location_id as string) ?? null) : null
        } else {
          rec[key] = (r[key] as string | number | null) ?? null
        }
      }
      return rec
    })

    return { headerFor: (field) => field, records }
  }
}

export function ModuleExport({ spec }: { spec: ModuleSpec }) {
  const { t } = useTranslation()
  return (
    <CsvExportPanel
      importType={spec.importType}
      runKind={spec.runKind}
      defaultFields={spec.defaultFields}
      fileBase={t(`${spec.i18nKey}.exportFileBase`)}
      title={t(`${spec.i18nKey}.exportTitle`)}
      subtitle={t(`${spec.i18nKey}.exportSubtitle`)}
      fieldLabel={(field) => t(`${spec.i18nKey}.field_${field}`)}
      load={moduleLoad(spec)}
    />
  )
}
