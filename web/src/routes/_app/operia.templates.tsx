import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { supabase } from '@/lib/supabase'

// Operia → Skabeloner: platform-admin redigerer platformens skabeloner. Øverst
// en combo-box der vælger skabelon; nedenfor Titel + Brødtekst med samme
// gem/annullér-bjælke som stamdata-siderne (fx locations) — fuld bredde,
// bundet til bunden med en topkant hele vejen over.
export const Route = createFileRoute('/_app/operia/templates')({
  component: TemplatesPage,
})

function useTemplates() {
  return useQuery({
    queryKey: ['platform-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_templates')
        .select('key, name, title, body')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function TemplatesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useTemplates()
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const templates = data ?? []
  const activeKey = selectedKey ?? templates[0]?.key ?? null
  const active = templates.find((tp) => tp.key === activeKey) ?? null

  // Indlæs felterne når den valgte skabelon skifter (eller data ankommer).
  useEffect(() => {
    if (active) {
      setTitle(active.title)
      setBody(active.body)
    }
  }, [active?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform-templates'] })

  const dirty = !!active && (title !== active.title || body !== active.body)

  const save = async () => {
    if (!active) return
    setSaving(true)
    const { data: updated, error } = await supabase
      .from('platform_templates')
      .update({ title, body })
      .eq('key', active.key)
      .select('key')
    setSaving(false)
    if (error || !updated?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    if (!active) return
    setTitle(active.title)
    setBody(active.body)
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('templatesPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('templatesPage.subtitle')}</p>
        </header>

        <div className="mb-6 flex flex-col gap-2">
          <Label className="text-label">{t('templatesPage.templateLabel')}</Label>
          <Select value={activeKey ?? undefined} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-full max-w-sm">
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

        {active && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('templatesPage.titleLabel')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('templatesPage.bodyLabel')}</Label>
              <Textarea
                value={body}
                rows={12}
                className="font-mono text-xs"
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
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
          <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}
