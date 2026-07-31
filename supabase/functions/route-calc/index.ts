// route-calc — beregner en rute via den kort-/ruteudbyder der er valgt på
// Operia → Kort & ruter. Nøglerne (ORS_API_KEY / GOOGLE_MAPS_API_KEY) bliver
// server-side; browseren sender kun adresser/koordinater. Geokoder adresser
// (eller tager "lat,lng"), evt. optimerer stop-rækkefølgen og henter geometri +
// distance/tid. Kun godkendte brugere med 'routes'-produktet.
//
// Begge udbydere returnerer PRÆCIS samme svar-form, så klienten er udbyder-
// agnostisk: { geometry: { coordinates: [lng, lat][] }, waypoints, distance_m,
// duration_s }. Google leverer en encoded polyline, som vi afkoder server-side
// til GeoJSON-orden netop for at holde den kontrakt.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const ORS = 'https://api.openrouteservice.org'
const PROFILE: Record<string, string> = {
  car: 'driving-car',
  bike: 'cycling-regular',
  walk: 'foot-walking',
}

// Google Routes API bruger sine egne rejseform-navne.
const TRAVEL_MODE: Record<string, string> = {
  car: 'DRIVE',
  bike: 'BICYCLE',
  walk: 'WALK',
}

// Accepterer "lat, lng" (menneskeorden) og returnerer ORS-orden [lng, lat].
function parseLatLng(s: string): [number, number] | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}

type Waypoint = { lng: number; lat: number; label: string; kind: 'from' | 'stop' | 'to' }

type Body = {
  from?: string
  to?: string
  stops?: string[]
  transportType?: 'car' | 'bike' | 'walk'
  roundTrip?: boolean
  optimizeStops?: boolean
}

type Result = {
  geometry: { coordinates: [number, number][] }
  waypoints: Waypoint[]
  distance_m: number | null
  duration_s: number | null
}

// --- OpenRouteService ---------------------------------------------------

