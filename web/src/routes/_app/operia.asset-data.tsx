import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
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
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Operia → Aktivdata: platformens standard-nummerserie. Nye kunder arver den
// ved oprettelsen (trigger companies_asset_no_defaults); en eksisterende kunde
// røres ikke — dens egen serie står under Konfigurér → Aktivdata.
export const Route = createFileRoute('/_app/operia/asset-data')({
  component: AssetDataPage,
})

function AssetDataPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [value, setValue] = useState<AssetNoValue | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setValue(toAssetNoValue(data))
  }, [data])

  const initial = data ? toAssetNoValue(data) : null
  const dirty = !!value && !!initial && assetNoKey(value) !== assetNoKey(initial)

  const save = async () => {
    if (!value) return
    const invalid = assetNoError(value)
    if (invalid) {
      toast.error(t(`assetDataConfig.${invalid}`))
      return
    }
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update(fromAssetNoValue(value))
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  const cancel = () => {
    if (data) setValue(toAssetNoValue(data))
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage
        title={t('nav.operiaAssetData')}
        subtitle={t('assetDataConfig.platformSubtitle')}
      >
        <AssetNoFields
          idPrefix="operia"
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
