package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.dcalogic.operia.data.ParcelBatch
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
// parcel_transition_allowed (20260710031953_parcels.sql, udvidet i
// 20260728170000) — serveren afviser alt andet, så knapperne SKAL følge
// state-maskinen, ellers får handleren en uforståelig fejl i stedet for en
// knap, der ikke er der.
//
// "Afvis" betyder nu "send retur til afsender" og fører pakken DIREKTE til
// 'returned' (se rejectParcel i Repository). REJECTABLE afgør stadig hvorfra der
// må afvises; udfaldet er blot 'returned' i stedet for det gamle 'rejected'.
//
// Bemærk asymmetrien, der let overses:
//   - in_locker må IKKE afvises (kun udleveres/returneres/tages i lager)

/** Statusser hvorfra udlevering er tilladt. */
private val DELIVERABLE = setOf("registered", "in_storage", "in_transit", "in_locker")

/** Statusser hvorfra afvisning er tilladt. */
private val REJECTABLE = setOf("registered", "in_storage", "in_transit")

/** Statusser hvorfra retur til afsender er tilladt. */
private val RETURNABLE = setOf("unassigned", "in_storage", "in_transit", "in_locker", "rejected")

/** Statusser hvor skærmen har noget at tilbyde. Kun 'delivered' og 'returned'
 *  er terminale — en allerede afvist pakke kan fx stadig returneres. Delt med
 *  SearchScreen, så hurtig-handlingen "Udlever" kun vises når skærmen faktisk
 *  har et udfald for pakkens status. */
internal val ACTIONABLE = DELIVERABLE + REJECTABLE + RETURNABLE + "unassigned"

/**
 * Udlever pakke (spec §handover: accept/afvis). Scan → find pakken → enten
 * kvittér med navn, evt. note og underskrift, eller afvis/returnér med en
 * påkrævet årsag. En 'unassigned' pakke skal først have tildelt modtager
 * (state-maskinen tillader ikke unassigned → delivered).
 */
