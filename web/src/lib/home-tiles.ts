import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Boxes,
  CalendarRange,
  Lock,
  Package,
  Radio,
  Route as RouteIcon,
  Ship,
} from 'lucide-react'

// Fælles katalog for startsidens (Home) produktfliser. Home-siden viser de
// fliser, kundens virksomhed har adgang til; Operia → Home-design arrangerer
// hele kataloget. Layoutet (rækkefølge + størrelse) gemmes på
// platform_settings.home_tiles og pakkes med packTiles til et Metro-rutenet.

export type TileSize = '1x1' | '2x2'

export type HomeTheme = 'metro' | 'muted'

export type ProductTile = {
  product: string // stabil nøgle, gemt i layoutet
  core?: boolean // kerneprodukt (pakker): altid synligt på Home
  entitlement?: string // produktnøgle i access.products (kræves hvis ikke core)
  labelKey: string // i18n-nøgle under nav.*
  href: string
  icon: LucideIcon
  color: string // flad Metro-flisefarve (bold)
  mutedColor: string // dæmpet variant (shadcn-agtig, afmættet mellemtone)
}

// To temaer: 'metro' (klassiske bold Metro-farver) og 'muted' (afmættede
// mellemtoner à la shadcn-farvepaletten). Begge holder hvid tekst læsbar.
export const PRODUCT_TILES: ProductTile[] = [
  { product: 'parcels', core: true, labelKey: 'parcels', href: '/parcels', icon: Package, color: '#0b8043', mutedColor: '#4f7a63' },
  { product: 'assets', entitlement: 'assets', labelKey: 'assets', href: '/assets', icon: Archive, color: '#d24726', mutedColor: '#9c6650' },
  { product: 'lager', entitlement: 'lager', labelKey: 'inventoryItems', href: '/inventory', icon: Boxes, color: '#2d89ef', mutedColor: '#4f7091' },
  { product: 'lockers', entitlement: 'lockers', labelKey: 'lockers', href: '/products/lockers', icon: Lock, color: '#603cba', mutedColor: '#66568c' },
  { product: 'iot', entitlement: 'iot', labelKey: 'iot', href: '/products/iot', icon: Radio, color: '#00aba9', mutedColor: '#3f7d7a' },
  { product: 'shipping', entitlement: 'shipping', labelKey: 'shipping', href: '/products/shipping', icon: Ship, color: '#e3a21a', mutedColor: '#927b45' },
  { product: 'routes', entitlement: 'routes', labelKey: 'routes', href: '/products/routes', icon: RouteIcon, color: '#b91d47', mutedColor: '#8a5062' },
  { product: 'booking', entitlement: 'booking', labelKey: 'booking', href: '/products/booking', icon: CalendarRange, color: '#9f00a7', mutedColor: '#7c5183' },
]

export function tileColor(tile: ProductTile, theme: HomeTheme): string {
  return theme === 'muted' ? tile.mutedColor : tile.color
}

export const TILE_BY_PRODUCT: Record<string, ProductTile> = Object.fromEntries(
  PRODUCT_TILES.map((tile) => [tile.product, tile]),
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
  imageUrl?: string // kun kind==='image'
  size: TileSize
  title?: string // brugerdefineret titel; tom/udeladt = produktnavnet
  titleEnabled?: boolean // default true
  iconEnabled?: boolean // default true
  color?: string // hex eller gradient; udeladt = temaets farve
  rounded?: number // hjørneradius i px (bruges når roundedEnabled)
  roundedEnabled?: boolean // default false (Metro-flade firkanter)
}

// Effektiv baggrund: brugerens farve hvis sat, ellers temaets flisefarve.
export function tileBackground(item: TileLayoutItem, tile: ProductTile, theme: HomeTheme): string {
  return item.color && item.color.trim() ? item.color : tileColor(tile, theme)
}

export const tileTitleShown = (item: Pick<TileLayoutItem, 'titleEnabled'>) =>
  item.titleEnabled !== false
export const tileIconShown = (item: Pick<TileLayoutItem, 'iconEnabled'>) =>
  item.iconEnabled !== false
export const tileRadius = (item: Pick<TileLayoutItem, 'rounded' | 'roundedEnabled'>) =>
  item.roundedEnabled ? (item.rounded ?? DEFAULT_TILE_RADIUS) : 0

// Rutenettets bredde i kolonner. Grundenheden er en firkant; 2×2-fliser
// spænder over to kolonner og to rækker.
export const GRID_COLS = 4

export function sizeToWH(size: TileSize): [number, number] {
  return size === '2x2' ? [2, 2] : [1, 1]
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
    const [w, h] = sizeToWH(item.size)
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

// Home-designets indstillinger (ved siden af fliselayoutet). Hvert
// tekst-/billedelement har et *Enabled-flag; er det slået fra, udelades
// elementet fra Home. Gemmes som platform_settings.home_design.
export type HomeDesign = {
  maxCols: number
  maxRows: number
  gap: number // afstand mellem fliser i px
  theme: HomeTheme
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

export const DEFAULT_HOME_DESIGN: HomeDesign = {
  maxCols: 4,
  maxRows: 3,
  gap: DEFAULT_GAP,
  theme: 'metro',
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
    theme: d.theme === 'muted' ? 'muted' : 'metro',
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
      size: (raw?.size === '2x2' ? '2x2' : '1x1') as TileSize,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.titleEnabled === 'boolean' ? { titleEnabled: raw.titleEnabled } : {}),
      ...(typeof raw.iconEnabled === 'boolean' ? { iconEnabled: raw.iconEnabled } : {}),
      ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
      ...(typeof raw.rounded === 'number' && Number.isFinite(raw.rounded)
        ? { rounded: Math.min(MAX_TILE_RADIUS, Math.max(0, Math.round(raw.rounded))) }
        : {}),
      ...(typeof raw.roundedEnabled === 'boolean' ? { roundedEnabled: raw.roundedEnabled } : {}),
    }
    const kind: TileKind = raw.kind === 'image' ? 'image' : raw.kind === 'empty' ? 'empty' : 'product'
    if (kind === 'product') {
      const product = typeof raw?.product === 'string' ? raw.product : null
      if (!product || seenProducts.has(product) || !TILE_BY_PRODUCT[product]) continue
      // Markér som set før filteret, så en udeladt (ikke-tilladt) flise heller
      // ikke føjes til igen i opsamlingen nedenfor.
      seenProducts.add(product)
      if (allowProduct && !allowProduct(product)) continue
      layout.push({ id: product, kind: 'product', product, ...common })
    } else if (kind === 'image') {
      const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
      layout.push({
        id,
        kind: 'image',
        ...(typeof raw.imageUrl === 'string' ? { imageUrl: raw.imageUrl } : {}),
        ...common,
      })
    } else {
      const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
      layout.push({ id, kind: 'empty', ...common })
    }
  }
  for (const tile of PRODUCT_TILES) {
    if (seenProducts.has(tile.product)) continue
    if (allowProduct && !allowProduct(tile.product)) continue
    layout.push({ id: tile.product, kind: 'product', product: tile.product, size: '1x1' })
  }
  return layout
}
