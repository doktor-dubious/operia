import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  BarChart3,
  Bell,
  Boxes,
  CalendarRange,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Lock,
  MapPin,
  Package,
  PackageCheck,
  PackagePlus,
  QrCode,
  Radio,
  Route as RouteIcon,
  ScanLine,
  Search,
  Ship,
  Star,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react'

// Fælles katalog for startsidens (Home) produktfliser. Home-siden viser de
// fliser, kundens virksomhed har adgang til; Operia → Home-design arrangerer
// hele kataloget. Layoutet (rækkefølge + størrelse) gemmes på
// platform_settings.home_tiles og pakkes med packTiles til et Metro-rutenet.

// Flisestørrelse som "BxH" (bredde × højde i celler). Vælges i flisens
// konfiguration; en flise bredere end rutenettet beskæres til nettets bredde
// ved pakning (se packTiles), så den aldrig kan "falde ud" til højre.
export type TileSize = '1x1' | '2x1' | '3x1' | '2x2' | '3x2' | '2x3' | '3x3' | '4x4'

// Valgbare størrelser i flise-popup'en (rækkefølgen styrer knapperne).
export const TILE_SIZES: TileSize[] = ['1x1', '2x1', '3x1', '2x2', '3x2', '2x3', '3x3', '4x4']
const TILE_SIZE_SET = new Set<string>(TILE_SIZES)
export const toTileSize = (v: unknown): TileSize =>
  typeof v === 'string' && TILE_SIZE_SET.has(v) ? (v as TileSize) : '1x1'

// Syv farvetemaer. Fem har hver deres per-produkt-palet (metro/ocean/sunset/
// forest/berry); 'handheld' og 'slate' er ensfarvede temaer, der maler alle
// fliser i én farve. 'handheld' spejler håndterminalens panelfarve, så Home
// matcher enhedens look.
export type HomeTheme = 'handheld' | 'metro' | 'ocean' | 'sunset' | 'forest' | 'berry' | 'slate'

// De temaer der har en per-produkt-palet (dvs. alle undtagen de ensfarvede).
type PaletteTheme = 'metro' | 'ocean' | 'sunset' | 'forest' | 'berry'

// Rækkefølgen her styrer temavælgeren: håndterminal først, så metro, så resten.
export const HOME_THEMES: HomeTheme[] = [
  'handheld',
  'metro',
  'ocean',
  'sunset',
  'forest',
  'berry',
  'slate',
]

// Ensfarvede temaer ignorerer per-produkt-paletten og maler hver flise ens.
// 'handheld' spejler Android-enhedens flisepanel (HH.panel i
// handheld-design-editor.tsx / android'ens Theme.kt) — ændres den dér, så ret her.
const UNIFORM_THEME_COLOR: Partial<Record<HomeTheme, string>> = {
  handheld: '#16213A', // håndterminalens panelfarve
  slate: '#334155', // neutral mørk skifer
}

export type ProductTile = {
  product: string // stabil nøgle, gemt i layoutet
  core?: boolean // kerneprodukt (pakker): altid synligt på Home
  entitlement?: string // produktnøgle i access.products (kræves hvis ikke core)
  labelKey: string // i18n-nøgle under nav.*
  href: string
  icon: LucideIcon
  // Per-produkt-flisefarve for hvert palet-tema. Alle holder hvid tekst læsbar.
  //  metro  — klassiske bold Metro-farver
  //  ocean  — kølig palet (blå/teal/indigo)
  //  sunset — varm palet (orange/rød/rav/pink)
  //  forest — jordnær palet (grøn/teal/oliven/brun)
  //  berry  — palet i lilla/magenta/pink
  colors: Record<PaletteTheme, string>
}

