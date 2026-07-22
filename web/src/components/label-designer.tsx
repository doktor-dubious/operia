import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import JsBarcode from 'jsbarcode'
import { QRCodeSVG } from 'qrcode.react'
import { AlignCenter, AlignLeft, AlignRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCompany } from '@/components/company-provider'
import { cn } from '@/lib/utils'

// Label-designer (prototypens "Label templates"): venstre kolonne med
// opsætning (størrelse, stregkodekilde, felter) og højre kolonne med et
// live-design, hvor elementerne kan trækkes på plads. Klik (eller dobbelt-
// klik) på et element åbner dets indstillinger i venstre kolonne.
// Designet gemmes som JSON i platform_templates.body (kind='label').

export type LabelAlign = 'left' | 'center' | 'right'

export type LabelElementStyle = {
  x: number // % af labelbredden (ankerpunkt efter justering)
  y: number // % af labelhøjden (lodret centreret)
  fontSize: number // pt (ignoreres af stregkoden)
  bold: boolean
  align: LabelAlign
  width: number // kun stregkode/QR-kode: % af labelbredden
}

export type LabelDesign = {
  size: 'small' | 'large' | 'shipping' | 'custom'
  width: number // mm
  height: number // mm
  barcodeFrom: 'reference' | 'parcel'
  fields: string[] // aktiverede standardfelter
  elements: Record<string, Partial<LabelElementStyle>>
  customTexts: { id: string }[]
  // Layoutet er sprogneutralt; kun teksterne varierer pr. sprog:
  // texts[lang][element-id] — 'heading' er overskriften.
  texts: Record<string, Record<string, string>>
}

export const LABEL_SIZES: Record<string, { width: number; height: number }> = {
  small: { width: 62, height: 29 },
  large: { width: 62, height: 100 },
  shipping: { width: 100, height: 150 },
}

export const LABEL_FIELD_KEYS = [
  'heading',
  'department',
  'reference',
  'date',
  'recipientName',
  'barcode',
  'qrcode',
  'carrier',
  'companyName',
] as const

// Startplaceringer når et felt slås til — spredt så de ikke lander i én klump.
const DEFAULT_STYLES: Record<string, Partial<LabelElementStyle>> = {
  heading: { x: 50, y: 12, fontSize: 12, bold: true, align: 'center' },
  department: { x: 4, y: 30, fontSize: 8, align: 'left' },
  reference: { x: 50, y: 84, fontSize: 8, align: 'center' },
  date: { x: 96, y: 30, fontSize: 8, align: 'right' },
  recipientName: { x: 4, y: 55, fontSize: 10, bold: true, align: 'left' },
  barcode: { x: 50, y: 40, width: 70 },
  // QR er kvadratisk — bredden er sidelængden, så den holdes lille som standard.
  qrcode: { x: 82, y: 50, width: 26 },
  carrier: { x: 4, y: 70, fontSize: 8, align: 'left' },
  companyName: { x: 96, y: 92, fontSize: 7, align: 'right' },
}

const FALLBACK: LabelElementStyle = {
  x: 50,
  y: 50,
  fontSize: 9,
  bold: false,
  align: 'center',
  width: 70,
}

export const DEFAULT_LABEL_DESIGN: LabelDesign = {
  size: 'small',
  width: 62,
  height: 29,
  barcodeFrom: 'parcel',
  fields: ['reference', 'barcode'],
  elements: {
    barcode: { x: 50, y: 40, width: 70 },
    reference: { x: 50, y: 84, fontSize: 8, bold: false, align: 'center' },
  },
  customTexts: [],
  texts: { da: { heading: 'PAKKE' }, en: { heading: 'PACKAGE' } },
}

