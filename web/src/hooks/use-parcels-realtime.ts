import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Realtime på parcels: håndterminalens handlinger (udlevering, afvisning,
// retur, flytning, intake) skal slå igennem i webkonsollen med det samme i
// stedet for at vente på app-skallens auto-refresh
// (platform_settings.refresh_interval_seconds, standard 30s). Pollingen bliver
// stående som fallback — falder websocket'en ud, opdateres skærmene stadig.
//
// Sikkerhed: Realtime håndhæver RLS på abonnenten (parcels_select er
// company-scoped), så vi kun får hændelser på egne pakker. Hændelsen bruges
// alligevel kun som signal — data hentes via de normale forespørgsler, der selv
// er RLS-beskyttede. Ingen rækkedata fra hændelsen lander i cachen.

// Forespørgsler der afhænger af pakkedata. Holdes samlet ét sted, så en ny
// pakkeskærm kun skal tilføjes her.
const PARCEL_QUERY_KEYS = [
  ['parcels'],
  ['parcel-status-counts'],
  ['parcel-dashboard'],
  ['parcel-stats'],
]

// Saml hændelser i et kort vindue før genhentning: en batch-intake fra
// håndterminalen kan udløse mange hændelser på én gang, og uden dette ville
// hver enkelt trigge sin egen runde forespørgsler.
const COALESCE_MS = 300

export function useParcelsRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const invalidate = () => {
      timer = null
      for (const key of PARCEL_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }

    const channel = supabase
      .channel('parcels-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parcels' }, () => {
        if (timer) return // allerede planlagt — lad vinduet løbe færdigt
        timer = setTimeout(invalidate, COALESCE_MS)
      })
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
