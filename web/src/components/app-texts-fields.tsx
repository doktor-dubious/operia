import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import Papa from 'papaparse'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  extractPlaceholders,
  FLAT_BUNDLES,
  pageLabel,
  pageOptions,
  TEXT_CATEGORIES,
  textRows,
  type TextRow,
} from '@/lib/app-texts'
import { buildCsv, dateStamp, downloadCsv } from '@/lib/csv-export'
import { describeError } from '@/lib/errors'
import { fetchAllTextOverrides } from '@/lib/text-overrides'
import { LANG_OPTIONS } from '@/lib/languages'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Tekster-siden: tabel over alle grænsefladetekster med kolonnefiltre, plus en
// dialog pr. tekst hvor alle aktive sprog redigeres på én gang.
//
// To scopes, samme komponent:
//  - platform: Operia → Tekster. Redigerer DCA's standard for ALLE kunder.
//  - company:  Konfigurér → Tekster. Lægger kundens eget lag oven på platformens.
// Derfor er "standard" i kunde-scopet platformens tekst hvis den findes, ellers
// locale-filens — det er præcis hvad kunden ville se uden sin egen overstyring.

export type TextsScope = { kind: 'platform' } | { kind: 'company'; companyId: string }

const TRUNCATE = 120

// Repræsentanten for en plural-gruppe: flertalsformen er den man genkender.
function mainKey(row: TextRow) {
  return row.keys.find((k) => k.endsWith('_other')) ?? row.keys[0]
}

// Ental/flertal-etiket til dialogen — kun relevant for plurale grupper.
function variantLabel(key: string, base: string) {
  return key === base ? '' : key.slice(base.length + 1)
}

type ViewRow = {
  id: string
  source: TextRow
  category: string
  namespace: string
  keyText: string
  defaultText: string
  currentText: string
  modified: boolean
}

