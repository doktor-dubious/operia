import type { ParcelStatus } from '@/components/parcel-status-badge'

// Flow 2 (relokering): de tre flytte-statusser en pakke kan sættes i.
export const MOVE_STATUSES = ['in_storage', 'in_transit', 'in_locker'] as const
export type MoveStatus = (typeof MOVE_STATUSES)[number]

// Hvilke flytte-statusser der er tilladt fra en given status — delmængden af
// parcel_transition_allowed (20260710031953_parcels.sql) der falder inden for
// MOVE_STATUSES, PLUS status-uændrede flytninger (samme status som mål). En ren
// hylde-til-hylde-relokering (Flow 2's kernecase) ændrer kun placeringen, ikke
// statussen: DB-guarden kører kun overgangstjekket når status faktisk ændres,
// så en in_storage→in_storage-flytning er tilladt og logges som 'moved'. Uden
// selv-målet ville UI'et tvinge en falsk statusændring (fx in_transit) for at
// flytte en pakke, der bliver stående i lager.
const MOVE_TARGETS: Record<ParcelStatus, MoveStatus[]> = {
  unassigned: ['in_storage'],
  registered: ['in_storage', 'in_transit', 'in_locker'],
  in_storage: ['in_storage', 'in_transit', 'in_locker'],
  in_transit: ['in_transit', 'in_storage', 'in_locker'],
  in_locker: ['in_locker', 'in_storage'],
  rejected: ['in_storage'],
  delivered: [],
  returned: [],
}

export function moveTargets(status: ParcelStatus): MoveStatus[] {
  return MOVE_TARGETS[status] ?? []
}

// En flytte-status skal pege på en placering (hvor pakken nu står), pånær
// 'in_transit' hvor pakken er undervejs og ikke nødvendigvis har en fast plads.
export function moveRequiresLocation(status: MoveStatus): boolean {
  return status !== 'in_transit'
}
