import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'

// Letvægts-kortkomponent (Leaflet + gratis OpenStreetMap-fliser) til at vise en
// beregnet rute: en polyline + cirkelmarkører for fra/stop/til. Ingen billed-
// assets (circleMarker) så der ikke er ikon-bundling-problemer. Koordinater ind
// er [lat, lng] (Leaflet-orden).

export type MapWaypoint = { lat: number; lng: number; kind: 'from' | 'stop' | 'to' }

const KIND_COLOR: Record<MapWaypoint['kind'], string> = {
  from: '#10b981',
  to: '#ef4444',
  stop: '#6366f1',
}

export function RouteMap({
  line,
  waypoints,
  className,
}: {
  line?: [number, number][]
  waypoints?: MapWaypoint[]
  className?: string
}) {
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
      L.polyline(line, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(layer)
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
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15 })
    }
  }, [line, waypoints])

  return <div ref={containerRef} className={cn('rounded-md border', className)} />
}
