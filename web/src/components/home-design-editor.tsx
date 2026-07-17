import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Image as ImageIcon, Plus, Settings2, Square } from 'lucide-react'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Expand } from '@/components/animate-ui/icons/expand'
import { Shrink } from '@/components/animate-ui/icons/shrink'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ColorPicker } from '@/components/color-picker'
import { DesignImageField, ToggleSection } from '@/components/design-editor-fields'
import { DetailTabs } from '@/components/detail-tabs'
import {
  DEFAULT_HOME_DESIGN,
  DEFAULT_TILE_RADIUS,
  MAX_COLS,
  MAX_GAP,
  MAX_ROWS,
  MAX_TILE_RADIUS,
  MIN_COLS,
  MIN_GAP,
  MIN_ROWS,
  packTiles,
  sizeToWH,
  tileBackground,
  tileIconShown,
  tileRadius,
  tileTitleShown,
  TILE_BY_PRODUCT,
  type HomeDesign,
  type ProductTile,
  type TileLayoutItem,
  type TileSize,
} from '@/lib/home-tiles'
import { cn } from '@/lib/utils'

// Fælles Home-design-editor: rutenet (kolonner/rækker/gap + farvetema), fliser
// (produkt-/billede-/tomme, træk for at flytte — first-fit-pakning) og
// indholdselementer (velkomsttitel/undertitel/logo/hero). Bruges af både
// platformens opsætning (Operia → Home-design) og kundens egen opsætning
// (Konfigurér → Home-design); de to sider adskiller sig kun i hvor layoutet
// hentes/gemmes og hvilke produktfliser der er tilgængelige.

const CELL = 100

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
// Sammenlign to fliser inkl. alle per-flise-overstyringer, så ugemt-vagten
// også fanger titel-/ikon-/farve-/hjørne-ændringer (ikke kun flyt/størrelse).
const sameTile = (a: TileLayoutItem, b: TileLayoutItem) =>
  a.id === b.id &&
  a.kind === b.kind &&
  (a.product ?? '') === (b.product ?? '') &&
  (a.imageUrl ?? '') === (b.imageUrl ?? '') &&
  a.size === b.size &&
  (a.title ?? '') === (b.title ?? '') &&
  (a.titleEnabled ?? true) === (b.titleEnabled ?? true) &&
  (a.iconEnabled ?? true) === (b.iconEnabled ?? true) &&
  (a.color ?? '') === (b.color ?? '') &&
  (a.rounded ?? DEFAULT_TILE_RADIUS) === (b.rounded ?? DEFAULT_TILE_RADIUS) &&
  (a.roundedEnabled ?? false) === (b.roundedEnabled ?? false)
const sameOrder = (a: TileLayoutItem[], b: TileLayoutItem[]) =>
  a.length === b.length && a.every((t, i) => sameTile(t, b[i]))
const sameDesign = (a: HomeDesign, b: HomeDesign) =>
  (Object.keys(DEFAULT_HOME_DESIGN) as (keyof HomeDesign)[]).every((k) => a[k] === b[k])