export function AppTextsEditor({ scope, langs }: { scope: TextsScope; langs: string[] }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const uiLang = i18n.language.slice(0, 2)
  const companyId = scope.kind === 'company' ? scope.companyId : null

  const [lang, setLang] = useState(() => (langs.includes(uiLang) ? uiLang : (langs[0] ?? 'da')))
  const [openRow, setOpenRow] = useState<TextRow | null>(null)
  const [bulkResetIds, setBulkResetIds] = useState<string[] | null>(null)

  // Alle sprog hentes på én gang: dialogen redigerer dem samtidig, og både
  // standard og overstyring er sprogafhængige.
  const { data, isPending } = useQuery({
    queryKey: ['app-text-overrides', companyId, 'all'],
    queryFn: () => fetchAllTextOverrides(companyId),
  })

  // Standardteksten set fra dette scope: platformlaget er kundens udgangspunkt.
  const baselineOf = (key: string, forLang: string) => {
    const fromBundle = FLAT_BUNDLES[forLang]?.[key] ?? FLAT_BUNDLES.da[key] ?? ''
    if (scope.kind === 'platform') return fromBundle
    return data?.[forLang]?.platformLayer[key] ?? fromBundle
  }

  // Den overstyring dette scope ejer (og altså kan gemme/nulstille).
  const ownOverride = (key: string, forLang: string) =>
    scope.kind === 'platform'
      ? data?.[forLang]?.platformLayer[key]
      : data?.[forLang]?.companyLayer[key]

  const rows: ViewRow[] = useMemo(() => {
    return textRows().map((source) => {
      const key = mainKey(source)
      const defaultText = baselineOf(key, lang)
      const override = ownOverride(key, lang)
      // "Ændret" gælder hele gruppen på det VISTE sprog — samme sprog som
      // Tekst-kolonnen, så status og tekst aldrig modsiger hinanden.
      const modified = source.keys.some((k) => ownOverride(k, lang) !== undefined)
      return {
        id: source.id,
        source,
        category: source.category,
        namespace: source.namespace,
        keyText: key,
        defaultText,
        currentText: override ?? defaultText,
        modified,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lang, scope.kind])

  const saveMutation = useMutation({
    mutationFn: async (entries: Record<string, Record<string, string | null>>) => {
      const { error } = await supabase.rpc('set_app_texts', {
        // null = platformlaget. De genererede typer kender ikke nullable
        // funktionsargumenter, derfor casten.
        p_company_id: companyId as unknown as string,
        p_platform: 'web',
        p_entries: entries,
      })
      if (error) throw error
    },
    onSuccess: () => {
      // Bredt præfiks: både denne side og app-skallens levende opslag.
      queryClient.invalidateQueries({ queryKey: ['app-text-overrides'] })
    },
  })

  const save = async (entries: Record<string, Record<string, string | null>>, message: string) => {
    try {
      await saveMutation.mutateAsync(entries)
      toast.success(message)
      return true
    } catch (error) {
      console.error('Kunne ikke gemme tekster:', error)
      toast.error(describeError(error, t))
      return false
    }
  }

  const resetRows = async (ids: string[]) => {
    const byId = new Map(textRows().map((r) => [r.id, r]))
    const entries: Record<string, Record<string, string | null>> = {}
    for (const id of ids) {
      const source = byId.get(id)
      if (!source) continue
      // Nulstil på tværs af ALLE sprog — ikke kun det viste. Ellers står der en
      // halv oversættelse tilbage som ingen kan se fra denne visning.
      for (const l of langs) {
        entries[l] ??= {}
        for (const key of source.keys) entries[l][key] = null
      }
    }
    return save(entries, t('textsPage.resetToast', { count: ids.length }))
  }

  const categoryOptions = TEXT_CATEGORIES.map((c) => ({
    value: c,
    label: t(`textsPage.category_${c}`),
  }))

  const columns: ColumnDef<ViewRow>[] = [
    {
      key: 'platform',
      header: t('textsPage.colPlatform'),
      className: 'w-24',
      sortable: true,
      sortValue: () => 'web',
      render: () => t('textsPage.platform_web'),
      filter: {
        valueOf: () => 'web',
        options: [
          { value: 'web', label: t('textsPage.platform_web') },
          // Håndterminalens tekster kompileres ind i APK'en og kræver et
          // opslagslag i Compose først — vises som "på vej", ikke skjult.
          { value: 'handheld', label: t('textsPage.platform_handheldSoon'), disabled: true },
        ],
      },
    },
    {
      key: 'category',
      header: t('textsPage.colCategory'),
      className: 'w-32',
      sortable: true,
      sortValue: (r) => t(`textsPage.category_${r.category}`),
      render: (r) => t(`textsPage.category_${r.category}`),
      filter: { valueOf: (r) => r.category, options: categoryOptions },
    },
    {
      key: 'page',
      header: t('textsPage.colPage'),
      className: 'w-40',
      sortable: true,
      sortValue: (r) => pageLabel(r.namespace, uiLang),
      render: (r) => pageLabel(r.namespace, uiLang),
      filter: {
        valueOf: (r) => r.namespace,
        options: pageOptions(uiLang),
        menuColumns: 4,
        searchable: true,
      },
    },
    {
      key: 'modified',
      header: t('textsPage.colStatus'),
      className: 'w-24',
      sortable: true,
      sortValue: (r) => (r.modified ? 1 : 0),
      render: (r) => (
        <span className={r.modified ? 'text-status-neutral' : 'text-muted-foreground'}>
          {t(r.modified ? 'textsPage.statusModified' : 'textsPage.statusDefault')}
        </span>
      ),
      filter: {
        valueOf: (r) => (r.modified ? 'modified' : 'default'),
        options: [
          { value: 'default', label: t('textsPage.statusDefault') },
          { value: 'modified', label: t('textsPage.statusModified') },
        ],
      },
    },
    {
      key: 'keyText',
      header: t('textsPage.colKey'),
      className: 'w-44',
      sortable: true,
      sortValue: (r) => r.keyText,
      render: (r) => (
        <span
          title={r.keyText}
          className="block max-w-44 truncate font-mono text-[11px] text-muted-foreground"
        >
          {r.keyText}
        </span>
      ),
    },
    {
      key: 'currentText',
      header: t('textsPage.colText'),
      sortable: true,
      sortValue: (r) => r.currentText,
      render: (r) => (
        // CSS-truncate holder kolonnen smal på en lille skærm; tegngrænsen
        // ovenfor forhindrer at en ekstremt lang streng bliver lagt i DOM'en.
        <span
          className={cn(
            'block max-w-[26rem] truncate',
            r.modified && 'font-medium text-foreground',
          )}
        >
          {r.currentText.length > TRUNCATE
            ? `${r.currentText.slice(0, TRUNCATE)}…`
            : r.currentText || '—'}
        </span>
      ),
    },
  ]

  // ── CSV: ét ark pr. sprog med nøgle, side, standard og overstyring ────────
  const exportCsv = () => {
    downloadCsv(
      `operia-tekster-${lang}-${dateStamp()}.csv`,
      buildCsv(
        { hasHeader: true, hasFooter: false, separator: ';', fields: ['key', 'page', 'default', 'override'] },
        (f) => ({ key: 'key', page: 'page', default: 'default', override: 'override' })[f] ?? f,
        rows.flatMap((r) =>
          r.source.keys.map((key) => ({
            key,
            page: pageLabel(r.namespace, uiLang),
            default: baselineOf(key, lang),
            override: ownOverride(key, lang) ?? '',
          })),
        ),
      ),
    )
  }

  const importCsv = async (file: File) => {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
      header: true,
      skipEmptyLines: true,
      delimiter: '',
    })
    const known = new Set(textRows().flatMap((r) => r.keys))
    const entries: Record<string, Record<string, string | null>> = { [lang]: {} }
    let matched = 0
    let skipped = 0
    for (const rec of parsed.data) {
      const key = rec.key?.trim()
      if (!key || !known.has(key)) {
        if (key) skipped++
        continue
      }
      const value = (rec.override ?? '').trim()
      // Pladsholdere skal overleve en tur gennem regnearket.
      const expected = extractPlaceholders(FLAT_BUNDLES.da[key] ?? '').join(',')
      if (value && extractPlaceholders(value).join(',') !== expected) {
        skipped++
        continue
      }
      entries[lang][key] = value || null
      matched++
    }
    if (matched === 0) {
      toast.error(t('textsPage.importNoRows'))
      return
    }
    const ok = await save(entries, t('textsPage.importToast', { count: matched, skipped }))
    if (ok && skipped > 0) toast.warning(t('textsPage.importSkipped', { count: skipped }))
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={rows}
        columns={columns}
        entityLabel={t('textsPage.entity')}
        searchText={(r) => `${r.keyText} ${r.defaultText} ${r.currentText}`}
        searchPlaceholder={t('textsPage.searchPlaceholder')}
        storageKey={`app-texts-${scope.kind}`}
        onRowClick={(r) => setOpenRow(r.source)}
        selectionMenuItems={[
          { label: t('textsPage.selectDefault'), select: (rs) => rs.filter((r) => !r.modified) },
          { label: t('textsPage.selectModified'), select: (rs) => rs.filter((r) => r.modified) },
        ]}
        selectionActions={({ ids }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setBulkResetIds(ids)}
          >
            <RotateCcw className="size-3.5" /> {t('textsPage.resetSelected')}
          </Button>
        )}
        toolbar={
          <div className="flex items-center gap-2">
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {langs.map((code) => (
                  <SelectItem key={code} value={code}>
                    {LANG_OPTIONS.find((l) => l.code === code)?.name ?? code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> {t('textsPage.exportCsv')}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="size-4" /> {t('textsPage.importCsv')}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void importCsv(file)
                  }}
                />
              </label>
            </Button>
          </div>
        }
      />

      {openRow && (
        <TextDialog
          key={openRow.id}
          row={openRow}
          langs={langs}
          baselineOf={baselineOf}
          overrideOf={ownOverride}
          scope={scope}
          saving={saveMutation.isPending}
          onClose={() => setOpenRow(null)}
          onSave={async (entries) => {
            const ok = await save(entries, t('textsPage.savedToast'))
            if (ok) setOpenRow(null)
          }}
          onReset={async () => {
            const ok = await resetRows([openRow.id])
            if (ok) setOpenRow(null)
          }}
        />
      )}

      <Dialog open={bulkResetIds !== null} onOpenChange={(open) => !open && setBulkResetIds(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('textsPage.resetTitle', { count: bulkResetIds?.length ?? 0 })}</DialogTitle>
            <DialogDescription>{t('textsPage.resetBulkDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkResetIds(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={saveMutation.isPending}
              onClick={async () => {
                if (bulkResetIds) await resetRows(bulkResetIds)
                setBulkResetIds(null)
              }}
            >
              {t('textsPage.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Redigeringsdialogen ───────────────────────────────────────────────────
// Alle aktive sprog redigeres samlet: den der omdøber "Modtag pakke" vil
// næsten altid rette "Receive parcel" i samme ombæring.
function TextDialog({
  row,
  langs,
  baselineOf,
  overrideOf,
  scope,
  saving,
  onClose,
  onSave,
  onReset,
}: {
  row: TextRow
  langs: string[]
  baselineOf: (key: string, lang: string) => string
  overrideOf: (key: string, lang: string) => string | undefined
  scope: TextsScope
  saving: boolean
  onClose: () => void
  onSave: (entries: Record<string, Record<string, string | null>>) => Promise<void>
  onReset: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const uiLang = i18n.language.slice(0, 2)

  // draft[lang][key] — starter på den nuværende overstyring (tom = brug standard).
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(() => {
    const out: Record<string, Record<string, string>> = {}
    for (const lang of langs) {
      out[lang] = {}
      for (const key of row.keys) out[lang][key] = overrideOf(key, lang) ?? ''
    }
    return out
  })
  const [confirmReset, setConfirmReset] = useState(false)
  // Nøglefeltet er readonly, så Radix' automatiske "fokusér første element"
  // ville parkere markøren et sted man ikke kan skrive. Vi peger i stedet på
  // det første tekstfelt.
  const firstFieldRef = useRef<HTMLTextAreaElement>(null)

  const hasOverride = langs.some((lang) =>
    row.keys.some((key) => overrideOf(key, lang) !== undefined),
  )

  // En overstyring skal bruge præcis de samme {{pladsholdere}} som standarden —
  // ellers render brugerfladen en halv sætning eller en rå {{count}}.
  const placeholderError = (key: string, value: string) => {
    if (!value.trim()) return null
    const expected = (row.placeholders[key] ?? []).join(',')
    const got = extractPlaceholders(value).join(',')
    if (expected === got) return null
    return t('textsPage.placeholderMismatch', {
      expected: (row.placeholders[key] ?? []).map((p) => `{{${p}}}`).join(' ') || '—',
    })
  }

  const errors = langs.flatMap((lang) =>
    row.keys.map((key) => placeholderError(key, draft[lang][key])).filter(Boolean),
  )

  const dirty = langs.some((lang) =>
    row.keys.some((key) => draft[lang][key].trim() !== (overrideOf(key, lang) ?? '')),
  )

  const submit = async () => {
    const entries: Record<string, Record<string, string | null>> = {}
    for (const lang of langs) {
      for (const key of row.keys) {
        const value = draft[lang][key].trim()
        const before = overrideOf(key, lang) ?? ''
        if (value === before) continue // rør kun de felter der faktisk ændrede sig
        entries[lang] ??= {}
        entries[lang][key] = value || null
      }
    }
    await onSave(entries)
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            firstFieldRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{pageLabel(row.namespace, uiLang)}</DialogTitle>
            <DialogDescription>
              {t(`textsPage.category_${row.category}`)} · {t('textsPage.platform_web')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">{t('textsPage.colKey')}</Label>
            <Input readOnly tabIndex={-1} value={row.id} className="font-mono text-xs" />
          </div>

          <div className="flex flex-col gap-5">
            {langs.map((lang, langIndex) => (
              <div key={lang} className="flex flex-col gap-3 rounded-md border p-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {LANG_OPTIONS.find((l) => l.code === lang)?.name ?? lang}
                </span>
                {row.keys.map((key, keyIndex) => {
                  const variant = variantLabel(key, row.id)
                  const error = placeholderError(key, draft[lang][key])
                  const isFirst = langIndex === 0 && keyIndex === 0
                  return (
                    <div key={key} className="flex flex-col gap-1.5">
                      {variant && (
                        <Label className="text-xs">
                          {t(`textsPage.plural_${variant}`, { defaultValue: variant })}
                        </Label>
                      )}
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">{t('textsPage.defaultLabel')}:</span>{' '}
                        {baselineOf(key, lang) || '—'}
                      </p>
                      <Textarea
                        ref={isFirst ? firstFieldRef : undefined}
                        rows={2}
                        value={draft[lang][key]}
                        placeholder={t('textsPage.overridePlaceholder')}
                        aria-invalid={!!error}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [lang]: { ...prev[lang], [key]: e.target.value },
                          }))
                        }
                      />
                      {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {scope.kind === 'company' && (
            <p className="text-xs text-muted-foreground">{t('textsPage.companyHint')}</p>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={!hasOverride || saving}
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw className="size-4" /> {t('textsPage.resetToDefault')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={!dirty || errors.length > 0 || saving} onClick={submit}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('textsPage.resetTitle', { count: 1 })}</DialogTitle>
            <DialogDescription>{t('textsPage.resetOneDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                setConfirmReset(false)
                await onReset()
              }}
            >
              {t('textsPage.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
