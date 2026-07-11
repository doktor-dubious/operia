// Læs en læsbar fejlbesked fra en Edge Function-fejl. supabase-js pakker
// non-2xx-svar som FunctionsHttpError, hvor selve Response ligger på .context;
// vores funktioner returnerer { error, detail } i kroppen. Fald tilbage til
// fallback, hvis intet kan læses.
export async function readEdgeError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.detail === 'string' && body.detail) return body.detail
      if (typeof body?.error === 'string' && body.error) return body.error
    } catch {
      // ignorér parse-fejl
    }
  }
  return fallback
}
