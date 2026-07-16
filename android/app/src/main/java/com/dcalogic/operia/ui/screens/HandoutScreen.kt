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
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.SignatureDialog
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import com.dcalogic.operia.ui.statusColor
import com.dcalogic.operia.ui.statusLabel
import kotlinx.coroutines.launch

/** Statusser hvorfra udlevering er tilladt (state-maskinen i parcels_guard). */
private val DELIVERABLE = setOf("registered", "in_storage", "in_transit", "in_locker")

/**
 * Udlever pakke (spec §handover): scan → find pakken → kvittér med navn,
 * evt. note og underskrift. En 'unassigned' pakke skal først have tildelt
 * modtager (state-maskinen tillader ikke unassigned → delivered).
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
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.handout_not_found)
    val msgLookupFailed = stringResource(R.string.handout_lookup_failed)
    val msgTerminal = stringResource(R.string.handout_terminal_status)
    val msgWho = stringResource(R.string.handout_who_required)
    val msgAssign = stringResource(R.string.handout_assign_required)
    val msgDone = stringResource(R.string.handout_done)
    val msgFailed = stringResource(R.string.handout_failed)

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
                val open = found.firstOrNull { it.status in DELIVERABLE || it.status == "unassigned" }
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
                parcel = null
                who = ""
                note = ""
                signature = null
                focusStamp = System.currentTimeMillis()
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

            val deliverable = p.status in DELIVERABLE || p.status == "unassigned"
            if (deliverable) {
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

                if (vm.has("signature")) {
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

                BigButton(
                    stringResource(R.string.handout_deliver_button),
                    color = C.green,
                    contentColor = C.greenInk,
                    busy = busy,
                    modifier = Modifier.padding(top = 14.dp),
                ) { deliver() }
            }
        }
    }

    if (sigOpen) {
        SignatureDialog(
            onDismiss = { sigOpen = false },
            onSaved = { signature = it },
        )
    }
}
