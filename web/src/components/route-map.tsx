import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { loadGoogleMaps, type GMap, type GOverlay, type GoogleMapsApi } from '@/lib/google-maps'
import { useMapsConfig } from '@/hooks/use-platform-settings'

// Kortkomponent til at vise en beregnet rute: en polyline + cirkelmarkører for
// fra/stop/til. Koordinater ind er [lat, lng] (Leaflet-orden) i begge grene.
//
// Renderer vælges ud fra platformens kort-/ruteudbyder (Operia → Kort & ruter):
//
//   openrouteservice → Leaflet + gratis OpenStreetMap-fliser
//   google           → Maps JavaScript API
//
// Det er ikke kosmetik. Google Maps Platforms vilkår ("No use with non-Google
// maps") forbyder at vise geokodning og rutegeometri fra deres API'er oven på
// et ikke-Google-kort, så når route-calc henter ruten hos Google, SKAL kortet
// også være Googles. Derfor falder Google-grenen heller ikke tilbage til
// Leaflet når browser-nøglen mangler — den viser en besked i stedet.

export type MapWaypoint = { lat: number; lng: number; kind: 'from' | 'stop' | 'to' }

type MapProps = {
  line?: [number, number][]
  waypoints?: MapWaypoint[]
  className?: string
}

const KIND_COLOR: Record<MapWaypoint['kind'], string> = {
  from: '#10b981',
  to: '#ef4444',
  stop: '#6366f1',
}

const LINE_COLOR = '#2563eb'
const FIT_PADDING = 28
const FIT_MAX_ZOOM = 15

export function RouteMap({ line, waypoints, className }: MapProps) {
  const { t } = useTranslation()
  const { data, isPending } = useMapsConfig()

  // Vent på udbyderen før der tegnes — ellers ville Leaflet nå at vise
  // OSM-fliser et øjeblik på en Google-platform.
  if (isPending) {
    return <div className={cn('animate-pulse rounded-md border bg-muted/40', className)} />
  }

  if (data?.maps_provider === 'google') {
    if (!data.google_maps_browser_key) {
      return (
        <div
          className={cn(
            'flex items-center justify-center rounded-md border bg-muted/30 p-6',
            className,
          )}
        >
          <p className="max-w-sm text-center text-xs text-muted-foreground">
            {t('routesPage.mapMissingBrowserKey')}
          </p>
        </div>
      )
    }
    return (
      <GoogleRouteMap
        apiKey={data.google_maps_browser_key}
        line={line}
        waypoints={waypoints}
        className={className}
      />
    )
  }

  return <LeafletRouteMap line={line} waypoints={waypoints} className={className} />
}

// --- OpenStreetMap (Leaflet) -------------------------------------------

// Ingen billed-assets (circleMarker) så der ikke er ikon-bundling-problemer.
function LeafletRouteMap({ line, waypoints, className }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  // Opret kortet én gang. En ResizeObserver kalder invalidateSize, så kortet
  // tegner korrekt når det vises i en dialog/fane der lige er foldet ud.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView([56.0, 10.5], 6)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Tegn/opdatér ruten når data ændrer sig.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds: [number, number][] = []

    if (line?.length) {
      L.polyline(line, { color: LINE_COLOR, weight: 4, opacity: 0.85 }).addTo(layer)
      bounds.push(...line)
    }
    for (const w of waypoints ?? []) {
      const color = KIND_COLOR[w.kind]
      L.circleMarker([w.lat, w.lng], {
        radius: 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(layer)
      bounds.push([w.lat, w.lng])
    }
    if (bounds.length) {
      map.invalidateSize()
      map.fitBounds(L.latLngBounds(bounds), { padding: [FIT_PADDING, FIT_PADDING], maxZoom: FIT_MAX_ZOOM })
    }
  }, [line, waypoints])

  return <div ref={containerRef} className={cn('rounded-md border', className)} />
}

// --- Google Maps --------------------------------------------------------

function GoogleRouteMap({ apiKey, line, waypoints, className }: MapProps & { apiKey: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GMap | null>(null)
  const overlaysRef = useRef<GOverlay[]>([])
  const [api, setApi] = useState<GoogleMapsApi | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadGoogleMaps(apiKey).then(
      (loaded) => alive && setApi(loaded),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [apiKey])

  // Opret kortet når api'et er klar.
  useEffect(() => {
    if (!api || !containerRef.current || mapRef.current) return
    mapRef.current = new api.Map(containerRef.current, {
      center: { lat: 56.0, lng: 10.5 },
      zoom: 6,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    })
  }, [api])

  // Tegn/opdatér ruten. Google har ingen layer-gruppe, så vi holder selv styr
  // på overlays og river dem af kortet inden nye tegnes.
  useEffect(() => {
    const map = mapRef.current
    if (!api || !map) return
    for (const o of overlaysRef.current) o.setMap(null)
    overlaysRef.current = []

    const bounds = new api.LatLngBounds()
    let count = 0

    if (line?.length) {
      overlaysRef.current.push(
        new api.Polyline({
          path: line.map(([lat, lng]) => ({ lat, lng })),
          map,
          strokeColor: LINE_COLOR,
          strokeWeight: 4,
          strokeOpacity: 0.85,
        }),
      )
      for (const [lat, lng] of line) {
        bounds.extend({ lat, lng })
        count++
      }
    }

    for (const w of waypoints ?? []) {
      const color = KIND_COLOR[w.kind]
      // Marker er formelt forældet til fordel for AdvancedMarkerElement, men
      // den kræver et Map ID oprettet i Google Cloud Console. Et symbol-ikon
      // her giver samme cirkel som Leaflet-grenen uden den ekstra opsætning.
      overlaysRef.current.push(
        new api.Marker({
          position: { lat: w.lat, lng: w.lng },
          map,
          icon: {
            path: api.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: color,
            strokeWeight: 2,
          },
        }),
      )
      bounds.extend({ lat: w.lat, lng: w.lng })
      count++
    }

    if (!count) return
    map.fitBounds(bounds, FIT_PADDING)
    // fitBounds har ingen maxZoom-option; klem zoom efter kortet har sat sig,
    // så et enkelt punkt ikke lander i gade-niveau (samme loft som Leaflet).
    api.event.addListenerOnce(map, 'idle', () => {
      const z = map.getZoom()
      if (typeof z === 'number' && z > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM)
    })
  }, [api, line, waypoints])

  useEffect(
    () => () => {
      for (const o of overlaysRef.current) o.setMap(null)
      overlaysRef.current = []
      mapRef.current = null
    },
    [],
  )

  if (failed) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-md border bg-muted/30 p-6', className)}
      >
        <p className="max-w-sm text-center text-xs text-muted-foreground">
          {t('routesPage.mapLoadFailed')}
        </p>
      </div>
    )
  }

  return <div ref={containerRef} className={cn('rounded-md border', className)} />
}
