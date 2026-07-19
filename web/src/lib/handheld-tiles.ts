import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Bell,
  Boxes,
  ClipboardList,
  Handshake,
  Inbox,
  Map as MapIcon,
  Package,
  PackageCheck,
  PackagePlus,
  QrCode,
  Route as RouteIcon,
  ScanLine,
  Search,
  Signature,
  Truck,
  Upload,
  Warehouse,
} from 'lucide-react'

// Fælles katalog for Android-håndterminalens startskærm. Modstykket til
// home-tiles.ts, men handheld'ens fliser er et FAST katalog: de er
// kodedefinerede i appen (HomeScreen.kt) og feature-gatede pr. virksomhed —
// Operia → Handheld-design styrer kun deres udseende (titel, undertitel, ikon,
// farve, baggrund) plus indholdselementerne over dem.
//
// Gemmes på platform_settings.handheld_tiles / .handheld_design.
// `key` og `feature` skal matche Tile-listen i HomeScreen.kt.

// Ikon-tema: hvordan flisernes ikoner tegnes.
//   happy   — emoji (handheld'ens oprindelige udseende)
//   desktop — lucide, dvs. NØJAGTIG de ikoner skrivebordsappen bruger. På
//             handheld'en tegnes de fra vektorer genereret ud fra denne pakkes
//             egen lucide-react (web/scripts/gen-lucide-android-icons.mjs), så
//             de to flader ikke kan glide fra hinanden.
//   outline/solid/mono — Material-ikoner, dvs. Androids eget ikonsprog.
export type HandheldIconTheme = 'happy' | 'desktop' | 'outline' | 'solid' | 'mono'

export const HANDHELD_ICON_THEMES: HandheldIconTheme[] = [
  'happy',
  'desktop',
  'outline',
  'solid',
  'mono',
]

// Ét ikon-valg = én emoji (tema 'happy') + ét lucide-ikon (øvrige temaer), så
// et flise-ikon kan vælges uafhængigt af temaet.
export type HandheldIcon = {
  key: string
  emoji: string
  icon: LucideIcon
}

export const HANDHELD_ICONS: HandheldIcon[] = [
  // De fire første er skrivebordsappens egne ikoner for de samme funktioner
  // (jf. navGroups i lib/nav.ts) — handheld'ens standardfliser peger på dem, så
  // de to flader viser det samme ikon for den samme handling. Ændres et ikon i
  // nav.ts, bør det ændres her med.
  { key: 'parcel-add', emoji: '📦', icon: PackagePlus }, // nav: receive
  { key: 'parcel-check', emoji: '📤', icon: PackageCheck }, // nav: handout
  { key: 'route', emoji: '🧭', icon: RouteIcon }, // nav: routes
  { key: 'boxes', emoji: '📚', icon: Boxes }, // nav: inventoryItems
  { key: 'search', emoji: '🔎', icon: Search }, // skrivebordets søgeknap
  { key: 'parcel-in', emoji: '📦', icon: Package },
  { key: 'parcel-out', emoji: '📤', icon: Upload },
  { key: 'map', emoji: '🗺️', icon: MapIcon },
  { key: 'stock', emoji: '🗄️', icon: Archive },
  { key: 'inbox', emoji: '📥', icon: Inbox },
  { key: 'scan', emoji: '📷', icon: ScanLine },
  { key: 'barcode', emoji: '🏷️', icon: QrCode },
  { key: 'truck', emoji: '🚚', icon: Truck },
  { key: 'warehouse', emoji: '🏬', icon: Warehouse },
  { key: 'delivered', emoji: '✅', icon: PackageCheck },
  { key: 'signature', emoji: '✍️', icon: Signature },
  { key: 'handover', emoji: '🤝', icon: Handshake },
  { key: 'list', emoji: '📋', icon: ClipboardList },
  { key: 'bell', emoji: '🔔', icon: Bell },
]

export const ICON_BY_KEY: Record<string, HandheldIcon> = Object.fromEntries(
  HANDHELD_ICONS.map((i) => [i.key, i]),
)

