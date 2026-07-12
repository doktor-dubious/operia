import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { BritishFlag, DanishFlag } from '@/components/flags'
import { useCompany } from '@/components/company-provider'
import {
  LabelDesigner,
  parseLabelDesign,
  printTestLabel,
  type LabelDesign,
} from '@/components/label-designer'
import { TextTemplateFields } from '@/components/text-template-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Konfigurér → Skabeloner: virksomhedens skabeloner (pakkelabel + pakke-
// notifikationer). Platformens skabelon (platform_templates, kun
// company_editable) er standarden; gemmer man, lægges en virksomheds-udgave
// i company_templates, som vinder over platformens. Labels er sprogneutrale
// (lang='*'); tekstskabeloner overrides pr. sprog.
export const Route = createFileRoute('/_app/configure/templates')({
  component: TemplatesPage,
})

const LANGS = [
  { code: 'da', label: 'Dansk', Flag: DanishFlag },
  { code: 'en', label: 'English', Flag: BritishFlag },
]

function useCompanyTemplates(companyId: string | null) {
  return useQuery({
    queryKey: ['company-templates', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [platform, overrides] = await Promise.all([
        supabase
          .from('platform_templates')
          .select('key, lang, name, kind, title, body')
          .eq('company_editable', true)
          .order('name'),
        supabase
          .from('company_templates')
          .select('key, lang, title, body')
          .eq('company_id', companyId!),
      ])
      if (platform.error) throw platform.error
      if (overrides.error) throw overrides.error
      return { platform: platform.data, overrides: overrides.data }
    },
  })
}

function TemplatesPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { activeCompany } = useCompany()
  const { data, isPending } = useCompanyTemplates(companyId)
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [lang, setLang] = useState('da')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [design, setDesign] = useState<LabelDesign | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const rows = data?.platform ?? []
  // Distinkte skabeloner (én pr. key) til combo-boxen.
  const templates = [...new Map(rows.map((r) => [r.key, { name: r.name, kind: r.kind }])).entries()]
    .map(([key, v]) => ({ key, ...v }))
  const activeKey = selectedKey ?? templates[0]?.key ?? null
  const isLabel = templates.find((tp) => tp.key === activeKey)?.kind === 'label'
  // Labels ligger i én sprogneutral række ('*'); tekstskabeloner pr. sprog.
  const activeLang = isLabel ? '*' : lang
  const platformRow = rows.find((r) => r.key === activeKey && r.lang === activeLang) ?? null
  const override =
    data?.overrides.find((o) => o.key === activeKey && o.lang === activeLang) ?? null
  const savedTitle = override?.title ?? platformRow?.title ?? ''
  const savedBody = override?.body ?? platformRow?.body ?? null

  // Bevidst ikke afhængig af `lang` direkte: et sprogskifte på en label må
  // ikke nulstille utgemte designændringer; for tekstskabeloner skifter
  // savedTitle/savedBody alligevel med sproget.
  useEffect(() => {
    setTitle(savedTitle)
    setBody(savedBody ?? '')
    setDesign(isLabel && savedBody != null ? parseLabelDesign(savedBody) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, isLabel, savedTitle, savedBody])

  const dirty = isLabel
    ? !!design &&
      savedBody != null &&
      JSON.stringify(design) !== JSON.stringify(parseLabelDesign(savedBody))
    : !!activeKey && (title !== savedTitle || body !== (savedBody ?? ''))

  const save = async () => {
    if (!activeKey || !companyId) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_templates')
      .upsert({
        company_id: companyId,
        key: activeKey,
        lang: activeLang,
        kind: isLabel ? 'label' : 'text',
        title: isLabel ? '' : title,
        body: isLabel ? JSON.stringify(design) : body,
      })
      .select('key')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-templates', companyId] })
  }

  const cancel = () => {
    setTitle(savedTitle)
    setBody(savedBody ?? '')
    setDesign(isLabel && savedBody != null ? parseLabelDesign(savedBody) : null)
  }

  // Nulstil: slet virksomhedens udgave (for tekstskabeloner kun det valgte
  // sprog), så platformens standard gælder igen.
  const reset = async () => {
    if (!activeKey || !companyId) return
    const { data: deleted, error } = await supabase
      .from('company_templates')
      .delete()
      .eq('company_id', companyId)
      .eq('key', activeKey)
      .eq('lang', activeLang)
      .select('key')
    if (error || !deleted?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    setResetOpen(false)
    toast.success(t('configureConfig.resetToast'))
    queryClient.invalidateQueries({ queryKey: ['company-templates', companyId] })
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className={cn('mx-auto w-full py-6', isLabel ? 'max-w-5xl' : 'max-w-3xl')}>
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('nav.configureTemplates')}</h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('configureConfig.templatesSubtitle')}
          </p>
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

        {activeKey && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {override
                ? t('configureConfig.templateCustomized')
                : t('configureConfig.templateUsesDefault')}
            </p>
            {override && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setResetOpen(true)}
              >
                {t('configureConfig.resetToDefault')}
              </Button>
            )}
          </div>
        )}

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

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('configureConfig.resetTitle')}</DialogTitle>
            <DialogDescription>{t('configureConfig.resetDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              {t('configureConfig.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dirty && (
        // Fuld bredde: bryd ud af indholdskolonnen (sekundærmenu w-52 + gap-8
        // + main px-6 = 16.5rem til venstre).
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
