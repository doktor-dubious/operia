import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTextsEditor } from '@/components/app-texts-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { BUNDLED_LANGS } from '@/lib/app-texts'
import { supabase } from '@/lib/supabase'

// Konfigurér → Tekster: virksomhedens egne grænsefladetekster. Lægger sig oven
// på platformens standard (Operia → Tekster), som igen ligger oven på
// locale-filerne.
export const Route = createFileRoute('/_app/configure/texts')({
  component: CompanyTextsPage,
})

function CompanyTextsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()

  const { data, isPending } = useQuery({
    queryKey: ['company-languages', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('supported_languages')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })

  if (!companyId || isPending) return <Skeleton className="h-96 w-full" />

  const langs = (data?.supported_languages ?? ['da']).filter((l) => BUNDLED_LANGS.includes(l))

  return (
    <div className="flex min-h-full flex-col gap-6">
      <p className="text-sm text-foreground-light">{t('textsPage.companySubtitle')}</p>
      <AppTextsEditor scope={{ kind: 'company', companyId }} langs={langs} />
    </div>
  )
}