async function calcOrs(body: Body, key: string): Promise<Result> {
  const from = (body.from ?? '').trim()
  const to = (body.to ?? '').trim()
  const profile = PROFILE[body.transportType ?? 'car'] ?? 'driving-car'
  const stopTexts = (body.stops ?? []).map((s) => s.trim()).filter(Boolean)

  const resolve = async (text: string): Promise<[number, number]> => {
    const parsed = parseLatLng(text)
    if (parsed) return parsed
    const res = await fetch(
      `${ORS}/geocode/search?text=${encodeURIComponent(text)}&size=1`,
      { headers: { Authorization: key } },
    )
    const j = await res.json()
    const f = j?.features?.[0]
    if (!f?.geometry?.coordinates) throw new Error(`geocode_failed:${text}`)
    return f.geometry.coordinates as [number, number]
  }

  const fromC = await resolve(from)
  const toC = await resolve(to)
  let stopCoords = await Promise.all(stopTexts.map(resolve))
  let stopLabels = stopTexts.slice()

  // Optimér stop-rækkefølgen (én bil: start=fra, slut=til eller retur til fra).
  if (body.optimizeStops && stopCoords.length > 1) {
    const origCoords = stopCoords.slice()
    const origLabels = stopLabels.slice()
    const optBody = {
      jobs: origCoords.map((loc, i) => ({ id: i + 1, location: loc })),
      vehicles: [{ id: 1, profile, start: fromC, end: body.roundTrip ? fromC : toC }],
    }
    const or = await fetch(`${ORS}/optimization`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(optBody),
    })
    const oj = await or.json()
    const order: number[] = (oj?.routes?.[0]?.steps ?? [])
      .filter((s: { type: string }) => s.type === 'job')
      .map((s: { job: number }) => s.job)
    if (order.length === origCoords.length) {
      stopCoords = order.map((id) => origCoords[id - 1])
      stopLabels = order.map((id) => origLabels[id - 1])
    }
  }

  const coordinates: [number, number][] = [fromC, ...stopCoords, toC]
  if (body.roundTrip) coordinates.push(fromC)

  const dr = await fetch(`${ORS}/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  })
  const dj = await dr.json()
  const feat = dj?.features?.[0]
  if (!feat?.geometry?.coordinates) {
    throw new Error(`route_failed:${dj?.error?.message ?? JSON.stringify(dj?.error ?? null)}`)
  }
  const summary = feat.properties?.summary ?? {}

  return {
    geometry: { coordinates: feat.geometry.coordinates },
    waypoints: [
      { lng: fromC[0], lat: fromC[1], label: from, kind: 'from' },
      ...stopCoords.map((c, i) => ({
        lng: c[0],
        lat: c[1],
        label: stopLabels[i],
        kind: 'stop' as const,
      })),
      { lng: toC[0], lat: toC[1], label: to, kind: 'to' as const },
    ],
    distance_m: summary.distance ?? null,
    duration_s: summary.duration ?? null,
  }
}

// --- Google Maps Platform ----------------------------------------------

// Afkoder Googles "encoded polyline algorithm"-streng til GeoJSON-orden
// [lng, lat], så geometrien matcher ORS-grenen 1:1.
function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    let b: number
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    out.push([lng / 1e5, lat / 1e5])
  }
  return out
}

const latLng = (c: [number, number]) => ({
  location: { latLng: { latitude: c[1], longitude: c[0] } },
})

async function calcGoogle(body: Body, key: string): Promise<Result> {
  const from = (body.from ?? '').trim()
  const to = (body.to ?? '').trim()
  const travelMode = TRAVEL_MODE[body.transportType ?? 'car'] ?? 'DRIVE'
  const stopTexts = (body.stops ?? []).map((s) => s.trim()).filter(Boolean)

  const resolve = async (text: string): Promise<[number, number]> => {
    const parsed = parseLatLng(text)
    if (parsed) return parsed
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`,
    )
    const j = await res.json()
    // ZERO_RESULTS er "adressen findes ikke" (brugerfejl); REQUEST_DENIED /
    // OVER_QUERY_LIMIT er opsætningsfejl og skal ikke se ud som en dårlig
    // adresse — ellers jagter man den forkerte fejl.
    if (j?.status === 'OK') {
      const loc = j?.results?.[0]?.geometry?.location
      if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') return [loc.lng, loc.lat]
    }
    if (j?.status && j.status !== 'OK' && j.status !== 'ZERO_RESULTS') {
      throw new Error(`provider_error:${j.status}:${j?.error_message ?? ''}`)
    }
    throw new Error(`geocode_failed:${text}`)
  }

  const fromC = await resolve(from)
  const toC = await resolve(to)
  const stopCoords = await Promise.all(stopTexts.map(resolve))

  // Mellemstop som Routes API må omrokere. Ved rundtur er slutpunktet 'fra',
  // og 'til' bliver derfor et mellemstop.
  //
  // BEMÆRK en bevidst afvigelse fra ORS-grenen: Routes API optimerer ALLE
  // mellemstop under ét, så ved rundtur + optimering kan 'til' flytte sig væk
  // fra sidstepladsen. ORS holder den fast som næstsidste punkt. Vi beholder
  // kind:'to' på waypointet, så kortet stadig markerer den korrekt uanset hvor
  // i rækkefølgen den lander.
  const intermediates: { coord: [number, number]; label: string; kind: 'stop' | 'to' }[] =
    stopCoords.map((coord, i) => ({ coord, label: stopTexts[i], kind: 'stop' as const }))
  if (body.roundTrip) intermediates.push({ coord: toC, label: to, kind: 'to' })
  const destination = body.roundTrip ? fromC : toC

  const req: Record<string, unknown> = {
    origin: latLng(fromC),
    destination: latLng(destination),
    travelMode,
    polylineEncoding: 'ENCODED_POLYLINE',
  }
  if (intermediates.length) req.intermediates = intermediates.map((s) => latLng(s.coord))
  if (body.optimizeStops && intermediates.length > 1) req.optimizeWaypointOrder = true
  // routingPreference gælder kun motoriserede rejseformer; sendes den for
  // WALK/BICYCLE svarer API'et INVALID_ARGUMENT. TRAFFIC_AWARE er netop den
  // live-trafik-ETA der er hele grunden til at vælge Google frem for ORS.
  if (travelMode === 'DRIVE') req.routingPreference = 'TRAFFIC_AWARE'

  const rr = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex',
    },
    body: JSON.stringify(req),
  })
  const rj = await rr.json()
  if (!rr.ok) {
    throw new Error(`provider_error:${rj?.error?.status ?? rr.status}:${rj?.error?.message ?? ''}`)
  }
  const route = rj?.routes?.[0]
  const encoded = route?.polyline?.encodedPolyline
  if (!encoded) throw new Error('route_failed:no_route')

  // optimizedIntermediateWaypointIndex[i] = oprindeligt indeks for det stop der
  // besøges som nr. i. Mangler feltet (ingen optimering), er rækkefølgen uændret.
  const order: number[] = Array.isArray(route.optimizedIntermediateWaypointIndex)
    ? route.optimizedIntermediateWaypointIndex
    : intermediates.map((_, i) => i)
  const ordered =
    order.length === intermediates.length ? order.map((i) => intermediates[i]) : intermediates

  const waypoints: Waypoint[] = [
    { lng: fromC[0], lat: fromC[1], label: from, kind: 'from' },
    ...ordered.map((s) => ({ lng: s.coord[0], lat: s.coord[1], label: s.label, kind: s.kind })),
  ]
  // Ved rundtur ligger 'til' allerede i mellemstoppene, og 'fra' er både start
  // og slut — så tilføj kun slutpunktet når det er en enkeltrejse.
  if (!body.roundTrip) waypoints.push({ lng: toC[0], lat: toC[1], label: to, kind: 'to' })

  // duration kommer som protobuf-varighed, fx "1234s".
  const durationS = typeof route.duration === 'string' ? parseInt(route.duration, 10) : null

  return {
    geometry: { coordinates: decodePolyline(encoded) },
    waypoints,
    distance_m: typeof route.distanceMeters === 'number' ? route.distanceMeters : null,
    duration_s: Number.isFinite(durationS) ? durationS : null,
  }
}

