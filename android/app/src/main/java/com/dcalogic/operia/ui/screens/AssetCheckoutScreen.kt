package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Asset
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.LookupPicker
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch

/**
 * Tjek aktiv ud: scan → vælg medarbejder → Tildel (fast, status 'assigned')
 * eller Udlån (midlertidigt, status 'on_loan' — kontaktdata snapshottes fra
 * kartoteket server-side, og lånet får påmindelser via webbens maskineri).
 * Al skrivning går gennem checkout_asset/lend_asset (SECURITY DEFINER), som
 * logger hændelsen i asset_events.
 */
@Composable
fun AssetCheckoutScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var asset by remember { mutableStateOf<Asset?>(null) }
    var mode by remember { mutableStateOf("assign") } // 'assign' | 'loan'
    var empId by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.asset_not_found)
    val msgLookupFailed = stringResource(R.string.asset_lookup_failed)
    val msgNotInStock = stringResource(R.string.asset_checkout_not_in_stock)
    val msgPickEmployee = stringResource(R.string.asset_checkout_pick_employee)
    val msgNoContact = stringResource(R.string.asset_checkout_no_contact)
    val msgDoneAssign = stringResource(R.string.asset_checkout_done_assign)
    val msgDoneLoan = stringResource(R.string.asset_checkout_done_loan)
    val msgFailed = stringResource(R.string.asset_checkout_failed)

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findAssets(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    asset = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                // Foretræk et aktiv der faktisk kan tjekkes ud, hvis koden er tvetydig.
                asset = found.firstOrNull { it.status == "in_stock" && it.is_active } ?: found.first()
                empId = null
                note = ""
                if ((asset?.status ?: "") != "in_stock") toast.show("info", msgNotInStock)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    fun submit() {
        val a = asset ?: return
        val emp = vm.employees.firstOrNull { it.id == empId }
        if (emp == null) {
            toast.show("err", msgPickEmployee)
            return
        }
        // Udlån kræver en kontaktvej (serveren afviser med contact_required) —
        // fang det her, hvor handleren stadig kan vælge en anden medarbejder.
        if (mode == "loan" && emp.email.isNullOrBlank() && emp.phone.isNullOrBlank()) {
            toast.show("err", msgNoContact)
            return
        }
        busy = true
        scope.launch {
            try {
                if (mode == "assign") {
                    Repository.checkoutAsset(a.id, emp.id, note.trim().ifBlank { null })
                    toast.show("ok", msgDoneAssign.format(emp.full_name))
                } else {
                    Repository.lendAssetToEmployee(a.id, emp.id, note.trim().ifBlank { null })
                    toast.show("ok", msgDoneLoan.format(emp.full_name))
                }
                asset = null
                empId = null
                note = ""
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.asset_checkout_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.asset_scan_label), onScan = ::find, focusStamp = focusStamp)

        val a = asset
        if (a == null) {
            EmptyBox("🗄️", stringResource(R.string.asset_checkout_empty))
        } else {
            AssetCard(vm, a)

            if (a.status != "in_stock" || !a.is_active) {
                Text(
                    msgNotInStock,
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 14.dp),
                )
            } else {
                // Tildel eller udlån — samme segmentvælger som Flyt-skærmens statusvalg.
                FieldLabel(stringResource(R.string.asset_checkout_mode_label), topPadding = 16)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    listOf(
                        "assign" to stringResource(R.string.asset_checkout_mode_assign),
                        "loan" to stringResource(R.string.asset_checkout_mode_loan),
                    ).forEach { (key, label) ->
                        val selected = key == mode
                        Row(
                            Modifier
                                .weight(1f)
                                .heightIn(min = 52.dp)
                                .border(
                                    1.5.dp,
                                    if (selected) C.blue else C.line,
                                    RoundedCornerShape(14.dp),
                                )
                                .background(
                                    if (selected) C.panel2 else C.panel,
                                    RoundedCornerShape(14.dp),
                                )
                                .clickable { mode = key }
                                .padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                label,
                                color = if (selected) C.txt else C.muted,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
                Text(
                    stringResource(
                        if (mode == "assign") R.string.asset_checkout_assign_hint
                        else R.string.asset_checkout_loan_hint,
                    ),
                    color = C.muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 6.dp, bottom = 10.dp),
                )

                LookupPicker(
                    title = stringResource(R.string.asset_employee_label),
                    items = vm.employees.map {
                        it.id to (it.full_name + (it.initials?.let { i -> " ($i)" } ?: ""))
                    },
                    selectedId = empId,
                    onSelect = { empId = it },
                )

                FieldLabel(stringResource(R.string.note_optional), topPadding = 4)
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    placeholder = { Text(stringResource(R.string.note_placeholder)) },
                    colors = operiaFieldColors(),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth(),
                )

                BigButton(
                    stringResource(R.string.asset_checkout_button),
                    color = C.green,
                    contentColor = C.greenInk,
                    busy = busy,
                    modifier = Modifier.padding(top = 20.dp),
                ) { submit() }
            }
        }
    }
}
