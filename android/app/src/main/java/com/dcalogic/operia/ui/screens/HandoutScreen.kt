package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Parcel
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.LookupPicker
import com.dcalogic.operia.ui.ReasonDialog
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.SignatureDialog
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import com.dcalogic.operia.ui.statusColor
import com.dcalogic.operia.ui.statusLabel
import kotlinx.coroutines.launch

// Hvilke handlinger den fundne pakkes status tillader. Spejler
// parcel_transition_allowed (20260710031953_parcels.sql) — serveren afviser
// alt andet, så knapperne SKAL følge state-maskinen, ellers får handleren en
// uforståelig fejl i stedet for en knap, der ikke er der.
//
// Bemærk de to asymmetrier, der let overses:
//   - in_locker må IKKE afvises (kun udleveres/returneres/tages i lager)
//   - registered må IKKE returneres (men gerne afvises)

/** Statusser hvorfra udlevering er tilladt. */
private val DELIVERABLE = setOf("registered", "in_storage", "in_transit", "in_locker")

/** Statusser hvorfra afvisning er tilladt. */
private val REJECTABLE = setOf("registered", "in_storage", "in_transit")

/** Statusser hvorfra retur til afsender er tilladt. */
private val RETURNABLE = setOf("unassigned", "in_storage", "in_transit", "in_locker", "rejected")

/** Statusser hvor skærmen har noget at tilbyde. Kun 'delivered' og 'returned'
 *  er terminale — en allerede afvist pakke kan fx stadig returneres. */
private val ACTIONABLE = DELIVERABLE + REJECTABLE + RETURNABLE + "unassigned"

/**
 * Udlever pakke (spec §handover: accept/afvis). Scan → find pakken → enten
 * kvittér med navn, evt. note og underskrift, eller afvis/returnér med en
 * påkrævet årsag. En 'unassigned' pakke skal først have tildelt modtager
 * (state-maskinen tillader ikke unassigned → delivered).
 */