export const PRODUCT_TILES: ProductTile[] = [
  { product: 'parcels', core: true, labelKey: 'parcels', href: '/parcels/overview', icon: Package, colors: { metro: '#0b8043', ocean: '#0e7490', sunset: '#ea580c', forest: '#15803d', berry: '#7e22ce' } },
  { product: 'assets', entitlement: 'assets', labelKey: 'assets', href: '/assets', icon: Archive, colors: { metro: '#d24726', ocean: '#0369a1', sunset: '#dc2626', forest: '#b45309', berry: '#be185d' } },
  { product: 'lager', entitlement: 'lager', labelKey: 'inventoryItems', href: '/inventory', icon: Boxes, colors: { metro: '#2d89ef', ocean: '#1d4ed8', sunset: '#d97706', forest: '#0f766e', berry: '#6d28d9' } },
  { product: 'lockers', entitlement: 'lockers', labelKey: 'lockers', href: '/products/lockers', icon: Lock, colors: { metro: '#603cba', ocean: '#4338ca', sunset: '#db2777', forest: '#4d7c0f', berry: '#86198f' } },
  { product: 'iot', entitlement: 'iot', labelKey: 'iot', href: '/products/iot', icon: Radio, colors: { metro: '#00aba9', ocean: '#0d9488', sunset: '#e11d48', forest: '#047857', berry: '#9333ea' } },
  { product: 'shipping', entitlement: 'shipping', labelKey: 'shipping', href: '/products/shipping', icon: Ship, colors: { metro: '#e3a21a', ocean: '#0891b2', sunset: '#f59e0b', forest: '#a16207', berry: '#c026d3' } },
  { product: 'routes', entitlement: 'routes', labelKey: 'routes', href: '/products/routes', icon: RouteIcon, colors: { metro: '#b91d47', ocean: '#5b21b6', sunset: '#be123c', forest: '#166534', berry: '#a21caf' } },
  { product: 'booking', entitlement: 'booking', labelKey: 'booking', href: '/products/booking', icon: CalendarRange, colors: { metro: '#9f00a7', ocean: '#7c3aed', sunset: '#c026d3', forest: '#365314', berry: '#7c3aed' } },
]

export function tileColor(tile: ProductTile, theme: HomeTheme): string {
  const uniform = UNIFORM_THEME_COLOR[theme]
  if (uniform) return uniform
  return tile.colors[theme as PaletteTheme]
}

export const TILE_BY_PRODUCT: Record<string, ProductTile> = Object.fromEntries(
  PRODUCT_TILES.map((tile) => [tile.product, tile]),
)

// ---------------------------------------------------------------------------
// Link-mål for billed- og tomme fliser ("Funktion (link)" i flise-popup'en).
// Produkt-fliserne kan linkes til som hidtil, men pakkemodulet er delt op i
// sine egne sider — så en flise kan pege direkte på fx "Modtag pakke" i stedet
// for kun produktets forside. `product` er alene til adgangskontrol
// (canSeeProductTile/SECTION_ROLES); `key` er det, der gemmes i layoutet.
// ---------------------------------------------------------------------------
export type LinkTarget = {
  key: string
  product: string
  entitlement?: string
  labelKey: string // fuld i18n-nøgle (nav.* for produkter, homeDesignPage.* for pakkesiderne)
  href: string
}

// Pakkemodulets sider. 'parcels-overview' afløser det gamle 'parcels'-mål, så
// listen navngiver siden frem for produktet. Egne labels (ikke nav.*), fordi
// listen skal sige hvad flisen gør — fx "Registrér tilstand" frem for
// menupunktets korte "Tilstand".
export const PARCEL_LINK_TARGETS: LinkTarget[] = [
  {
    key: 'parcels-overview',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsOverview',
    href: '/parcels/overview',
  },
  {
    key: 'parcels-receive',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsReceive',
    href: '/parcels/receive',
  },
  {
    key: 'parcels-handout',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsHandout',
    href: '/parcels/handout',
  },
  {
    key: 'parcels-move',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsMove',
    href: '/parcels/move',
  },
  {
    key: 'parcels-condition',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsCondition',
    href: '/parcels/condition',
  },
  {
    key: 'parcels-search',
    product: 'parcels',
    labelKey: 'homeDesignPage.linkParcelsSearch',
    href: '/parcels/search',
  },
]

export const LINK_TARGETS: LinkTarget[] = [
  ...PARCEL_LINK_TARGETS,
  // Øvrige produkter linker til deres egen forside som hidtil (nøgle =
  // produktnøgle). Pakke-produktet er udeladt — det dækkes af listen ovenfor.
  ...PRODUCT_TILES.filter((tile) => tile.product !== 'parcels').map((tile) => ({
    key: tile.product,
    product: tile.product,
    ...(tile.entitlement ? { entitlement: tile.entitlement } : {}),
    labelKey: `nav.${tile.labelKey}`,
    href: tile.href,
  })),
]

export const LINK_TARGET_BY_KEY: Record<string, LinkTarget> = Object.fromEntries(
  LINK_TARGETS.map((target) => [target.key, target]),
)

