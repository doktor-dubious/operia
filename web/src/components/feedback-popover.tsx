import { useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, ImageIcon, Lightbulb, MessageCircle, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/errors'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Feedback-widget i topbjælken (Supabase Studio-mønsteret): et lille panel
// under ikonet, hvor man først vælger hvad man vil dele (problem/idé) og
// derefter skriver beskeden. Problem-varianten er rød (danger), idé-varianten
// bruger standardknappen. Gemmes i public.feedback (DCA's indbakke) med
// valgfrit skærmbillede i den private 'feedback'-bucket.

type Kind = 'issue' | 'idea'

export function FeedbackPopover() {
  const { t } = useTranslation()
  const { session } = useSession()
  const { companyId } = useCompanyContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [message, setMessage] = useState('')
  const [shot, setShot] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setKind(null)
    setMessage('')
    setShot(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    setOpen(next)
  }

  const isIssue = kind === 'issue'

  const send = async () => {
    const userId = session?.user.id
    if (!kind || !message.trim() || !userId) return
    setBusy(true)
    try {
      let screenshotPath: string | null = null
      if (shot) {
        const ext = shot.name.split('.').pop()?.toLowerCase() || 'png'
        screenshotPath = `${userId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('feedback')
          .upload(screenshotPath, shot, { contentType: shot.type || 'image/png' })
        if (upErr) throw upErr
      }
      const { error } = await supabase.from('feedback').insert({
        user_id: userId,
        company_id: companyId,
        kind,
        message: message.trim(),
        screenshot_path: screenshotPath,
        page_path: pathname,
      })
      if (error) throw error
      toast.success(t('feedback.sent'))
      handleOpenChange(false)
    } catch (error) {
      console.error('Feedback fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={t('nav.feedback')}
          title={t('nav.feedback')}
        >
          <MessageCircle className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0">
        {kind === null ? (
          // Trin 1: hvad vil du dele?
          <div className="flex flex-col gap-3 p-4">
            <p className="text-[13px] font-medium">{t('feedback.title')}</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setKind('issue')}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-border px-3 py-5 transition-colors hover:border-destructive/50 hover:bg-accent/50"
              >
                <TriangleAlert className="size-6 text-destructive" />
                <span className="mt-1 text-[15px] font-medium">{t('feedback.issue')}</span>
                <span className="text-xs text-muted-foreground">{t('feedback.issueSub')}</span>
              </button>
              <button
                type="button"
                onClick={() => setKind('idea')}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-border px-3 py-5 transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                <Lightbulb className="size-6 text-status-neutral" />
                <span className="mt-1 text-[15px] font-medium">{t('feedback.idea')}</span>
                <span className="text-xs text-muted-foreground">{t('feedback.ideaSub')}</span>
              </button>
            </div>
          </div>
        ) : (
          // Trin 2: skriv beskeden. Problem-varianten er rød hele vejen igennem.
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={t('feedback.back')}
                title={t('feedback.back')}
                onClick={reset}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <span className="text-[13px] font-medium">
                {isIssue ? t('feedback.issue') : t('feedback.idea')}
              </span>
            </div>

            <div className="p-3">
              <Textarea
                autoFocus
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={isIssue ? t('feedback.issuePlaceholder') : t('feedback.ideaPlaceholder')}
                className={cn(
                  'resize-none',
                  isIssue && 'border-destructive/60 focus-visible:border-destructive',
                )}
              />
              {shot && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{shot.name}</span>
                  <button
                    type="button"
                    aria-label={t('feedback.removeAttachment')}
                    title={t('feedback.removeAttachment')}
                    className="cursor-pointer rounded p-0.5 hover:bg-accent hover:text-foreground"
                    onClick={() => setShot(null)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 cursor-pointer"
                aria-label={t('feedback.attach')}
                title={t('feedback.attach')}
                onClick={() => fileRef.current?.click()}
              >
                <ImageIcon className="size-4" />
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setShot(file)
                  e.target.value = ''
                }}
              />
              <Button
                size="sm"
                variant={isIssue ? 'destructive' : 'default'}
                disabled={busy || !message.trim()}
                onClick={send}
              >
                {busy ? t('common.loading') : t('feedback.send')}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
