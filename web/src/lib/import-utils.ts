// Fælles hjælpere for CSV-import/-eksport (medarbejdere + Aktiver/Lager) —
// samlet ét sted så modulimporten ikke driver fra medarbejderimportens
// hårdt lærte lektioner (footer-strip før parsning, sidevis hentning).

// Footeren fjernes FØR parsning: Papa's skipEmptyLines ville sluge en tom/
// whitespace-footer, hvorefter et slice(0, -1) på de parsede rækker ville
// fjerne en rigtig datarække i stedet. Ét afsluttende linjeskift er ikke en
// footer; derefter ryger sidste linje uanset indhold.
export function stripFooter(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  lines.pop()
  return lines.join('\n')
}

// PostgREST svarer med højst 1000 rækker pr. kald — hent ALT sidevis, ellers
// ser diff'en/eksporten kun de første 1000 rækker og behandler resten som
// nye/manglende. Kald med en stabil order() så siderne ikke overlapper.
export const PAGE_SIZE = 1000
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE_SIZE) return all
  }
}
