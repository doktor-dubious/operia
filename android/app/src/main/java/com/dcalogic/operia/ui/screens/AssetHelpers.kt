package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Asset
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.assetStatusColor
import com.dcalogic.operia.ui.assetStatusLabel

/** Den kode et fundet aktiv genfindes på (?code=-deep-links mellem skærmene):
 *  stregkoden hvis den findes, ellers aktiv-nr., ellers serienr. — samme regel
 *  som webbens assetCode i lib/asset-lookup.ts. */
internal fun assetDeepLinkCode(a: Asset): String? = a.barcode ?: a.asset_tag ?: a.serial_no

/** Aktivets kort: navn, tag/serienr., status, placering og evt. tildeling —
 *  delt af alle aktiv-skærmene, så et aktiv præsenteres ens overalt. */
@Composable
internal fun AssetCard(vm: AppViewModel, a: Asset) {
    Card {
        Text(a.name, color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
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
        a.condition?.takeIf { it.isNotBlank() }?.let {
            Text(
                stringResource(R.string.asset_condition_prefix, it),
                color = C.muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Text(
            assetStatusLabel(a.status),
            color = assetStatusColor(a.status),
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}