// Handheld'ens faste flisekatalog. Rækkefølgen er appens rækkefølge.
export type HandheldTile = {
  key: string // stabil nøgle, gemt i layoutet — matcher HomeScreen.kt
  // feature-nøgle; flisen vises kun for virksomheder med adgang. Valgfri: en
  // gruppe/mappe gates IKKE på sin egen feature (børnenes egne gates afgør), så
  // den bærer ingen — i stedet for en misvisende filler-feature.
  feature?: string
  labelKey: string // i18n-nøgle under handheldDesignPage.tile_*
  subKey: string // i18n-nøgle for standard-undertitlen
  icon: string // standard-ikonnøgle (HANDHELD_ICONS)
  children?: string[] // sat = gruppe/mappe: åbner en underside med disse fliser
}

// Standard-ikonerne er skrivebordsappens ikoner for de SAMME funktioner
// (lib/nav.ts): receive=PackagePlus, handout=PackageCheck, routes=Route,
// inventoryItems=Boxes, søgning=Search. Ellers ville 'desktop'-ikontemaet vise
// skrivebordets tegnestil, men ikke skrivebordets ikoner.
export const HANDHELD_TILES: HandheldTile[] = [
  { key: 'receive', feature: 'hh_receive', labelKey: 'tile_receive', subKey: 'tile_receive_sub', icon: 'parcel-add' },
  { key: 'handout', feature: 'hh_handout', labelKey: 'tile_handout', subKey: 'tile_handout_sub', icon: 'parcel-check' },
  { key: 'move', feature: 'hh_move', labelKey: 'tile_move', subKey: 'tile_move_sub', icon: 'truck' },
  { key: 'condition', feature: 'hh_condition', labelKey: 'tile_condition', subKey: 'tile_condition_sub', icon: 'scan' },
  { key: 'search', feature: 'hh_search', labelKey: 'tile_search', subKey: 'tile_search_sub', icon: 'search' },
  { key: 'route', feature: 'hh_route', labelKey: 'tile_route', subKey: 'tile_route_sub', icon: 'route' },
  { key: 'stock', feature: 'hh_stock', labelKey: 'tile_stock', subKey: 'tile_stock_sub', icon: 'boxes' },
  // Gruppe-/mappeflise: åbner en underside med pakke-fliserne. `children` gør den
  // til en gruppe — appen viser den kun hvis mindst ét barn er tilgængeligt, og
  // navigerer til en underskærm i stedet for en enkelt funktion. Ingen `feature`:
  // grupper gates på deres børn, ikke på en egen entitlement.
  {
    key: 'parcel_group',
    labelKey: 'tile_parcel_group',
    subKey: 'tile_parcel_group_sub',
    icon: 'inbox',
    children: ['receive', 'handout', 'move', 'condition', 'search'],
  },
]

export const HANDHELD_TILE_BY_KEY: Record<string, HandheldTile> = Object.fromEntries(
  HANDHELD_TILES.map((t) => [t.key, t]),
)

// Per-flise-overstyringer. Udeladte felter betyder "brug standard": titel og
// undertitel fra i18n, katalogets ikon, handheld'ens egne panel-/tekstfarver.
export type HandheldTileItem = {
  key: string
  // Fjernet fra startskærmen. Fjernelse er et FLAG og ikke fravær i listen:
  // normalizeHandheldTiles føjer manglende katalogfliser til igen (så en ny
  // flise aldrig forsvinder), så en fjernet flise ville komme igen ved næste
  // indlæsning, hvis den blot blev slettet fra listen. Default true.
  //
  // Bemærk forskellen på de to mekanismer: her fjerner platformen flisen for
  // ALLE kunder; entitlement-gatingen i appen (vm.has("hh_search")) skjuler den
  // pr. kunde. En fjernet flise er væk uanset entitlement.
  enabled?: boolean
  title?: string // brugerdefineret titel; tom/udeladt = standardtitlen
  titleEnabled?: boolean // default true
  subtitle?: string // brugerdefineret undertitel
  subtitleEnabled?: boolean // default true
  icon?: string // ikonnøgle; udeladt = katalogets ikon
  color?: string // ikon-/accentfarve; udeladt = handheld'ens standard
  background?: string // flisens baggrund (hex eller gradient)
  children?: HandheldTileItem[] // kun for gruppe-fliser: underside-layoutet
}

export const tileEnabled = (item: Pick<HandheldTileItem, 'enabled'>) => item.enabled !== false

