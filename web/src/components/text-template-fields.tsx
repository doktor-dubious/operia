import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Emne/indhold-editor til tekstskabeloner med indsæt-koder (Mustache-stil
// {{snake_case}}, samme format som {{link}} i invitationen — koderne
// erstattes ved afsendelse). Klik på en kode indsætter den ved markøren i
// det senest fokuserede felt. Delt mellem Operia → Skabeloner og
// Konfigurér → Skabeloner.

// Standardkoderne for pakke-notifikationer; skabeloner med andre koder (fx
// invitationens {{link}}) kan angives eksplicit.
const DEFAULT_TOKENS = ['company_name', 'recipient_name', 'reference', 'barcode', 'carrier', 'date']
const TEMPLATE_TOKENS: Record<string, string[]> = {
  customer_invite: ['link'],
}

export function tokensForTemplate(key: string): string[] {
  return TEMPLATE_TOKENS[key] ?? DEFAULT_TOKENS
}

export function TextTemplateFields({
  templateKey,
  title,
  body,
  onTitleChange,
  onBodyChange,
}: {
  templateKey: string
  title: string
  body: string
  onTitleChange: (v: string) => void
  onBodyChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // Koderne skal lande der hvor man sidst skrev — som udgangspunkt i brødteksten.
  const lastFocused = useRef<'title' | 'body'>('body')

  const insertToken = (token: string) => {
    const isTitle = lastFocused.current === 'title'
    const el = isTitle ? titleRef.current : bodyRef.current
    if (!el) return
    const text = `{{${token}}}`
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    if (isTitle) onTitleChange(next)
    else onBodyChange(next)
    // Fokus + markør tilbage efter den indsatte kode (efter re-render).
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('templatesPage.titleLabel')}</Label>
        <Input
          ref={titleRef}
          value={title}
          onFocus={() => (lastFocused.current = 'title')}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('templatesPage.bodyLabel')}</Label>
        <Textarea
          ref={bodyRef}
          value={body}
          rows={12}
          className="font-mono text-xs"
          onFocus={() => (lastFocused.current = 'body')}
          onChange={(e) => onBodyChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('templatesPage.insertCode')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {tokensForTemplate(templateKey).map((token) => (
            <button
              key={token}
              type="button"
              title={`{{${token}}}`}
              className="cursor-pointer rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              // onMouseDown i stedet for onClick: bevarer fokus/markør i feltet
              onMouseDown={(e) => {
                e.preventDefault()
                insertToken(token)
              }}
            >
              {t(`templateTokens.${token}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
