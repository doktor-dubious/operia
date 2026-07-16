// route-calc — beregner en rute via den kort-/ruteudbyder der er valgt på
// Operia → Kort & ruter. ORS-nøglen (ORS_API_KEY) bliver server-side; browseren
// sender kun adresser/koordinater. Geokoder adresser (eller tager "lat,lng"),
// evt. optimerer stop-rækkefølgen (ORS Optimization/Vroom) og henter geometri +
// distance/tid (ORS Directions). Kun godkendte brugere.

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

// Accepterer "lat, lng" (menneskeorden) og returnerer ORS-orden [lng, lat].
function parseLatLng(s: string): [number, number] | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}

type Body = {
  from?: string
  to?: string
  stops?: string[]
  transportType?: 'car' | 'bike' | 'walk'
  roundTrip?: boolean
  optimizeStops?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const orsKey = Deno.env.get('ORS_API_KEY') ?? ''

  // 1) Verificér kalderen (kun app-brugere må bruge vores ruteudbyder-kvote).
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  // Ruteplanlægning er et betalt produkt: kalderens virksomhed skal have
  // 'routes'-entitlementet (platform-admins slipper igennem via helperen) —
  // ellers kunne enhver bruger brænde ORS-kvoten af udenom produktgatingen.
  const { data: hasRoutes, error: entErr } = await asCaller.rpc('has_product', { p: 'routes' })
  if (entErr || hasRoutes !== true) return json({ error: 'forbidden' }, 403)

  // 2) Hvilken udbyder er valgt på platformen?
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: settings } = await admin.from('platform_settings').select('maps_provider').single()
  const provider = settings?.maps_provider ?? 'openrouteservice'
  if (provider !== 'openrouteservice') return json({ error: 'provider_not_supported', provider })
  if (!orsKey) return json({ error: 'missing_key' })

  const body = (await req.json().catch(() => ({}))) as Body
  const from = (body.from ?? '').trim()
  const to = (body.to ?? '').trim()
  if (!from || !to) return json({ error: 'from_to_required' })
  const profile = PROFILE[body.transportType ?? 'car'] ?? 'driving-car'
  const stopTexts = (body.stops ?? []).map((s) => s.trim()).filter(Boolean)

  const resolve = async (text: string): Promise<[number, number]> => {
    const parsed = parseLatLng(text)
    if (parsed) return parsed
    const res = await fetch(
      `${ORS}/geocode/search?text=${encodeURIComponent(text)}&size=1`,
      { headers: { Authorization: orsKey } },
    )
    const j = await res.json()
    const f = j?.features?.[0]
    if (!f?.geometry?.coordinates) throw new Error(`geocode_failed:${text}`)
    return f.geometry.coordinates as [number, number]
  }

  try {
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
        headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
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
      headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    })
    const dj = await dr.json()
    const feat = dj?.features?.[0]
    if (!feat?.geometry?.coordinates) {
      return json({ error: 'route_failed', detail: dj?.error?.message ?? dj?.error ?? null })
    }
    const summary = feat.properties?.summary ?? {}

    const waypoints = [
      { lng: fromC[0], lat: fromC[1], label: from, kind: 'from' as const },
      ...stopCoords.map((c, i) => ({ lng: c[0], lat: c[1], label: stopLabels[i], kind: 'stop' as const })),
      { lng: toC[0], lat: toC[1], label: to, kind: 'to' as const },
    ]

    return json({
      geometry: { coordinates: feat.geometry.coordinates },
      waypoints,
      distance_m: summary.distance ?? null,
      duration_s: summary.duration ?? null,
    })
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    if (msg.startsWith('geocode_failed:')) {
      return json({ error: 'geocode_failed', address: msg.slice('geocode_failed:'.length) })
    }
    return json({ error: 'calc_failed', detail: msg })
  }
})
