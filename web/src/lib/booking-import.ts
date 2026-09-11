import Papa from 'papaparse'
import { normalizeHeader } from '@/lib/module-import'

// Bookingimport fra fil (EVU-krav B-03): filen læses og kolonnerne mappes her;
// opslag, overlap, lås og selve skrivningen sker i basen (`import_bookings`).
//
// Kolonnemapningen er eksplicit OG automatisk: aliasserne foreslår en mapning
// ud fra headerne, og brugeren kan rette hver kolonne i en vælger. Det er
// svaret på et Dalux-ark, vi endnu ikke har set (B-04): når det kommer, er det
// en mapning i skærmen, ikke en ændring i koden.
//
// Tidspunkter kan komme som ét felt (start/slut) eller som dato + starttid +
// sluttid — begge dele er almindelige i lokaleeksporter. Tidspunkter sendes
// som vægur-tid uden offset; basen lægger virksomhedens tidszone på.

export type ImportField =
  | 'external_ref'
  | 'resource'
  | 'employee'
  | 'starts_at'
  | 'ends_at'
  | 'date'
  | 'start_time'
  | 'end_time'
  | 'title'
  | 'participant_count'
  | 'participant_level'
  | 'all_day'

export const IMPORT_FIELDS: { key: ImportField; aliases: string[]; required?: boolean }[] = [
  { key: 'external_ref', aliases: ['id', 'ref', 'reference', 'external_ref', 'ekstern_id', 'booking_id', 'bookingid', 'nr'] },
  { key: 'resource', aliases: ['ressource', 'resource', 'lokale', 'room', 'rum', 'lokalenavn', 'roomid', 'room_id', 'lokale_id'], required: true },
  { key: 'employee', aliases: ['medarbejder', 'employee', 'underviser', 'ansvarlig', 'booket_af', 'booker', 'initialer', 'initials', 'email', 'e_mail', 'medarbejdernr', 'medarbejder_nr'], required: true },
  { key: 'starts_at', aliases: ['start', 'starts_at', 'starttid', 'fra', 'from', 'start_time_full', 'startdato_tid'] },
  { key: 'ends_at', aliases: ['slut', 'ends_at', 'sluttid', 'til', 'to', 'end', 'slutdato_tid'] },
  { key: 'date', aliases: ['dato', 'date', 'dag'] },
  { key: 'start_time', aliases: ['start_kl', 'starttime', 'start_time', 'kl_fra', 'tid_fra'] },
  { key: 'end_time', aliases: ['slut_kl', 'endtime', 'end_time', 'kl_til', 'tid_til'] },
  { key: 'title', aliases: ['formål', 'formaal', 'titel', 'title', 'emne', 'beskrivelse', 'kursus', 'subject'] },
  { key: 'participant_count', aliases: ['kursister', 'deltagere', 'antal', 'participants', 'antal_kursister', 'antal_deltagere', 'count'] },
  { key: 'participant_level', aliases: ['niveau', 'level', 'kursistniveau', 'participant_level'] },
  { key: 'all_day', aliases: ['heldag', 'hele_dagen', 'all_day', 'allday'] },
]

export type ParsedFile = {
  headers: string[]
  rows: string[][]
  delimiter: string
}

export function parseCsv(text: string): ParsedFile {
  const sniff = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 5 })
  const delimiter = sniff.meta.delimiter || ';'
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { delimiter, skipEmptyLines: true })
  const [headers = [], ...rows] = parsed.data
  return { headers: headers.map((h) => h.trim()), rows, delimiter }
}

/** Foreslået mapning: header → felt, via aliasserne. Ukendte kolonner → null. */
export function suggestMapping(headers: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>()
  return headers.map((h) => {
    const n = normalizeHeader(h)
    const f = IMPORT_FIELDS.find((x) => !used.has(x.key) && x.aliases.includes(n))
    if (f) used.add(f.key)
    return f?.key ?? null
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Vægur-tid UDEN offset. Basen lægger virksomhedens tidszone på
 * (companies.timezone): filen beskriver et lokale i Danmark, og den, der
 * importerer, kan sidde i en anden tidszone — browserens offset er irrelevant.
 */
function toWallClock(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

/** "16.09.2026", "16-09-2026", "2026-09-16", "16/9/2026" → [y, m, d]. */
function parseDate(s: string): [number, number, number] | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])]
  return null
}

