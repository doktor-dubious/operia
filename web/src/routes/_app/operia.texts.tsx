import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTextsEditor } from '@/components/app-texts-fields'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { BUNDLED_LANGS } from '@/lib/app-texts'

// Operia → Tekster: platformens standardtekster. Det DCA gemmer her gælder ALLE
// kunder og lægger sig oven på locale-filerne — kunderne kan derefter lægge
// deres eget lag oven på det igen (Konfigurér → Tekster).
export const Route = createFileRoute('/_app/operia/texts')({
  component: OperiaTextsPage,
})

function OperiaTextsPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()

  if (isPending) return <Skeleton className="h-96 w-full" />

  // Kun sprog app'en har et bundt for kan overstyres — en overstyring på et
  // sprog brugerfladen ikke kan skifte til ville bare være død data.
  const langs = (data?.supported_languages ?? ['da']).filter((l) => BUNDLED_LANGS.includes(l))

  return (
    <div className="flex min-h-full flex-col gap-6">
      <p className="text-sm text-foreground-light">{t('textsPage.platformSubtitle')}</p>
      <AppTextsEditor scope={{ kind: 'platform' }} langs={langs} />
    </div>
  )
}
