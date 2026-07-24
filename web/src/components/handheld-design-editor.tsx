import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { FolderOpen, GripVertical, Plus, Settings2, X } from 'lucide-react'
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
  applyDesignTokens,
  DEFAULT_HANDHELD_DESIGN,
  HANDHELD_ICONS,
  HANDHELD_ICON_THEMES,
  HANDHELD_TILE_BY_KEY,
  mergeVisibleOrder,
  timeGreetingKey,
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

// Funktionserklæringer (ikke arrow-const) så sameTile/sameTiles kan referere
// hinanden — gruppe-fliser sammenlignes rekursivt på deres børneliste.
function sameTile(a: HandheldTileItem, b: HandheldTileItem): boolean {
  return (
    a.key === b.key &&
    (a.enabled ?? true) === (b.enabled ?? true) &&
    (a.title ?? '') === (b.title ?? '') &&
    (a.titleEnabled ?? true) === (b.titleEnabled ?? true) &&
    (a.subtitle ?? '') === (b.subtitle ?? '') &&
    (a.subtitleEnabled ?? true) === (b.subtitleEnabled ?? true) &&
    (a.icon ?? '') === (b.icon ?? '') &&
    (a.color ?? '') === (b.color ?? '') &&
    (a.background ?? '') === (b.background ?? '') &&
    sameTiles(a.children ?? [], b.children ?? [])
  )
}
function sameTiles(a: HandheldTileItem[], b: HandheldTileItem[]): boolean {
  return a.length === b.length && a.every((t, i) => sameTile(t, b[i]))
}
const sameDesign = (a: HandheldDesign, b: HandheldDesign) =>
  (Object.keys(DEFAULT_HANDHELD_DESIGN) as (keyof HandheldDesign)[]).every((k) => {
    const av = a[k]
    const bv = b[k]
    if (Array.isArray(av) && Array.isArray(bv)) {
      return av.length === bv.length && av.every((x, i) => x === bv[i])
    }
    return av === bv
  })

// Skabelon-koderne til velkomsttitel/undertitel og nøglen til deres
// forklaring. En tom oversættelse betyder "koden forklarer sig selv".
const TOKEN_HINTS = [
  ['{{name}}', 'tokenName'],
  ['{{lastname}}', 'tokenLastname'],
  ['{{time-greeting}}', 'tokenTimeGreeting'],
] as const

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

// Det trækbare flisegitter (delt af mock-up'en og gruppe-mappen): to kolonner,
// hver flise med tandhjul (konfigurér) og ✕ (fjern); gruppe-fliser får desuden
// et mappe-ikon (åbn) til venstre for tandhjulet. Trækkes for at ombytte
// rækkefølgen — den rækkefølge, appen viser fliserne i.
function TileGrid({
  tiles,
  design,
  onConfigure,
  onReorder,
  onRemove,
  onOpen,
}: {
  tiles: HandheldTileItem[]
  design: HandheldDesign
  onConfigure: (key: string) => void
  onReorder: (next: HandheldTileItem[]) => void
  onRemove: (key: string) => void
  onOpen?: (key: string) => void
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HandheldTileItem[]>(tiles)
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

  tilesRef.current = tiles

  // Træk: flyt den trukne flise hen på den nærmeste gitterplads og skub de
  // øvrige på plads (splice — ikke ombytning), så rækkefølgen følger med musen.
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
      ref={containerRef}
      className="relative select-none"
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
        const isGroup = !!tile.children
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
            {/* Handlingsknapper (åbn?/konfigurér/fjern) samlet øverst til højre;
                stopper træk så et klik ikke starter en flytning. */}
            <div
              className="absolute right-1.5 top-1.5 flex gap-0.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {isGroup && onOpen && (
                <button
                  type="button"
                  aria-label={t('handheldDesignPage.openFolderAria', { name: title })}
                  title={t('handheldDesignPage.openFolderAria', { name: title })}
                  onClick={() => onOpen(item.key)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <FolderOpen size={14} />
                </button>
              )}
              <button
                type="button"
                aria-label={t('handheldDesignPage.configureTileAria', { name: title })}
                title={t('handheldDesignPage.configureTileAria', { name: title })}
                onClick={() => onConfigure(item.key)}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Settings2 size={14} />
              </button>
              <button
                type="button"
                aria-label={t('handheldDesignPage.removeTileAria', { name: title })}
                title={t('handheldDesignPage.removeTileAria', { name: title })}
                onClick={() => onRemove(item.key)}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-destructive/80 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
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
  )
}