// Flet de viste flisers nye rækkefølge tilbage i den fulde liste. Mock-up'en
// viser kun de aktive fliser, så et træk giver kun deres indbyrdes rækkefølge;
// her skrives de ind i de pladser, viste fliser i forvejen optog. Fjernede
// fliser beholder derved deres plads i listen og dukker op samme sted, hvis de
// føjes til igen.
export function mergeVisibleOrder(
  all: HandheldTileItem[],
  nextVisible: HandheldTileItem[],
): HandheldTileItem[] {
  const slots = all.reduce<number[]>((acc, o, i) => (tileEnabled(o) ? [...acc, i] : acc), [])
  const next = [...all]
  nextVisible.forEach((tile, i) => {
    if (i < slots.length) next[slots[i]] = tile
  })
  return next
}

export const tileTitleShown = (item: Pick<HandheldTileItem, 'titleEnabled'>) =>
  item.titleEnabled !== false
export const tileSubtitleShown = (item: Pick<HandheldTileItem, 'subtitleEnabled'>) =>
  item.subtitleEnabled !== false

// Det effektive ikon for en flise: overstyringen hvis den peger på et kendt
// ikon, ellers katalogets standard.
export function tileIcon(item: HandheldTileItem, tile: HandheldTile): HandheldIcon {
  return ICON_BY_KEY[item.icon ?? ''] ?? ICON_BY_KEY[tile.icon] ?? HANDHELD_ICONS[0]
}

// Handheld-startskærmens indholdselementer + ikon-tema. Hvert tekst-/billed-
// element har et *Enabled-flag; er det slået fra, udelades elementet.
export type HandheldDesign = {
  iconTheme: HandheldIconTheme
  welcomeTitle: string
  welcomeTitleEnabled: boolean
  subtitle: string
  subtitleEnabled: boolean
  // Rækkefølgen af hilsen-elementerne (undertitel/titel) — redigerbar ved at
  // trække dem på detaljefanen. Enheden viser dem i samme rækkefølge.
  greetingOrder: string[]
  logoUrl: string
  logoEnabled: boolean
  heroUrl: string
  heroEnabled: boolean
}

// Hilsen-elementer der kan omarrangeres (spejles i HomeScreen.kt).
export const GREETING_KEYS = ['subtitle', 'title'] as const

export const DEFAULT_HANDHELD_DESIGN: HandheldDesign = {
  iconTheme: 'happy',
  welcomeTitle: '',
  // Tændt som standard: med tom welcomeTitle falder titlen tilbage til brugerens
  // fornavn, så en uændret opsætning stadig viser den personlige hilsen på
  // enheden (spejler HandheldDesignCfg i Android-appen).
  welcomeTitleEnabled: true,
  subtitle: '',
  subtitleEnabled: true,
  greetingOrder: ['subtitle', 'title'],
  logoUrl: '',
  logoEnabled: false,
  heroUrl: '',
  heroEnabled: false,
}

// Normalisér den gemte hilsen-rækkefølge: behold kendte nøgler i gemt rækkefølge,
// føj manglende til sidst (så et nyt element aldrig forsvinder), kassér ukendte.
export function normalizeGreetingOrder(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of arr) {
    if ((GREETING_KEYS as readonly string[]).includes(k) && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  for (const k of GREETING_KEYS) if (!seen.has(k)) out.push(k)
  return out
}

// Skabelon-koder i velkomsttitel/undertitel, erstattet ved visning på enheden
// (og i mock-up'ens forhåndsvisning). Spejles i HomeScreen.kt (applyTokens).
//   {{name}}          — den indloggede brugers fornavn
//   {{lastname}}      — efternavn
//   {{time-greeting}} — tidsafhængig hilsen (godmorgen/goddag/godaften/godnat)
export const DESIGN_TOKENS = ['{{name}}', '{{lastname}}', '{{time-greeting}}'] as const

export function applyDesignTokens(
  text: string,
  ctx: { firstName: string; lastName: string; timeGreeting: string },
): string {
  return text
    .replaceAll('{{name}}', ctx.firstName)
    .replaceAll('{{lastname}}', ctx.lastName)
    .replaceAll('{{time-greeting}}', ctx.timeGreeting)
}

// i18n-nøgle for tidshilsenen ud fra timen (0–23). Buckets spejler
// timeGreeting() i HomeScreen.kt, så web og enhed hilser ens.
export function timeGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 12) return 'handheldDesignPage.greetingMorning'
  if (hour >= 12 && hour < 18) return 'handheldDesignPage.greetingDay'
  if (hour >= 18 && hour < 22) return 'handheldDesignPage.greetingEvening'
  return 'handheldDesignPage.greetingNight'
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

