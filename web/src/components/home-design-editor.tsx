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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorPicker } from '@/components/color-picker'
import { DesignImageField, ToggleSection } from '@/components/design-editor-fields'
import { DetailTabs } from '@/components/detail-tabs'
import {
  ALIGN_X_CLASS,
  ALIGN_Y_CLASS,
  COL_START_CLASS,
  DEFAULT_HOME_DESIGN,
  DEFAULT_TILE_RADIUS,
  firstFreeSlot,
  HOME_ALIGN_X,
  HOME_ALIGN_Y,
  HOME_THEMES,
  isPinnedTile,
  ROW_START_CLASS,
  slotKey,
  splitPinnedTiles,
  TILE_PLACEMENTS,
  tilePlaceX,
  tilePlaceY,
  tilePlacement,
  tileSlotKey,
  MAX_COLS,
  MAX_GAP,
  MAX_ROWS,
  MAX_TILE_RADIUS,
  MAX_TRANSPARENCY,
  MIN_COLS,
  MIN_GAP,
  MIN_ROWS,
  homeBackgroundUrl,
  homeTileIcon,
  tileAreaLayer,
  HOME_ICONS,
  packTiles,
  sizeToWH,
  TILE_SIZES,
  tileBackground,
  tileIconShown,
  tileRadius,
  tileSubtitleShown,
  tileTitleShown,
  linkTargetsForProducts,
  TILE_BY_PRODUCT,
  type LinkTarget,
  type HomeAlignX,
  type HomeAlignY,
  type HomeDesign,
  type HomeTheme,
  type ProductTile,
  type TileLayoutItem,
  type TilePlacement,
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
// En skjult (fjernet) produkt-flise: beholdt i layoutet, men ude af rutenettet.
const isHiddenProduct = (t: TileLayoutItem) => t.kind === 'product' && !!t.hidden
// Sammenlign to fliser inkl. alle per-flise-overstyringer, så ugemt-vagten
// også fanger titel-/ikon-/farve-/hjørne-ændringer (ikke kun flyt/størrelse).
const sameTile = (a: TileLayoutItem, b: TileLayoutItem) =>
  a.id === b.id &&
  a.kind === b.kind &&
  (a.product ?? '') === (b.product ?? '') &&
  (a.imageUrl ?? '') === (b.imageUrl ?? '') &&
  (a.linkProduct ?? '') === (b.linkProduct ?? '') &&
  (a.hidden ?? false) === (b.hidden ?? false) &&
  a.size === b.size &&
  (a.title ?? '') === (b.title ?? '') &&
  (a.titleEnabled ?? true) === (b.titleEnabled ?? true) &&
  (a.subtitle ?? '') === (b.subtitle ?? '') &&
  (a.subtitleEnabled ?? true) === (b.subtitleEnabled ?? true) &&
  (a.icon ?? '') === (b.icon ?? '') &&
  (a.iconEnabled ?? true) === (b.iconEnabled ?? true) &&
  (a.color ?? '') === (b.color ?? '') &&
  (a.background ?? '') === (b.background ?? '') &&
  (a.rounded ?? DEFAULT_TILE_RADIUS) === (b.rounded ?? DEFAULT_TILE_RADIUS) &&
  (a.roundedEnabled ?? false) === (b.roundedEnabled ?? false) &&
  tilePlacement(a) === tilePlacement(b) &&
  tilePlaceX(a) === tilePlaceX(b) &&
  tilePlaceY(a) === tilePlaceY(b)
const sameOrder = (a: TileLayoutItem[], b: TileLayoutItem[]) =>
  a.length === b.length && a.every((t, i) => sameTile(t, b[i]))
const sameDesign = (a: HomeDesign, b: HomeDesign) =>
  (Object.keys(DEFAULT_HOME_DESIGN) as (keyof HomeDesign)[]).every((k) => a[k] === b[k])

// Radioknapper for en af flisesektionens placeringsakser (venstre/midt/højre
// eller top/midt/bund). Ligger på modulniveau, så radiogruppen ikke remountes
// (og mister tastaturfokus) hver gang editoren gentegner.
function AlignChoice({
  name,
  value,
  options,
  onChange,
  isDisabled,
}: {
  name: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  // Valgfri: slår enkelte valg fra (fx en position en anden flise har taget).
  isDisabled?: (v: string) => boolean
}) {
  const { t } = useTranslation()
  return (
    <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const disabled = o !== value && !!isDisabled?.(o)
        return (
          <label
            key={o}
            htmlFor={`${name}-${o}`}
            title={disabled ? t('homeDesignPage.placementTaken') : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            <RadioGroupItem value={o} id={`${name}-${o}`} disabled={disabled} />
            <span className="text-[13px] font-[450]">{t(`homeDesignPage.align_${o}`)}</span>
          </label>
        )
      })}
    </RadioGroup>
  )
}

