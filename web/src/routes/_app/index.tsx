import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  DEFAULT_GAP,
  normalizeDesign,
  normalizeLayout,
  packTiles,
  tileBackground,
  tileIconShown,
  tileRadius,
  tileTitleShown,
  TILE_BY_PRODUCT,
  type TileLayoutItem,
} from '@/lib/home-tiles'
import { cn } from '@/lib/utils'
import { canSeeProductTile, productTileHref } from '@/lib/roles'
import { supabase } from '@/lib/supabase'

// Home — startsiden (landing page). Metro/Windows 8-agtig: flade, ensfarvede
// firkanter i ét rutenet. Hver flise er et produkt, virksomheden har adgang
// til. Rækkefølge, størrelse (1×1 / 2×2), farvetema, kolonner/rækker samt
// velkomsttitel, undertitel, logo og hero-billede styres af platformens
// Home-design (Operia → Home-design, gemt på platform_settings). First-fit-
// pakning sikrer at fliser aldrig overlapper.
export const Route = createFileRoute('/_app/')({
  component: HomePage,
})

const CELL = 120

// Home-layoutet: kundens egen overstyring (company_home_config) hvis den findes,
// ellers platformens standard (platform_settings). Uanset kilde filtreres
// produktfliserne stadig efter virksomhedens aktuelle adgang (se `visible`).
function useHomeConfig(companyId: string | null) {
  return useQuery({
    queryKey: ['home-config', companyId],
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (companyId) {
        const { data: own } = await supabase
          .from('company_home_config')
          .select('home_tiles, home_design')
          .eq('company_id', companyId)
          .maybeSingle()
        if (own)
          return { tiles: normalizeLayout(own.home_tiles), design: normalizeDesign(own.home_design) }
      }
      const { data, error } = await supabase
        .from('platform_settings')
        .select('home_tiles, home_design')
        .single()
      if (error) throw error
      return { tiles: normalizeLayout(data.home_tiles), design: normalizeDesign(data.home_design) }
    },
  })
}

function HomePage() {
  const { t } = useTranslation()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()
  const { data: config } = useHomeConfig(companyId)

  const design = config?.design
  // Kun fliser for produkter virksomheden har adgang til, og som brugerens
  // roller åbner (platform-admins ser alt). Rækkefølgen bevares fra designet.
  const visible: TileLayoutItem[] = (config?.tiles ?? []).filter((item) => {
    // Billede-/tomme fliser er platform-designet dekoration: altid synlige.
    if (item.kind !== 'product') return true
    const tile = item.product ? TILE_BY_PRODUCT[item.product] : null
    if (!tile) return false
    if (access && !canSeeProductTile(tile.product, tile.href, access)) return false
    if (tile.core) return true
    return access?.isPlatformAdmin || (tile.entitlement && access?.products.has(tile.entitlement))
  })

  const cols = design?.maxCols ?? 4
  const GAP = design?.gap ?? DEFAULT_GAP
  const STEP = CELL + GAP
  const { placed, rows } = packTiles(visible, cols)
  const boardRows = Math.max(rows, design?.maxRows ?? 1)
  const boardWidth = cols * STEP - GAP
  const boardHeight = boardRows * STEP - GAP
  const theme = design?.theme ?? 'metro'

  const showTitle = !!design?.welcomeTitleEnabled && !!design.welcomeTitle.trim()
  const showSubtitle = !!design?.subtitleEnabled && !!design.subtitle.trim()
  const showLogo = !!design?.logoEnabled && !!design.logoUrl.trim()
  const showHero = !!design?.heroEnabled && !!design.heroUrl.trim()

  return (
    <div className="flex flex-col gap-5">
      {showHero && (
        <img
          src={design!.heroUrl}
          alt=""
          className="max-h-56 w-full rounded-lg object-cover"
        />
      )}
      {(showLogo || showTitle || showSubtitle) && (
        <div className="flex items-center gap-4">
          {showLogo && (
            <img src={design!.logoUrl} alt="" className="h-12 w-auto shrink-0 object-contain" />
          )}
          <div className="flex flex-col gap-0.5">
            {showTitle && (
              <h1 className="text-2xl font-semibold leading-tight">{design!.welcomeTitle}</h1>
            )}
            {showSubtitle && <p className="text-sm text-muted-foreground">{design!.subtitle}</p>}
          </div>
        </div>
      )}

      <div className="max-w-full overflow-x-auto pb-1">
      <div
        className="relative select-none"
        style={{ width: boardWidth, height: boardHeight }}
      >
        {placed.map((p) => {
          const large = p.size === '2x2'
          const width = p.w * CELL + (p.w - 1) * GAP
          const height = p.h * CELL + (p.h - 1) * GAP
          const box = {
            position: 'absolute' as const,
            left: p.x * STEP,
            top: p.y * STEP,
            width,
            height,
            borderRadius: tileRadius(p),
          }

          // Tom flise: usynlig afstands-holder (evt. med farve).
          if (p.kind === 'empty') {
            return (
              <div
                key={p.id}
                style={{ ...box, background: p.color?.trim() || 'transparent' }}
              />
            )
          }

          // Billed-flise: viser et billede; ikke-klikbar (intet mål).
          if (p.kind === 'image') {
            return (
              <div
                key={p.id}
                style={{
                  ...box,
                  backgroundColor: p.color?.trim() || undefined,
                  backgroundImage: p.imageUrl ? `url(${p.imageUrl})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
                className="flex flex-col justify-end overflow-hidden p-3 text-white shadow-sm"
              >
                {tileTitleShown(p) && p.title?.trim() && (
                  <span className={cn('font-medium leading-tight', large ? 'text-base' : 'text-[13px]')}>
                    {p.title}
                  </span>
                )}
              </div>
            )
          }

          // Produkt-flise: klikbar genvej. Destinationen er rolle-afhængig, så
          // en handler lander på en side, rollen faktisk kan åbne (fx
          // /parcels/receive) frem for produktets manager-hovedside.
          const tile = TILE_BY_PRODUCT[p.product!]
          const href = access ? productTileHref(tile.href, access) : tile.href
          return (
            <Link
              key={p.id}
              to={href}
              style={{ ...box, background: tileBackground(p, tile, theme) }}
              className={cn(
                'group flex flex-col justify-end overflow-hidden p-3 text-white shadow-sm outline-none',
                'transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:brightness-110 active:scale-[0.97]',
              )}
            >
              {tileIconShown(p) && (
                <tile.icon
                  className={cn('absolute text-white/90', large ? 'right-4 top-4 size-16' : 'right-3 top-3 size-8')}
                  strokeWidth={1.5}
                />
              )}
              {tileTitleShown(p) && (
                <span className={cn('font-medium leading-tight', large ? 'text-base' : 'text-[13px]')}>
                  {p.title?.trim() || t(`nav.${tile.labelKey}`)}
                </span>
              )}
            </Link>
          )
        })}
      </div>
      </div>
    </div>
  )
}