function parseTime(s: string): [number, number] | null {
  const m = s.trim().match(/(\d{1,2})[:.](\d{2})/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/**
 * Det, der står EFTER datoen i et dato+tid-felt: "2026-09-16 09:00" → " 09:00",
 * "2026-09-16T09:00" → "T09:00", "16.09.2026" → "". Datoen fjernes på sit eget
 * mønster — ikke som "første ord", for ISO-8601 sætter T mellem dato og tid
 * uden mellemrum, og så ville tiden ryge med datoen.
 */
function afterDate(s: string): string {
  return s.trim().replace(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/, '')
}

/** Har feltet et klokkeslæt efter datoen? */
export function hasTimePart(s: string | undefined): boolean {
  return !!s && parseTime(afterDate(s)) != null
}

/** Ét felt med dato og evt. klokkeslæt. Uden klokkeslæt = hele dagen fra 00:00. */
export function parseDateTime(s: string | undefined): Date | null {
  if (!s) return null
  const d = parseDate(s)
  if (!d) return null
  const tm = parseTime(afterDate(s)) ?? [0, 0]
  const out = new Date(d[0], d[1] - 1, d[2], tm[0], tm[1])
  return isNaN(out.getTime()) ? null : out
}

export type ImportRowPayload = {
  external_ref?: string
  resource?: string
  employee?: string
  starts_at?: string
  ends_at?: string
  title?: string
  participant_count?: number
  participant_level?: string
  all_day?: boolean
}

/** Filens rækker → RPC'ens rækker efter mapningen. Ugyldige tider sendes tomme, så basen siger 'bad_time'. */
export function buildPayload(file: ParsedFile, mapping: (ImportField | null)[]): ImportRowPayload[] {
  const idx = (f: ImportField) => mapping.indexOf(f)
  const cell = (row: string[], f: ImportField) => {
    const i = idx(f)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }
  return file.rows.map((row) => {
    let starts: Date | null = null
    let ends: Date | null = null
    let allDay = /^(ja|yes|true|1|x)$/i.test(cell(row, 'all_day'))
    if (idx('starts_at') >= 0) {
      starts = parseDateTime(cell(row, 'starts_at'))
      ends = parseDateTime(cell(row, 'ends_at'))
      // Slut angivet kun som dato (ingen klokkeslæt) → hele slutdagen.
      if (ends && idx('ends_at') >= 0 && !hasTimePart(cell(row, 'ends_at'))) {
        ends = new Date(ends.getFullYear(), ends.getMonth(), ends.getDate(), 23, 59)
        allDay = allDay || !hasTimePart(cell(row, 'starts_at'))
      }
    } else if (idx('date') >= 0) {
      const d = parseDate(cell(row, 'date'))
      const st = parseTime(cell(row, 'start_time'))
      const et = parseTime(cell(row, 'end_time'))
      if (d) {
        if (st && et) {
          starts = new Date(d[0], d[1] - 1, d[2], st[0], st[1])
          ends = new Date(d[0], d[1] - 1, d[2], et[0], et[1])
        } else {
          starts = new Date(d[0], d[1] - 1, d[2], 0, 0)
          ends = new Date(d[0], d[1] - 1, d[2], 23, 59)
          allDay = true
        }
      }
    }
    const count = cell(row, 'participant_count')
    return {
      external_ref: cell(row, 'external_ref') || undefined,
      resource: cell(row, 'resource') || undefined,
      employee: cell(row, 'employee') || undefined,
      starts_at: starts ? toWallClock(starts) : undefined,
      ends_at: ends ? toWallClock(ends) : undefined,
      title: cell(row, 'title') || undefined,
      participant_count: count && /^\d+$/.test(count) ? Number(count) : undefined,
      participant_level: cell(row, 'participant_level') || undefined,
      all_day: allDay || undefined,
    }
  })
}

export type ImportResultRow = {
  row: number
  action: 'create' | 'update' | 'unchanged' | 'skip'
  reason: string | null
  booking_id: string | null
  external_ref: string | null
  resource: string | null
  employee: string | null
  starts_at: string | null
  ends_at: string | null
}

export type ImportResult = {
  applied: boolean
  rows: number
  created: number
  updated: number
  unchanged: number
  skipped: number
  results: ImportResultRow[]
}
