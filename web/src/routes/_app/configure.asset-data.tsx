import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AssetNoFields,
  assetNoError,
  assetNoKey,
  fromAssetNoValue,
  toAssetNoValue,
  type AssetNoValue,
} from '@/components/asset-no-fields'
import { OperiaPage } from '@/components/operia-config-page'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Konfigurér → Aktivdata: virksomhedens egen nummerserie for Aktiv-nr.
// Nummeret tildeles altid af serveren (next_asset_no) — her vælges kun formen.
export const Route = createFileRoute('/_app/configure/asset-data')({
  component: AssetDataPage,
})

function useCompanyAssetNo(companyId: string | null) {
  return useQuery({
    queryKey: ['company-asset-no', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('asset_no_type, asset_no_prefix, asset_no_length')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

function AssetDataPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: access } = useAccess()
  const { data, isPending } = useCompanyAssetNo(companyId)
  const queryClient = useQueryClient()
  const [value, setValue] = useState<AssetNoValue | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setValue(toAssetNoValue(data))
  }, [data])

  const initial = data ? toAssetNoValue(data) : null
  const dirty = !!value && !!initial && assetNoKey(value) !== assetNoKey(initial)

  const save = async () => {
    if (!value || !companyId) return
    // Spejler kolonne-checkene, så en ulovlig længde/præfiks giver en læselig
    // fejl frem for en rå constraint-violation.
    const invalid = assetNoError(value)
    if (invalid) {
      toast.error(t(`assetDataConfig.${invalid}`))
      return
    }
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update(fromAssetNoValue(value))
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-asset-no', companyId] })
  }

  const cancel = () => {
    if (data) setValue(toAssetNoValue(data))
  }

  // Produktgate som menupunktet (nav.ts): siden findes ikke for kunder uden
  // aktiver-modulet — heller ikke via direkte URL.
  if (access && !access.isPlatformAdmin && !access.products.has('assets')) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage
        title={t('nav.configureAssetData')}
        subtitle={t('assetDataConfig.companySubtitle')}
      >
        <AssetNoFields
          idPrefix="cfg"
          value={value}
          onChange={(patch) => setValue((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      </OperiaPage>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}