@Composable
fun HandoutScreen(vm: AppViewModel, onBack: () -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var parcel by remember { mutableStateOf<Parcel?>(null) }
    var assignEmpId by remember { mutableStateOf<String?>(null) }
    var who by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf<ByteArray?>(null) }
    var sigOpen by remember { mutableStateOf(false) }
    var rejectOpen by remember { mutableStateOf(false) }
    var returnOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.handout_not_found)
    val msgLookupFailed = stringResource(R.string.handout_lookup_failed)
    val msgTerminal = stringResource(R.string.handout_terminal_status)
    val msgWho = stringResource(R.string.handout_who_required)
    val msgAssign = stringResource(R.string.handout_assign_required)
    val msgDone = stringResource(R.string.handout_done)
    val msgFailed = stringResource(R.string.handout_failed)
    val msgRejected = stringResource(R.string.handout_rejected)
    val msgReturned = stringResource(R.string.handout_returned)

    fun receiverLabel(p: Parcel): String = listOfNotNull(
        vm.departments.firstOrNull { it.id == p.department_id }?.name,
        vm.employees.firstOrNull { it.id == p.receiver_employee_id }?.full_name,
    ).joinToString(" · ").ifBlank { "—" }

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findParcels(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    parcel = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                val open = found.firstOrNull { it.status in ACTIONABLE }
                parcel = open ?: found.first()
                assignEmpId = null
                note = ""
                signature = null
                who = vm.employees.firstOrNull { it.id == parcel?.receiver_employee_id }?.full_name ?: ""
                if (open == null) toast.show("info", msgTerminal)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    /** Ryd formularen efter en gennemført handling og giv scanneren fokus igen. */
    fun clearAfterAction() {
        parcel = null
        who = ""
        note = ""
        signature = null
        assignEmpId = null
        focusStamp = System.currentTimeMillis()
    }

    fun deliver() {
        val p = parcel ?: return
        if (who.trim().isEmpty()) {
            toast.show("err", msgWho)
            return
        }
        if (p.status == "unassigned" && assignEmpId == null) {
            toast.show("err", msgAssign)
            return
        }
        busy = true
        scope.launch {
            try {
                if (p.status == "unassigned") {
                    Repository.assignReceiver(p.id, assignEmpId!!)
                }
                val sigPath = signature?.let { png ->
                    runCatching { Repository.uploadSignature(p.company_id, p.id, png) }.getOrNull()
                }
                Repository.deliverParcel(p.id, who.trim(), note.trim().ifBlank { null }, sigPath)
                toast.show("ok", msgDone.format(who.trim()))
                clearAfterAction()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    /** Afvis (modtageren nægter modtagelse) — årsag påkrævet (fra dialogen),
     *  underskrift valgfri. */
    fun reject(reason: String) {
        val p = parcel ?: return
        busy = true
        scope.launch {
            try {
                val sigPath = signature?.let { png ->
                    runCatching { Repository.uploadSignature(p.company_id, p.id, png) }.getOrNull()
                }
                Repository.rejectParcel(p.id, reason, sigPath)
                toast.show("ok", msgRejected)
                rejectOpen = false
                clearAfterAction()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    /** Returnér til afsender — årsag påkrævet (fra dialogen), ingen underskrift. */
    fun returnToSender(reason: String) {
        val p = parcel ?: return
        busy = true
        scope.launch {
            try {
                Repository.returnParcel(p.id, reason)
                toast.show("ok", msgReturned)
                returnOpen = false
                clearAfterAction()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.handout_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.handout_scan_label), onScan = ::find, focusStamp = focusStamp)

        val p = parcel
        if (p == null) {
            EmptyBox("📤", stringResource(R.string.handout_empty))
        } else {
            Card {
                Text(p.barcode ?: p.id.take(8), color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    stringResource(R.string.receiver_prefix, receiverLabel(p)),
                    color = C.muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    statusLabel(p.status),
                    color = statusColor(p.status),
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            val canDeliver = p.status in DELIVERABLE || p.status == "unassigned"
            val canReject = p.status in REJECTABLE
            val canReturn = p.status in RETURNABLE
            // Note-feltet herunder hører til UDLEVERING og er valgfrit. Den
            // påkrævede årsag ved afvis/returnér spørges der om i ReasonDialog
            // — ét felt kan ikke mærkes for begge regler på én gang.
            if (canDeliver || canReject || canReturn) {
                if (p.status == "unassigned") {
                    Text(
                        stringResource(R.string.handout_unassigned_hint),
                        color = C.amber,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
                    )
                    LookupPicker(
                        title = stringResource(R.string.handout_assign_receiver),
                        items = vm.employees.map {
                            it.id to (it.full_name + (it.initials?.let { i -> " ($i)" } ?: ""))
                        },
                        selectedId = assignEmpId,
                        onSelect = { id ->
                            assignEmpId = id
                            if (id != null) {
                                who = vm.employees.firstOrNull { it.id == id }?.full_name ?: who
                            }
                        },
                    )
                }

                // "Udleveret til" giver kun mening ved udlevering.
                if (canDeliver) {
                    FieldLabel(stringResource(R.string.handout_who_label), topPadding = 14)
                    OutlinedTextField(
                        value = who,
                        onValueChange = { who = it },
                        placeholder = { Text(stringResource(R.string.handout_who_placeholder)) },
                        singleLine = true,
                        colors = operiaFieldColors(),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    // Valgfri note til udleveringen. Vises kun når udlevering er
                    // mulig — ved ren afvis/retur kommer teksten fra dialogen.
                    FieldLabel(stringResource(R.string.note_optional), topPadding = 14)
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it },
                        placeholder = { Text(stringResource(R.string.note_placeholder)) },
                        singleLine = true,
                        colors = operiaFieldColors(),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // Underskrift gælder udlevering og afvisning (modtageren er til
                // stede og kan kvittere for begge). Ved retur er der ingen
                // modtager at kvittere — så skjul den.
                if (vm.has("signature") && (canDeliver || canReject)) {
                    GhostButton(
                        text = if (signature != null) {
                            stringResource(R.string.signature_added)
                        } else {
                            stringResource(R.string.signature_add)
                        },
                        textColor = if (signature != null) C.green else C.txt,
                        modifier = Modifier.padding(top = 14.dp),
                    ) { sigOpen = true }
                }

                if (canDeliver) {
                    BigButton(
                        stringResource(R.string.handout_deliver_button),
                        color = C.green,
                        contentColor = C.greenInk,
                        busy = busy,
                        modifier = Modifier.padding(top = 14.dp),
                    ) { deliver() }
                }

                // Afvis/returnér spørger om årsag i en dialog (påkrævet) —
                // derfor åbner knapperne her kun dialogen.
                if (canReject) {
                    BigButton(
                        stringResource(R.string.handout_reject_button),
                        color = C.red,
                        busy = busy,
                        modifier = Modifier.padding(top = 10.dp),
                    ) { rejectOpen = true }
                }

                if (canReturn) {
                    BigButton(
                        stringResource(R.string.handout_return_button),
                        color = C.amber,
                        contentColor = C.greenInk,
                        busy = busy,
                        modifier = Modifier.padding(top = 10.dp),
                    ) { returnOpen = true }
                }
            }
        }
    }

    if (sigOpen) {
        SignatureDialog(
            onDismiss = { sigOpen = false },
            onSaved = { signature = it },
        )
    }

    if (rejectOpen) {
        ReasonDialog(
            title = stringResource(R.string.handout_reject_button),
            confirmText = stringResource(R.string.handout_reject_confirm),
            confirmColor = C.red,
            busy = busy,
            onDismiss = { rejectOpen = false },
            onConfirm = { reject(it) },
        )
    }

    if (returnOpen) {
        ReasonDialog(
            title = stringResource(R.string.handout_return_button),
            confirmText = stringResource(R.string.handout_return_confirm),
            confirmColor = C.amber,
            busy = busy,
            onDismiss = { returnOpen = false },
            onConfirm = { returnToSender(it) },
        )
    }
}
