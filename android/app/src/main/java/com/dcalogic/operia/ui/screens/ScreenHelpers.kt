package com.dcalogic.operia.ui.screens

import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.data.Parcel
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Fælles skærm-hjælpere for håndterminalen. Delt af Modtag/Udlever/Flyt/Tilstand/
 * Søg, så modtager-etiketten og tidsvisningen ser ens ud alle steder (og kun skal
 * rettes ét sted).
 */

/** Modtageren som "Afdeling · Medarbejder" (dropper tomme led), "—" hvis ingen. */
internal fun receiverLabel(vm: AppViewModel, p: Parcel): String = listOfNotNull(
    vm.departments.firstOrNull { it.id == p.department_id }?.name,
    vm.employees.firstOrNull { it.id == p.receiver_employee_id }?.full_name,
).joinToString(" · ").ifBlank { "—" }

private val LOCAL_TS = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")

/**
 * Vis en Postgres-timestamptz i enhedens lokale tidszone. PostgREST serialiserer
 * i UTC (fx "2026-07-19T12:00:00+00:00"); en rå take(16) ville vise UTC-vægtur
 * og dermed et andet klokkeslæt end webbens lokale visning. Kan strengen ikke
 * parses (uventet format), falder vi tilbage til de første 16 tegn.
 */
internal fun formatLocalTimestamp(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(LOCAL_TS)
}.getOrElse { iso.take(16).replace("T", " ") }