// Gemte layouts fra før opdelingen bærer produktnøglen 'parcels' som link — den
// peger på samme side som 'parcels-overview'.
const LEGACY_LINK_KEYS: Record<string, string> = { parcels: 'parcels-overview' }
export const resolveLinkKey = (key: string): string => LEGACY_LINK_KEYS[key] ?? key

// Link-mål der giver mening på denne flade: dem hvis produkt findes i layoutet
// (dvs. som virksomheden har adgang til). Rækkefølgen følger LINK_TARGETS.
export function linkTargetsForProducts(products: Iterable<string>): LinkTarget[] {
  const available = new Set(products)
  return LINK_TARGETS.filter((target) => available.has(target.product))
}

// Valgbart ikon-katalog til flisernes ikon-vælger (4 rækker à 6 = 24). Stabile
// nøgler gemmes i layoutet; produkt-fliser falder tilbage til produktets eget
// ikon når intet er valgt.
export type HomeIcon = { key: string; icon: LucideIcon }
export const HOME_ICONS: HomeIcon[] = [
  { key: 'package', icon: Package },
  { key: 'package-plus', icon: PackagePlus },
  { key: 'package-check', icon: PackageCheck },
  { key: 'archive', icon: Archive },
  { key: 'boxes', icon: Boxes },
  { key: 'warehouse', icon: Warehouse },
  { key: 'truck', icon: Truck },
  { key: 'route', icon: RouteIcon },
  { key: 'map-pin', icon: MapPin },
  { key: 'ship', icon: Ship },
  { key: 'lock', icon: Lock },
  { key: 'radio', icon: Radio },
  { key: 'calendar', icon: CalendarRange },
  { key: 'scan', icon: ScanLine },
  { key: 'barcode', icon: QrCode },
  { key: 'clipboard', icon: ClipboardList },
  { key: 'inbox', icon: Inbox },
  { key: 'bell', icon: Bell },
  { key: 'search', icon: Search },
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'users', icon: Users },
  { key: 'file', icon: FileText },
  { key: 'chart', icon: BarChart3 },
  { key: 'star', icon: Star },
]
export const HOME_ICON_BY_KEY: Record<string, HomeIcon> = Object.fromEntries(
  HOME_ICONS.map((i) => [i.key, i]),
)

// Standard hjørneradius (px) når en flise slår afrundede hjørner til.
export const DEFAULT_TILE_RADIUS = 8
export const MAX_TILE_RADIUS = 40

// Flise-art: et produkt (fra kataloget), et frit billede, eller en tom
// afstands-flise. Kun 'product'-fliser er koblet til et produkt/entitlement.
export type TileKind = 'product' | 'image' | 'empty'

// En flise i layoutet: art + stabil id + størrelse plus valgfri per-flise-
// overstyringer (titel, ikon-synlighed, farve, afrundede hjørner). Udeladte
// felter betyder "brug standard": titel/ikon vist, temaets farve, skarpe hjørner.
// For 'product'-fliser er id = produktnøglen; billede/tomme fliser får et uuid.
export type TileLayoutItem = {
  id: string
  kind: TileKind
  product?: string // kun kind==='product'
  imageUrl?: string // baggrundsbillede: billed-fliser (kind==='image') og valgfrit på produkt-fliser
  linkProduct?: string // kun kind==='image': gør billed-flisen klikbar som genvej til et produkt
  size: TileSize
  title?: string // brugerdefineret titel; tom/udeladt = produktnavnet
  titleEnabled?: boolean // default true
  subtitle?: string // brugerdefineret undertitel (valgfri)
  subtitleEnabled?: boolean // default true
  icon?: string // valgt ikon-nøgle (HOME_ICONS); udeladt = produktets standardikon / intet
  iconEnabled?: boolean // default true
  color?: string // FORGRUNDSFARVE (tekst + ikon); udeladt = hvid
  background?: string // baggrundsfarve/-fyld; udeladt = temaets produktfarve (produkt) / transparent
  rounded?: number // hjørneradius i px (bruges når roundedEnabled)
  roundedEnabled?: boolean // default false (Metro-flade firkanter)
  // Løsrevet placering: 'fixed'/'sticky' tager flisen ud af rutenettet og
  // hæfter den til positionen (placeX × placeY). Kun én flise pr. position.
  placement?: TilePlacement // default 'grid'
  placeX?: HomeAlignX // default 'right' (kun når placement ≠ 'grid')
  placeY?: HomeAlignY // default 'bottom'
  // Kun kind==='product': flisen er fjernet fra rutenettet. Rækken beholdes i
  // layoutet (i stedet for at slette den), så normalizeLayout ser produktet som
  // "kendt" og ikke føjer det til igen; Home og editoren skjuler skjulte fliser.
  hidden?: boolean
}

