/**
 * Klassifikation af WebAuthn-fejl (passkeys).
 *
 * Browserens ceremoni fejler med en DOMException, hvis navn ER diagnosen —
 * men auth-js pakker den ind i sin egen WebAuthnError, så navnet skal graves
 * frem både på fejlen selv og på dens `cause`. Uden det kollapser alle årsager
 * til én generisk "det virkede ikke", og et forkert domæne ligner en afvist
 * finger.
 *
 * Bemærk om `NotAllowedError`: WebAuthn bruger med vilje SAMME fejl til
 * "brugeren afbrød" og "der findes ingen passkey til dette domæne" — ellers
 * kunne en side afprøve, om en bruger har en nøgle. De to kan derfor ikke
 * skelnes fra klienten, og begge behandles som 'cancelled' (tavse).
 */

export type PasskeyFailure =
  /** Brugeren lukkede prompten, den løb ud — eller der fandtes ingen passkey. */
  | 'cancelled'
  /** Siden kører på et domæne, der ikke matcher serverens rp_id (eller er usikker kontekst). */
  | 'origin'
  /** Browser/platform kan ikke det, ceremonien beder om. */
  | 'unsupported'
  /** Enheden er allerede tilmeldt (kun ved registrering). */
  | 'alreadyRegistered'
  /** Autentifikatoren kunne ikke opfylde kravene (fx ingen brugerverifikation). */
  | 'constraint'
  | 'unknown'

/** Fejlens tekniske navn — vises i UI som selvdiagnose ("SecurityError"). */
export function passkeyErrorName(err: unknown): string | null {
  const e = err as
    | { name?: string; code?: string; cause?: { name?: string; code?: string } }
    | null
    | undefined
  if (!e) return null
  // DOMException-navnet er det brugbare; auth-js' eget wrapper-navn
  // ("WebAuthnError") siger intet, så `cause` foretrækkes når den findes.
  const inner = e.cause?.name
  if (inner && inner !== 'Error') return inner
  if (e.name && e.name !== 'Error' && e.name !== 'AuthError') return e.name
  return e.code ?? e.cause?.code ?? null
}

export function classifyPasskeyError(err: unknown): PasskeyFailure {
  const name = passkeyErrorName(err)
  switch (name) {
    case 'NotAllowedError':
    case 'AbortError':
    case 'ERROR_CEREMONY_ABORTED':
      return 'cancelled'
    // Domænet matcher ikke rp_id, eller siden kører ikke i en sikker kontekst.
    // Dette er fejlen på localhost, når rp_id er produktionsdomænet.
    case 'SecurityError':
      return 'origin'
    case 'NotSupportedError':
      return 'unsupported'
    case 'InvalidStateError':
      return 'alreadyRegistered'
    case 'ConstraintError':
      return 'constraint'
    default:
      return 'unknown'
  }
}
