import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Plus, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { ColorPicker } from '@/components/color-picker'
import { DesignImageField, ToggleSection } from '@/components/design-editor-fields'
import { DetailTabs } from '@/components/detail-tabs'
import {
  DEFAULT_HANDHELD_DESIGN,
  HANDHELD_ICONS,
  HANDHELD_ICON_THEMES,
  HANDHELD_TILE_BY_KEY,
  mergeVisibleOrder,
  tileEnabled,
  tileIcon,
  tileSubtitleShown,
  tileTitleShown,
  type HandheldDesign,
  type HandheldIconTheme,
  type HandheldTile,
  type HandheldTileItem,
} from '@/lib/handheld-tiles'
import { MATERIAL_ICON_PATHS } from '@/lib/material-icon-paths'
import { cn } from '@/lib/utils'

// Handheld-design-editor: indholdselementer (velkomsttitel/undertitel/logo/hero
// + ikon-tema) og per-flise-udseende, vist på en mock-up af Android-håndter-
// minalens startskærm. Modstykket til HomeDesignEditor, men handheld'ens fliser
// er et fast, feature-gatet katalog — der kan hverken tilføjes eller flyttes
// fliser, kun ændres udseende.

// Håndterminalens egne farver (android/…/ui/Theme.kt) — mock-up'en skal ligne
// enheden, ikke webappens tema, så de er hardcodede her med vilje. Ændres de i
// appen, skal de også ændres her.
const HH = {
  bg: '#0B1220',
  panel: '#16213A',
  line: '#293752',
  txt: '#EEF3FC',
  muted: '#8FA2C4',
}

const sameTile = (a: HandheldTileItem, b: HandheldTileItem) =>
  a.key === b.key &&
  (a.enabled ?? true) === (b.enabled ?? true) &&
  (a.title ?? '') === (b.title ?? '') &&
  (a.titleEnabled ?? true) === (b.titleEnabled ?? true) &&
  (a.subtitle ?? '') === (b.subtitle ?? '') &&
  (a.subtitleEnabled ?? true) === (b.subtitleEnabled ?? true) &&
  (a.icon ?? '') === (b.icon ?? '') &&
  (a.color ?? '') === (b.color ?? '') &&
  (a.background ?? '') === (b.background ?? '')
const sameTiles = (a: HandheldTileItem[], b: HandheldTileItem[]) =>
  a.length === b.length && a.every((t, i) => sameTile(t, b[i]))
const sameDesign = (a: HandheldDesign, b: HandheldDesign) =>
  (Object.keys(DEFAULT_HANDHELD_DESIGN) as (keyof HandheldDesign)[]).every((k) => a[k] === b[k])

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>
)

// Ét flise-ikon, tegnet som HANDHELD'EN tegner det — mock-up'en skal vise
// enheden, ikke webbens eget ikonsprog:
//   happy   — emoji
//   desktop — lucide (skrivebordsappens ikoner; på enheden tegnet fra vektorer
//             genereret ud fra netop denne lucide-pakke)
//   outline/solid/mono — Material, Androids eget sæt. Derfor tegnes de fra
//             MATERIAL_ICON_PATHS og ikke fra lucide: gjorde vi det med lucide,
//             ville forhåndsvisningen vise noget andet end enheden.
function MaterialGlyph({
  iconKey,
  variant,
  size,
  color,
}: {
  iconKey: string
  variant: 'outlined' | 'filled'
  size: number
  color: string
}) {
  const paths = MATERIAL_ICON_PATHS[iconKey]
  if (!paths) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d={paths[variant]} />
    </svg>
  )
}