export function parseLabelDesign(body: string): LabelDesign {
  try {
    // Ældre gemte designs havde headingText + customTexts[].text direkte i
    // layoutet — løft dem ind i texts (da var det eneste redigerede sprog).
    const raw = JSON.parse(body) as Partial<LabelDesign> & {
      headingText?: string
      customTexts?: { id: string; text?: string }[]
    }
    const texts: LabelDesign['texts'] = raw.texts ?? {}
    if (!raw.texts) {
      const da: Record<string, string> = { ...texts.da }
      if (raw.headingText !== undefined) da.heading = raw.headingText
      for (const c of raw.customTexts ?? []) if (c.text !== undefined) da[c.id] = c.text
      texts.da = da
    }
    return {
      ...DEFAULT_LABEL_DESIGN,
      ...raw,
      elements: raw.elements ?? {},
      customTexts: (raw.customTexts ?? []).map(({ id }) => ({ id })),
      texts,
    }
  } catch {
    return DEFAULT_LABEL_DESIGN
  }
}

// Eksempeldata til designet og testlabelen. Virksomhedsnavnet kommer fra den
// aktive virksomhed (CompanySwitcheren), så designet ligner kundens label.
const SAMPLES: Record<string, string> = {
  department: 'Økonomi',
  reference: 'OPERIA-2026-000042',
  date: new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' }).format(new Date()),
  recipientName: 'Mette Jensen',
  carrier: 'GLS',
}

function barcodeSample(design: LabelDesign) {
  return design.barcodeFrom === 'reference' ? 'OPERIA-2026-000042' : '5701234567890'
}

// Sprogtekst med fald tilbage til et hvilket som helst andet sprog, så et
// element aldrig står tomt bare fordi oversættelsen mangler.
function textFor(design: LabelDesign, lang: string, id: string): string | undefined {
  const direct = design.texts[lang]?.[id]
  if (direct !== undefined && direct !== '') return direct
  for (const l of Object.keys(design.texts)) {
    const v = design.texts[l]?.[id]
    if (v !== undefined && v !== '') return v
  }
  return undefined
}

function elementText(
  design: LabelDesign,
  lang: string,
  id: string,
  companyName?: string | null,
): string {
  if (id === 'heading') return textFor(design, lang, 'heading') ?? 'PAKKE'
  if (id === 'companyName') return companyName ?? 'DCA Logic ApS'
  if (design.customTexts.some((c) => c.id === id)) return textFor(design, lang, id) ?? ''
  return SAMPLES[id] ?? id
}

function style(design: LabelDesign, id: string): LabelElementStyle {
  return { ...FALLBACK, ...DEFAULT_STYLES[id], ...design.elements[id] }
}

function BarcodeSvg({ value, className }: { value: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        displayValue: false,
        height: 36,
        margin: 0,
        background: 'transparent',
      })
    } catch (error) {
      console.error('Stregkoden kunne ikke tegnes:', error)
    }
  }, [value])
  return <svg ref={ref} className={className} />
}

// Justering afgør hvad x-ankeret peger på (venstre kant, midte, højre kant).
const alignTransform: Record<LabelAlign, string> = {
  left: 'translateY(-50%)',
  center: 'translate(-50%, -50%)',
  right: 'translate(-100%, -50%)',
}

