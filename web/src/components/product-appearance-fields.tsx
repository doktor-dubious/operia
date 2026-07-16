import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Image as ImageIcon, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { ColorPicker } from '@/components/color-picker'
import type { Database } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { textSlotsFor, TEXT_LANGS, type TextSlot, type TextLang } from '@/lib/product-texts'

// Per-produkt udseende (white-labeling). Bruges to steder med samme UI:
// Konfigurér → Udseende (egen virksomhed) og Operia → Kunder → Udseende (valgt
// kunde). Hvert produkt listes med et badge (systemstandard/tilpasset) og to
// knapper: Design (denne popup) og Tekster (senere). Billeder uploades til
// 'company-logos'-bucket'en under {companyId}/appearance-…

type AppearanceRow = Database['public']['Tables']['product_appearance']['Row']
type Theme = 'light' | 'dark'

// Produkter der kan white-labeles (Operia-produktnøgler, i rækkefølge).
const PRODUCT_KEYS = ['parcels', 'booking', 'routes', 'shipping', 'assets', 'lager']

async function uploadAppearanceImage(
  companyId: string,
  prefix: string,
  file: File,
): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path = `${companyId}/appearance-${prefix}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true })
  if (error) return null
  return supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl
}

function useCatalog() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  return useQuery({
    queryKey: ['appearance-catalog', en],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_catalog')
        .select('key, name, name_en, sort_order')
        .in('key', PRODUCT_KEYS)
        .order('sort_order')
      if (error) throw error
      return data.map((p) => ({ key: p.key, name: (en && p.name_en) || p.name }))
    },
  })
}

function useAppearance(companyId: string) {
  return useQuery({
    queryKey: ['product-appearance', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_appearance')
        .select('*')
        .eq('company_id', companyId)
      if (error) throw error
      return new Map(data.map((r) => [r.product_key, r]))
    },
  })
}

// Tekst-overrides for hele virksomheden → Map<product_key, Map<text_key, value>>.
function useTextOverrides(companyId: string) {
  return useQuery({
    queryKey: ['product-text-overrides', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_text_override')
        .select('product_key, lang, text_key, value')
        .eq('company_id', companyId)
      if (error) throw error
      // product_key → lang → text_key → value
      const byProduct = new Map<string, Map<string, Map<string, string>>>()
      for (const r of data) {
        let byLang = byProduct.get(r.product_key)
        if (!byLang) byProduct.set(r.product_key, (byLang = new Map()))
        let m = byLang.get(r.lang)
        if (!m) byLang.set(r.lang, (m = new Map()))
        m.set(r.text_key, r.value)
      }
      return byProduct
    },
  })
}

// Antal overrides for et produkt på tværs af alle sprog (til badge/tælling).
function overrideCount(byLang: Map<string, Map<string, string>> | undefined): number {
  if (!byLang) return 0
  let n = 0
  for (const m of byLang.values()) n += m.size
  return n
}

function ImagePick({
  label,
  value,
  busy,
  onFile,
  onClear,
}: {
  label: string
  value: string | null
  busy: boolean
  onFile: (f: File) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-label">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {value ? (
            <img src={value} alt="" className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? t('common.loading') : t('appearance.pickImage')}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onClear}
          >
            {t('appearance.removeImage')}
          </Button>
        )}
      </div>
    </div>
  )
}

function DesignDialog({
  open,
  onOpenChange,
  companyId,
  product,
  appearance,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  companyId: string
  product: { key: string; name: string }
  appearance: AppearanceRow | null
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [headerName, setHeaderName] = useState('')
  const [headerColor, setHeaderColor] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('light')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [watermarkUrl, setWatermarkUrl] = useState<string | null>(null)
  const [busyLogo, setBusyLogo] = useState(false)
  const [busyWm, setBusyWm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setHeaderName(appearance?.header_name ?? product.name)
    setHeaderColor(appearance?.header_color ?? null)
    setTheme((appearance?.theme as Theme) ?? 'light')
    setLogoUrl(appearance?.logo_url ?? null)
    setWatermarkUrl(appearance?.watermark_url ?? null)
  }, [open, appearance, product.name])

  const pickImage = async (kind: 'header' | 'watermark', file: File) => {
    const setBusy = kind === 'header' ? setBusyLogo : setBusyWm
    setBusy(true)
    const url = await uploadAppearanceImage(companyId, `${product.key}-${kind}`, file)
    setBusy(false)
    if (!url) {
      toast.error(t('errors.uploadFailed'))
      return
    }
    if (kind === 'header') setLogoUrl(url)
    else setWatermarkUrl(url)
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('product_appearance').upsert(
      {
        company_id: companyId,
        product_key: product.key,
        header_name: headerName.trim() || null,
        header_color: headerColor,
        theme,
        logo_url: logoUrl,
        watermark_url: watermarkUrl,
      },
      { onConflict: 'company_id,product_key' },
    )
    setSaving(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('settings.saved'))
    onSaved()
    onOpenChange(false)
  }

  const reset = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('product_appearance')
      .delete()
      .eq('company_id', companyId)
      .eq('product_key', product.key)
    setSaving(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('appearance.resetDone'))
    onSaved()
    onOpenChange(false)
  }

  // Eksplicitte forhåndsvisnings-farver (uafhængige af appens aktuelle tema).
  const dark = theme === 'dark'
  const headerBg = headerColor ?? (dark ? '#1c1b1a' : '#f2f0e5')
  const headerFg = headerColor ? '#ffffff' : dark ? '#e6e4d9' : '#100f0f'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('appearance.designTitle', { name: product.name })}</DialogTitle>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border">
          <div
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ background: headerBg, color: headerFg }}
          >
            {logoUrl && <img src={logoUrl} alt="" className="h-5 w-auto object-contain" />}
            <span className="truncate">{headerName || product.name}</span>
          </div>
          <div
            className="relative flex h-16 items-center justify-center"
            style={{ background: dark ? '#131413' : '#ffffff', color: dark ? '#8a8a86' : '#6f6e69' }}
          >
            {watermarkUrl && (
              <img
                src={watermarkUrl}
                alt=""
                className="absolute inset-0 size-full object-contain opacity-10"
              />
            )}
            <span className="relative text-xs">{t('appearance.previewBody')}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('appearance.headerName')}</Label>
          <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('appearance.headerColor')}</Label>
          <ColorPicker value={headerColor} onChange={setHeaderColor} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('appearance.theme')}</Label>
          <RadioGroup
            value={theme}
            onValueChange={(v) => setTheme(v as Theme)}
            className="flex gap-2"
          >
            {(['light', 'dark'] as const).map((th) => (
              <label
                key={th}
                htmlFor={`theme-${th}`}
                className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-accent/40"
              >
                <RadioGroupItem value={th} id={`theme-${th}`} />
                {t(th === 'light' ? 'appearance.themeLight' : 'appearance.themeDark')}
              </label>
            ))}
          </RadioGroup>
        </div>
        <ImagePick
          label={t('appearance.logo')}
          value={logoUrl}
          busy={busyLogo}
          onFile={(f) => pickImage('header', f)}
          onClear={() => setLogoUrl(null)}
        />
        <ImagePick
          label={t('appearance.watermark')}
          value={watermarkUrl}
          busy={busyWm}
          onFile={(f) => pickImage('watermark', f)}
          onClear={() => setWatermarkUrl(null)}
        />

        <DialogFooter className="sm:justify-between">
          {appearance ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={reset}
              disabled={saving}
            >
              {t('appearance.reset')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={saving || busyLogo || busyWm}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TextsDialog({
  open,
  onOpenChange,
  companyId,
  product,
  slots,
  overrides,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  companyId: string
  product: { key: string; name: string }
  slots: TextSlot[]
  // lang → text_key → value
  overrides: Map<string, Map<string, string>> | null
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const initialLang: TextLang = (TEXT_LANGS as readonly string[]).includes(i18n.language)
    ? (i18n.language as TextLang)
    : 'da'
  const [lang, setLang] = useState<TextLang>(initialLang)
  // values[lang][text_key] — redigeres pr. sprog; alle sprog gemmes samlet.
  const [values, setValues] = useState<Record<TextLang, Record<string, string>>>({
    da: {},
    en: {},
  })
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const init = { da: {}, en: {} } as Record<TextLang, Record<string, string>>
    for (const l of TEXT_LANGS) {
      const m = overrides?.get(l)
      for (const s of slots) init[l][s.key] = m?.get(s.key) ?? ''
    }
    setValues(init)
    setLang(initialLang)
    setQuery('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slots, overrides])

  // Filtrér + gruppér de synlige slots (efter det aktuelle sprogs standardtekst).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: { group: string; items: TextSlot[] }[] = []
    for (const s of slots) {
      const label = s.defaults[lang]
      const group = s.group[lang]
      if (q && !label.toLowerCase().includes(q) && !group.toLowerCase().includes(q)) continue
      let g = out[out.length - 1]
      if (!g || g.group !== group) out.push((g = { group, items: [] }))
      g.items.push(s)
    }
    return out
  }, [slots, query, lang])

  const langCount = (l: TextLang) =>
    slots.filter((s) => (values[l]?.[s.key] ?? '').trim() !== '').length

  const save = async () => {
    setSaving(true)
    // Kun udfyldte felter gemmes, pr. sprog. Fuld erstatning + én revisionspost
    // sker server-side i replace_product_texts (SECURITY DEFINER, atomisk).
    const payload: Record<string, Record<string, string>> = {}
    for (const l of TEXT_LANGS) {
      const lv: Record<string, string> = {}
      for (const s of slots) {
        const v = (values[l]?.[s.key] ?? '').trim()
        if (v) lv[s.key] = v
      }
      if (Object.keys(lv).length) payload[l] = lv
    }
    const { error } = await supabase.rpc('replace_product_texts', {
      p_company_id: companyId,
      p_product_key: product.key,
      p_overrides: payload,
    })
    setSaving(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('settings.saved'))
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('appearance.textsTitle', { name: product.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('appearance.textsHint')}</p>

        <div className="flex items-center gap-2">
          {/* Sprogvælger — overstyr standarden separat pr. sprog. */}
          <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
            {TEXT_LANGS.map((l) => {
              const n = langCount(l)
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={cn(
                    'rounded px-2.5 py-1 uppercase transition-colors',
                    lang === l ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {l}
                  {n > 0 && <span className="ml-1 text-[10px] text-primary">{n}</span>}
                </button>
              )
            })}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('appearance.textsSearch')}
              className="h-8 pl-8"
            />
          </div>
        </div>

        <div className="-mr-2 flex-1 space-y-4 overflow-y-auto pr-2">
          {groups.map((g) => (
            <div key={g.group} className="space-y-1.5">
              <p className="text-label sticky top-0 bg-background/95 py-1 uppercase text-muted-foreground">
                {g.group}
              </p>
              {g.items.map((s) => (
                <div key={s.key} className="grid grid-cols-[10rem_1fr] items-center gap-3">
                  <Label className="truncate text-[13px] font-normal" title={s.defaults[lang]}>
                    {s.defaults[lang]}
                  </Label>
                  <Input
                    value={values[lang]?.[s.key] ?? ''}
                    placeholder={s.defaults[lang]}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [lang]: { ...v[lang], [s.key]: e.target.value },
                      }))
                    }
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          ))}
          {!groups.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('appearance.textsNoResults')}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">
            {t('appearance.textsCount', { count: langCount(lang) })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ProductAppearanceList({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: catalog, isPending: catPending } = useCatalog()
  const { data: appearanceMap, isPending: appPending } = useAppearance(companyId)
  const { data: textMap, isPending: txtPending } = useTextOverrides(companyId)
  const [designKey, setDesignKey] = useState<string | null>(null)
  const [textsKey, setTextsKey] = useState<string | null>(null)

  if (catPending || appPending || txtPending) return <Skeleton className="h-40 w-full" />

  const products = catalog ?? []
  const designProduct = products.find((p) => p.key === designKey) ?? null
  const designAppearance = designKey ? (appearanceMap?.get(designKey) ?? null) : null
  const textsProduct = products.find((p) => p.key === textsKey) ?? null
  const refreshAppearance = () =>
    queryClient.invalidateQueries({ queryKey: ['product-appearance', companyId] })
  const refreshTexts = () =>
    queryClient.invalidateQueries({ queryKey: ['product-text-overrides', companyId] })

  return (
    <div className="flex max-w-3xl flex-col gap-2">
      {products.map((p) => {
        const slots = textSlotsFor(p.key)
        const hasTextOverrides = overrideCount(textMap?.get(p.key)) > 0
        const custom = appearanceMap?.has(p.key) || hasTextOverrides
        return (
          <div
            key={p.key}
            className="flex items-center justify-between gap-3 rounded-md border px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium">{p.name}</span>
              <Badge variant={custom ? 'default' : 'secondary'} className="font-normal">
                {custom ? t('appearance.customized') : t('appearance.default')}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setDesignKey(p.key)}>
                {t('appearance.design')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!slots.length}
                title={slots.length ? undefined : t('appearance.textsNone')}
                onClick={() => setTextsKey(p.key)}
              >
                {t('appearance.texts')}
              </Button>
            </div>
          </div>
        )
      })}
      {!products.length && <p className="text-sm text-muted-foreground">—</p>}

      {designProduct && (
        <DesignDialog
          open={!!designKey}
          onOpenChange={(o) => !o && setDesignKey(null)}
          companyId={companyId}
          product={designProduct}
          appearance={designAppearance}
          onSaved={refreshAppearance}
        />
      )}

      {textsProduct && (
        <TextsDialog
          open={!!textsKey}
          onOpenChange={(o) => !o && setTextsKey(null)}
          companyId={companyId}
          product={textsProduct}
          slots={textSlotsFor(textsProduct.key)}
          overrides={textMap?.get(textsProduct.key) ?? null}
          onSaved={refreshTexts}
        />
      )}
    </div>
  )
}