// Mock-up af håndterminalens startskærm: statuslinje, brandbjælke, hilsen +
// indholdselementer, flisegitteret og "Log ud". Et mappe-ikon på en gruppe-flise
// åbner dens underside (onOpen).
function HandheldPreview({
  tiles,
  design,
  onConfigure,
  onReorder,
  onRemove,
  onOpen,
}: {
  // Kun de viste fliser — mock-up'en er hvad enheden viser.
  tiles: HandheldTileItem[]
  design: HandheldDesign
  onConfigure: (key: string) => void
  onReorder: (next: HandheldTileItem[]) => void
  onRemove: (key: string) => void
  onOpen: (key: string) => void
}) {
  const { t } = useTranslation()
  // Eksempeldata til forhåndsvisning af skabelon-koderne (rigtige værdier
  // udfyldes på enheden af den indloggede bruger + klokkeslættet).
  const previewTokens = {
    firstName: t('handheldDesignPage.previewName'),
    lastName: t('handheldDesignPage.previewLastName'),
    timeGreeting: t(timeGreetingKey(new Date().getHours())),
  }

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

        {/* Hilsen-elementerne i den valgte rækkefølge (design.greetingOrder), som
            på enheden. Skabelon-koderne ({{name}} osv.) vises opløst med
            eksempeldata. Slået fra ⇒ elementet skjules helt. */}
        {design.greetingOrder.map((gk) =>
          gk === 'subtitle'
            ? design.subtitleEnabled && (
                <p key="subtitle" className="text-[12px]" style={{ color: HH.muted }}>
                  {applyDesignTokens(design.subtitle, previewTokens).trim() ||
                    t('handheldDesignPage.previewGreeting')}
                </p>
              )
            : design.welcomeTitleEnabled && (
                <p key="title" className="text-[19px] font-extrabold" style={{ color: HH.txt }}>
                  {applyDesignTokens(design.welcomeTitle, previewTokens).trim() ||
                    t('handheldDesignPage.previewName')}
                </p>
              ),
        )}

        <div className="mt-4">
          <TileGrid
            tiles={tiles}
            design={design}
            onConfigure={onConfigure}
            onReorder={onReorder}
            onRemove={onRemove}
            onOpen={onOpen}
          />
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
  banner,
  baseTiles,
  baseDesign,
  saving,
  onSave,
  extraTabs = [],
  companyId,
}: {
  title: string
  subtitle?: string
  // Valgfri note over fanerne — bruges af kundefladen til at fortælle om
  // designet er arvet fra Operia eller virksomhedens eget.
  banner?: React.ReactNode
  baseTiles: HandheldTileItem[]
  baseDesign: HandheldDesign
  saving: boolean
  onSave: (tiles: HandheldTileItem[], design: HandheldDesign) => void
  // Ekstra faner efter Detaljer/Fliser — platformsiden bruger den til
  // "Handlinger" (udgivelse + QR-kode), som kundefladen ikke skal have.
  extraTabs?: { key: string; label: string; content: React.ReactNode }[]
  // Null på platformsiden (standard), company_id på kundefladen — styrer
  // upload-stien i DesignImageField (storage-RLS).
  companyId?: string | null
}) {
  const { t } = useTranslation()
  const [tiles, setTiles] = useState<HandheldTileItem[]>(baseTiles)
  const [design, setDesign] = useState<HandheldDesign>(baseDesign)
  const [tab, setTab] = useState('details')
  const [dragGreeting, setDragGreeting] = useState<string | null>(null)
  // Hvilken flise konfigureres — enten på top-niveau (groupKey null) eller et
  // barn inde i en gruppe-mappe (groupKey = gruppens nøgle).
  const [configTarget, setConfigTarget] = useState<{ groupKey: string | null; key: string } | null>(
    null,
  )
  // Den åbne gruppe-mappe (dens underside redigeres), eller null.
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null)

  // Nulstil fra base-props når de skifter (første load + efter gem/invalidering).
  useEffect(() => {
    setTiles(baseTiles)
    setDesign(baseDesign)
  }, [baseTiles, baseDesign])

  const dirty = !sameTiles(tiles, baseTiles) || !sameDesign(design, baseDesign)
  const patchDesign = (patch: Partial<HandheldDesign>) => setDesign((d) => ({ ...d, ...patch }))
  const patchTile = (key: string, patch: Partial<HandheldTileItem>) =>
    setTiles((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)))

  // Patch/omarrangér et barn inde i en gruppe-mappe.
  const patchChild = (groupKey: string, childKey: string, patch: Partial<HandheldTileItem>) =>
    setTiles((prev) =>
      prev.map((o) =>
        o.key === groupKey
          ? { ...o, children: (o.children ?? []).map((c) => (c.key === childKey ? { ...c, ...patch } : c)) }
          : o,
      ),
    )
  const reorderGroupVisible = (groupKey: string, nextVisible: HandheldTileItem[]) =>
    setTiles((prev) =>
      prev.map((o) =>
        o.key === groupKey ? { ...o, children: mergeVisibleOrder(o.children ?? [], nextVisible) } : o,
      ),
    )

  // Byt om på hilsen-elementernes rækkefølge (træk-og-slip på detaljefanen).
  const reorderGreeting = (from: string, over: string) =>
    setDesign((d) => {
      const order = [...d.greetingOrder]
      const fromI = order.indexOf(from)
      const overI = order.indexOf(over)
      if (fromI < 0 || overI < 0 || fromI === overI) return d
      order.splice(fromI, 1)
      order.splice(overI, 0, from)
      return { ...d, greetingOrder: order }
    })

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

  // Konfigurations-målet kan være en top-niveau-flise eller et barn i en gruppe.
  const configItem = configTarget
    ? configTarget.groupKey
      ? (tiles
          .find((o) => o.key === configTarget.groupKey)
          ?.children?.find((c) => c.key === configTarget.key) ?? null)
      : (tiles.find((o) => o.key === configTarget.key) ?? null)
    : null
  const configTile = configItem ? (HANDHELD_TILE_BY_KEY[configItem.key] ?? null) : null

  // Den åbne gruppe-mappe og dens børn (viste/fjernede).
  const openGroupItem = openGroupKey ? (tiles.find((o) => o.key === openGroupKey) ?? null) : null
  const openGroupTile = openGroupItem ? (HANDHELD_TILE_BY_KEY[openGroupItem.key] ?? null) : null
  const groupChildren = openGroupItem?.children ?? []
  const groupVisible = groupChildren.filter(tileEnabled)
  const groupRemoved = groupChildren.filter((o) => !tileEnabled(o))

  return (
    <div className="flex min-h-full flex-col">
      <div className="py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-foreground-light">{subtitle}</p>}
        </header>

        <div className="max-w-3xl">
          {banner}
          <DetailTabs
            tabs={[
              { key: 'details', label: t('detail.tabDetails') },
              { key: 'tiles', label: t('handheldDesignPage.tilesSection') },
              ...extraTabs.map(({ key, label }) => ({ key, label })),
            ]}
            active={tab}
            onChange={setTab}
            showMaximize={false}
          >
            {extraTabs.find((et) => et.key === tab)?.content}
            {tab === 'details' && (
              <div className="flex flex-col gap-8">
                {/* Indholdselementer med til/fra */}
                <section className="flex flex-col gap-3">
                  <SectionTitle>{t('handheldDesignPage.contentSection')}</SectionTitle>
                  <div className="flex flex-col gap-4">
                    {/* Hilsen-elementerne (undertitel/titel) i den gemte rækkefølge,
                        træk i grebet for at bytte om — enheden viser dem i samme
                        rækkefølge (design.greetingOrder). */}
                    {design.greetingOrder.map((gk) => (
                      <div
                        key={gk}
                        onDragOver={(e) => {
                          e.preventDefault()
                          if (dragGreeting && dragGreeting !== gk) reorderGreeting(dragGreeting, gk)
                        }}
                        className={cn('flex items-start gap-2', dragGreeting === gk && 'opacity-60')}
                      >
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDragGreeting(gk)}
                          onDragEnd={() => setDragGreeting(null)}
                          aria-label={t('handheldDesignPage.reorderHandle')}
                          title={t('handheldDesignPage.reorderHandle')}
                          className="mt-3.5 cursor-grab text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </button>
                        <div className="flex-1">
                          {gk === 'title' ? (
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
                          ) : (
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
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Skabelon-koder til velkomsttitel/undertitel. Literalerne står
                        i JSX (ikke i i18n-strengen), ellers ville i18next selv
                        forsøge at interpolere {{name}} osv. */}
                    <p className="text-xs text-muted-foreground">
                      {t('handheldDesignPage.tokenHintPrefix')}{' '}
                      {TOKEN_HINTS.map(([token, key], i) => {
                        const raw = t(`handheldDesignPage.${key}`)
                        // Udelad forklaringen når den blot ville gentage selve
                        // koden (engelsk: "{{lastname}} (last name)"); på dansk
                        // er den en oversættelse og bevares derfor.
                        const desc = raw && raw !== `handheldDesignPage.${key}` ? raw : ''
                        return (
                          <span key={token}>
                            {i > 0 && ', '}
                            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{token}</code>
                            {desc ? ` ${desc}` : ''}
                          </span>
                        )
                      })}
                    </p>

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
                        companyId={companyId}
                        hint={t('handheldDesignPage.logoHint')}
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
                        companyId={companyId}
                        hint={t('handheldDesignPage.heroHint')}
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
                      onConfigure={(key) => setConfigTarget({ groupKey: null, key })}
                      onReorder={reorderVisible}
                      onRemove={(key) => patchTile(key, { enabled: false })}
                      onOpen={setOpenGroupKey}
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

      {/* Gruppe-mappe: rediger undersidens fliser (konfigurér, omarrangér,
          tilføj/fjern) — de vises på håndterminalens underside i samme orden. */}
      {openGroupItem && openGroupTile && (
        <Dialog open onOpenChange={(o) => !o && setOpenGroupKey(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t('handheldDesignPage.folderTitle', {
                  name: openGroupItem.title?.trim() || t(`handheldDesignPage.${openGroupTile.labelKey}`),
                })}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t('handheldDesignPage.folderHint')}</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={groupRemoved.length === 0}>
                    <Plus className="size-4" /> {t('handheldDesignPage.addTile')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {groupRemoved.map((item) => {
                    const tile = HANDHELD_TILE_BY_KEY[item.key]
                    if (!tile) return null
                    const Icon = tileIcon(item, tile).icon
                    return (
                      <DropdownMenuItem
                        key={item.key}
                        className="cursor-pointer"
                        onClick={() => patchChild(openGroupItem.key, item.key, { enabled: true })}
                      >
                        <Icon className="size-4" />
                        {item.title?.trim() || t(`handheldDesignPage.${tile.labelKey}`)}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {groupVisible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                {t('handheldDesignPage.noTiles')}
              </p>
            ) : (
              <div className="flex justify-center overflow-x-auto pt-1">
                <TileGrid
                  tiles={groupVisible}
                  design={design}
                  onConfigure={(key) => setConfigTarget({ groupKey: openGroupItem.key, key })}
                  onReorder={(next) => reorderGroupVisible(openGroupItem.key, next)}
                  onRemove={(key) => patchChild(openGroupItem.key, key, { enabled: false })}
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {configItem && configTile && (
        <HandheldTileDialog
          item={configItem}
          tile={configTile}
          theme={design.iconTheme}
          onPatch={(patch) =>
            configTarget?.groupKey
              ? patchChild(configTarget.groupKey, configItem.key, patch)
              : patchTile(configItem.key, patch)
          }
          onClose={() => setConfigTarget(null)}
        />
      )}
    </div>
  )
}
