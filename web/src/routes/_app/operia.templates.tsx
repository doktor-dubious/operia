import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BritishFlag, DanishFlag } from '@/components/flags'
import { useCompany } from '@/components/company-provider'
import { TextTemplateFields } from '@/components/text-template-fields'
import {
  LabelDesigner,
  parseLabelDesign,
  printTestLabel,
  type LabelDesign,
} from '@/components/label-designer'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Operia → Skabeloner: platform-admin redigerer platformens skabeloner pr.
// sprog. Combo-box vælger skabelon; sprogvælgeren til højre vælger sprog.
// Titel + Brødtekst redigeres med samme fuldbredde-gem/annullér-bjælke som
// stamdata-siderne (fx locations).
export const Route = createFileRoute('/_app/operia/templates')({
  component: TemplatesPage,
})

// Sprog skabelonerne kan laves i (matcher appens i18n: dansk først, engelsk).
const LANGS = [
  { code: 'da', label: 'Dansk', Flag: DanishFlag },
  { code: 'en', label: 'English', Flag: BritishFlag },
]

function useTemplates() {
  return useQuery({
    queryKey: ['platform-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_templates')
        .select('key, lang, name, kind, title, body')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function TemplatesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useTemplates()
  const { activeCompany } = useCompany()
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [lang, setLang] = useState('da')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [design, setDesign] = useState<LabelDesign | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = data ?? []
  // Distinkte skabeloner (én pr. key) til combo-boxen.
  const templates = [...new Map(rows.map((r) => [r.key, { name: r.name, kind: r.kind }])).entries()]
    .map(([key, v]) => ({ key, ...v }))
  const activeKey = selectedKey ?? templates[0]?.key ?? null
  // Label-skabeloner (fx pakkelabelen) redigeres i den grafiske designer;
  // body er designet som JSON. Layoutet er sprogneutralt og ligger i én
  // række (lang='*'); sprogvælgeren skifter kun designets tekster.
  const isLabel = templates.find((tp) => tp.key === activeKey)?.kind === 'label'
  const active =
    rows.find((r) => r.key === activeKey && r.lang === (isLabel ? '*' : lang)) ?? null

  // Indlæs felterne når valgt skabelon skifter (eller data ankommer).
  // Bevidst ikke afhængig af `lang`: label-rækken er sprogneutral ('*'), og
  // et sprogskifte må ikke nulstille utgemte designændringer. For tekst-
  // skabeloner skifter rækken (og dermed title/body) alligevel med sproget.
  useEffect(() => {
    setTitle(active?.title ?? '')
    setBody(active?.body ?? '')
    setDesign(active?.kind === 'label' ? parseLabelDesign(active.body) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, active?.kind, active?.title, active?.body])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform-templates'] })

  const dirty = isLabel
    ? !!design &&
      !!active &&
      JSON.stringify(design) !== JSON.stringify(parseLabelDesign(active.body))
    : !!activeKey && (title !== (active?.title ?? '') || body !== (active?.body ?? ''))

  const save = async () => {
    if (!activeKey) return
    const name = templates.find((tp) => tp.key === activeKey)?.name ?? activeKey
    setSaving(true)
    // Upsert på (key, lang): opretter oversættelsen hvis den mangler.
    const { data: saved, error } = await supabase
      .from('platform_templates')
      .upsert(
        isLabel
          ? { key: activeKey, lang: '*', name, kind: 'label', title: '', body: JSON.stringify(design) }
          : { key: activeKey, lang, name, title, body },
      )
      .select('key')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setTitle(active?.title ?? '')
    setBody(active?.body ?? '')
    setDesign(active?.kind === 'label' ? parseLabelDesign(active.body) : null)
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className={cn('mx-auto w-full py-6', isLabel ? 'max-w-5xl' : 'max-w-3xl')}>
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('templatesPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('templatesPage.subtitle')}</p>
        </header>

        <div className="mb-6 flex flex-wrap items-end gap-3 border-b border-border pb-6">
          <div className="flex flex-1 flex-col gap-2">
            <Label className="text-label">{t('templatesPage.templateLabel')}</Label>
            <Select value={activeKey ?? undefined} onValueChange={setSelectedKey}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tp) => (
                  <SelectItem key={tp.key} value={tp.key}>
                    {tp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('templatesPage.languageLabel')}</Label>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    <span className="flex items-center gap-2">
                      <l.Flag className="h-3.5 w-5" />
                      {l.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {activeKey && isLabel && design && (
          <div className="flex flex-col gap-5">
            <LabelDesigner design={design} lang={lang} onChange={setDesign} />
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => printTestLabel(design, lang, activeCompany?.name)}
            >
              {t('labelDesigner.printTest')}
            </Button>
          </div>
        )}
        {activeKey && !isLabel && (
          <TextTemplateFields
            templateKey={activeKey}
            title={title}
            body={body}
            onTitleChange={setTitle}
            onBodyChange={setBody}
          />
        )}
      </div>

      {dirty && (
        // Fuld bredde som på locations: bryd ud af indholdskolonnen til begge
        // hovedkanter. Venstre = sekundærmenu (w-52 = 13rem) + gap-8 (2rem) +
        // main px-6 (1.5rem) = 16.5rem; højre = main px-6.
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!isLabel && !title.trim())}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}
