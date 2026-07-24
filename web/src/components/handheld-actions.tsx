import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { describeError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Handlinger-fanen på Operia → Handheld-design: udgiv en ny APK-version og
// hent QR-koden kunderne installerer fra. Selve bygningen sker på bygge-
// maskinen: knappen lægger en række i handheld_deploys, som deploy-workeren
// (android/deploy-worker.sh) samler op, kører publish-apk.sh og melder
// status/log tilbage på.

// Udgivelse kræver deploy-workeren på Runes byggemaskine, så knappen vises
// (og RLS-policyen tillader, jf. 20260723032149) kun for denne bruger,
// indtil bygningen evt. flyttes til CI.
const DEPLOY_USER = 'rune@predictioninstitute.com'

const QR_SRC = '/operia-handheld-qr.png'
const APK_URL =
  'https://rjlxmdfmktucunxehtqz.supabase.co/storage/v1/object/public/app-dist/operia-handheld.apk'

const STATUS_DOT: Record<string, string> = {
  queued: 'bg-status-neutral',
  running: 'bg-status-good-to-neutral animate-pulse',
  success: 'bg-status-good',
  failed: 'bg-status-bad',
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>
)

export function HandheldActions() {
  const { t, i18n } = useTranslation()
  const { session } = useSession()
  const queryClient = useQueryClient()
  const [requesting, setRequesting] = useState(false)
  const [openLogId, setOpenLogId] = useState<string | null>(null)

  const canDeploy = session?.user.email === DEPLOY_USER

  const { data: deploys, isPending } = useQuery({
    queryKey: ['handheld-deploys'],
    enabled: canDeploy,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handheld_deploys')
        .select('id, status, log, created_at, started_at, finished_at')
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data
    },
    // Poll hurtigt mens en udgivelse er i gang, ellers slet ikke.
    refetchInterval: (query) =>
      query.state.data?.some(
        (d) => d.status === 'queued' || d.status === 'running',
      )
        ? 4000
        : false,
  })

  const active = deploys?.some(
    (d) => d.status === 'queued' || d.status === 'running',
  )

  const requestDeploy = async () => {
    setRequesting(true)
    const { error } = await supabase
      .from('handheld_deploys')
      .insert({ requested_by: session?.user.id })
    setRequesting(false)
    if (error) {
      // 23505 = unik-indekset "højst én aktiv udgivelse" — pæn besked frem for fejl.
      toast.error(
        error.code === '23505'
          ? t('handheldActions.alreadyActive')
          : describeError(error, t),
      )
    } else {
      toast.success(t('handheldActions.queuedToast'))
    }
    queryClient.invalidateQueries({ queryKey: ['handheld-deploys'] })
  }

  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'da', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  return (
    <div className="flex flex-col gap-8">
      {/* Udgiv ny version — kun for DEPLOY_USER */}
      {canDeploy && (
        <section className="flex flex-col gap-3">
          <SectionTitle>{t('handheldActions.deploySection')}</SectionTitle>
          <p className="text-[13px] text-foreground-light">
            {t('handheldActions.deployHint')}
          </p>
          <div>
            <Button
              size="sm"
              onClick={requestDeploy}
              disabled={requesting || active}
            >
              <Rocket className="size-4" />
              {active
                ? t('handheldActions.deployRunning')
                : t('handheldActions.deployButton')}
            </Button>
          </div>

          {isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : deploys && deploys.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border bg-panel">
              {deploys.map((d) => (
                <li key={d.id} className="px-4 py-2.5 text-[13px]">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        STATUS_DOT[d.status],
                      )}
                    />
                    <span className="w-20 font-[450] text-foreground">
                      {t(`handheldActions.status.${d.status}`)}
                    </span>
                    <span className="text-foreground-light">
                      {fmt.format(new Date(d.created_at))}
                    </span>
                    {d.log &&
                      (d.status === 'failed' || d.status === 'success') && (
                        <button
                          type="button"
                          className="ml-auto cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() =>
                            setOpenLogId(openLogId === d.id ? null : d.id)
                          }
                        >
                          {openLogId === d.id
                            ? t('handheldActions.hideLog')
                            : t('handheldActions.showLog')}
                        </button>
                      )}
                  </div>
                  {openLogId === d.id && d.log && (
                    <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap text-foreground-light">
                      {d.log}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {t('handheldActions.historyEmpty')}
            </p>
          )}
        </section>
      )}

      {/* QR-kode til installation */}
      <section className="flex flex-col gap-3">
        <SectionTitle>{t('handheldActions.qrSection')}</SectionTitle>
        <p className="text-[13px] text-foreground-light">
          {t('handheldActions.qrHint')}
        </p>
        <div className="flex items-start gap-5">
          <img
            src={QR_SRC}
            alt={t('handheldActions.qrAlt')}
            className="h-40 w-40 rounded-lg border bg-white p-2"
          />
          <div className="flex flex-col gap-2">
            <div>
              <Button size="sm" variant="outline" asChild>
                <a href={QR_SRC} download="operia-handheld-qr.png">
                  <Download className="size-4" />
                  {t('handheldActions.downloadQr')}
                </a>
              </Button>
            </div>
            <p className="max-w-md text-xs break-all text-muted-foreground">
              {APK_URL}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
