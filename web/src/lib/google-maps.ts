// Doven indlæser for Maps JavaScript API.
//
// Hvorfor overhovedet bruge Googles egen renderer? Google Maps Platforms vilkår
// ("No use with non-Google maps") forbyder at vise indhold fra deres API'er —
// geokodning og rutegeometri — oven på et ikke-Google-kort. Vælger platformen
// Google som udbyder, SKAL kortet derfor tegnes af Google og ikke af vores
// Leaflet/OSM-komponent. Se route-map.tsx for skiftet.
//
// Nøglen her er browser-nøglen fra platform_settings — offentlig pr. design og
// beskyttet med HTTP-referrer-begrænsning i Google Cloud, ikke ved hemmelig-
// holdelse. Server-nøglen (Geocoding/Routes) må aldrig havne her.
//
// I stedet for at trække @types/google.maps ind beskriver vi præcis den lille
// flade vi bruger. Det holder tsconfig'ens "types"-liste urørt og fejler stadig
// ved typefejl.

export type GLatLngLiteral = { lat: number; lng: number }

export type GLatLngBounds = {
  extend(p: GLatLngLiteral): GLatLngBounds
  isEmpty(): boolean
}

export type GMap = {
  fitBounds(bounds: GLatLngBounds, padding?: number): void
  setCenter(c: GLatLngLiteral): void
  setZoom(z: number): void
  getZoom(): number | undefined
}

export type GOverlay = { setMap(map: GMap | null): void }

export type GoogleMapsApi = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap
  Polyline: new (opts: Record<string, unknown>) => GOverlay
  Marker: new (opts: Record<string, unknown>) => GOverlay
  LatLngBounds: new () => GLatLngBounds
  SymbolPath: { CIRCLE: number }
  event: { addListenerOnce(target: object, event: string, handler: () => void): void }
}

const CALLBACK = '__operiaGoogleMapsReady'

let pending: Promise<GoogleMapsApi> | null = null
let pendingKey: string | null = null

/**
 * Indlæser Maps JavaScript API én gang pr. side og resolver med api'et.
 *
 * Maps JS kan kun indlæses én gang i et dokument: skifter browser-nøglen mens
 * fanen er åben, kan vi ikke hente scriptet igen, og kaldet resolver med det
 * allerede indlæste api. Brugeren skal genindlæse siden for at få den nye nøgle
 * i brug — derfor nævner admin-siden det eksplicit.
 */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  const existing = (globalThis as { google?: { maps?: GoogleMapsApi } }).google?.maps
  if (existing) return Promise.resolve(existing)
  if (pending && pendingKey === apiKey) return pending

  pendingKey = apiKey
  pending = new Promise<GoogleMapsApi>((resolve, reject) => {
    const w = globalThis as unknown as Record<string, unknown>
    w[CALLBACK] = () => {
      const api = (globalThis as { google?: { maps?: GoogleMapsApi } }).google?.maps
      delete w[CALLBACK]
      if (api) resolve(api)
      else reject(new Error('google_maps_unavailable'))
    }

    const script = document.createElement('script')
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: CALLBACK,
    })
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
    script.async = true
    // Netværks-/blokeringsfejl. Ugyldig nøgle giver derimod et indlæst script
    // der tegner Googles egen fejl-overlay i kortet — det kan vi ikke fange her.
    script.onerror = () => {
      pending = null
      pendingKey = null
      delete w[CALLBACK]
      reject(new Error('google_maps_script_failed'))
    }
    document.head.appendChild(script)
  })
  return pending
}
