// Fælles konstanter for integrationssiderne (Operia → Integrationer og
// Konfigurér → Integrationer). Intervallerne skal matche check-constraint'en
// på platform_settings/company_entra_config — en værdi der kun findes her,
// afvises af databasen.
export const SYNC_INTERVALS = [15, 60, 240, 720, 1440, 10080] as const

export type SyncInterval = (typeof SYNC_INTERVALS)[number]