// Effektiv baggrund: brugerens baggrundsfarve hvis sat, ellers temaets flisefarve.
export function tileBackground(item: TileLayoutItem, tile: ProductTile, theme: HomeTheme): string {
  return item.background && item.background.trim() ? item.background : tileColor(tile, theme)
}

// Effektivt flise-ikon: brugerens valgte ikon (icon-nøgle) hvis sat, ellers
// produkt-flisens standardikon, ellers intet (billed-/tomme fliser uden valg).
export function homeTileIcon(
  item: Pick<TileLayoutItem, 'icon'>,
  productTile?: ProductTile | null,
): LucideIcon | null {
  if (item.icon && HOME_ICON_BY_KEY[item.icon]) return HOME_ICON_BY_KEY[item.icon].icon
  return productTile?.icon ?? null
}

export const tileTitleShown = (item: Pick<TileLayoutItem, 'titleEnabled'>) =>
  item.titleEnabled !== false
export const tileSubtitleShown = (item: Pick<TileLayoutItem, 'subtitleEnabled'>) =>
  item.subtitleEnabled !== false
export const tileIconShown = (item: Pick<TileLayoutItem, 'iconEnabled'>) =>
  item.iconEnabled !== false
export const tileRadius = (item: Pick<TileLayoutItem, 'rounded' | 'roundedEnabled'>) =>
  item.roundedEnabled ? (item.rounded ?? DEFAULT_TILE_RADIUS) : 0

// --- Løsrevne (fastgjorte/klæbende) fliser ------------------------------
type PinnedFields = Pick<TileLayoutItem, 'placement' | 'placeX' | 'placeY'>

export const tilePlacement = (item: PinnedFields): TilePlacement =>
  item.placement === 'fixed' || item.placement === 'sticky' ? item.placement : 'grid'
export const isPinnedTile = (item: PinnedFields) => tilePlacement(item) !== 'grid'
export const tilePlaceX = (item: PinnedFields): HomeAlignX => item.placeX ?? 'right'
export const tilePlaceY = (item: PinnedFields): HomeAlignY => item.placeY ?? 'bottom'

// Nøgle for en af de ni positioner — bruges til at holde dem unikke.
export const slotKey = (x: HomeAlignX, y: HomeAlignY) => `${x}|${y}`
export const tileSlotKey = (item: PinnedFields) => slotKey(tilePlaceX(item), tilePlaceY(item))

// Positionerne i den rækkefølge, en ny løsrevet flise får tildelt dem:
// hjørnerne først (nederst til højre er det typiske "flydende" hjørne).
const SLOT_ORDER: Array<[HomeAlignX, HomeAlignY]> = [
  ['right', 'bottom'],
  ['left', 'bottom'],
  ['right', 'top'],
  ['left', 'top'],
  ['center', 'bottom'],
  ['center', 'top'],
  ['right', 'middle'],
  ['left', 'middle'],
  ['center', 'middle'],
]

// Første ledige position (alle ni optaget ⇒ nederst til højre, som så deles).
export function firstFreeSlot(taken: Set<string>): [HomeAlignX, HomeAlignY] {
  return SLOT_ORDER.find(([x, y]) => !taken.has(slotKey(x, y))) ?? SLOT_ORDER[0]
}

// Fliser der er taget ud af rutenettet, i fast rækkefølge (én pr. position:
// dubletter — fx fra et gammelt layout — falder tilbage i rutenettet).
export function splitPinnedTiles(items: TileLayoutItem[]): {
  grid: TileLayoutItem[]
  pinned: TileLayoutItem[]
} {
  const grid: TileLayoutItem[] = []
  const pinned: TileLayoutItem[] = []
  const taken = new Set<string>()
  for (const item of items) {
    const slot = tileSlotKey(item)
    if (!isPinnedTile(item) || taken.has(slot)) {
      grid.push(item)
      continue
    }
    taken.add(slot)
    pinned.push(item)
  }
  return { grid, pinned }
}