// Per-flise-konfiguration (popup). Felterne afhænger af flise-arten:
//  - produkt: titel, ikon, størrelse, farve, hjørner
//  - billede: billedvælger, titel, størrelse, hjørner (+ fjern)
//  - tom:     størrelse, farve, hjørner (+ fjern)
// Farvevælgeren genbruges fra Konfigurér → Udseende. Ændringer anvendes live på
// layoutet; gem/annullér-bjælken persisterer dem.
function TileConfigDialog({
  item,
  tile,
  onPatch,
  onRemove,
  onClose,
}: {
  item: TileLayoutItem
  tile: ProductTile | null
  onPatch: (patch: Partial<TileLayoutItem>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const productName = tile ? t(`nav.${tile.labelKey}`) : ''
  const titleEnabled = item.titleEnabled !== false
  const iconEnabled = item.iconEnabled !== false
  const roundedEnabled = item.roundedEnabled === true

  const showTitle = item.kind === 'product' || item.kind === 'image'
  const showIcon = item.kind === 'product'
  const showColor = item.kind === 'product' || item.kind === 'empty'
  const removable = item.kind !== 'product'

  const heading =
    item.kind === 'image'
      ? t('homeDesignPage.imageTile')
      : item.kind === 'empty'
        ? t('homeDesignPage.emptyTile')
        : t('homeDesignPage.configureTile', { name: productName })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {/* Billedvælger (kun billed-fliser) */}
          {item.kind === 'image' && (
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('homeDesignPage.tileImage')}</Label>
              <DesignImageField
                url={item.imageUrl ?? ''}
                onChange={(u) => onPatch({ imageUrl: u })}
                kind="tile"
                pathPrefix="home-design"
              />
            </div>
          )}

          {/* Titel */}
          {showTitle && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-label">{t('homeDesignPage.tileTitle')}</Label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={titleEnabled}
                    onCheckedChange={(v) => onPatch({ titleEnabled: v === true })}
                  />
                  {t('homeDesignPage.tileEnabled')}
                </label>
              </div>
              <Input
                value={item.title ?? ''}
                placeholder={productName}
                disabled={!titleEnabled}
                onChange={(e) => onPatch({ title: e.target.value })}
              />
            </div>
          )}

          {/* Ikon (kun produkt) */}
          {showIcon && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={iconEnabled}
                onCheckedChange={(v) => onPatch({ iconEnabled: v === true })}
              />
              <span className="text-[13px] font-[450]">{t('homeDesignPage.showIcon')}</span>
            </label>
          )}

          {/* Størrelse */}
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('homeDesignPage.tileSize')}</Label>
            <RadioGroup
              value={item.size}
              onValueChange={(v) => onPatch({ size: (v === '2x2' ? '2x2' : '1x1') as TileSize })}
              className="flex gap-3"
            >
              {(['1x1', '2x2'] as const).map((s) => (
                <label
                  key={s}
                  htmlFor={`tile-size-${s}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
                >
                  <RadioGroupItem value={s} id={`tile-size-${s}`} />
                  <span className="text-[13px] font-[450]">{s === '2x2' ? '2×2' : '1×1'}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* Farve (produkt + tom) */}
          {showColor && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-label">{t('homeDesignPage.tileColor')}</Label>
                {item.color && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onPatch({ color: undefined })}
                  >
                    {t('homeDesignPage.resetColor')}
                  </Button>
                )}
              </div>
              <ColorPicker value={item.color ?? null} onChange={(v) => onPatch({ color: v })} />
            </div>
          )}

          {/* Afrundede hjørner */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-label">{t('homeDesignPage.tileRounded')}</Label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={roundedEnabled}
                  onCheckedChange={(v) => onPatch({ roundedEnabled: v === true })}
                />
                {t('homeDesignPage.tileEnabled')}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={MAX_TILE_RADIUS}
                value={item.rounded ?? DEFAULT_TILE_RADIUS}
                disabled={!roundedEnabled}
                className="w-28"
                onChange={(e) =>
                  onPatch({ rounded: clamp(Math.round(Number(e.target.value) || 0), 0, MAX_TILE_RADIUS) })
                }
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          </div>
        </div>
        <DialogFooter className={cn(removable && 'sm:justify-between')}>
          {removable && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
              {t('homeDesignPage.removeTile')}
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            {t('homeDesignPage.tileDone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Home-design-editorens indhold + gem/annullér-bjælke. `baseTiles`/`baseDesign`
// er det gemte udgangspunkt (ugemt-vagten sammenligner mod dem); efter et
// vellykket gem invaliderer forælderen sin query, hvorved nye base-props
// nulstiller udgangspunktet.
export function HomeDesignEditor({
  title,
  subtitle,
  banner,
  baseTiles,
  baseDesign,
  saving,
  onSave,
}: {
  title: string
  subtitle?: string
  banner?: React.ReactNode
  baseTiles: TileLayoutItem[]
  baseDesign: HomeDesign
  saving: boolean
  onSave: (tiles: TileLayoutItem[], design: HomeDesign) => void
}) {
  const { t } = useTranslation()

  const [order, setOrder] = useState<TileLayoutItem[]>(baseTiles)
  const [design, setDesign] = useState<HomeDesign>(baseDesign)
  const [tab, setTab] = useState('details')

  const containerRef = useRef<HTMLDivElement>(null)
  const orderRef = useRef<TileLayoutItem[]>(baseTiles)
  const designRef = useRef<HomeDesign>(baseDesign)
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

  orderRef.current = order
  designRef.current = design
  // Nulstil fra base-props når de skifter (første load + efter gem/invalidering).
  useEffect(() => {
    setOrder(baseTiles)
    setDesign(baseDesign)
  }, [baseTiles, baseDesign])

  const dirty = !sameOrder(order, baseTiles) || !sameDesign(design, baseDesign)
  const patchDesign = (patch: Partial<HomeDesign>) => setDesign((d) => ({ ...d, ...patch }))

  const [configId, setConfigId] = useState<string | null>(null)

  const toggleSize = (id: string) => {
    setOrder((prev) =>
      prev.map((o) => (o.id === id ? { ...o, size: o.size === '2x2' ? '1x1' : '2x2' } : o)),
    )
  }

  // Opdatér én flises per-flise-indstillinger (titel, ikon, størrelse, farve, hjørner, billede).
  const updateTile = (id: string, patch: Partial<TileLayoutItem>) => {
    setOrder((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  // Tilføj en fri flise (billede eller tom afstands-flise) og åbn dens config.
  const addTile = (kind: 'image' | 'empty') => {
    const id = crypto.randomUUID()
    setOrder((prev) => [...prev, { id, kind, size: '1x1' }])
    setConfigId(id)
  }

  const removeTile = (id: string) => {
    setOrder((prev) => prev.filter((o) => o.id !== id))
    setConfigId(null)
  }

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    const container = containerRef.current
    if (!drag || !container) return
    const cols = designRef.current.maxCols
    const step = CELL + designRef.current.gap
    const rect = container.getBoundingClientRect()
    const gx = e.clientX - rect.left - drag.offsetX
    const gy = e.clientY - rect.top - drag.offsetY
    setDragPos({ x: gx, y: gy })

    const dragged = orderRef.current.find((o) => o.id === drag.id)
    if (!dragged) return
    const [w] = sizeToWH(dragged.size)
    const col = clamp(Math.round(gx / step), 0, Math.max(0, cols - w))
    const row = Math.max(0, Math.round(gy / step))
    const draggedReading = row * cols + col

    const others = orderRef.current.filter((o) => o.id !== drag.id)
    const packedOthers = packTiles(others, cols).placed
    const newIndex = packedOthers.filter((p) => p.y * cols + p.x < draggedReading).length
    const next = [...others.slice(0, newIndex), dragged, ...others.slice(newIndex)]
    if (!sameOrder(next, orderRef.current)) {
      orderRef.current = next
      setOrder(next)
    }
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
    setDraggingId(null)
    setDragPos(null)
  }, [])

  useEffect(() => {
    if (!draggingId) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
    }
  }, [draggingId, onPointerMove, endDrag])

  const onTilePointerDown = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const tileRect = e.currentTarget.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    dragRef.current = {
      id,
      offsetX: e.clientX - tileRect.left,
      offsetY: e.clientY - tileRect.top,
    }
    setDraggingId(id)
    setDragPos({ x: tileRect.left - containerRect.left, y: tileRect.top - containerRect.top })
  }

  const cancel = () => {
    setOrder(baseTiles)
    setDesign(baseDesign)
  }

  const configItem = configId ? (order.find((o) => o.id === configId) ?? null) : null
  const configTile =
    configItem?.kind === 'product' && configItem.product
      ? (TILE_BY_PRODUCT[configItem.product] ?? null)
      : null

  const GAP = design.gap
  const STEP = CELL + GAP
  const { placed, rows } = packTiles(order, design.maxCols)
  const boardCols = design.maxCols
  const boardRows = Math.max(rows, design.maxRows)
  const boardWidth = boardCols * STEP - GAP
  const boardHeight = boardRows * STEP - GAP

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>
  )

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
            { key: 'tiles', label: t('homeDesignPage.tilesSection') },
          ]}
          active={tab}
          onChange={setTab}
          showMaximize={false}
        >
          {tab === 'tiles' && (
            <div className="flex flex-col gap-8">
          {/* Rutenet: max kolonner/rækker */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.gridSection')}</SectionTitle>
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('homeDesignPage.maxCols')}</Label>
                <Input
                  type="number"
                  min={MIN_COLS}
                  max={MAX_COLS}
                  value={design.maxCols}
                  className="w-28"
                  onChange={(e) =>
                    patchDesign({ maxCols: clamp(Number(e.target.value) || MIN_COLS, MIN_COLS, MAX_COLS) })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('homeDesignPage.maxRows')}</Label>
                <Input
                  type="number"
                  min={MIN_ROWS}
                  max={MAX_ROWS}
                  value={design.maxRows}
                  className="w-28"
                  onChange={(e) =>
                    patchDesign({ maxRows: clamp(Number(e.target.value) || MIN_ROWS, MIN_ROWS, MAX_ROWS) })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('homeDesignPage.gap')}</Label>
                <Input
                  type="number"
                  min={MIN_GAP}
                  max={MAX_GAP}
                  value={design.gap}
                  className="w-28"
                  onChange={(e) =>
                    patchDesign({ gap: clamp(Math.round(Number(e.target.value) || 0), MIN_GAP, MAX_GAP) })
                  }
                />
              </div>
            </div>
          </section>

          {/* Farvetema */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.themeSection')}</SectionTitle>
            <RadioGroup
              value={design.theme}
              onValueChange={(v) => patchDesign({ theme: v === 'muted' ? 'muted' : 'metro' })}
              className="flex gap-3"
            >
              {(['metro', 'muted'] as const).map((th) => (
                <label
                  key={th}
                  htmlFor={`theme-${th}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
                >
                  <RadioGroupItem value={th} id={`theme-${th}`} />
                  <span className="text-[13px] font-[450]">{t(`homeDesignPage.theme_${th}`)}</span>
                </label>
              ))}
            </RadioGroup>
          </section>

          {/* Fliserne */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>{t('homeDesignPage.tilesSection')}</SectionTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="size-4" /> {t('homeDesignPage.addTile')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="cursor-pointer" onClick={() => addTile('image')}>
                    <ImageIcon className="size-4" /> {t('homeDesignPage.imageTile')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => addTile('empty')}>
                    <Square className="size-4" /> {t('homeDesignPage.emptyTile')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-xs text-muted-foreground">{t('homeDesignPage.tilesHint')}</p>
            <div className="max-w-full overflow-x-auto pb-1">
            <div
              ref={containerRef}
              className="relative select-none"
              style={{ width: boardWidth, height: boardHeight, touchAction: 'none' }}
            >
              {placed.map((p) => {
                const productTile =
                  p.kind === 'product' && p.product ? TILE_BY_PRODUCT[p.product] : null
                if (p.kind === 'product' && !productTile) return null
                const isDragging = draggingId === p.id
                const isEmpty = p.kind === 'empty'
                const width = p.w * CELL + (p.w - 1) * GAP
                const height = p.h * CELL + (p.h - 1) * GAP
                const pos = isDragging && dragPos ? dragPos : { x: p.x * STEP, y: p.y * STEP }
                const large = p.size === '2x2'
                const bg = productTile
                  ? tileBackground(p, productTile, design.theme)
                  : p.color?.trim() || (isEmpty ? 'transparent' : '#334155')
                const titleText =
                  p.title?.trim() || (productTile ? t(`nav.${productTile.labelKey}`) : '')
                const overlayBtn = isEmpty
                  ? 'text-foreground/60 hover:bg-foreground/10 hover:text-foreground'
                  : 'text-white/90 hover:bg-white/20 hover:text-white'
                return (
                  <motion.div
                    key={p.id}
                    initial={false}
                    animate={{ x: pos.x, y: pos.y, width, height }}
                    transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }}
                    onPointerDown={(e) => onTilePointerDown(p.id, e)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      background: bg,
                      backgroundImage:
                        p.kind === 'image' && p.imageUrl ? `url(${p.imageUrl})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      borderRadius: tileRadius(p),
                    }}
                    className={cn(
                      'flex touch-none flex-col justify-end overflow-hidden p-2.5 shadow-sm',
                      isEmpty ? 'border border-dashed border-foreground/25 text-foreground' : 'text-white',
                      isDragging ? 'z-50 cursor-grabbing opacity-95 shadow-xl' : 'z-[1] cursor-grab',
                    )}
                  >
                    <AnimateIcon animateOnHover asChild>
                      <button
                        type="button"
                        aria-label={t(large ? 'homeDesignPage.shrink' : 'homeDesignPage.expand')}
                        title={t(large ? 'homeDesignPage.shrink' : 'homeDesignPage.expand')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => toggleSize(p.id)}
                        className={cn(
                          'absolute left-1.5 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors',
                          overlayBtn,
                        )}
                      >
                        {large ? <Shrink size={16} /> : <Expand size={16} />}
                      </button>
                    </AnimateIcon>
                    <button
                      type="button"
                      aria-label={t('homeDesignPage.configureTileAria')}
                      title={t('homeDesignPage.configureTileAria')}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setConfigId(p.id)}
                      className={cn(
                        'absolute left-8 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors',
                        overlayBtn,
                      )}
                    >
                      <Settings2 size={15} />
                    </button>
                    {productTile && tileIconShown(p) && (
                      <productTile.icon
                        className={cn('absolute text-white/90', large ? 'right-3 top-3 size-12' : 'right-2.5 top-2.5 size-6')}
                        strokeWidth={1.5}
                      />
                    )}
                    {p.kind === 'image' && !p.imageUrl && (
                      <ImageIcon
                        className={cn('absolute text-white/70', large ? 'right-3 top-3 size-10' : 'right-2.5 top-2.5 size-6')}
                        strokeWidth={1.5}
                      />
                    )}
                    {isEmpty && (
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                        {t('homeDesignPage.emptyTile')}
                      </span>
                    )}
                    {!isEmpty && tileTitleShown(p) && titleText && (
                      <span className={cn('font-medium leading-tight', large ? 'text-sm' : 'text-xs')}>
                        {titleText}
                      </span>
                    )}
                  </motion.div>
                )
              })}
            </div>
            </div>
          </section>
            </div>
          )}

          {tab === 'details' && (
            <div className="flex flex-col gap-8">
          {/* Indholdselementer med til/fra */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.contentSection')}</SectionTitle>
            <div className="flex flex-col gap-4">
              <ToggleSection
                id="hd-welcome"
                label={t('homeDesignPage.welcomeTitle')}
                checked={design.welcomeTitleEnabled}
                onCheckedChange={(v) => patchDesign({ welcomeTitleEnabled: v })}
              >
                <Input
                  value={design.welcomeTitle}
                  placeholder={t('homeDesignPage.welcomeTitlePlaceholder')}
                  onChange={(e) => patchDesign({ welcomeTitle: e.target.value })}
                />
              </ToggleSection>

              <ToggleSection
                id="hd-subtitle"
                label={t('homeDesignPage.subtitleLabel')}
                checked={design.subtitleEnabled}
                onCheckedChange={(v) => patchDesign({ subtitleEnabled: v })}
              >
                <Input
                  value={design.subtitle}
                  placeholder={t('homeDesignPage.subtitlePlaceholder')}
                  onChange={(e) => patchDesign({ subtitle: e.target.value })}
                />
              </ToggleSection>

              <ToggleSection
                id="hd-logo"
                label={t('homeDesignPage.logo')}
                checked={design.logoEnabled}
                onCheckedChange={(v) => patchDesign({ logoEnabled: v })}
              >
                <DesignImageField
                  url={design.logoUrl}
                  onChange={(u) => patchDesign({ logoUrl: u })}
                  kind="logo"
                  pathPrefix="home-design"
                  allowUrl
                />
              </ToggleSection>

              <ToggleSection
                id="hd-hero"
                label={t('homeDesignPage.hero')}
                checked={design.heroEnabled}
                onCheckedChange={(v) => patchDesign({ heroEnabled: v })}
              >
                <DesignImageField
                  url={design.heroUrl}
                  onChange={(u) => patchDesign({ heroUrl: u })}
                  kind="hero"
                  pathPrefix="home-design"
                />
              </ToggleSection>
            </div>
          </section>
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
          <Button size="sm" onClick={() => onSave(order, design)} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      {configItem && (
        <TileConfigDialog
          item={configItem}
          tile={configTile}
          onPatch={(patch) => updateTile(configItem.id, patch)}
          onRemove={() => removeTile(configItem.id)}
          onClose={() => setConfigId(null)}
        />
      )}
    </div>
  )
}
