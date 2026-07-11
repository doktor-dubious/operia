// Læs en læsbar fejlbesked fra en Edge Function-fejl. supabase-js pakker
// non-2xx-svar som FunctionsHttpError, hvor selve Response ligger på .context;
// vores funktioner returnerer { error, detail } i kroppen. Fald tilbage til
// fallback, hvis intet kan læses.
export async function readEdgeError(
  error: unknown,
  fallback: string,
  map?: Record<string, string>,
): Promise<string> {
  const context = (error as { context?: unknown }).context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      const code = typeof body?.error === 'string' ? body.error : undefined
      // Kendt fejlkode → venlig, oversat besked.
      if (code && map?.[code]) return map[code]
      if (typeof body?.detail === 'string' && body.detail) return body.detail
      if (code) return code
    } catch {
      // ignorér parse-fejl
    }
  }
  return fallback
}