// Rutenettets bredde i kolonner. Grundenheden er en firkant; 2×2-fliser
// spænder over to kolonner og to rækker.
export const GRID_COLS = 4

export function sizeToWH(size: TileSize): [number, number] {
  const [w, h] = size.split('x').map(Number)
  return [w, h]
}

export type PlacedTile = TileLayoutItem & { x: number; y: number; w: number; h: number }

// First-fit-pakning i `cols` kolonner. Rækkefølgen bestemmer placeringen:
// hver flise lægges i den første ledige position (top→bund, venstre→højre),
// hvor dens w×h-blok er fri. Garanterer at fliser aldrig overlapper, og at en
// forstørret flise skubber de efterfølgende fliser videre.
export function packTiles(
  items: TileLayoutItem[],
  cols = GRID_COLS,
): { placed: PlacedTile[]; rows: number } {
  const occupied = new Set<string>()
  const cell = (x: number, y: number) => `${x},${y}`
  const fits = (x: number, y: number, w: number, h: number) => {
    if (x + w > cols) return false
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) if (occupied.has(cell(x + dx, y + dy))) return false
    return true
  }
  const placed: PlacedTile[] = []
  let rows = 0
  for (const item of items) {
    const [rawW, h] = sizeToWH(item.size)
    // Beskær bredden til nettets bredde, ellers ville en flise bredere end
    // `cols` aldrig kunne placeres (x + w <= cols er aldrig sandt) og pakningen
    // ville løkke i det uendelige.
    const w = Math.min(rawW, cols)
    let done = false
    for (let y = 0; !done; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (fits(x, y, w, h)) {
          for (let dy = 0; dy < h; dy++)
            for (let dx = 0; dx < w; dx++) occupied.add(cell(x + dx, y + dy))
          placed.push({ ...item, x, y, w, h })
          rows = Math.max(rows, y + h)
          done = true
          break
        }
      }
    }
  }
  return { placed, rows }
}

// Placering af hele flisesektionen på Home (vandret × lodret). Rutenettet er
// smallere end siden, så manageren kan skubbe det hen hvor det passer med
// baggrundsbilledet.
export const HOME_ALIGN_X = ['left', 'center', 'right'] as const
export const HOME_ALIGN_Y = ['top', 'middle', 'bottom'] as const
export type HomeAlignX = (typeof HOME_ALIGN_X)[number]
export type HomeAlignY = (typeof HOME_ALIGN_Y)[number]

// Flexbox-klasser for de to akser (bruges både på Home og i editorens preview).
export const ALIGN_X_CLASS: Record<HomeAlignX, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
}
export const ALIGN_Y_CLASS: Record<HomeAlignY, string> = {
  top: 'items-start',
  middle: 'items-center',
  bottom: 'items-end',
}

// De ni positioner tegnes som et 3×3-net oven på siden; hver løsrevet flise
// lægges i sin egen celle.
export const COL_START_CLASS: Record<HomeAlignX, string> = {
  left: 'col-start-1',
  center: 'col-start-2',
  right: 'col-start-3',
}
export const ROW_START_CLASS: Record<HomeAlignY, string> = {
  top: 'row-start-1',
  middle: 'row-start-2',
  bottom: 'row-start-3',
}

// Flisens placering: med i rutenettet (standard), eller løsrevet og hæftet til
// en af sidens ni positioner — enten fastgjort til indholdsområdets kant
// (fixed: bliver på skærmen, også når siden scroller) eller klæbende (sticky:
// følger med siden, men holder sig ved kanten så længe den er i syne).
export const TILE_PLACEMENTS = ['grid', 'fixed', 'sticky'] as const
export type TilePlacement = (typeof TILE_PLACEMENTS)[number]

// Home-designets indstillinger (ved siden af fliselayoutet). Hvert
// tekst-/billedelement har et *Enabled-flag; er det slået fra, udelades
// elementet fra Home. Gemmes som platform_settings.home_design.
export type HomeDesign = {
  maxCols: number
  maxRows: number
  gap: number // afstand mellem fliser i px
  theme: HomeTheme
  // Baggrundsbillede for hele Home-siden (bag både velkomstindhold og fliser).
  backgroundUrl: string
  backgroundEnabled: boolean
  // Flisesektionens placering på siden.
  alignX: HomeAlignX
  alignY: HomeAlignY
  // Baggrund bag selve flisesektionen (må gerne afvige fra sidens baggrund),
  // med en gennemsigtighed så sidens baggrund kan skinne igennem.
  tileAreaColor: string // tom = ingen
  tileAreaTransparency: number // 0 = helt dækkende, 100 = usynlig
  welcomeTitle: string
  welcomeTitleEnabled: boolean
  subtitle: string
  subtitleEnabled: boolean
  logoUrl: string
  logoEnabled: boolean
  heroUrl: string
  heroEnabled: boolean
}