@Composable
fun HandoutScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var parcel by remember { mutableStateOf<Parcel?>(null) }
    // Batchen bag den scannede pakke/batch-label (null = enkelt pakke). batchScope
    // 'all' (standard) = handling rammer hele batchen; 'one' = kun den scannede.
    var batch by remember { mutableStateOf<ParcelBatch?>(null) }
    var batchScope by remember { mutableStateOf("all") }
    var batchCount by remember { mutableStateOf(0) }
    // Blev batchen fundet ved at scanne selve batch-labelen? Så gælder handlingen
    // altid hele batchen — "kun denne pakke" (repræsentanten = vilkårligt medlem)
    // giver ingen mening og skjules. Kun ved scanning af en konkret pakkes
    // stregkode tilbydes valget.
    var batchViaLabel by remember { mutableStateOf(false) }
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
    val msgBatchDelivered = stringResource(R.string.handout_batch_delivered)
    val msgBatchRejected = stringResource(R.string.handout_batch_rejected)

    // Scanningen kan være en pakkes stregkode ELLER en batch-labels kode (OPB-…):
    // først slås op på pakke, ellers på batch. Hører pakken/labelen til en batch,
    // hentes batchens åbne medlemmer (antal + repræsentant til formularen).
    fun find(code: String) {
        scope.launch {
            try {
                val companyId = vm.companyId ?: return@launch
                val found = Repository.findParcels(companyId, code)
                var p = found.firstOrNull { it.status in ACTIONABLE } ?: found.firstOrNull()
                var b: ParcelBatch? = null
                var members: List<Parcel> = emptyList()
                var viaLabel = false

                if (p != null && p.batch_id != null) {
                    b = Repository.batchById(p.batch_id!!)
                    if (b != null) members = Repository.batchOpenMembers(b.id)
                } else if (p == null) {
                    b = Repository.batchByCode(companyId, code)
                    if (b != null) {
                        viaLabel = true
                        members = Repository.batchOpenMembers(b.id)
                        p = members.firstOrNull()
                    }
                }

                if (p == null) {
                    parcel = null
                    batch = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                parcel = p
                batch = b
                batchCount = members.size
                batchScope = "all"
                batchViaLabel = viaLabel
                assignEmpId = null
                note = ""
                signature = null
                who = vm.employees.firstOrNull { it.id == p.receiver_employee_id }?.full_name ?: ""
                if (p.status !in ACTIONABLE) toast.show("info", msgTerminal)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    /** Ryd formularen efter en gennemført handling og giv scanneren fokus igen. */
    fun clearAfterAction() {
        parcel = null
        batch = null
        batchCount = 0
        batchScope = "all"
        batchViaLabel = false
        who = ""
        note = ""
        signature = null
        assignEmpId = null
        focusStamp = System.currentTimeMillis()
    }

    // Rammer handlingen hele batchen? (batch fundet + scope 'all').
    fun actOnBatch(): Boolean = batch != null && batchScope == "all"

    fun deliver() {
        val p = parcel ?: return
        if (who.trim().isEmpty()) {
            toast.show("err", msgWho)
            return
        }
        // Assign-før-udlevering gælder kun enkeltpakker; en batch har altid modtager.
        if (!actOnBatch() && p.status == "unassigned" && assignEmpId == null) {
            toast.show("err", msgAssign)
            return
        }
        busy = true
        scope.launch {
            try {
                val note0 = note.trim().ifBlank { null }
                if (actOnBatch()) {
                    val b = batch!!
                    // Én underskrift dækker hele batchen (gemmes på en batch-sti).
                    val sigPath = signature?.let { png ->
                        runCatching { Repository.uploadSignature(p.company_id, "batch-${b.id}", png) }.getOrNull()
                    }
                    val n = Repository.deliverBatch(b.id, who.trim(), note0, sigPath)
                    toast.show("ok", msgBatchDelivered.format(n))
                } else {
                    if (p.status == "unassigned") {
                        Repository.assignReceiver(p.id, assignEmpId!!)
                    }
                    val sigPath = signature?.let { png ->
                        runCatching { Repository.uploadSignature(p.company_id, p.id, png) }.getOrNull()
                    }
                    Repository.deliverParcel(p.id, who.trim(), note0, sigPath)
                    toast.show("ok", msgDone.format(who.trim()))
                }
                clearAfterAction()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    /** Afvis (modtageren nægter modtagelse) → pakken(erne) sendes retur til
     *  afsender ('returned'). Årsag påkrævet (fra ReasonDialog), underskrift valgfri. */
    fun reject(reason: String) {
        val p = parcel ?: return
        busy = true
        scope.launch {
            try {
                if (actOnBatch()) {
                    val b = batch!!
                    val sigPath = signature?.let { png ->
                        runCatching { Repository.uploadSignature(p.company_id, "batch-${b.id}", png) }.getOrNull()
                    }
                    val n = Repository.rejectBatch(b.id, reason, sigPath)
                    toast.show("ok", msgBatchRejected.format(n))
                } else {
                    val sigPath = signature?.let { png ->
                        runCatching { Repository.uploadSignature(p.company_id, p.id, png) }.getOrNull()
                    }
                    Repository.rejectParcel(p.id, reason, sigPath)
                    toast.show("ok", msgRejected)
                }
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

    // Åbnet fra Søg med en pakke valgt → slå den straks op, som var den scannet.
    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    Screen(title = stringResource(R.string.handout_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.handout_scan_label), onScan = ::find, focusStamp = focusStamp)

        val p = parcel
        if (p == null) {
            EmptyBox("📤", stringResource(R.string.handout_empty))
        } else {
            Card {
                Text(p.barcode ?: p.id.take(8), color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    stringResource(R.string.receiver_prefix, receiverLabel(vm, p)),
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

            // Batch-banner: pakken/labelen hører til en batch → handel på hele
            // batchen (standard) eller kun den scannede pakke.
            val b = batch
            if (b != null) {
                Card {
                    Text(b.batch_code, color = C.txt, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                    Text(
                        stringResource(R.string.handout_batch_banner, batchCount, receiverLabel(vm, p)),
                        color = C.muted,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    // Batch-label scannet ⇒ altid hele batchen; ellers tilbyd "kun denne".
                    if (batchViaLabel) {
                        Text(
                            stringResource(R.string.handout_batch_whole_only, batchCount),
                            color = C.muted,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    } else {
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                            GhostButton(
                                text = stringResource(R.string.handout_batch_scope_all, batchCount),
                                textColor = if (batchScope == "all") C.green else C.muted,
                                modifier = Modifier.weight(1f),
                            ) { batchScope = "all" }
                            GhostButton(
                                text = stringResource(R.string.handout_batch_scope_one),
                                textColor = if (batchScope == "one") C.green else C.muted,
                                modifier = Modifier.weight(1f),
                            ) { batchScope = "one" }
                        }
                    }
                }
            }

            val batchAll = actOnBatch()
            // Batch → udlever/afvis ALLE (retur-knappen udgår, afvis→returned dækker det).
            val canDeliver = if (batchAll) true else (p.status in DELIVERABLE || p.status == "unassigned")
            val canReject = if (batchAll) true else (p.status in REJECTABLE)
            // Afvis går nu direkte til 'returned' (modtageren nægter → retur til
            // afsender), så den separate "Returnér"-knap ville være overflødig,
            // hvor der også kan afvises. Vis den derfor kun for de statusser, der
            // KAN returneres men IKKE afvises (unassigned, in_locker, og en
            // historisk 'rejected'-pakke) — ellers stod to knapper med samme udfald.
            val canReturn = if (batchAll) false else (p.status in RETURNABLE && p.status !in REJECTABLE)
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
                        if (batchAll) {
                            stringResource(R.string.handout_batch_deliver, batchCount)
                        } else {
                            stringResource(R.string.handout_deliver_button)
                        },
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
                        if (batchAll) {
                            stringResource(R.string.handout_batch_reject, batchCount)
                        } else {
                            stringResource(R.string.handout_reject_button)
                        },
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