export function LabelDesigner({
  design,
  lang,
  onChange,
}: {
  design: LabelDesign
  lang: string // sproget hvis tekster (heading/tekstfelter) redigeres
  onChange: (next: LabelDesign) => void
}) {
  const { t } = useTranslation()
  const { activeCompany } = useCompany()
  const [selected, setSelected] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)

  const activeIds = [...design.fields, ...design.customTexts.map((c) => c.id)]
  if (selected && !activeIds.includes(selected)) setSelected(null)

  const patchElement = (id: string, patch: Partial<LabelElementStyle>) =>
    onChange({
      ...design,
      elements: { ...design.elements, [id]: { ...design.elements[id], ...patch } },
    })

  // Tekster redigeres kun for det valgte sprog; layoutet er fælles.
  const patchText = (id: string, value: string) =>
    onChange({
      ...design,
      texts: { ...design.texts, [lang]: { ...design.texts[lang], [id]: value } },
    })

  const toggleField = (key: string, on: boolean) => {
    const fields = on ? [...design.fields, key] : design.fields.filter((f) => f !== key)
    onChange({ ...design, fields })
    if (!on && selected === key) setSelected(null)
  }

  const setSize = (size: LabelDesign['size']) => {
    const dims = LABEL_SIZES[size]
    onChange({ ...design, size, ...(dims ?? {}) })
  }

  const addTextField = () => {
    const id = `text-${Date.now()}`
    onChange({
      ...design,
      customTexts: [...design.customTexts, { id }],
      elements: { ...design.elements, [id]: { x: 50, y: 65, fontSize: 9, align: 'center' } },
      texts: {
        ...design.texts,
        [lang]: { ...design.texts[lang], [id]: t('labelDesigner.newTextDefault') },
      },
    })
    setSelected(id)
  }

  const removeCustomText = (id: string) => {
    const elements = { ...design.elements }
    delete elements[id]
    // Teksten fjernes i alle sprog — elementet findes ikke længere.
    const texts = Object.fromEntries(
      Object.entries(design.texts).map(([l, m]) => {
        const next = { ...m }
        delete next[id]
        return [l, next]
      }),
    )
    onChange({
      ...design,
      customTexts: design.customTexts.filter((c) => c.id !== id),
      elements,
      texts,
    })
    setSelected(null)
  }

  // Træk: pointer-events med capture; under 3 px bevægelse tolkes som klik
  // (vælg element). Dobbeltklik vælger også.
  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
  }

  const onPointerMove = (id: string) => (e: React.PointerEvent) => {
    const d = drag.current
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!d || d.id !== id || !rect) return
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 3 && !d.moved) return
    d.moved = true
    const el = style(design, id)
    const dx = ((e.clientX - d.startX) / rect.width) * 100
    const dy = ((e.clientY - d.startY) / rect.height) * 100
    d.startX = e.clientX
    d.startY = e.clientY
    patchElement(id, {
      x: Math.round(Math.min(100, Math.max(0, el.x + dx)) * 2) / 2,
      y: Math.round(Math.min(100, Math.max(0, el.y + dy)) * 2) / 2,
    })
  }

  const onPointerUp = (id: string) => () => {
    if (drag.current?.id === id && !drag.current.moved) setSelected(id)
    drag.current = null
  }

  const selectedStyle = selected ? style(design, selected) : null
  const selectedCustom = selected ? design.customTexts.find((c) => c.id === selected) : undefined

  const numberInput = (
    label: string,
    value: number,
    apply: (n: number) => void,
    step = 1,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label className="text-label">{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) apply(n)
        }}
      />
    </div>
  )

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* ── Opsætning ── */}
      <section className="flex flex-col gap-5">
        <h2 className="text-[13px] font-semibold">{t('labelDesigner.setup')}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-label">{t('labelDesigner.size')}</Label>
            <Select value={design.size} onValueChange={(v) => setSize(v as LabelDesign['size'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">{t('labelDesigner.sizeSmall')}</SelectItem>
                <SelectItem value="large">{t('labelDesigner.sizeLarge')}</SelectItem>
                <SelectItem value="shipping">{t('labelDesigner.sizeShipping')}</SelectItem>
                <SelectItem value="custom">{t('labelDesigner.sizeCustom')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-label">{t('labelDesigner.barcodeFrom')}</Label>
            <Select
              value={design.barcodeFrom}
              onValueChange={(v) => onChange({ ...design, barcodeFrom: v as 'reference' | 'parcel' })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reference">{t('labelDesigner.barcodeFromReference')}</SelectItem>
                <SelectItem value="parcel">{t('labelDesigner.barcodeFromParcel')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {design.size === 'custom' && (
          <div className="grid grid-cols-2 gap-4">
            {numberInput(t('labelDesigner.widthMm'), design.width, (n) =>
              onChange({ ...design, width: Math.max(10, n) }),
            )}
            {numberInput(t('labelDesigner.heightMm'), design.height, (n) =>
              onChange({ ...design, height: Math.max(10, n) }),
            )}
          </div>
        )}

        {design.fields.includes('heading') && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-label">{t('labelDesigner.headingText')}</Label>
            <Input
              value={design.texts[lang]?.heading ?? ''}
              onChange={(e) => patchText('heading', e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('labelDesigner.fieldsOnLabel')}</Label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {LABEL_FIELD_KEYS.map((key) => (
              <FieldLabel key={key} htmlFor={`label-field-${key}`} className="py-1 font-normal">
                <Checkbox
                  id={`label-field-${key}`}
                  checked={design.fields.includes(key)}
                  onCheckedChange={(v) => toggleField(key, v === true)}
                />
                {t(`labelDesigner.field_${key}`)}
              </FieldLabel>
            ))}
          </div>
        </div>

        <Button size="sm" variant="outline" className="self-start" onClick={addTextField}>
          <Plus className="size-4" /> {t('labelDesigner.addTextField')}
        </Button>

        {/* ── Indstillinger for valgt element ── */}
        <div className="rounded-md border p-4">
          {!selected || !selectedStyle ? (
            <p className="text-xs text-muted-foreground">{t('labelDesigner.clickToAdjust')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">
                  {selectedCustom
                    ? t('labelDesigner.customText')
                    : t(`labelDesigner.field_${selected}`)}
                </p>
                {selectedCustom && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-destructive hover:text-destructive"
                    onClick={() => removeCustomText(selected)}
                  >
                    <Trash2 className="size-3.5" /> {t('labelDesigner.removeElement')}
                  </Button>
                )}
              </div>

              {selectedCustom && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-label">{t('labelDesigner.textContent')}</Label>
                  <Input
                    value={design.texts[lang]?.[selected] ?? ''}
                    onChange={(e) => patchText(selected, e.target.value)}
                  />
                </div>
              )}

              {selected === 'barcode' || selected === 'qrcode' ? (
                <div className="grid grid-cols-3 gap-3">
                  {numberInput(
                    t(selected === 'qrcode' ? 'labelDesigner.qrWidth' : 'labelDesigner.barcodeWidth'),
                    selectedStyle.width,
                    (n) => patchElement(selected, { width: Math.min(100, Math.max(10, n)) }),
                  )}
                  {numberInput('X (%)', selectedStyle.x, (n) =>
                    patchElement(selected, { x: Math.min(100, Math.max(0, n)) }),
                  )}
                  {numberInput('Y (%)', selectedStyle.y, (n) =>
                    patchElement(selected, { y: Math.min(100, Math.max(0, n)) }),
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {numberInput(t('labelDesigner.fontSize'), selectedStyle.fontSize, (n) =>
                      patchElement(selected, { fontSize: Math.min(72, Math.max(4, n)) }),
                    )}
                    {numberInput('X (%)', selectedStyle.x, (n) =>
                      patchElement(selected, { x: Math.min(100, Math.max(0, n)) }),
                    )}
                    {numberInput('Y (%)', selectedStyle.y, (n) =>
                      patchElement(selected, { y: Math.min(100, Math.max(0, n)) }),
                    )}
                  </div>
                  <div className="flex items-end gap-6">
                    <FieldLabel htmlFor="label-el-bold" className="pb-1.5 font-normal">
                      <Checkbox
                        id="label-el-bold"
                        checked={selectedStyle.bold}
                        onCheckedChange={(v) => patchElement(selected, { bold: v === true })}
                      />
                      {t('labelDesigner.bold')}
                    </FieldLabel>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-label">{t('labelDesigner.alignment')}</Label>
                      <div className="flex gap-1">
                        {(
                          [
                            ['left', AlignLeft, t('labelDesigner.alignLeft')],
                            ['center', AlignCenter, t('labelDesigner.alignCenter')],
                            ['right', AlignRight, t('labelDesigner.alignRight')],
                          ] as const
                        ).map(([align, Icon, label]) => (
                          <Button
                            key={align}
                            size="icon"
                            variant={selectedStyle.align === align ? 'secondary' : 'ghost'}
                            className="h-7 w-7"
                            aria-label={label}
                            title={label}
                            onClick={() => patchElement(selected, { align })}
                          >
                            <Icon className="size-4" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Design ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">{t('labelDesigner.design')}</h2>
        <p className="text-xs text-muted-foreground">{t('labelDesigner.designHint')}</p>
        <div
          className="mt-2 flex items-center justify-center rounded-lg border p-6"
          style={{
            // Skaktern-baggrund som i prototypen
            backgroundImage:
              'linear-gradient(45deg, var(--border) 25%, transparent 25%), linear-gradient(-45deg, var(--border) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--border) 75%), linear-gradient(-45deg, transparent 75%, var(--border) 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          }}
        >
          <div
            ref={canvasRef}
            className="relative w-full select-none overflow-hidden bg-white text-black shadow-md"
            style={{
              aspectRatio: `${design.width} / ${design.height}`,
              maxWidth: design.width >= design.height ? 420 : 280,
            }}
            onPointerDown={() => setSelected(null)}
          >
            {activeIds.map((id) => {
              const el = style(design, id)
              const isBarcode = id === 'barcode'
              const isQr = id === 'qrcode'
              const isCode = isBarcode || isQr
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'absolute cursor-grab whitespace-nowrap rounded-sm px-0.5 outline-none active:cursor-grabbing',
                    selected === id && 'ring-2 ring-ring',
                  )}
                  style={{
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    transform: alignTransform[isCode ? 'center' : el.align],
                    fontSize: `${el.fontSize}pt`,
                    fontWeight: el.bold ? 700 : 400,
                    width: isCode ? `${el.width}%` : undefined,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onPointerDown(id)(e)
                  }}
                  onPointerMove={onPointerMove(id)}
                  onPointerUp={onPointerUp(id)}
                  onDoubleClick={() => setSelected(id)}
                >
                  {isBarcode ? (
                    <BarcodeSvg value={barcodeSample(design)} className="h-auto w-full" />
                  ) : isQr ? (
                    <QRCodeSVG
                      value={barcodeSample(design)}
                      marginSize={4}
                      bgColor="transparent"
                      className="h-auto w-full"
                    />
                  ) : (
                    elementText(design, lang, id, activeCompany?.name)
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

// Testlabel: åbner et printvindue i labelens fysiske mål (mm) med samme
// procent-positionering som designet.
export function printTestLabel(design: LabelDesign, lang: string, companyName?: string | null) {
  const win = window.open('', '_blank', 'width=600,height=400')
  if (!win) return

  const parts = [...design.fields, ...design.customTexts.map((c) => c.id)].map((id) => {
    const el = style(design, id)
    if (id === 'barcode') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      JsBarcode(svg, barcodeSample(design), {
        format: 'CODE128',
        displayValue: false,
        height: 36,
        margin: 0,
      })
      svg.setAttribute('style', 'width:100%;height:auto')
      return `<div style="position:absolute;left:${el.x}%;top:${el.y}%;width:${el.width}%;transform:${alignTransform.center}">${svg.outerHTML}</div>`
    }
    if (id === 'qrcode') {
      // Samme kilde som stregkoden — QR er blot en anden aftegning af koden.
      // marginSize=4 er QR-standardens "quiet zone" (4 moduler fri kant) —
      // uden den fejlaflæser scannere koden, når den står tæt på kant/tekst.
      const svg = renderToStaticMarkup(
        <QRCodeSVG value={barcodeSample(design)} marginSize={4} style={{ width: '100%', height: 'auto' }} />,
      )
      return `<div style="position:absolute;left:${el.x}%;top:${el.y}%;width:${el.width}%;transform:${alignTransform.center}">${svg}</div>`
    }
    const text = elementText(design, lang, id, companyName)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
    return `<div style="position:absolute;left:${el.x}%;top:${el.y}%;transform:${alignTransform[el.align]};font-size:${el.fontSize}pt;font-weight:${el.bold ? 700 : 400};white-space:nowrap">${text}</div>`
  })

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label</title>
<style>@page{size:${design.width}mm ${design.height}mm;margin:0}
html,body{margin:0;padding:0}
body{position:relative;width:${design.width}mm;height:${design.height}mm;font-family:Inter,Arial,sans-serif;overflow:hidden}</style>
</head><body>${parts.join('')}</body></html>`)
  win.document.close()
  win.addEventListener('load', () => win.print())
}