// Flisens flade i editoren: baggrundsfarve (eller temaets produktfarve),
// baggrundsbillede og hjørner. Delt af rutenettets fliser og de løsrevne.
function editorTileStyle(
  item: TileLayoutItem,
  productTile: ProductTile | null,
  theme: HomeTheme,
): React.CSSProperties {
  const bg = productTile
    ? tileBackground(item, productTile, theme)
    : item.background?.trim() || (item.kind === 'empty' ? 'transparent' : '#334155')
  return {
    background: bg,
    backgroundImage:
      (item.kind === 'image' || item.kind === 'product') && item.imageUrl
        ? `url(${item.imageUrl})`
        : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    borderRadius: tileRadius(item),
  }
}

const editorTileClass = (item: TileLayoutItem) =>
  cn(
    'flex touch-none flex-col justify-end overflow-hidden p-2.5 shadow-sm',
    item.kind === 'empty'
      ? 'border border-dashed border-foreground/25 text-foreground'
      : 'text-white',
  )

// Flisens indhold i editoren: hurtig-knapperne (størrelse, konfigurér) plus
// ikon, titel og undertitel. Kalderen leverer selve boksen — motion.div i
// rutenettet, en almindelig div for de løsrevne fliser.
function EditorTileFace({
  item,
  productTile,
  large,
  onToggleSize,
  onConfigure,
}: {
  item: TileLayoutItem
  productTile: ProductTile | null
  large: boolean
  onToggleSize: () => void
  onConfigure: () => void
}) {
  const { t } = useTranslation()
  const isEmpty = item.kind === 'empty'
  const fg = item.color?.trim() || undefined
  const fgStyle = fg ? { color: fg } : undefined
  const IconComp = homeTileIcon(item, productTile)
  const showIcon = tileIconShown(item) && !!IconComp
  const titleText = item.title?.trim() || (productTile ? t(`nav.${productTile.labelKey}`) : '')
  const subText = item.subtitle?.trim() || ''
  const showTitle = tileTitleShown(item) && !!titleText
  const showSub = tileSubtitleShown(item) && !!subText
  // Tom flise uden indhold beholder sin "Tom flise"-etikette.
  const emptyPlaceholder = isEmpty && !showIcon && !showTitle && !showSub
  // Mørk scrim bag ikonerne, så de kan ses uanset flisens baggrund
  // (hvidt billede / lys brugerfarve).
  const overlayBtn = isEmpty
    ? 'text-foreground/60 hover:bg-foreground/10 hover:text-foreground'
    : 'bg-black/35 text-white/90 backdrop-blur-[2px] hover:bg-black/55 hover:text-white'

  return (
    <>
      <AnimateIcon animateOnHover asChild>
        <button
          type="button"
          aria-label={t(large ? 'homeDesignPage.shrink' : 'homeDesignPage.expand')}
          title={t(large ? 'homeDesignPage.shrink' : 'homeDesignPage.expand')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleSize}
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
        onClick={onConfigure}
        className={cn(
          'absolute left-8 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors',
          overlayBtn,
        )}
      >
        <Settings2 size={15} />
      </button>
      {showIcon && IconComp && (
        <IconComp
          className={cn(
            'absolute',
            !fg && (isEmpty ? 'text-foreground/80' : 'text-white/90'),
            large ? 'right-3 top-3 size-12' : 'right-2.5 top-2.5 size-6',
          )}
          style={fgStyle}
          strokeWidth={1.5}
        />
      )}
      {item.kind === 'image' && !item.imageUrl && !showIcon && (
        <ImageIcon
          className={cn(
            'absolute text-white/70',
            large ? 'right-3 top-3 size-10' : 'right-2.5 top-2.5 size-6',
          )}
          strokeWidth={1.5}
        />
      )}
      {emptyPlaceholder && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {t('homeDesignPage.emptyTile')}
        </span>
      )}
      {showTitle && (
        <span
          className={cn(
            'font-medium leading-tight',
            large ? 'text-sm' : 'text-xs',
            item.kind === 'image' && item.imageUrl && '[text-shadow:0_1px_3px_rgb(0_0_0/0.6)]',
          )}
          style={fgStyle}
        >
          {titleText}
        </span>
      )}
      {showSub && (
        <span
          className={cn(
            'mt-0.5 leading-tight opacity-90',
            large ? 'text-xs' : 'text-[10px]',
            item.kind === 'image' && item.imageUrl && '[text-shadow:0_1px_3px_rgb(0_0_0/0.6)]',
          )}
          style={fgStyle}
        >
          {subText}
        </span>
      )}
    </>
  )
}