export function normalizeHandheldDesign(raw: unknown): HandheldDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const theme = HANDHELD_ICON_THEMES.find((t) => t === d.iconTheme)
  return {
    iconTheme: theme ?? DEFAULT_HANDHELD_DESIGN.iconTheme,
    welcomeTitle: str(d.welcomeTitle),
    welcomeTitleEnabled: bool(d.welcomeTitleEnabled, DEFAULT_HANDHELD_DESIGN.welcomeTitleEnabled),
    subtitle: str(d.subtitle),
    subtitleEnabled: bool(d.subtitleEnabled, DEFAULT_HANDHELD_DESIGN.subtitleEnabled),
    greetingOrder: normalizeGreetingOrder(d.greetingOrder),
    logoUrl: str(d.logoUrl),
    logoEnabled: bool(d.logoEnabled, DEFAULT_HANDHELD_DESIGN.logoEnabled),
    heroUrl: str(d.heroUrl),
    heroEnabled: bool(d.heroEnabled, DEFAULT_HANDHELD_DESIGN.heroEnabled),
  }
}

// Byg det effektive flise-layout: behold den GEMTE rækkefølge for kendte
// fliser (rækkefølgen er selve layoutet — den er redigerbar ved at trække i
// mock-up'en) og føj katalogfliser, der endnu ikke er i layoutet, til sidst —
// så en ny handheld-flise aldrig forsvinder fra editoren. Ukendte nøgler og
// dubletter kasseres.
// Læs de fælles per-flise-overstyringer fra en rå gemt række.
function readTileOverrides(raw: Record<string, unknown>): Partial<HandheldTileItem> {
  return {
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.titleEnabled === 'boolean' ? { titleEnabled: raw.titleEnabled } : {}),
    ...(typeof raw.subtitle === 'string' ? { subtitle: raw.subtitle } : {}),
    ...(typeof raw.subtitleEnabled === 'boolean' ? { subtitleEnabled: raw.subtitleEnabled } : {}),
    ...(typeof raw.icon === 'string' && ICON_BY_KEY[raw.icon] ? { icon: raw.icon } : {}),
    ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
    ...(typeof raw.background === 'string' ? { background: raw.background } : {}),
  }
}

// Normalisér en gruppes børne-layout: kun de tilladte børnenøgler, gemt
// rækkefølge først, manglende føjet til sidst (så et nyt barn aldrig forsvinder).
function normalizeChildTiles(saved: unknown, allowedKeys: string[]): HandheldTileItem[] {
  const rawList = Array.isArray(saved) ? (saved as Array<Record<string, unknown>>) : []
  const seen = new Set<string>()
  const out: HandheldTileItem[] = []
  for (const raw of rawList) {
    const key = typeof raw?.key === 'string' ? raw.key : null
    if (!key || !allowedKeys.includes(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ key, ...readTileOverrides(raw) })
  }
  for (const key of allowedKeys) if (!seen.has(key)) out.push({ key })
  return out
}

export function normalizeHandheldTiles(saved: unknown): HandheldTileItem[] {
  const rawList = Array.isArray(saved) ? (saved as Array<Record<string, unknown>>) : []
  const seen = new Set<string>()
  const layout: HandheldTileItem[] = []
  const build = (key: string, raw: Record<string, unknown>): HandheldTileItem => {
    const catalog = HANDHELD_TILE_BY_KEY[key]
    const item: HandheldTileItem = { key, ...readTileOverrides(raw) }
    // Gruppe-fliser bærer deres underside-layout i `children`.
    if (catalog?.children) item.children = normalizeChildTiles(raw.children, catalog.children)
    return item
  }
  for (const raw of rawList) {
    const key = typeof raw?.key === 'string' ? raw.key : null
    if (!key || !HANDHELD_TILE_BY_KEY[key] || seen.has(key)) continue
    seen.add(key)
    layout.push(build(key, raw))
  }
  for (const tile of HANDHELD_TILES) {
    if (!seen.has(tile.key)) layout.push(build(tile.key, {}))
  }
  return layout
}