function TileIcon({
  item,
  tile,
  theme,
  size,
}: {
  item: HandheldTileItem
  tile: HandheldTile
  theme: HandheldIconTheme
  size: number
}) {
  const chosen = tileIcon(item, tile)
  const accent = item.color?.trim()

  if (theme === 'happy') {
    return (
      <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
        {chosen.emoji}
      </span>
    )
  }

  const color = theme === 'mono' ? accent || HH.muted : accent || HH.txt

  // Skrivebordets egne ikoner: lucide, tegnet direkte af komponenten.
  if (theme === 'desktop') {
    const Icon = chosen.icon
    return <Icon size={size} strokeWidth={2} color={color} />
  }

  if (theme === 'solid') {
    return (
      <span
        className="flex items-center justify-center rounded-[10px]"
        style={{ width: size, height: size, background: accent || HH.line }}
      >
        <MaterialGlyph iconKey={chosen.key} variant="filled" size={size * 0.58} color={HH.txt} />
      </span>
    )
  }
  return <MaterialGlyph iconKey={chosen.key} variant="outlined" size={size} color={color} />
}

// Per-flise-konfiguration (popup): titel og undertitel (hver med til/fra),
// ikon, farve og baggrundsfarve. Ændringer anvendes live på mock-up'en;
// gem/annullér-bjælken persisterer dem.
function HandheldTileDialog({
  item,
  tile,
  theme,
  onPatch,
  onClose,
}: {
  item: HandheldTileItem
  tile: HandheldTile
  theme: HandheldIconTheme
  onPatch: (patch: Partial<HandheldTileItem>) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const defaultTitle = t(`handheldDesignPage.${tile.labelKey}`)
  const defaultSub = t(`handheldDesignPage.${tile.subKey}`)
  const titleEnabled = tileTitleShown(item)
  const subtitleEnabled = tileSubtitleShown(item)
  const activeIcon = tileIcon(item, tile)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('handheldDesignPage.configureTile', { name: defaultTitle })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {/* Titel */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('handheldDesignPage.tileTitle')}</Label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={titleEnabled}
                  onCheckedChange={(v) => onPatch({ titleEnabled: v === true })}
                />
                {t('handheldDesignPage.tileEnabled')}
              </label>
            </div>
            <Input
              value={item.title ?? ''}
              placeholder={defaultTitle}
              disabled={!titleEnabled}
              onChange={(e) => onPatch({ title: e.target.value })}
            />
          </div>

          {/* Undertitel */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('handheldDesignPage.tileSubtitle')}</Label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={subtitleEnabled}
                  onCheckedChange={(v) => onPatch({ subtitleEnabled: v === true })}
                />
                {t('handheldDesignPage.tileEnabled')}
              </label>
            </div>
            <Input
              value={item.subtitle ?? ''}
              placeholder={defaultSub}
              disabled={!subtitleEnabled}
              onChange={(e) => onPatch({ subtitle: e.target.value })}
            />
          </div>

          {/* Ikon */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('handheldDesignPage.tileIcon')}</Label>
              {item.icon && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => onPatch({ icon: undefined })}
                >
                  {t('handheldDesignPage.resetIcon')}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {HANDHELD_ICONS.map((ic) => {
                const Icon = ic.icon
                const selected = ic.key === activeIcon.key
                return (
                  <button
                    key={ic.key}
                    type="button"
                    title={ic.key}
                    aria-label={ic.key}
                    aria-pressed={selected}
                    onClick={() => onPatch({ icon: ic.key })}
                    className={cn(
                      'flex aspect-square cursor-pointer items-center justify-center rounded-md border transition-colors hover:bg-accent/60',
                      selected ? 'border-primary bg-accent/40' : 'border-border',
                    )}
                  >
                    {/* Vælgeren viser ikonet som det valgte tema tegner det —
                        ellers ville man vælge ét ikon og få et andet at se. */}
                    {theme === 'happy' ? (
                      <span className="text-lg leading-none">{ic.emoji}</span>
                    ) : theme === 'desktop' ? (
                      <Icon className="size-4" strokeWidth={2} />
                    ) : (
                      <MaterialGlyph
                        iconKey={ic.key}
                        variant={theme === 'solid' ? 'filled' : 'outlined'}
                        size={16}
                        color="currentColor"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Farve (ikon/accent) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('handheldDesignPage.tileColor')}</Label>
              {item.color && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => onPatch({ color: undefined })}
                >
                  {t('handheldDesignPage.resetColor')}
                </Button>
              )}
            </div>
            <ColorPicker value={item.color ?? null} onChange={(v) => onPatch({ color: v })} />
            {theme === 'happy' && (
              <p className="text-xs text-muted-foreground">
                {t('handheldDesignPage.colorEmojiHint')}
              </p>
            )}
          </div>

          {/* Baggrundsfarve */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('handheldDesignPage.tileBackground')}</Label>
              {item.background && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => onPatch({ background: undefined })}
                >
                  {t('handheldDesignPage.resetColor')}
                </Button>
              )}
            </div>
            <ColorPicker
              value={item.background ?? null}
              onChange={(v) => onPatch({ background: v })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            {t('handheldDesignPage.tileDone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Håndterminalens flisegitter: to kolonner, ens fliser. Målene er mock-up'ens,
// ikke enhedens — de skal blot give samme proportioner som appen.
const COLS = 2
const TILE_W = 142
const TILE_H = 118
const TILE_GAP = 12
const STEP_X = TILE_W + TILE_GAP
const STEP_Y = TILE_H + TILE_GAP

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

// Mock-up af håndterminalens startskærm: statuslinje, brandbjælke, hilsen +
// indholdselementer, fliserne to og to, og "Log ud". Hver flise har et
// tandhjul, der åbner dens konfiguration, og kan trækkes for at ombytte
// rækkefølgen (rækkefølgen er den, appen viser fliserne i).
function HandheldPreview({
  tiles,
  design,
  onConfigure,
  onReorder,
  onRemove,
}: {
  // Kun de viste fliser — mock-up'en er hvad enheden viser, så fjernede
  // fliser hører ikke til her. Rækkefølgen her er de viste flisers indbyrdes
  // rækkefølge; forælderen fletter den tilbage i den fulde liste.
  tiles: HandheldTileItem[]
  design: HandheldDesign
  onConfigure: (key: string) => void
  onReorder: (next: HandheldTileItem[]) => void
  onRemove: (key: string) => void
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HandheldTileItem[]>(tiles)
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

  tilesRef.current = tiles

  // Træk: flyt den trukne flise hen på den nærmeste gitterplads og skub de
  // øvrige på plads (splice — ikke ombytning), så rækkefølgen følger med
  // musen. Selve positionen animeres af motion.
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current
      const container = containerRef.current
      if (!drag || !container) return
      const rect = container.getBoundingClientRect()
      const gx = e.clientX - rect.left - drag.offsetX
      const gy = e.clientY - rect.top - drag.offsetY
      setDragPos({ x: gx, y: gy })

      const list = tilesRef.current
      const from = list.findIndex((o) => o.key === drag.key)
      if (from < 0) return
      const col = clamp(Math.round(gx / STEP_X), 0, COLS - 1)
      const row = Math.max(0, Math.round(gy / STEP_Y))
      const to = clamp(row * COLS + col, 0, list.length - 1)
      if (to === from) return
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      tilesRef.current = next
      onReorder(next)
    },
    [onReorder],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    setDraggingKey(null)
    setDragPos(null)
  }, [])

  useEffect(() => {
    if (!draggingKey) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
    }
  }, [draggingKey, onPointerMove, endDrag])

  const onTilePointerDown = (key: string, e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const tileRect = e.currentTarget.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    dragRef.current = {
      key,
      offsetX: e.clientX - tileRect.left,
      offsetY: e.clientY - tileRect.top,
    }
    setDraggingKey(key)
    setDragPos({ x: tileRect.left - containerRect.left, y: tileRect.top - containerRect.top })
  }

  const gridRows = Math.max(1, Math.ceil(tiles.length / COLS))

  return (
    <div
      className="w-[340px] shrink-0 overflow-hidden rounded-[28px] border-[6px] shadow-xl"
      style={{ borderColor: '#0a0a0a', background: HH.bg }}
    >
      {/* Statuslinje + brandbjælke */}
      <div style={{ background: HH.panel, borderBottom: `1px solid ${HH.line}` }}>
        <div
          className="flex items-center justify-between px-4 pb-1 pt-2 text-[10px]"
          style={{ color: HH.muted }}
        >
          <span>2:18</span>
          <span className="size-2.5 rounded-full" style={{ background: '#0a0a0a' }} />
          <span>▲ ▮</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-3">
          {design.logoEnabled && design.logoUrl && (
            <img src={design.logoUrl} alt="" className="max-h-5 max-w-[80px] object-contain" />
          )}
          <span className="text-[15px] font-extrabold" style={{ color: HH.txt }}>
            {t('handheldDesignPage.previewBrand')}
          </span>
        </div>
      </div>

      <div className="p-4">
        {design.heroEnabled && design.heroUrl && (
          <div className="mb-3 h-20 overflow-hidden rounded-xl">
            <img src={design.heroUrl} alt="" className="size-full object-cover" />
          </div>
        )}

        {/* Hilsen: undertitel over navnet, som på enheden */}
        {design.subtitleEnabled && (
          <p className="text-[12px]" style={{ color: HH.muted }}>
            {design.subtitle.trim() || t('handheldDesignPage.previewGreeting')}
          </p>
        )}
        {/* Slået fra (eller tom) ⇒ standardnavnet — som på enheden. */}
        <p className="text-[19px] font-extrabold" style={{ color: HH.txt }}>
          {(design.welcomeTitleEnabled && design.welcomeTitle.trim()) ||
            t('handheldDesignPage.previewName')}
        </p>

        {/* Fliserne — absolut placeret på et 2-kolonners gitter, så de kan
            trækkes rundt og animere på plads. */}
        <div
          ref={containerRef}
          className="relative mt-4 select-none"
          style={{
            width: COLS * STEP_X - TILE_GAP,
            height: gridRows * STEP_Y - TILE_GAP,
            touchAction: 'none',
          }}
        >
          {tiles.map((item, i) => {
            const tile = HANDHELD_TILE_BY_KEY[item.key]
            if (!tile) return null
            const title = item.title?.trim() || t(`handheldDesignPage.${tile.labelKey}`)
            const sub = item.subtitle?.trim() || t(`handheldDesignPage.${tile.subKey}`)
            const isDragging = draggingKey === item.key
            const pos =
              isDragging && dragPos
                ? dragPos
                : { x: (i % COLS) * STEP_X, y: Math.floor(i / COLS) * STEP_Y }
            return (
              <motion.div
                key={item.key}
                initial={false}
                animate={{ x: pos.x, y: pos.y }}
                transition={
                  isDragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }
                }
                onPointerDown={(e) => onTilePointerDown(item.key, e)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: TILE_W,
                  height: TILE_H,
                  borderColor: HH.line,
                  background: item.background?.trim() || HH.panel,
                }}
                className={cn(
                  'flex touch-none flex-col justify-center rounded-2xl border p-3.5',
                  isDragging ? 'z-50 cursor-grabbing opacity-95 shadow-xl' : 'z-[1] cursor-grab',
                )}
              >
                <button
                  type="button"
                  aria-label={t('handheldDesignPage.configureTileAria', { name: title })}
                  title={t('handheldDesignPage.configureTileAria', { name: title })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onConfigure(item.key)}
                  className="absolute right-8 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <Settings2 size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t('handheldDesignPage.removeTileAria', { name: title })}
                  title={t('handheldDesignPage.removeTileAria', { name: title })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemove(item.key)}
                  className="absolute right-1.5 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-destructive/80 hover:text-white"
                >
                  <X size={14} />
                </button>
                <TileIcon item={item} tile={tile} theme={design.iconTheme} size={32} />
                {tileTitleShown(item) && (
                  <span
                    className="mt-2 text-[14px] font-extrabold leading-tight"
                    style={{ color: HH.txt }}
                  >
                    {title}
                  </span>
                )}
                {tileSubtitleShown(item) && (
                  <span
                    className="mt-0.5 text-[11px] font-semibold leading-tight"
                    style={{ color: HH.muted }}
                  >
                    {sub}
                  </span>
                )}
              </motion.div>
            )
          })}
        </div>

        <div
          className="mt-4 rounded-xl border py-2.5 text-center text-[13px] font-bold"
          style={{ borderColor: HH.line, color: HH.txt }}
        >
          {t('handheldDesignPage.previewSignOut')}
        </div>
      </div>
    </div>
  )
}

export function HandheldDesignEditor({
  title,
  subtitle,
  baseTiles,
  baseDesign,
  saving,
  onSave,
}: {
  title: string
  subtitle?: string
  baseTiles: HandheldTileItem[]
  baseDesign: HandheldDesign
  saving: boolean
  onSave: (tiles: HandheldTileItem[], design: HandheldDesign) => void
}) {
  const { t } = useTranslation()
  const [tiles, setTiles] = useState<HandheldTileItem[]>(baseTiles)
  const [design, setDesign] = useState<HandheldDesign>(baseDesign)
  const [tab, setTab] = useState('details')
  const [configKey, setConfigKey] = useState<string | null>(null)

  // Nulstil fra base-props når de skifter (første load + efter gem/invalidering).
  useEffect(() => {
    setTiles(baseTiles)
    setDesign(baseDesign)
  }, [baseTiles, baseDesign])

  const dirty = !sameTiles(tiles, baseTiles) || !sameDesign(design, baseDesign)
  const patchDesign = (patch: Partial<HandheldDesign>) => setDesign((d) => ({ ...d, ...patch }))
  const patchTile = (key: string, patch: Partial<HandheldTileItem>) =>
    setTiles((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)))

  const visible = tiles.filter(tileEnabled)
  const removed = tiles.filter((o) => !tileEnabled(o))

  // Mock-up'en kender kun de viste fliser, så et træk giver kun deres
  // indbyrdes rækkefølge — flet den tilbage i den fulde liste.
  const reorderVisible = (nextVisible: HandheldTileItem[]) =>
    setTiles((prev) => mergeVisibleOrder(prev, nextVisible))

  const cancel = () => {
    setTiles(baseTiles)
    setDesign(baseDesign)
  }

  const configItem = configKey ? (tiles.find((o) => o.key === configKey) ?? null) : null
  const configTile = configItem ? (HANDHELD_TILE_BY_KEY[configItem.key] ?? null) : null

  return (
    <div className="flex min-h-full flex-col">
      <div className="py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-foreground-light">{subtitle}</p>}
        </header>

        <div className="max-w-3xl">
          <DetailTabs
            tabs={[
              { key: 'details', label: t('detail.tabDetails') },
              { key: 'tiles', label: t('handheldDesignPage.tilesSection') },
            ]}
            active={tab}
            onChange={setTab}
            showMaximize={false}
          >
            {tab === 'details' && (
              <div className="flex flex-col gap-8">
                {/* Indholdselementer med til/fra */}
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t('handheldDesignPage.contentSection')}</SectionTitle>
                  <div className="flex flex-col gap-4">
                    <ToggleSection
                      id="hh-welcome"
                      label={t('handheldDesignPage.welcomeTitle')}
                      checked={design.welcomeTitleEnabled}
                      onCheckedChange={(v) => patchDesign({ welcomeTitleEnabled: v })}
                    >
                      <Input
                        value={design.welcomeTitle}
                        placeholder={t('handheldDesignPage.welcomeTitlePlaceholder')}
                        onChange={(e) => patchDesign({ welcomeTitle: e.target.value })}
                      />
                    </ToggleSection>

                    <ToggleSection
                      id="hh-subtitle"
                      label={t('handheldDesignPage.subtitleLabel')}
                      checked={design.subtitleEnabled}
                      onCheckedChange={(v) => patchDesign({ subtitleEnabled: v })}
                    >
                      <Input
                        value={design.subtitle}
                        placeholder={t('handheldDesignPage.subtitlePlaceholder')}
                        onChange={(e) => patchDesign({ subtitle: e.target.value })}
                      />
                    </ToggleSection>

                    <ToggleSection
                      id="hh-logo"
                      label={t('handheldDesignPage.logo')}
                      checked={design.logoEnabled}
                      onCheckedChange={(v) => patchDesign({ logoEnabled: v })}
                    >
                      <DesignImageField
                        url={design.logoUrl}
                        onChange={(u) => patchDesign({ logoUrl: u })}
                        kind="logo"
                        pathPrefix="handheld-design"
                        allowUrl
                      />
                    </ToggleSection>

                    <ToggleSection
                      id="hh-hero"
                      label={t('handheldDesignPage.hero')}
                      checked={design.heroEnabled}
                      onCheckedChange={(v) => patchDesign({ heroEnabled: v })}
                    >
                      <DesignImageField
                        url={design.heroUrl}
                        onChange={(u) => patchDesign({ heroUrl: u })}
                        kind="hero"
                        pathPrefix="handheld-design"
                      />
                    </ToggleSection>
                  </div>
                </section>

                {/* Ikon-tema */}
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t('handheldDesignPage.iconThemeSection')}</SectionTitle>
                  <RadioGroup
                    value={design.iconTheme}
                    onValueChange={(v) => patchDesign({ iconTheme: v as HandheldIconTheme })}
                    className="flex flex-wrap gap-3"
                  >
                    {HANDHELD_ICON_THEMES.map((th) => (
                      <label
                        key={th}
                        htmlFor={`icon-theme-${th}`}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
                      >
                        <RadioGroupItem value={th} id={`icon-theme-${th}`} />
                        <span className="text-[13px] font-[450]">
                          {t(`handheldDesignPage.iconTheme_${th}`)}
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  <p className="text-xs text-muted-foreground">
                    {t('handheldDesignPage.iconThemeHint')}
                  </p>
                </section>
              </div>
            )}

            {tab === 'tiles' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle>{t('handheldDesignPage.tilesSection')}</SectionTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" disabled={removed.length === 0}>
                        <Plus className="size-4" /> {t('handheldDesignPage.addTile')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {removed.map((item) => {
                        const tile = HANDHELD_TILE_BY_KEY[item.key]
                        if (!tile) return null
                        const Icon = tileIcon(item, tile).icon
                        return (
                          <DropdownMenuItem
                            key={item.key}
                            className="cursor-pointer"
                            onClick={() => patchTile(item.key, { enabled: true })}
                          >
                            <Icon className="size-4" />
                            {item.title?.trim() || t(`handheldDesignPage.${tile.labelKey}`)}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('handheldDesignPage.tilesHint')}
                </p>
                {visible.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                    {t('handheldDesignPage.noTiles')}
                  </p>
                ) : (
                  <div className="overflow-x-auto pb-1 pt-2">
                    <HandheldPreview
                      tiles={visible}
                      design={design}
                      onConfigure={setConfigKey}
                      onReorder={reorderVisible}
                      onRemove={(key) => patchTile(key, { enabled: false })}
                    />
                  </div>
                )}
              </div>
            )}
          </DetailTabs>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => onSave(tiles, design)} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      {configItem && configTile && (
        <HandheldTileDialog
          item={configItem}
          tile={configTile}
          theme={design.iconTheme}
          onPatch={(patch) => patchTile(configItem.key, patch)}
          onClose={() => setConfigKey(null)}
        />
      )}
    </div>
  )
}
