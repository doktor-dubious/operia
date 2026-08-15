# Databehandleraftale — sådan sættes den sammen

**Status:** udkast til bilagene · **Sidst gennemgået:** 2026-08-14 · **Ejer:** DCA Logics privacy owner.

## Hvad aftalen består af

| Del | Kilde | Hvem skriver den |
|---|---|---|
| Selve bestemmelserne | **Datatilsynets standardkontraktsbestemmelser** (Standardkontraktsbestemmelser, jan. 2020) — hentes uændret fra datatilsynet.dk | Datatilsynet |
| Bilag A, B, C (+ D) | [`bilag-da.md`](bilag-da.md) | DCA Logic |

Vi bruger Datatilsynets standard frem for en egen tekst, fordi kundens DPO
genkender den: gennemgangen bliver til en læsning af bilagene i stedet for en
forhandling af hele aftalen. **Bestemmelserne ændres ikke** — al udfyldning sker
i bilagene.

## Bilagene henter deres indhold ét sted fra

Bilagene må aldrig blive en selvstændig beskrivelse af systemet, der kan drive
fra virkeligheden:

| Bilag | Hentes fra |
|---|---|
| A — Oplysninger om behandlingen | [`../ropa.md`](../ropa.md) |
| B — Underdatabehandlere | [`../subprocessors.md`](../subprocessors.md) |
| C.2 — Behandlingssikkerhed | [`../toms.md`](../toms.md) **inkl. §12 (kendte begrænsninger)** |
| C.4 — Opbevaring/sletning | `../retention-schedule.md` (mangler — skrives som arbejdspunkt 7) |

Ændrer et af de dokumenter sig væsentligt, hæves bilagenes version, og kunderne
får den nye udgave.

## Version og registrering

Bilagene versioneres som `DCA-DPA-<major>.<minor>` (første udgave:
**`DCA-DPA-1.0`**). Den underskrevne version registreres i produktet på
virksomheden (`companies.dpa_version` / `dpa_signed_at` / `dpa_signed_by`,
Operia → Kunder → Databeskyttelse) — det er dokumentationen for, at aftalen var
på plads, **før** behandlingen begyndte. Kunden kan selv se registreringen under
Konfigurér → Databeskyttelse.

## Rækkefølge ved en ny kunde

1. Under salget: send [`../subprocessors.md`](../subprocessors.md) og
   [`../toms.md`](../toms.md) — de besvarer det meste af et
   sikkerhedsspørgeskema på forhånd.
2. Databehandleraftalen underskrives **sammen med hovedaftalen og altid før
   første behandling af rigtige personoplysninger** — også før en pilot.
   En pilot uden aftale må kun køre på syntetiske data, og det skal stå
   skriftligt.
3. Kunden udfylder sine kontakter under Konfigurér → Databeskyttelse
   (databeskyttelseskontakt + sikkerhedskontakt).
4. DCA registrerer version, dato og underskriver i Operia → Kunder.

## Endnu ikke gjort

- [ ] Juridisk gennemgang af bilagene (advokat) før første underskrift.
- [ ] Engelsk høflighedskopi — laves når den danske tekst er endeligt gennemgået,
      så to sprog ikke skal holdes i sync gennem review-runderne.
- [ ] DCA Logics egne stamdata (juridisk navn, CVR, adresse, tegningsberettiget)
      ind i bilagene — står som pladsholdere i dag.
- [ ] `../retention-schedule.md`, som C.4 skal henvise til.
