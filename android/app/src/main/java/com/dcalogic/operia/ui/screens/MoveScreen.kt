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
import com.dcalogic.operia.data.Parcel
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.LookupPicker
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.rememberToast
import com.dcalogic.operia.ui.statusColor
import com.dcalogic.operia.ui.statusLabel
import kotlinx.coroutines.launch

// Flow 2 (relokering): hvilke flytte-statusser der er tilladt fra en given
// status — delmængden af parcel_transition_allowed (20260710031953_parcels.sql)
// der er in_storage/in_transit/in_locker, PLUS status-uændrede flytninger (samme
// status som mål). Spejler web/src/lib/parcel-moves.ts. En ren hylde-til-hylde-
// flytning ændrer kun placeringen: DB-guarden kører kun overgangstjekket når
// status faktisk ændres, så in_storage→in_storage er tilladt og logges som
// 'moved'. Uden selv-målet ville handleren blive tvunget til en falsk
// statusændring for at flytte en pakke, der bliver stående i lager.
private val MOVE_TARGETS = mapOf(
    "unassigned" to listOf("in_storage"),
    "registered" to listOf("in_storage", "in_transit", "in_locker"),
    "in_storage" to listOf("in_storage", "in_transit", "in_locker"),
    "in_transit" to listOf("in_transit", "in_storage", "in_locker"),
    "in_locker" to listOf("in_locker", "in_storage"),
    "rejected" to listOf("in_storage"),
)

internal fun moveTargets(status: String): List<String> = MOVE_TARGETS[status] ?: emptyList()

/** En flytte-status skal pege på en placering, pånær 'in_transit' hvor pakken
 *  er undervejs og ikke nødvendigvis har en fast plads. */
private fun requiresLocation(status: String): Boolean = status != "in_transit"

/**
 * Flyt pakke (spec Flow 2: hver intern flytning scannes). Scan → find pakken →
 * vælg ny flytte-status og placering → gem. Repository.moveParcel opdaterer
 * pakken; DB-triggeren logger 'status_changed' + 'moved' i parcel_events, så
 * hele sporbarheden skrives af sig selv.
 */
@Composable
fun MoveScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var parcel by remember { mutableStateOf<Parcel?>(null) }
    var toStatus by remember { mutableStateOf<String?>(null) }
    var toLocationId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.handout_not_found)
    val msgLookupFailed = stringResource(R.string.handout_lookup_failed)
    val msgNotMovable = stringResource(R.string.move_not_movable)
    val msgPickStatus = stringResource(R.string.move_pick_status)
    val msgPickLocation = stringResource(R.string.move_pick_location)
    val msgDone = stringResource(R.string.move_done)
    val msgFailed = stringResource(R.string.handout_failed)

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findParcels(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    parcel = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                val movable = found.firstOrNull { moveTargets(it.status).isNotEmpty() }
                val p = movable ?: found.first()
                parcel = p
                // Forudvælg pakkens nuværende placering, så en ren statusændring
                // ikke utilsigtet flytter pakken væk fra hylden.
                toLocationId = p.storage_location_id
                toStatus = moveTargets(p.status).firstOrNull()
                if (movable == null) toast.show("info", msgNotMovable)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    fun clearAfterAction() {
        parcel = null
        toStatus = null
        toLocationId = null
        focusStamp = System.currentTimeMillis()
    }

    fun move() {
        val p = parcel ?: return
        val status = toStatus
        if (status == null) {
            toast.show("err", msgPickStatus)
            return
        }
        if (requiresLocation(status) && toLocationId == null) {
            toast.show("err", msgPickLocation)
            return
        }
        busy = true
        scope.launch {
            try {
                Repository.moveParcel(p.id, status, toLocationId)
                toast.show("ok", msgDone)
                clearAfterAction()
            } catch (e: Exception) {
                toast.show("err", "$msgFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    // Åbnet fra Søg med en pakke valgt → slå den straks op, som var den scannet.
    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    Screen(title = stringResource(R.string.move_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.move_scan_label), onScan = ::find, focusStamp = focusStamp)

        val p = parcel
        if (p == null) {
            EmptyBox("🚚", stringResource(R.string.move_empty))
        } else {
            Card {
                Text(p.barcode ?: p.id.take(8), color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    stringResource(R.string.receiver_prefix, receiverLabel(vm, p)),
                    color = C.muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    stringResource(
                        R.string.move_current_location,
                        vm.storageLocations.firstOrNull { it.id == p.storage_location_id }?.name ?: "—",
                    ),
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
                Text(
                    statusLabel(p.status),
                    color = statusColor(p.status),
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            val targets = moveTargets(p.status)
            if (targets.isEmpty()) {
                Text(
                    msgNotMovable,
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 14.dp),
                )
            } else {
                FieldLabel(stringResource(R.string.move_status_label), topPadding = 16)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    targets.forEach { s ->
                        val selected = s == toStatus
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
                                .clickable { toStatus = s }
                                .padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                statusLabel(s),
                                color = if (selected) C.txt else C.muted,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }

                val status = toStatus
                val locationRequired = status != null && requiresLocation(status)
                LookupPicker(
                    title = stringResource(
                        if (locationRequired) R.string.move_location_label
                        else R.string.move_location_label_optional,
                    ),
                    items = vm.storageLocations.map { it.id to it.name },
                    selectedId = toLocationId,
                    onSelect = { toLocationId = it },
                )

                BigButton(
                    stringResource(R.string.move_confirm_button),
                    color = C.blue,
                    busy = busy,
                    modifier = Modifier.padding(top = 4.dp),
                ) { move() }
            }
        }
    }
}
