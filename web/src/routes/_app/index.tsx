import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  ALIGN_X_CLASS,
  ALIGN_Y_CLASS,
  COL_START_CLASS,
  DEFAULT_GAP,
  homeBackgroundUrl,
  homeTileIcon,
  normalizeDesign,
  ROW_START_CLASS,
  sizeToWH,
  splitPinnedTiles,
  tileAreaLayer,
  tilePlaceX,
  tilePlaceY,
  tilePlacement,
  normalizeLayout,
  packTiles,
  tileBackground,
  tileIconShown,
  tileRadius,
  tileSubtitleShown,
  tileTitleShown,
  LINK_TARGET_BY_KEY,
  TILE_BY_PRODUCT,
  type PlacedTile,
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

// Afstand fra indholdsområdets kant til en løsrevet flise.
const PIN_PAD = 24

// Indholdsområdets (main-elementets) plads på skærmen. De fastgjorte fliser
// skal blive stående når siden scroller — men inden for indholdsområdet, så de
// ikke lægger sig hen over menuen. Måles derfor frem for at bruge hele vinduet.
function useContentAreaRect(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    const host = ref.current?.parentElement
    if (!enabled || !host) return
    const update = () => {
      const r = host.getBoundingClientRect()
      setRect((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height },
      )
    }
    update()
    // Fanger både vinduets størrelse og at sidemenuen foldes ind/ud.
    const observer = new ResizeObserver(update)
    observer.observe(host)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [enabled])

  return { ref, rect }
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
    // Skjulte produkt-fliser er fjernet fra rutenettet af manageren.
    if (item.kind === 'product' && item.hidden) return false
    // Billede-/tomme fliser er platform-designet dekoration: altid synlige.
    if (item.kind !== 'product') return true
    const tile = item.product ? TILE_BY_PRODUCT[item.product] : null
    if (!tile) return false
    if (access && !canSeeProductTile(tile.product, tile.href, access)) return false
    if (tile.core) return true
    return access?.isPlatformAdmin || (tile.entitlement && access?.products.has(tile.entitlement))
  })

  // Løsrevne fliser (fastgjort/klæbende) er ude af rutenettet og placeres af
  // 3×3-lagene nedenfor — én flise pr. position.
  const { grid: gridTiles, pinned } = splitPinnedTiles(visible)
  const pinnedTiles: PlacedTile[] = pinned.map((item) => {
    const [w, h] = sizeToWH(item.size)
    return { ...item, x: 0, y: 0, w, h }
  })
  const fixedTiles = pinnedTiles.filter((p) => tilePlacement(p) === 'fixed')
  const stickyTiles = pinnedTiles.filter((p) => tilePlacement(p) === 'sticky')
  const { ref: pageRef, rect: contentRect } = useContentAreaRect(fixedTiles.length > 0)

  const cols = design?.maxCols ?? 4
  const GAP = design?.gap ?? DEFAULT_GAP
  const STEP = CELL + GAP
  const { placed, rows } = packTiles(gridTiles, cols)
  // Flisesektionen fylder kun det område, fliserne rent faktisk optager (ikke
  // hele det maks. rutenet) — ellers ville placeringen og farvefladen bagved
  // omslutte tomt lærred, og fx "midtfor" ville ikke kunne ses.
  const contentCols = placed.reduce((max, p) => Math.max(max, p.x + p.w), 0)
  const boardWidth = Math.max(0, contentCols * STEP - GAP)
  const boardHeight = Math.max(0, rows * STEP - GAP)
  const theme = design?.theme ?? 'metro'

  const showTitle = !!design?.welcomeTitleEnabled && !!design.welcomeTitle.trim()
  const showSubtitle = !!design?.subtitleEnabled && !!design.subtitle.trim()
  const showLogo = !!design?.logoEnabled && !!design.logoUrl.trim()
  const showHero = !!design?.heroEnabled && !!design.heroUrl.trim()

  // Sidens baggrundsbillede, flisesektionens placering og dens eget
  // baggrundslag (alle fra Home-designet).
  const pageBackground = design ? homeBackgroundUrl(design) : null
  const areaLayer = design ? tileAreaLayer(design) : null
  const alignX = design?.alignX ?? 'left'
  const alignY = design?.alignY ?? 'top'

  // Én flise. `position` sættes for fliserne i rutenettet (absolut placering i
  // brættet); de løsrevne fliser får deres plads af 3×3-laget og sender ingen.
  const renderTile = (p: PlacedTile, position?: { left: number; top: number }) => {
    const large = p.w >= 2 && p.h >= 2
    const width = p.w * CELL + (p.w - 1) * GAP
    const height = p.h * CELL + (p.h - 1) * GAP
    const box = {
      // Uden position (løsrevet flise) skal boksen stadig være det, ikonet
      // placeres i forhold til — derfor 'relative'.
      ...(position ? { position: 'absolute' as const, ...position } : { position: 'relative' as const }),
      width,
      height,
      borderRadius: tileRadius(p),
    }

    // Fælles for alle flise-arter: produkt-fliser linker til deres eget
    // produkt; billed-/tomme fliser linker til det tildelte produkt
    // (linkProduct), hvis brugeren må se det. Ikon, titel, undertitel,
    // forgrunds- og baggrundsfarve gælder nu alle arter.
    const productTile = p.kind === 'product' && p.product ? TILE_BY_PRODUCT[p.product] : null
    // Billed-/tomme fliser peger på et link-mål: enten et produkt eller
    // en af pakkemodulets sider (fx 'parcels-receive').
    const linkTile = productTile ?? (p.linkProduct ? LINK_TARGET_BY_KEY[p.linkProduct] : null)
    const clickable =
      !!linkTile && (!access || canSeeProductTile(linkTile.product, linkTile.href, access))
    const href = clickable
      ? access
        ? productTileHref(linkTile.href, access)
        : linkTile.href
      : null

    const hasImage = !!p.imageUrl?.trim()
    const IconComp = homeTileIcon(p, productTile)
    const fg = p.color?.trim() || undefined
    const titleText = p.title?.trim() || (productTile ? t(`nav.${productTile.labelKey}`) : '')
    const subText = p.subtitle?.trim() || ''
    // Baggrund: produkt-fliser bruger temaets farve som standard; billed-/
    // tomme bruger den valgte baggrundsfarve (ellers gennemsigtig).
    const bg = productTile
      ? tileBackground(p, productTile, theme)
      : p.background?.trim() || 'transparent'
    const textShadow = hasImage ? '[text-shadow:0_1px_3px_rgb(0_0_0/0.6)]' : ''
    const fgStyle = fg ? { color: fg } : undefined

    const style = {
      ...box,
      background: bg,
      ...(hasImage
        ? {
            backgroundImage: `url(${p.imageUrl})`,
            backgroundSize: 'cover' as const,
            backgroundPosition: 'center' as const,
          }
        : {}),
    }

    const interactive =
      'transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:brightness-110 active:scale-[0.97]'

    const showIcon = tileIconShown(p) && !!IconComp
    const showTitle = tileTitleShown(p) && !!titleText
    const showSub = tileSubtitleShown(p) && !!subText

    // Tom/billed-flise helt uden indhold: ren (evt. farvet/billed-)flade —
    // fx en afstands-holder eller et rent dekorationsbillede.
    if (!showIcon && !showTitle && !showSub) {
      return href ? (
        <Link key={p.id} to={href} style={style} className={cn('outline-none', interactive)} />
      ) : (
        <div key={p.id} style={style} />
      )
    }

    const content = (
      <>
        {showIcon && IconComp && (
          <IconComp
            className={cn(
              'absolute',
              !fg && 'text-white/90',
              large ? 'right-4 top-4 size-16' : 'right-3 top-3 size-8',
              hasImage && 'drop-shadow-[0_1px_3px_rgb(0_0_0/0.6)]',
            )}
            style={fgStyle}
            strokeWidth={1.5}
          />
        )}
        {showTitle && (
          <span
            className={cn('font-medium leading-tight', large ? 'text-base' : 'text-[13px]', textShadow)}
            style={fgStyle}
          >
            {titleText}
          </span>
        )}
        {showSub && (
          <span
            className={cn(
              'mt-0.5 leading-tight opacity-90',
              large ? 'text-[13px]' : 'text-[11px]',
              textShadow,
            )}
            style={fgStyle}
          >
            {subText}
          </span>
        )}
      </>
    )

    const cls = cn(
      'group flex flex-col justify-end overflow-hidden p-3 text-white shadow-sm outline-none',
      clickable && interactive,
    )

    return href ? (
      <Link key={p.id} to={href} style={style} className={cls}>
        {content}
      </Link>
    ) : (
      <div key={p.id} style={style} className={cls}>
        {content}
      </div>
    )
  }

  return (
    // Negative margener + samme padding igen: baggrunden dækker hele
    // indholdsområdet (main'ens polstring inklusive), ikke kun fliserne.
    // Min-højden lægger main'ens polstring (pt-4 + pb-6 = 2.5rem) oveni, så
    // baggrunden også når ud i det stykke de negative margener dækker.
    <div
      ref={pageRef}
      className="relative -mx-6 -mb-6 -mt-4 flex min-h-[calc(100%+2.5rem)] flex-col gap-5 px-6 pb-6 pt-4"
      style={
        pageBackground
          ? {
              backgroundImage: `url(${pageBackground})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
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

      {/* Flisesektionen placeres i det resterende område efter velkomst-
          indholdet; farvelaget bag den ligger i sit eget lag, så en evt.
          gennemsigtighed lader sidens baggrund skinne igennem. */}
      {/* z-10: rutenettet ligger over de løsrevne fliser, så de aldrig dækker
          det hvis de deler plads på skærmen. */}
      <div
        className={cn(
          'relative z-10 flex min-w-0 flex-1',
          ALIGN_X_CLASS[alignX],
          ALIGN_Y_CLASS[alignY],
        )}
      >
      <div className="relative max-w-full">
      {areaLayer && <div className="absolute -inset-4 rounded-lg" style={areaLayer} />}
      <div className="relative max-w-full overflow-x-auto pb-1">
      <div
        className="relative select-none"
        style={{ width: boardWidth, height: boardHeight }}
      >
        {placed.map((p) => renderTile(p, { left: p.x * STEP, top: p.y * STEP }))}
      </div>
      </div>
      </div>
      </div>

      {/* Klæbende fliser: ligger i et 3×3-net på siden, følger med når den
          scroller, men holder sig ved kanten så længe de er i syne. Ligger
          under rutenettet (z-0), så de ikke dækker det. */}
      {stickyTiles.length > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-0 grid grid-cols-3 grid-rows-3"
          style={{ padding: PIN_PAD }}
        >
          {stickyTiles.map((p) => {
            const x = tilePlaceX(p)
            const y = tilePlaceY(p)
            return (
              <div
                key={p.id}
                className={cn(
                  'flex',
                  COL_START_CLASS[x],
                  ROW_START_CLASS[y],
                  ALIGN_X_CLASS[x],
                  ALIGN_Y_CLASS[y],
                )}
              >
                <div
                  className="pointer-events-auto sticky"
                  style={y === 'top' ? { top: PIN_PAD } : y === 'bottom' ? { bottom: PIN_PAD } : undefined}
                >
                  {renderTile(p)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Fastgjorte fliser: bliver på skærmen når siden scroller. Holdt inden
          for indholdsområdet (målt), så de ikke dækker menuen — og under
          rutenettet (z-0), så de heller ikke dækker fliserne. */}
      {fixedTiles.length > 0 && contentRect && (
        <div
          className="pointer-events-none fixed z-0 grid grid-cols-3 grid-rows-3"
          style={{ ...contentRect, padding: PIN_PAD }}
        >
          {fixedTiles.map((p) => {
            const x = tilePlaceX(p)
            const y = tilePlaceY(p)
            return (
              <div
                key={p.id}
                className={cn(
                  'flex',
                  COL_START_CLASS[x],
                  ROW_START_CLASS[y],
                  ALIGN_X_CLASS[x],
                  ALIGN_Y_CLASS[y],
                )}
              >
                <div className="pointer-events-auto">{renderTile(p)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