export const MIN_COLS = 2
export const MAX_COLS = 8
export const MIN_ROWS = 1
export const MAX_ROWS = 8
export const MIN_GAP = 0
export const MAX_GAP = 40
export const DEFAULT_GAP = 8
export const MAX_TRANSPARENCY = 100

export const DEFAULT_HOME_DESIGN: HomeDesign = {
  maxCols: 4,
  maxRows: 3,
  gap: DEFAULT_GAP,
  theme: 'metro',
  backgroundUrl: '',
  backgroundEnabled: false,
  alignX: 'left',
  alignY: 'top',
  tileAreaColor: '',
  tileAreaTransparency: 0,
  welcomeTitle: '',
  welcomeTitleEnabled: false,
  subtitle: '',
  subtitleEnabled: true,
  logoUrl: '',
  logoEnabled: false,
  heroUrl: '',
  heroEnabled: false,
}

const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

export function normalizeDesign(raw: unknown): HomeDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    maxCols: clampInt(d.maxCols, MIN_COLS, MAX_COLS, DEFAULT_HOME_DESIGN.maxCols),
    maxRows: clampInt(d.maxRows, MIN_ROWS, MAX_ROWS, DEFAULT_HOME_DESIGN.maxRows),
    gap: clampInt(d.gap, MIN_GAP, MAX_GAP, DEFAULT_HOME_DESIGN.gap),
    theme: HOME_THEMES.includes(d.theme as HomeTheme) ? (d.theme as HomeTheme) : 'metro',
    backgroundUrl: str(d.backgroundUrl),
    backgroundEnabled: bool(d.backgroundEnabled, DEFAULT_HOME_DESIGN.backgroundEnabled),
    alignX: HOME_ALIGN_X.includes(d.alignX as HomeAlignX) ? (d.alignX as HomeAlignX) : 'left',
    alignY: HOME_ALIGN_Y.includes(d.alignY as HomeAlignY) ? (d.alignY as HomeAlignY) : 'top',
    tileAreaColor: str(d.tileAreaColor),
    tileAreaTransparency: clampInt(
      d.tileAreaTransparency,
      0,
      MAX_TRANSPARENCY,
      DEFAULT_HOME_DESIGN.tileAreaTransparency,
    ),
    welcomeTitle: str(d.welcomeTitle),
    welcomeTitleEnabled: bool(d.welcomeTitleEnabled, DEFAULT_HOME_DESIGN.welcomeTitleEnabled),
    subtitle: str(d.subtitle),
    subtitleEnabled: bool(d.subtitleEnabled, DEFAULT_HOME_DESIGN.subtitleEnabled),
    logoUrl: str(d.logoUrl),
    logoEnabled: bool(d.logoEnabled, DEFAULT_HOME_DESIGN.logoEnabled),
    heroUrl: str(d.heroUrl),
    heroEnabled: bool(d.heroEnabled, DEFAULT_HOME_DESIGN.heroEnabled),
  }
}

// Sidens baggrundsbillede, hvis det er slået til og udfyldt (ellers null).
export const homeBackgroundUrl = (d: HomeDesign): string | null =>
  d.backgroundEnabled && d.backgroundUrl.trim() ? d.backgroundUrl.trim() : null

// Baggrundslaget bag flisesektionen. Farven males i et selvstændigt lag med
// CSS-opacity (frem for rgba), så gennemsigtigheden også virker på de
// gradienter farvevælgeren kan levere. Helt gennemsigtig ⇒ intet lag.
export function tileAreaLayer(d: HomeDesign): { background: string; opacity: number } | null {
  const background = d.tileAreaColor.trim()
  if (!background) return null
  const opacity = 1 - clampInt(d.tileAreaTransparency, 0, MAX_TRANSPARENCY, 0) / 100
  return opacity > 0 ? { background, opacity } : null
}