// --- Handler ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen (kun app-brugere må bruge vores ruteudbyder-kvote).
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  // Ruteplanlægning er et betalt produkt: kalderens virksomhed skal have
  // 'routes'-entitlementet (platform-admins slipper igennem via helperen) —
  // ellers kunne enhver bruger brænde udbyder-kvoten af udenom produktgatingen.
  const { data: hasRoutes, error: entErr } = await asCaller.rpc('has_product', { p: 'routes' })
  if (entErr || hasRoutes !== true) return json({ error: 'forbidden' }, 403)

  // 2) Hvilken udbyder er valgt på platformen?
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: settings } = await admin.from('platform_settings').select('maps_provider').single()
  const provider = settings?.maps_provider ?? 'openrouteservice'
  if (provider !== 'openrouteservice' && provider !== 'google') {
    return json({ error: 'provider_not_supported', provider })
  }

  const key =
    provider === 'google'
      ? (Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '')
      : (Deno.env.get('ORS_API_KEY') ?? '')
  if (!key) return json({ error: 'missing_key' })

  const body = (await req.json().catch(() => ({}))) as Body
  if (!(body.from ?? '').trim() || !(body.to ?? '').trim()) return json({ error: 'from_to_required' })

  try {
    return json(provider === 'google' ? await calcGoogle(body, key) : await calcOrs(body, key))
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    if (msg.startsWith('geocode_failed:')) {
      return json({ error: 'geocode_failed', address: msg.slice('geocode_failed:'.length) })
    }
    if (msg.startsWith('provider_error:')) {
      return json({ error: 'provider_error', detail: msg.slice('provider_error:'.length) })
    }
    if (msg.startsWith('route_failed:')) {
      return json({ error: 'route_failed', detail: msg.slice('route_failed:'.length) })
    }
    return json({ error: 'calc_failed', detail: msg })
  }
})
