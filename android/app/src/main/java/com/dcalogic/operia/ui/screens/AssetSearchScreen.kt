package com.dcalogic.operia.ui.screens

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.dcalogic.operia.data.Asset
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.assetStatusColor
import com.dcalogic.operia.ui.assetStatusLabel
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch

/** Søg aktiver: opslag på stregkode/serienr./aktiv-nr., med hurtig-handlinger
 *  (Tjek ud/ind, Flyt, Dokumentér) der åbner den rette skærm med aktivet
 *  forudvalgt — som pakkernes Søg. */
@Composable
fun AssetSearchScreen(vm: AppViewModel, onBack: () -> Unit, onNavigate: (String) -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()
    var results by remember { mutableStateOf<List<Asset>?>(null) }
    val msgFailed = stringResource(R.string.asset_search_failed)

    fun find(code: String) {
        scope.launch {
            try {
                results = Repository.findAssets(vm.companyId ?: return@launch, code)
            } catch (e: Exception) {
                toast.show("err", msgFailed)
            }
        }
    }

    Screen(title = stringResource(R.string.asset_search_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.asset_scan_label), onScan = ::find)

        when {
            results == null -> EmptyBox("🔎", stringResource(R.string.asset_search_empty))
            results!!.isEmpty() -> EmptyBox("🚫", stringResource(R.string.asset_search_no_results))
            else -> results!!.forEach { a ->
                Card {
                    Text(a.name, color = C.txt, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                    val idLine = listOfNotNull(a.asset_tag, a.serial_no).joinToString(" · ")
                    if (idLine.isNotBlank()) {
                        Text(idLine, color = C.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                    Text(
                        stringResource(
                            R.string.asset_location_prefix,
                            vm.assetLocations.firstOrNull { it.id == a.location_id }?.name ?: "—",
                        ),
                        color = C.muted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                    a.assigned_to_employee_id?.let { empId ->
                        vm.employees.firstOrNull { it.id == empId }?.let { emp ->
                            Text(
                                stringResource(R.string.asset_assigned_prefix, emp.full_name),
                                color = C.muted,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                    Text(
                        assetStatusLabel(a.status),
                        color = assetStatusColor(a.status),
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.padding(top = 6.dp),
                    )

                    // Hurtig-handlinger: kun dem aktivets status (og brugerens
                    // entitlements) tillader — logikken bor på målskærmene.
                    val code = assetDeepLinkCode(a)
                    val canCheckout =
                        vm.has("hh_asset_checkout") && a.status == "in_stock" && a.is_active
                    val canCheckin =
                        vm.has("hh_asset_checkin") && a.status in listOf("assigned", "on_loan", "service")
                    val canMove = vm.has("hh_asset_move") &&
                        a.status != "on_loan" && a.status != "written_off"
                    if (code != null && (canCheckout || canCheckin || canMove)) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (canCheckout) {
                                BigButton(
                                    stringResource(R.string.tile_asset_checkout),
                                    color = C.green,
                                    contentColor = C.greenInk,
                                    modifier = Modifier.weight(1f),
                                ) { onNavigate("asset_checkout?code=${Uri.encode(code)}") }
                            }
                            if (canCheckin) {
                                BigButton(
                                    stringResource(R.string.tile_asset_checkin),
                                    color = C.green,
                                    contentColor = C.greenInk,
                                    modifier = Modifier.weight(1f),
                                ) { onNavigate("asset_checkin?code=${Uri.encode(code)}") }
                            }
                            if (canMove) {
                                BigButton(
                                    stringResource(R.string.tile_asset_move),
                                    color = C.blue,
                                    modifier = Modifier.weight(1f),
                                ) { onNavigate("asset_move?code=${Uri.encode(code)}") }
                            }
                        }
                    }
                }
            }
        }
    }
}
