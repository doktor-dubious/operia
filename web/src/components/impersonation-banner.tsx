import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getImpersonationLabel,
  isImpersonating,
  stopImpersonation,
  subscribeImpersonation,
} from '@/lib/impersonation'

// App-dækkende bjælke, der vises mens en platform-admin impersonerer en bruger.
// Sidder øverst i _app-layoutet, over skallen, så den er synlig på alle skærme —
// en tydelig påmindelse om at man IKKE er logget ind som sig selv.
export function ImpersonationBanner() {
  const { t } = useTranslation()
  const [stopping, setStopping] = useState(false)
  // I fanen der starter impersoneringen genindlæses appen, men supabase-
  // sessionen deles via localStorage, så ANDRE åbne faner bliver også
  // målbrugeren — storage-abonnementet får banneret frem i dem med det samme.
  const active = useSyncExternalStore(subscribeImpersonation, isImpersonating)

  if (!active) return null

  const label = getImpersonationLabel()

  const onStop = async () => {
    setStopping(true)
    try {
      await stopImpersonation()
    } catch {
      setStopping(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-[13px] font-medium text-amber-950">
      <UserCog className="size-4 shrink-0" />
      <span className="truncate">{t('impersonate.bannerActive', { name: label })}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={stopping}
        onClick={onStop}
        className="h-6 border-amber-950/30 bg-amber-400/40 px-2 text-amber-950 hover:bg-amber-400/60"
      >
        {stopping ? t('common.loading') : t('impersonate.stop')}
      </Button>
    </div>
  )
}
