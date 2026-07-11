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
import { OperiaPage } from '@/components/operia-config-page'
import { supabase } from '@/lib/supabase'

// Operia → Skabeloner: platform-admin redigerer platformens skabeloner. Øverst
// en combo-box der vælger skabelon; nedenfor Titel + Brødtekst med samme
// gem/annullér-bjælke som stamdata-siderne (fx locations).
export const Route = createFileRoute('/_app/operia/templates')({
  component: TemplatesPage,
})

type Template = NonNullable<ReturnType<typeof useTemplates>['data']>[number]

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

function TemplateEditor({ template, refresh }: { template: Template; refresh: () => void }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(template.title)
  const [body, setBody] = useState(template.body)
  const [saving, setSaving] = useState(false)

  const dirty = title !== template.title || body !== template.body

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase
      .from('platform_templates')
      .update({ title, body })
      .eq('key', template.key)
      .select('key')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setTitle(template.title)
    setBody(template.body)
  }

  return (
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

      {dirty && (
        <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-border bg-background py-3">
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

function TemplatesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useTemplates()
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform-templates'] })

  // Nulstil valget hvis den valgte skabelon forsvinder.
  useEffect(() => {
    if (selectedKey && data && !data.some((tp) => tp.key === selectedKey)) setSelectedKey(null)
  }, [data, selectedKey])

  if (isPending) return <Skeleton className="h-40 w-full" />

  const templates = data ?? []
  const activeKey = selectedKey ?? templates[0]?.key ?? null
  const active = templates.find((tp) => tp.key === activeKey) ?? null

  return (
    <OperiaPage title={t('templatesPage.title')} subtitle={t('templatesPage.subtitle')}>
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
      {active && <TemplateEditor key={active.key} template={active} refresh={refresh} />}
    </OperiaPage>
  )
}
