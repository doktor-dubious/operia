import type { TFunction } from 'i18next'

// Oversæt en fejl fra Supabase/PostgREST (eller en almindelig Error) til en
// læsbar, lokaliseret besked. Erstatter det generiske "Noget gik galt" med noget
// der faktisk fortæller brugeren hvad der gik galt.
//
// PostgREST-fejl bærer en Postgres-SQLSTATE-kode på `.code`; de mest almindelige
// afbildes til en præcis besked. Ukendte koder falder tilbage til den generiske
// besked med den tekniske detalje vedhæftet, så support har noget at gå efter.
//
// Auth-fejl (og andre uden SQLSTATE-kode) har typisk kun `.message` — den vises
// direkte via `errors.withDetail`.

type ErrorLike = {
  code?: string | number
  message?: string
  details?: string
  hint?: string
}

// Kendte Postgres-SQLSTATE-koder → i18n-nøgle. Bemærk: 23505 (unik) afbildes til
// en neutral "findes allerede"-besked; skærme med et konkret felt (fx navn) bør
// selv oversætte 23505 til en feltspecifik besked (fx common.nameTaken) før de
// falder tilbage til describeError.
const CODE_KEYS: Record<string, string> = {
  '42501': 'common.noPermission', // insufficient_privilege (RLS afviste skrivning)
  '23505': 'errors.duplicate', // unique_violation
  '23503': 'errors.inUse', // foreign_key_violation
  '23502': 'errors.missingField', // not_null_violation
  '23514': 'errors.invalidValue', // check_violation
  '22P02': 'errors.invalidValue', // invalid_text_representation
  '22007': 'errors.invalidValue', // invalid_datetime_format
  '22001': 'errors.tooLong', // string_data_right_truncation
  '23P01': 'errors.conflict', // exclusion_violation
  '40001': 'errors.retryable', // serialization_failure
  '57014': 'errors.retryable', // query_canceled (timeout)
  PGRST301: 'common.noPermission', // JWT/rolle afviste
}

export function describeError(error: unknown, t: TFunction): string {
  if (error == null) return t('common.error')
  const e = error as ErrorLike
  const code = e.code != null ? String(e.code) : undefined
  if (code && CODE_KEYS[code]) return t(CODE_KEYS[code])

  const detail = typeof e.message === 'string' ? e.message.trim() : ''
  return detail ? t('errors.withDetail', { detail }) : t('common.error')
}
