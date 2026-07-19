package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.LocalStore
import com.dcalogic.operia.data.ParcelInsert
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.data.supabase
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.ConfirmDialog
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.FoldSection
import com.dcalogic.operia.ui.LookupPicker
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.exceptions.RestException
import kotlinx.coroutines.launch

private data class ScannedItem(
    val barcode: String,
    val departmentId: String?,
    val employeeId: String?,
    val label: String,
)

/**
 * Flow 1 — Modtag pakker: vælg modtager, scan én eller flere pakker, gem.
 * Uden net gemmes modtagelserne lokalt og synkroniseres senere.
 */
@Composable
fun ReceiveScreen(vm: AppViewModel, onBack: () -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current

    var deptId by remember { mutableStateOf<String?>(null) }
    var empId by remember { mutableStateOf<String?>(null) }
    var locationId by remember { mutableStateOf<String?>(null) }
    var carrierId by remember { mutableStateOf<String?>(null) }
    var handlingId by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<ScannedItem>>(emptyList()) }
    var confirmUnassignedOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var lastCount by remember { mutableStateOf(0) }
    var focusStamp by remember { mutableStateOf(0L) }

    val multidept = vm.has("hh_multidept")
    var showDept = vm.has("hh_to_department")
    var showEmp = vm.has("hh_to_employee")
    if (!showDept && !showEmp) { showDept = true; showEmp = true }

    val deptName = { id: String? -> vm.departments.firstOrNull { it.id == id }?.name }
    val empName = { id: String? -> vm.employees.firstOrNull { it.id == id }?.full_name }
    fun currentLabel(): String = listOfNotNull(
        if (showDept) deptName(deptId) else null,
        if (showEmp) empName(empId) else null,
    ).joinToString(" · ")

    val hasRecipient = (showDept && deptId != null) || (showEmp && empId != null)

    val msgAlready = stringResource(R.string.receive_already_scanned)
    val msgAdded = stringResource(R.string.receive_added)
    val msgScanOne = stringResource(R.string.receive_scan_at_least_one)
    val msgSaved = stringResource(R.string.receive_saved)
    val msgQueued = stringResource(R.string.receive_queued)
    val msgSaveFailed = stringResource(R.string.receive_save_failed)

    fun addScan(code: String) {
        if (items.any { it.barcode == code }) {
            toast.show("info", "$msgAlready: $code")
            return
        }
        // Ingen modtager kræves for at scanne — som på webben kan pakker
        // registreres uden modtager (bliver 'unassigned'); det bekræftes ved
        // gemning, ikke ved scanning.
        items = listOf(
            ScannedItem(
                barcode = code,
                departmentId = if (showDept) deptId else null,
                employeeId = if (showEmp) empId else null,
                label = currentLabel(),
            ),
        ) + items
        toast.show("ok", "$msgAdded: $code")
    }

    fun doSave() {
        confirmUnassignedOpen = false
        val companyId = vm.companyId ?: return
        val uid = supabase.auth.currentUserOrNull()?.id
        val rows = items.map { item ->
            ParcelInsert(
                company_id = companyId,
                barcode = item.barcode,
                department_id = if (multidept) item.departmentId else deptId.takeIf { showDept },
                receiver_employee_id = if (multidept) item.employeeId else empId.takeIf { showEmp },
                storage_location_id = locationId,
                carrier_id = carrierId,
                handling_class_id = handlingId,
                condition_note = note.trim().ifBlank { null },
                registered_by = uid,
                // Idempotens-nøgle: har serveren allerede committet (svar tabt),
                // afvises gensendingen fra offline-køen som dublet i stedet for
                // at oprette pakken igen.
                client_key = java.util.UUID.randomUUID().toString(),
            )
        }
        busy = true
        scope.launch {
            try {
                Repository.insertParcels(rows)
                lastCount = rows.size
                toast.show("ok", msgSaved.format(rows.size))
                items = emptyList()
                note = ""
            } catch (e: RestException) {
                toast.show("err", "$msgSaveFailed: ${e.message ?: ""}")
            } catch (e: Exception) {
                // Ingen forbindelse ELLER svar tabt efter commit (timeout/
                // afkodningsfejl) → gem lokalt og synkronisér senere. Rækkerne
                // beholder deres client_key, så en gensending af noget serveren
                // allerede har gemt bliver en dublet-no-op, ikke en ekstra pakke.
                LocalStore.queue(ctx, rows)
                vm.refreshPending()
                lastCount = rows.size
                toast.show("info", msgQueued.format(rows.size))
                items = emptyList()
                note = ""
            }
            busy = false
            focusStamp = System.currentTimeMillis()
        }
    }

    fun save() {
        if (items.isEmpty()) {
            toast.show("err", msgScanOne)
            return
        }
        // Uden modtager bliver pakkerne 'unassigned' (DB-guarden). Gyldigt, men
        // bekræftes bevidst — som webbens modtag-formular. I multidept-tilstand
        // bærer hver scannet post sin egen modtager (fanget ved scanning), så vi
        // tjekker posterne, ikke den aktuelle vælger: en pakke scannet FØR en
        // modtager blev valgt ville ellers snige sig forbi bekræftelsen.
        val anyUnassigned =
            if (multidept) items.any { it.departmentId == null && it.employeeId == null }
            else !hasRecipient
        if (anyUnassigned) {
            confirmUnassignedOpen = true
            return
        }
        doSave()
    }

    Screen(title = stringResource(R.string.receive_title), onBack = onBack, toast = toast) {
        // Rækkefølge som webbens modtag-formular: Modtager, Afdeling, Fragtfirma,
        // Håndtering, Placering. Modtageren er altid synlig; de valgfrie felter
        // foldes ud efter behov, så skærmen er kompakt og scan-fokuseret.
        if (showEmp) {
            LookupPicker(
                title = stringResource(R.string.receiver),
                items = vm.employees.map {
                    it.id to (it.full_name + (it.initials?.let { i -> " ($i)" } ?: ""))
                },
                selectedId = empId,
                onSelect = { empId = it; focusStamp = System.currentTimeMillis() },
            )
        }
        if (showDept) {
            // Afdeling er valgfri når der også er en modtager (som på webben) og
            // foldes derfor sammen; i "modtag til afdeling"-tilstand (uden
            // medarbejder) er afdelingen selve modtageren og vises altid.
            if (showEmp) {
                FoldSection(title = stringResource(R.string.department), summary = deptName(deptId)) {
                    LookupPicker(
                        title = stringResource(R.string.department),
                        items = vm.departments.map { it.id to it.name },
                        selectedId = deptId,
                        onSelect = { deptId = it; focusStamp = System.currentTimeMillis() },
                        showLabel = false,
                    )
                }
            } else {
                LookupPicker(
                    title = stringResource(R.string.department),
                    items = vm.departments.map { it.id to it.name },
                    selectedId = deptId,
                    onSelect = { deptId = it; focusStamp = System.currentTimeMillis() },
                )
            }
        }
        if (vm.carriers.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.carrier),
                summary = vm.carriers.firstOrNull { it.id == carrierId }?.name,
            ) {
                LookupPicker(
                    title = stringResource(R.string.carrier),
                    items = vm.carriers.map { it.id to it.name },
                    selectedId = carrierId,
                    onSelect = { carrierId = it; focusStamp = System.currentTimeMillis() },
                    showLabel = false,
                )
            }
        }
        if (vm.handlingClasses.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.handling),
                summary = vm.handlingClasses.firstOrNull { it.id == handlingId }?.name,
            ) {
                LookupPicker(
                    title = stringResource(R.string.handling),
                    items = vm.handlingClasses.map { it.id to it.name },
                    selectedId = handlingId,
                    onSelect = { handlingId = it; focusStamp = System.currentTimeMillis() },
                    showLabel = false,
                )
            }
        }
        if (vm.storageLocations.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.storage_location),
                summary = vm.storageLocations.firstOrNull { it.id == locationId }?.name,
            ) {
                LookupPicker(
                    title = stringResource(R.string.storage_location),
                    items = vm.storageLocations.map { it.id to it.name },
                    selectedId = locationId,
                    onSelect = { locationId = it; focusStamp = System.currentTimeMillis() },
                    showLabel = false,
                )
            }
        }

        ScanBox(label = stringResource(R.string.receive_scan_label), onScan = ::addScan, focusStamp = focusStamp)

        Row(
            Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.receive_scanned_count, items.size),
                color = C.txt,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f),
            )
            if (items.isNotEmpty()) {
                Text(
                    stringResource(R.string.receive_clear_all),
                    color = C.red,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { items = emptyList() },
                )
            }
        }
        if (items.isEmpty()) {
            EmptyBox("📦", stringResource(R.string.receive_empty))
        }
        items.forEachIndexed { i, item ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
                    .border(1.dp, C.line, RoundedCornerShape(12.dp))
                    .background(C.panel, RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("${i + 1}.  ${item.barcode}", color = C.txt, fontSize = 16.sp)
                    Text(
                        (if (multidept) item.label else currentLabel()).ifBlank { "—" },
                        color = C.muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Text(
                    "✕",
                    color = C.red,
                    fontSize = 20.sp,
                    modifier = Modifier
                        .clickable { items = items.filter { it.barcode != item.barcode } }
                        .padding(4.dp),
                )
            }
        }

        FoldSection(
            title = stringResource(R.string.receive_note_label),
            summary = note.trim().ifBlank { null },
        ) {
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                placeholder = { Text(stringResource(R.string.receive_note_placeholder)) },
                singleLine = true,
                colors = operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        BigButton(
            stringResource(R.string.receive_save_button, items.size),
            color = C.green,
            contentColor = C.greenInk,
            busy = busy,
            modifier = Modifier.padding(top = 20.dp),
        ) { save() }
        if (lastCount > 0) {
            Text(
                stringResource(R.string.receive_saved_confirm, lastCount),
                color = C.green,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 16.sp,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }

    if (confirmUnassignedOpen) {
        ConfirmDialog(
            title = stringResource(R.string.receive_unassigned_title),
            body = stringResource(R.string.receive_unassigned_body),
            confirmText = stringResource(R.string.receive_unassigned_confirm),
            busy = busy,
            onDismiss = { confirmUnassignedOpen = false },
            onConfirm = { doSave() },
        )
    }
}
