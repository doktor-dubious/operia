package com.dcalogic.operia.ui.screens

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
 * Tjek aktiv ind: scan → aktivet er tilbage på lager. Dækker alle tre udveje —
 * tildelt, udlånt (lånet lukkes; låneren anonymiseres automatisk) og til
 * service. Valgfrit: ny placering og opdateret stand. checkin_asset (SECURITY
 * DEFINER) skriver hændelsen i asset_events; fotos tilføjes via Dokumentér.
 */
@Composable
fun AssetCheckinScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var asset by remember { mutableStateOf<Asset?>(null) }
    var locationId by remember { mutableStateOf<String?>(null) }
    var condition by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val outStatuses = listOf("assigned", "on_loan", "service")

    val msgNotFound = stringResource(R.string.asset_not_found)
    val msgLookupFailed = stringResource(R.string.asset_lookup_failed)
    val msgNotOut = stringResource(R.string.asset_checkin_not_out)
    val msgDone = stringResource(R.string.asset_checkin_done)
    val msgFailed = stringResource(R.string.asset_checkin_failed)

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findAssets(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    asset = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                asset = found.firstOrNull { it.status in outStatuses } ?: found.first()
                locationId = null
                condition = ""
                note = ""
                if ((asset?.status ?: "") !in outStatuses) toast.show("info", msgNotOut)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    fun submit() {
        val a = asset ?: return
        busy = true
        scope.launch {
            try {
                Repository.checkinAsset(
                    a.id,
                    locationId,
                    condition.trim().ifBlank { null },
                    note.trim().ifBlank { null },
                )
                toast.show("ok", msgDone)
                asset = null
                locationId = null
                condition = ""
                note = ""
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.asset_checkin_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.asset_scan_label), onScan = ::find, focusStamp = focusStamp)

        val a = asset
        if (a == null) {
            EmptyBox("🗄️", stringResource(R.string.asset_checkin_empty))
        } else {
            AssetCard(vm, a)

            if (a.status !in outStatuses) {
                Text(
                    msgNotOut,
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 14.dp),
                )
            } else {
                LookupPicker(
                    title = stringResource(R.string.asset_checkin_location_label),
                    items = vm.assetLocations.map { it.id to it.name },
                    selectedId = locationId,
                    onSelect = { locationId = it },
                )

                FieldLabel(stringResource(R.string.asset_checkin_condition_label))
                OutlinedTextField(
                    value = condition,
                    onValueChange = { condition = it },
                    placeholder = { Text(stringResource(R.string.asset_checkin_condition_placeholder)) },
                    singleLine = true,
                    colors = operiaFieldColors(),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                )

                FieldLabel(stringResource(R.string.note_optional))
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    placeholder = { Text(stringResource(R.string.note_placeholder)) },
                    colors = operiaFieldColors(),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth(),
                )

                BigButton(
                    stringResource(R.string.asset_checkin_button),
                    color = C.green,
                    contentColor = C.greenInk,
                    busy = busy,
                    modifier = Modifier.padding(top = 20.dp),
                ) { submit() }
            }
        }
    }
}
