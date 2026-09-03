import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { applyTextOverrides, fetchTextOverrides } from '@/lib/text-overrides'

/**
 * Henter og anvender virksomhedens (+ platformens) tekst-overstyringer for det
 * aktive sprog. Kaldes ét sted — i app-skallen — så hele brugerfladen får dem,
 * og køres igen når sproget eller den aktive virksomhed skifter.
 *
 * Query-nøglen deler præfiks med Tekster-siden, så et gem dér slår igennem i
 * skallen med det samme (samme mønster som Design/udseende havde).
 */
export function useTextOverrides() {
  const { i18n } = useTranslation()
  const { companyId } = useCompanyContext()
  const { session } = useSession()
  const lang = i18n.language.slice(0, 2)

  const { data } = useQuery({
    queryKey: ['app-text-overrides', companyId, lang],
    // Uden session har vi ingen læseadgang (RLS) — og ingen brugerflade at
    // overstyre endnu (login-siderne ligger uden for skallen).
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchTextOverrides(companyId, lang),
  })

  // Vent på svaret før der lægges (eller fjernes) et lag. Kørte effekten på
  // data === undefined, blev ALT nulstillet til locale-standarden hver gang
  // sproget eller den aktive virksomhed skiftede — teksterne blinkede tilbage
  // til standard og så på plads igen. Prisen er at det forrige lag står et
  // øjeblik længere ved et virksomhedsskift; det er kun kosmetiske etiketter,
  // og ét blink mindre er den bedre handel.
  useEffect(() => {
    if (!data) return
    applyTextOverrides(lang, data.merged)
  }, [data, lang])
}
