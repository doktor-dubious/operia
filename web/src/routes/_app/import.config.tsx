import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Lock, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCompanyContext } from '@/hooks/use-company-context'
import { IMPORT_CONFIG_DEFAULTS, useImportConfig } from '@/hooks/use-import-config'
import { supabase } from '@/lib/supabase'

// Import → Konfiguration: virksomhedens filformat for medarbejderimporten —
// header/footer, separator og de aktive kolonner i rækkefølge. employee_no
// (ID) og name er obligatoriske og kan ikke fjernes, men gerne flyttes.
export const Route = createFileRoute('/_app/import/config')({
  component: ImportConfigPage,
})

// Alle mulige kolonner; nøglerne matcher employees-tabellen.
const ALL_FIELDS = [
  'employee_no',
  'name',
  'initials',
  'email',
  'phone',
  'nfc_card_id',
  'role',
  'language',
  'department',
] as const

const REQUIRED_FIELDS = new Set(['employee_no', 'name'])

const DEFAULTS = {
  hasHeader: IMPORT_CONFIG_DEFAULTS.has_header,
  hasFooter: IMPORT_CONFIG_DEFAULTS.has_footer,
  separator: IMPORT_CONFIG_DEFAULTS.separator,
  fields: IMPORT_CONFIG_DEFAULTS.fields,
}

type Values = typeof DEFAULTS

function ImportConfigPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useImportConfig(companyId)
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Values | null>(null)
  const [saving, setSaving] = useState(false)

  const toValues = (): Values =>
    data
      ? {
          hasHeader: data.has_header,
          hasFooter: data.has_footer,
          separator: data.separator,
          fields: data.fields,
        }
      : DEFAULTS

  useEffect(() => {
    if (!isPending) setValues(toValues())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isPending])

  const initial = isPending ? null : toValues()
  const dirty = !!values && !!initial && JSON.stringify(values) !== JSON.stringify(initial)

  const save = async () => {
    if (!values || !companyId) return
    if (!values.separator) {
      toast.error(t('importConfig.separatorRequired'))
      return
    }
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('import_configs')
      .upsert({
        company_id: companyId,
        import_type: 'employees',
        has_header: values.hasHeader,
        has_footer: values.hasFooter,
        separator: values.separator,
        fields: values.fields,
      })
      .select('import_type')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['import-config', companyId] })
  }

  const cancel = () => setValues(toValues())

  const addField = (key: string) =>
    setValues((prev) => (prev ? { ...prev, fields: [...prev.fields, key] } : prev))

  const removeField = (key: string) =>
    setValues((prev) =>
      prev ? { ...prev, fields: prev.fields.filter((f) => f !== key) } : prev,
    )

  const moveField = (index: number, delta: -1 | 1) =>
    setValues((prev) => {
      if (!prev) return prev
      const target = index + delta
      if (target < 0 || target >= prev.fields.length) return prev
      const fields = [...prev.fields]
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
      return { ...prev, fields }
    })

  if (isPending || !values || !companyId) return <Skeleton className="h-40 w-full" />

  const inactive = ALL_FIELDS.filter((f) => !values.fields.includes(f))

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-medium text-foreground">{t('importConfig.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('importConfig.subtitle')}</p>
        </header>

        {/* Meta: header/footer/separator */}
        <div className="flex max-w-2xl flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-[13px] font-[450]">{t('importConfig.hasHeader')}</p>
              <p className="text-xs text-muted-foreground">{t('importConfig.hasHeaderHint')}</p>
            </div>
            <Switch
              checked={values.hasHeader}
              onCheckedChange={(v) => setValues({ ...values, hasHeader: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-[13px] font-[450]">{t('importConfig.hasFooter')}</p>
              <p className="text-xs text-muted-foreground">{t('importConfig.hasFooterHint')}</p>
            </div>
            <Switch
              checked={values.hasFooter}
              onCheckedChange={(v) => setValues({ ...values, hasFooter: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-[13px] font-[450]">{t('importConfig.separator')}</p>
              <p className="text-xs text-muted-foreground">{t('importConfig.separatorHint')}</p>
            </div>
            <Input
              value={values.separator}
              maxLength={3}
              className="w-20 text-center font-mono"
              onChange={(e) => setValues({ ...values, separator: e.target.value })}
            />
          </div>
        </div>

        {/* Felter: aktive (ordnede) og mulige */}
        <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('importConfig.activeFields')}</Label>
            <p className="text-xs text-muted-foreground">{t('importConfig.activeFieldsHint')}</p>
            <div className="flex flex-col gap-1.5">
              {values.fields.map((key, index) => {
                const required = REQUIRED_FIELDS.has(key)
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[13px]">
                      <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="truncate">{t(`importConfig.field_${key}`)}</span>
                      {required && (
                        <Lock
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label={t('importConfig.requiredField')}
                        />
                      )}
                    </span>
                    <span className="flex shrink-0 items-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 cursor-pointer"
                        disabled={index === 0}
                        aria-label={t('importConfig.moveUp')}
                        onClick={() => moveField(index, -1)}
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 cursor-pointer"
                        disabled={index === values.fields.length - 1}
                        aria-label={t('importConfig.moveDown')}
                        onClick={() => moveField(index, 1)}
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 cursor-pointer text-muted-foreground hover:text-destructive disabled:opacity-30"
                        disabled={required}
                        aria-label={t('importConfig.removeField')}
                        onClick={() => removeField(key)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('importConfig.potentialFields')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('importConfig.potentialFieldsHint')}
            </p>
            <div className="flex flex-col gap-1.5">
              {inactive.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {t('importConfig.noPotentialFields')}
                </p>
              ) : (
                inactive.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1.5"
                  >
                    <span className="truncate text-[13px] text-muted-foreground">
                      {t(`importConfig.field_${key}`)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 cursor-pointer"
                      aria-label={t('importConfig.addField')}
                      onClick={() => addField(key)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !values.separator}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}
