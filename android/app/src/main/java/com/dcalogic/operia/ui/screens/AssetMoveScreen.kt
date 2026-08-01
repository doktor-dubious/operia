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
 * Flyt aktiv: scan → vælg ny placering → gem. Status uændret (aktivernes
 * Flow 2); udlånte og afskrevne aktiver kan ikke flyttes (fysisk ude af
 * huset). move_asset (SECURITY DEFINER) validerer og skriver 'moved'.
 */
private val BLOCKED = listOf("on_loan", "written_off")

@Composable
fun AssetMoveScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var asset by remember { mutableStateOf<Asset?>(null) }
    var locationId by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.asset_not_found)
    val msgLookupFailed = stringResource(R.string.asset_lookup_failed)
    val msgOnLoan = stringResource(R.string.asset_move_on_loan)
    val msgWrittenOff = stringResource(R.string.asset_move_written_off)
    val msgPickLocation = stringResource(R.string.asset_move_pick_location)
    val msgDone = stringResource(R.string.asset_move_done)
    val msgFailed = stringResource(R.string.asset_move_failed)

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findAssets(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    asset = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                // Udlånte og afskrevne er fysisk ude af huset og kan ikke flyttes.
                asset = found.firstOrNull { it.status !in BLOCKED } ?: found.first()
                locationId = null
                note = ""
                when (asset?.status) {
                    "on_loan" -> toast.show("info", msgOnLoan)
                    "written_off" -> toast.show("info", msgWrittenOff)
                }
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    fun submit() {
        val a = asset ?: return
        val loc = locationId
        if (loc == null) {
            toast.show("err", msgPickLocation)
            return
        }
        busy = true
        scope.launch {
            try {
                Repository.moveAsset(a.id, loc, note.trim().ifBlank { null })
                toast.show("ok", msgDone)
                asset = null
                locationId = null
                note = ""
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.asset_move_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.asset_scan_label), onScan = ::find, focusStamp = focusStamp)

        val a = asset
        if (a == null) {
            EmptyBox("🚚", stringResource(R.string.asset_move_empty))
        } else {
            AssetCard(vm, a)

            if (a.status in BLOCKED) {
                Text(
                    if (a.status == "written_off") msgWrittenOff else msgOnLoan,
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 14.dp),
                )
            } else {
                LookupPicker(
                    title = stringResource(R.string.asset_move_location_label),
                    // Den nuværende placering udelades — en flytning dertil er et no-op
                    // (serveren afviser med same_location).
                    items = vm.assetLocations.filter { it.id != a.location_id }.map { it.id to it.name },
                    selectedId = locationId,
                    onSelect = { locationId = it },
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
                    stringResource(R.string.asset_move_button),
                    color = C.blue,
                    busy = busy,
                    modifier = Modifier.padding(top = 20.dp),
                ) { submit() }
            }
        }
    }
}
