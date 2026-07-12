import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyLogoFields, cleanupLogos } from '@/components/company-config-fields'
import { OperiaPage } from '@/components/operia-config-page'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

// Konfigurér → Logo: virksomhedens eget logo — samme felter som fanen på
// Operia → Kunder, men for den aktive virksomhed. Managers kan gemme og
// uploade via companies_manager_update- og company_logos-politikkerne.
export const Route = createFileRoute('/_app/configure/logo')({
  component: LogoPage,
})

function useCompanyLogo(companyId: string | null) {
  return useQuery({
    queryKey: ['company-logo', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('logo_url')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

function LogoPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useCompanyLogo(companyId)
  const queryClient = useQueryClient()
  const [logoUrl, setLogoUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setLogoUrl(data.logo_url ?? '')
      setLoaded(true)
    }
  }, [data])

  const dirty = loaded && !!data && logoUrl !== (data.logo_url ?? '')

  const save = async () => {
    if (!companyId) return
    setSaving(true)
    const trimmed = logoUrl.trim()
    const { data: saved, error } = await supabase
      .from('companies')
      .update({ logo_url: trimmed || null })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    // Udskiftede/fjernede logofiler skal ikke blive liggende i den
    // offentlige bucket (GDPR).
    void cleanupLogos(companyId, trimmed || null)
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-logo', companyId] })
  }

  const cancel = () => setLogoUrl(data?.logo_url ?? '')

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage title={t('nav.configureLogo')} subtitle={t('configureConfig.logoSubtitle')}>
        <CompanyLogoFields companyId={companyId} logoUrl={logoUrl} onLogoUrlChange={setLogoUrl} />
      </OperiaPage>

      {dirty && (
        // Fuld bredde: bryd ud af indholdskolonnen (sekundærmenu w-52 + gap-8
        // + main px-6 = 16.5rem til venstre).
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