// Byg det effektive Home-layout ud fra et gemt layout: behold rækkefølgen for
// kendte fliser (produkt-, billede- og tomme fliser), og føj nye produkter
// (endnu ikke i layoutet) til sidst, så et nyt produkt aldrig forsvinder.
// Bagudkompatibelt: ældre poster uden `kind` behandles som produkt-fliser.
//
// `allowProduct` (valgfri): kundekonfigurationen viser kun de produkter
// virksomheden har adgang til. Er den sat, udelades produktfliser uden for
// filteret — både fra det gemte layout og fra opsamlingen af manglende
// produkter til sidst. Billede-/tomme fliser rammes aldrig af filteret.
export function normalizeLayout(
  saved: unknown,
  opts?: { allowProduct?: (product: string) => boolean },
): TileLayoutItem[] {
  const allowProduct = opts?.allowProduct
  const rawList = Array.isArray(saved) ? (saved as Array<Record<string, unknown>>) : []
  const seenProducts = new Set<string>()
  const layout: TileLayoutItem[] = []
  for (const raw of rawList) {
    const common = {
      size: toTileSize(raw?.size),
      ...(typeof raw.imageUrl === 'string' ? { imageUrl: raw.imageUrl } : {}),
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.titleEnabled === 'boolean' ? { titleEnabled: raw.titleEnabled } : {}),
      ...(typeof raw.subtitle === 'string' ? { subtitle: raw.subtitle } : {}),
      ...(typeof raw.subtitleEnabled === 'boolean' ? { subtitleEnabled: raw.subtitleEnabled } : {}),
      ...(typeof raw.icon === 'string' ? { icon: raw.icon } : {}),
      ...(typeof raw.iconEnabled === 'boolean' ? { iconEnabled: raw.iconEnabled } : {}),
      ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
      ...(typeof raw.background === 'string' ? { background: raw.background } : {}),
      ...(typeof raw.rounded === 'number' && Number.isFinite(raw.rounded)
        ? { rounded: Math.min(MAX_TILE_RADIUS, Math.max(0, Math.round(raw.rounded))) }
        : {}),
      ...(typeof raw.roundedEnabled === 'boolean' ? { roundedEnabled: raw.roundedEnabled } : {}),
      ...(TILE_PLACEMENTS.includes(raw.placement as TilePlacement)
        ? { placement: raw.placement as TilePlacement }
        : {}),
      ...(HOME_ALIGN_X.includes(raw.placeX as HomeAlignX)
        ? { placeX: raw.placeX as HomeAlignX }
        : {}),
      ...(HOME_ALIGN_Y.includes(raw.placeY as HomeAlignY)
        ? { placeY: raw.placeY as HomeAlignY }
        : {}),
    }
    // Link kun beholdt hvis det peger på et kendt mål (produkt eller pakkeside).
    // Gælder billed- og tomme fliser (produkt-fliser linker altid til sig selv).
    const linkKey =
      typeof raw.linkProduct === 'string' ? resolveLinkKey(raw.linkProduct) : null
    const linkPatch = linkKey && LINK_TARGET_BY_KEY[linkKey] ? { linkProduct: linkKey } : {}
    const kind: TileKind = raw.kind === 'image' ? 'image' : raw.kind === 'empty' ? 'empty' : 'product'
    if (kind === 'product') {
      const product = typeof raw?.product === 'string' ? raw.product : null
      if (!product || seenProducts.has(product) || !TILE_BY_PRODUCT[product]) continue
      // Markér som set før filteret, så en udeladt (ikke-tilladt) flise heller
      // ikke føjes til igen i opsamlingen nedenfor.
      seenProducts.add(product)
      if (allowProduct && !allowProduct(product)) continue
      layout.push({
        id: product,
        kind: 'product',
        product,
        ...(raw.hidden === true ? { hidden: true } : {}),
        ...common,
      })
    } else if (kind === 'image') {
      const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
      layout.push({ id, kind: 'image', ...linkPatch, ...common })
    } else {
      const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
      layout.push({ id, kind: 'empty', ...linkPatch, ...common })
    }
  }
  for (const tile of PRODUCT_TILES) {
    if (seenProducts.has(tile.product)) continue
    if (allowProduct && !allowProduct(tile.product)) continue
    layout.push({ id: tile.product, kind: 'product', product: tile.product, size: '1x1' })
  }
  return layout
}