// Per-flise-konfiguration (popup), organiseret i tre faner:
//  - Grundlæggende: titel, undertitel, ikon (alle fliser)
//  - Farve & baggrund: forgrundsfarve, baggrundsfarve, baggrundsbillede
//  - Form & funktion: størrelse, hjørner, funktion/link
// Alle felter gælder nu alle flise-arter; kun baggrundsbillede (produkt/billede)
// og funktion/link (billede/tom) er art-afhængige. Farvevælgeren genbruges fra
// Konfigurér → Udseende. Ændringer anvendes live på layoutet; gem/annullér-
// bjælken persisterer dem.
function TileConfigDialog({
  item,
  tile,
  linkTargets,
  takenSlots,
  onPatch,
  onRemove,
  onClose,
  companyId,
}: {
  item: TileLayoutItem
  tile: ProductTile | null
  linkTargets: LinkTarget[]
  // Positioner de øvrige løsrevne fliser allerede optager — der kan kun ligge
  // én flise i hver af de ni positioner.
  takenSlots: Set<string>
  onPatch: (patch: Partial<TileLayoutItem>) => void
  onRemove: () => void
  onClose: () => void
  companyId?: string | null
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('basic')
  const productName = tile ? t(`nav.${tile.labelKey}`) : ''
  const titleEnabled = item.titleEnabled !== false
  const subtitleEnabled = item.subtitleEnabled !== false
  const iconEnabled = item.iconEnabled !== false
  const roundedEnabled = item.roundedEnabled === true
  const placement = tilePlacement(item)
  const placeX = tilePlaceX(item)
  const placeY = tilePlaceY(item)

  // Skift af placering: første gang flisen løsrives får den en ledig position
  // (dens hidtidige, hvis den er fri — ellers den første ledige).
  const patchPlacement = (next: TilePlacement): Partial<TileLayoutItem> => {
    if (next === 'grid') return { placement: 'grid' }
    if (!takenSlots.has(slotKey(placeX, placeY))) return { placement: next }
    const [x, y] = firstFreeSlot(takenSlots)
    return { placement: next, placeX: x, placeY: y }
  }

  // Baggrundsbillede kun på produkt-/billed-fliser; funktion/link kun på
  // billed-/tomme fliser (produkt-fliser linker allerede til deres eget produkt).
  const showImage = item.kind === 'product' || item.kind === 'image'
  const showLink = item.kind === 'image' || item.kind === 'empty'

  // Marker det aktive ikon i vælgeren: brugerens valg hvis sat, ellers produkt-
  // flisens standardikon (matches på ikon-komponenten, da alle produkt-ikoner
  // også findes i HOME_ICONS).
  const defaultIconKey = tile ? HOME_ICONS.find((ic) => ic.icon === tile.icon)?.key : undefined
  const selectedIconKey = item.icon ?? defaultIconKey

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

        <DetailTabs
          tabs={[
            { key: 'basic', label: t('homeDesignPage.tabBasic') },
            { key: 'colors', label: t('homeDesignPage.tabColors') },
            { key: 'shape', label: t('homeDesignPage.tabShape') },
          ]}
          active={tab}
          onChange={setTab}
          showMaximize={false}
        >
          {/* — Grundlæggende: titel, undertitel, ikon — */}
          {tab === 'basic' && (
            <div className="flex flex-col gap-5">
              {/* Titel */}
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

              {/* Undertitel */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label">{t('homeDesignPage.tileSubtitle')}</Label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={subtitleEnabled}
                      onCheckedChange={(v) => onPatch({ subtitleEnabled: v === true })}
                    />
                    {t('homeDesignPage.tileEnabled')}
                  </label>
                </div>
                <Input
                  value={item.subtitle ?? ''}
                  disabled={!subtitleEnabled}
                  onChange={(e) => onPatch({ subtitle: e.target.value })}
                />
              </div>

              {/* Ikon: vælger + vis/skjul. Produkt-fliser falder tilbage til
                  produktets eget ikon når intet er valgt. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label">{t('homeDesignPage.tileIcon')}</Label>
                  <div className="flex items-center gap-3">
                    {item.icon && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => onPatch({ icon: undefined })}
                      >
                        {t('homeDesignPage.resetIcon')}
                      </Button>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={iconEnabled}
                        onCheckedChange={(v) => onPatch({ iconEnabled: v === true })}
                      />
                      {t('homeDesignPage.showIcon')}
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {HOME_ICONS.map((ic) => {
                    const Icon = ic.icon
                    const selected = ic.key === selectedIconKey
                    return (
                      <button
                        key={ic.key}
                        type="button"
                        title={ic.key}
                        aria-label={ic.key}
                        aria-pressed={selected}
                        onClick={() => onPatch({ icon: ic.key, iconEnabled: true })}
                        className={cn(
                          'flex aspect-square cursor-pointer items-center justify-center rounded-md border transition-colors',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-accent/60',
                        )}
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* — Farve & baggrund — */}
          {tab === 'colors' && (
            <div className="flex flex-col gap-5">
              {/* Forgrundsfarve (tekst + ikon) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label">{t('homeDesignPage.tileForeground')}</Label>
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

              {/* Baggrundsfarve */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-label">{t('homeDesignPage.tileBackground')}</Label>
                  {item.background && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => onPatch({ background: undefined })}
                    >
                      {t('homeDesignPage.resetColor')}
                    </Button>
                  )}
                </div>
                <ColorPicker
                  value={item.background ?? null}
                  onChange={(v) => onPatch({ background: v })}
                />
              </div>

              {/* Baggrundsbillede (produkt/billede) */}
              {showImage && (
                <div className="flex flex-col gap-2">
                  <Label className="text-label">{t('homeDesignPage.tileBackgroundImage')}</Label>
                  <DesignImageField
                    url={item.imageUrl ?? ''}
                    onChange={(u) => onPatch({ imageUrl: u })}
                    kind="tile"
                    pathPrefix="home-design"
                    companyId={companyId}
                    hint={t('homeDesignPage.tileBackgroundHint')}
                  />
                </div>
              )}
            </div>
          )}

          {/* — Form & funktion — */}
          {tab === 'shape' && (
            <div className="flex flex-col gap-5">
              {/* Størrelse */}
              <div className="flex flex-col gap-2">
                <Label className="text-label">{t('homeDesignPage.tileSize')}</Label>
                <RadioGroup
                  value={item.size}
                  onValueChange={(v) => onPatch({ size: v as TileSize })}
                  className="flex flex-wrap gap-2"
                >
                  {TILE_SIZES.map((s) => (
                    <label
                      key={s}
                      htmlFor={`tile-size-${s}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
                    >
                      <RadioGroupItem value={s} id={`tile-size-${s}`} />
                      <span className="text-[13px] font-[450]">{s.replace('x', '×')}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

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
                      onPatch({
                        rounded: clamp(Math.round(Number(e.target.value) || 0), 0, MAX_TILE_RADIUS),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">px</span>
                </div>
              </div>

              {/* Placering: med i rutenettet, eller løsrevet og hæftet til en
                  af sidens ni positioner (fastgjort eller klæbende). */}
              <div className="flex flex-col gap-2">
                <Label className="text-label">{t('homeDesignPage.tilePlacement')}</Label>
                <RadioGroup
                  value={placement}
                  onValueChange={(v) => onPatch(patchPlacement(v as TilePlacement))}
                  className="flex flex-wrap gap-2"
                >
                  {TILE_PLACEMENTS.map((pl) => (
                    <label
                      key={pl}
                      htmlFor={`tile-placement-${pl}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
                    >
                      <RadioGroupItem value={pl} id={`tile-placement-${pl}`} />
                      <span className="text-[13px] font-[450]">
                        {t(`homeDesignPage.placement_${pl}`)}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  {t(`homeDesignPage.placementHint_${placement}`)}
                </p>
              </div>

              {/* Position for en løsrevet flise. Optagne positioner er slået
                  fra — der er kun plads til én flise i hver. */}
              {placement !== 'grid' && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label className="text-label">{t('homeDesignPage.alignX')}</Label>
                    <AlignChoice
                      name={`tile-place-x-${item.id}`}
                      value={placeX}
                      options={HOME_ALIGN_X}
                      onChange={(v) => onPatch({ placeX: v as HomeAlignX })}
                      isDisabled={(v) => takenSlots.has(slotKey(v as HomeAlignX, placeY))}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-label">{t('homeDesignPage.alignY')}</Label>
                    <AlignChoice
                      name={`tile-place-y-${item.id}`}
                      value={placeY}
                      options={HOME_ALIGN_Y}
                      onChange={(v) => onPatch({ placeY: v as HomeAlignY })}
                      isDisabled={(v) => takenSlots.has(slotKey(placeX, v as HomeAlignY))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('homeDesignPage.placementSlotHint')}
                  </p>
                </>
              )}

              {/* Funktion/link (billede/tom): gør flisen til en genvej til et produkt */}
              {showLink && (
                <div className="flex flex-col gap-2">
                  <Label className="text-label">{t('homeDesignPage.tileLink')}</Label>
                  <Select
                    value={item.linkProduct ?? '__none__'}
                    onValueChange={(v) => onPatch({ linkProduct: v === '__none__' ? undefined : v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('homeDesignPage.tileLinkNone')}</SelectItem>
                      {linkTargets.map((target) => (
                        <SelectItem key={target.key} value={target.key}>
                          {t(target.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('homeDesignPage.tileLinkHint')}</p>
                </div>
              )}
            </div>
          )}
        </DetailTabs>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
            {t('homeDesignPage.removeTile')}
          </Button>
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
  companyId,
}: {
  title: string
  subtitle?: string
  banner?: React.ReactNode
  baseTiles: TileLayoutItem[]
  baseDesign: HomeDesign
  saving: boolean
  onSave: (tiles: TileLayoutItem[], design: HomeDesign) => void
  // Null på platformsiden (standard), company_id på kundefladen — styrer
  // upload-stien i DesignImageField (storage-RLS).
  companyId?: string | null
}) {
  const { t } = useTranslation()

  // Layoutet deles i synlige fliser (rutenettet, kan trækkes rundt) og skjulte
  // produkt-fliser (fjernet af manageren, men beholdt så de ikke dukker op igen).
  // Ved gem sættes de to sammen igen.
  const baseVisible = baseTiles.filter((tl) => !isHiddenProduct(tl))
  const baseHidden = baseTiles.filter(isHiddenProduct)

  const [order, setOrder] = useState<TileLayoutItem[]>(baseVisible)
  const [hiddenTiles, setHiddenTiles] = useState<TileLayoutItem[]>(baseHidden)
  const [design, setDesign] = useState<HomeDesign>(baseDesign)
  const [tab, setTab] = useState('details')

  const containerRef = useRef<HTMLDivElement>(null)
  const orderRef = useRef<TileLayoutItem[]>(baseVisible)
  const designRef = useRef<HomeDesign>(baseDesign)
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

  orderRef.current = order
  designRef.current = design
  // Nulstil fra base-props når de skifter (første load + efter gem/invalidering).
  useEffect(() => {
    setOrder(baseTiles.filter((tl) => !isHiddenProduct(tl)))
    setHiddenTiles(baseTiles.filter(isHiddenProduct))
    setDesign(baseDesign)
  }, [baseTiles, baseDesign])

  const dirty =
    !sameOrder(order, baseVisible) ||
    !sameOrder(hiddenTiles, baseHidden) ||
    !sameDesign(design, baseDesign)
  const patchDesign = (patch: Partial<HomeDesign>) => setDesign((d) => ({ ...d, ...patch }))

  const [configId, setConfigId] = useState<string | null>(null)

  // Hurtig-knap (forstør/formindsk) på flisen: enhver flerfeltsflise skrumper
  // til 1×1, en 1×1 vokser til 2×2. Popup'en giver adgang til alle størrelser.
  const toggleSize = (id: string) => {
    setOrder((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o
        const [w, h] = sizeToWH(o.size)
        return { ...o, size: w * h > 1 ? '1x1' : '2x2' }
      }),
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

  // Produkt-fliser slettes ikke (så ville normalizeLayout føje dem til igen) —
  // de flyttes til de skjulte og kan hentes tilbage fra "Tilføj flise". Billed-/
  // tomme fliser fjernes helt.
  const removeTile = (id: string) => {
    const item = order.find((o) => o.id === id)
    if (item?.kind === 'product') {
      setHiddenTiles((prev) => [...prev, { ...item, hidden: true }])
    }
    setOrder((prev) => prev.filter((o) => o.id !== id))
    setConfigId(null)
  }

  // Hent en skjult produkt-flise tilbage i rutenettet.
  const restoreTile = (id: string) => {
    const item = hiddenTiles.find((h) => h.id === id)
    if (!item) return
    setHiddenTiles((prev) => prev.filter((h) => h.id !== id))
    const { hidden: _hidden, ...rest } = item
    setOrder((prev) => [...prev, rest])
  }

  // Mål en billed-/tom flise kan linke til: pakkemodulets sider plus de øvrige
  // produkter, der findes i layoutet (synlige som skjulte) — dvs. dem
  // virksomheden har adgang til på denne flade.
  const linkTargets = linkTargetsForProducts(
    [...order, ...hiddenTiles]
      .filter((o) => o.kind === 'product' && o.product)
      .map((o) => o.product as string),
  )

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

    // Kun rutenettets fliser flyder rundt; de løsrevne ligger fast i deres
    // position, så de skal hverken pakkes eller tælles med i indekset.
    const others = orderRef.current.filter((o) => o.id !== drag.id)
    const gridOthers = others.filter((o) => !isPinnedTile(o))
    const packedOthers = packTiles(gridOthers, cols).placed
    const gridIndex = packedOthers.filter((p) => p.y * cols + p.x < draggedReading).length
    // Oversæt pladsen blandt rutenettets fliser til et indeks i hele listen.
    const target =
      gridIndex < gridOthers.length ? others.indexOf(gridOthers[gridIndex]) : others.length
    const next = [...others.slice(0, target), dragged, ...others.slice(target)]
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
    setOrder(baseVisible)
    setHiddenTiles(baseHidden)
    setDesign(baseDesign)
  }

  const configItem = configId ? (order.find((o) => o.id === configId) ?? null) : null
  const configTile =
    configItem?.kind === 'product' && configItem.product
      ? (TILE_BY_PRODUCT[configItem.product] ?? null)
      : null

  const GAP = design.gap
  const STEP = CELL + GAP
  // Løsrevne fliser (fastgjort/klæbende) er ude af rutenettet; de tegnes i
  // preview-rammens 3×3-net i stedet.
  const { grid: gridOrder, pinned: pinnedOrder } = splitPinnedTiles(order)
  const { placed, rows } = packTiles(gridOrder, design.maxCols)
  const boardCols = design.maxCols
  const boardRows = Math.max(rows, design.maxRows)
  // Lærredet (træk-fladen) dækker hele det maks. rutenet; fliserne fylder kun
  // en del af det. Placering og farveflade følger det brugte område — samme
  // regnestykke som på Home, så preview'et passer.
  const boardWidth = boardCols * STEP - GAP
  const boardHeight = boardRows * STEP - GAP
  const contentCols = placed.reduce((max, p) => Math.max(max, p.x + p.w), 0)
  const contentWidth = Math.max(0, contentCols * STEP - GAP)
  const contentHeight = Math.max(0, rows * STEP - GAP)

  // Sidens baggrundsbillede + flisesektionens baggrundslag, som de vises på Home.
  const pageBackground = homeBackgroundUrl(design)
  const areaLayer = tileAreaLayer(design)

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
          {/* Sidens baggrundsbillede (bag hele Home) */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.backgroundSection')}</SectionTitle>
            <ToggleSection
              id="hd-page-bg"
              label={t('homeDesignPage.backgroundImage')}
              checked={design.backgroundEnabled}
              onCheckedChange={(v) => patchDesign({ backgroundEnabled: v })}
            >
              <DesignImageField
                url={design.backgroundUrl}
                onChange={(u) => patchDesign({ backgroundUrl: u })}
                kind="background"
                pathPrefix="home-design"
                companyId={companyId}
                hint={t('homeDesignPage.backgroundHint')}
              />
            </ToggleSection>
          </section>

          {/* Flisesektionens placering på siden */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.alignSection')}</SectionTitle>
            <div className="flex flex-col gap-1.5">
              <Label className="text-label">{t('homeDesignPage.alignX')}</Label>
              <AlignChoice
                name="align-x"
                value={design.alignX}
                options={HOME_ALIGN_X}
                onChange={(v) => patchDesign({ alignX: v as HomeAlignX })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-label">{t('homeDesignPage.alignY')}</Label>
              <AlignChoice
                name="align-y"
                value={design.alignY}
                options={HOME_ALIGN_Y}
                onChange={(v) => patchDesign({ alignY: v as HomeAlignY })}
              />
            </div>
          </section>

          {/* Flisesektionens egen baggrund (farve + gennemsigtighed) */}
          <section className="flex flex-col gap-3">
            <SectionTitle>{t('homeDesignPage.tileAreaSection')}</SectionTitle>
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex w-64 max-w-full flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-label">{t('homeDesignPage.tileAreaColor')}</Label>
                  {design.tileAreaColor && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => patchDesign({ tileAreaColor: '' })}
                    >
                      {t('homeDesignPage.resetColor')}
                    </Button>
                  )}
                </div>
                <ColorPicker
                  value={design.tileAreaColor || null}
                  onChange={(v) => patchDesign({ tileAreaColor: v })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('homeDesignPage.tileAreaTransparency')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={MAX_TRANSPARENCY}
                    value={design.tileAreaTransparency}
                    className="w-28"
                    onChange={(e) =>
                      patchDesign({
                        tileAreaTransparency: clamp(
                          Math.round(Number(e.target.value) || 0),
                          0,
                          MAX_TRANSPARENCY,
                        ),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('homeDesignPage.tileAreaHint')}</p>
          </section>

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
              onValueChange={(v) =>
                patchDesign({ theme: HOME_THEMES.includes(v as HomeTheme) ? (v as HomeTheme) : 'metro' })
              }
              className="flex flex-wrap gap-3"
            >
              {HOME_THEMES.map((th) => (
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
                  {/* Fjernede produkt-fliser kan hentes tilbage her. */}
                  {hiddenTiles.length > 0 && <DropdownMenuSeparator />}
                  {hiddenTiles.map((h) => {
                    const pt = h.product ? TILE_BY_PRODUCT[h.product] : null
                    if (!pt) return null
                    return (
                      <DropdownMenuItem
                        key={h.id}
                        className="cursor-pointer"
                        onClick={() => restoreTile(h.id)}
                      >
                        <pt.icon className="size-4" />{' '}
                        {t('homeDesignPage.restoreTile', { name: t(`nav.${pt.labelKey}`) })}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-xs text-muted-foreground">{t('homeDesignPage.tilesHint')}</p>
            <div className="max-w-full overflow-x-auto pb-1">
            {/* Preview-ramme: viser sidens baggrund, flisesektionens placering
                og dens baggrundsfarve, så indstillingerne ovenfor kan ses
                virke. Rammen er højere end rutenettet, ellers ville den
                lodrette placering ikke kunne ses. */}
            <div
              className={cn(
                'relative flex rounded-lg border border-dashed border-border/70 bg-muted/20 p-4',
                ALIGN_X_CLASS[design.alignX],
                ALIGN_Y_CLASS[design.alignY],
              )}
              style={{
                minWidth: boardWidth + 32,
                // Mindst hele lærredet, og altid lidt luft under fliserne —
                // ellers kunne den lodrette placering ikke ses i preview'et.
                minHeight: Math.max(boardHeight, contentHeight + 160) + 32,
                ...(pageBackground
                  ? {
                      backgroundImage: `url(${pageBackground})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : {}),
              }}
            >
            {/* Løsrevne fliser: ét 3×3-net over rammen, præcis som på Home
                (kun én flise pr. position). De kan ikke trækkes — positionen
                vælges i flisens popup. */}
            {pinnedOrder.length > 0 && (
              <div
                className="pointer-events-none absolute inset-0 z-0 grid grid-cols-3 grid-rows-3 p-4"
              >
                {pinnedOrder.map((item) => {
                  const productTile =
                    item.kind === 'product' && item.product
                      ? TILE_BY_PRODUCT[item.product]
                      : null
                  if (item.kind === 'product' && !productTile) return null
                  const [w, h] = sizeToWH(item.size)
                  const x = tilePlaceX(item)
                  const y = tilePlaceY(item)
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex',
                        COL_START_CLASS[x],
                        ROW_START_CLASS[y],
                        ALIGN_X_CLASS[x],
                        ALIGN_Y_CLASS[y],
                      )}
                    >
                      <div
                        className={cn(editorTileClass(item), 'pointer-events-auto relative')}
                        style={{
                          width: w * CELL + (w - 1) * GAP,
                          height: h * CELL + (h - 1) * GAP,
                          ...editorTileStyle(item, productTile, design.theme),
                        }}
                      >
                        <EditorTileFace
                          item={item}
                          productTile={productTile}
                          large={w >= 2 && h >= 2}
                          onToggleSize={() => toggleSize(item.id)}
                          onConfigure={() => setConfigId(item.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Boksen er det område fliserne fylder; selve lærredet nedenfor
                må gerne stikke ud under/til højre for den (tomme rækker og
                kolonner op til maks-rutenettet). */}
            <div
              className="relative z-10 shrink-0"
              style={{ width: contentWidth, height: contentHeight }}
            >
              {areaLayer && <div className="absolute -inset-4 rounded-lg" style={areaLayer} />}
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
                const width = p.w * CELL + (p.w - 1) * GAP
                const height = p.h * CELL + (p.h - 1) * GAP
                const pos = isDragging && dragPos ? dragPos : { x: p.x * STEP, y: p.y * STEP }
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
                      ...editorTileStyle(p, productTile, design.theme),
                    }}
                    className={cn(
                      editorTileClass(p),
                      isDragging ? 'z-50 cursor-grabbing opacity-95 shadow-xl' : 'z-[1] cursor-grab',
                    )}
                  >
                    <EditorTileFace
                      item={p}
                      productTile={productTile}
                      large={p.w >= 2 && p.h >= 2}
                      onToggleSize={() => toggleSize(p.id)}
                      onConfigure={() => setConfigId(p.id)}
                    />
                  </motion.div>
                )
              })}
            </div>
            </div>
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
                  companyId={companyId}
                  hint={t('homeDesignPage.logoHint')}
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
                  companyId={companyId}
                  hint={t('homeDesignPage.heroHint')}
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
          <Button size="sm" onClick={() => onSave([...order, ...hiddenTiles], design)} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      {configItem && (
        <TileConfigDialog
          item={configItem}
          tile={configTile}
          linkTargets={linkTargets}
          takenSlots={
            new Set(
              order.filter((o) => o.id !== configItem.id && isPinnedTile(o)).map(tileSlotKey),
            )
          }
          onPatch={(patch) => updateTile(configItem.id, patch)}
          onRemove={() => removeTile(configItem.id)}
          onClose={() => setConfigId(null)}
          companyId={companyId}
        />
      )}
    </div>
  )
}
