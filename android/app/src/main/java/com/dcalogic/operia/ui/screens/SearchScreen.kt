package com.dcalogic.operia.ui.screens

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
import com.dcalogic.operia.data.Parcel
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.rememberToast
import com.dcalogic.operia.ui.statusColor
import com.dcalogic.operia.ui.statusLabel
import kotlinx.coroutines.launch

/** Søg: chain-of-custody-opslag på stregkode. */
@Composable
fun SearchScreen(vm: AppViewModel, onBack: () -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()
    var results by remember { mutableStateOf<List<Parcel>?>(null) }
    val msgFailed = stringResource(R.string.search_failed)

    fun receiverLabel(p: Parcel): String = listOfNotNull(
        vm.departments.firstOrNull { it.id == p.department_id }?.name,
        vm.employees.firstOrNull { it.id == p.receiver_employee_id }?.full_name,
    ).joinToString(" · ").ifBlank { "—" }

    fun find(code: String) {
        scope.launch {
            try {
                results = Repository.findParcels(vm.companyId ?: return@launch, code)
            } catch (e: Exception) {
                toast.show("err", msgFailed)
            }
        }
    }

    Screen(title = stringResource(R.string.search_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.search_scan_label), onScan = ::find)

        when {
            results == null -> EmptyBox("🔎", stringResource(R.string.search_empty))
            results!!.isEmpty() -> EmptyBox("🚫", stringResource(R.string.search_no_results))
            else -> results!!.forEach { p ->
                Card {
                    Text(
                        p.barcode ?: p.id.take(8),
                        color = C.txt,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        stringResource(R.string.receiver_prefix, receiverLabel(p)),
                        color = C.muted,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    p.registered_at?.let {
                        Text(
                            stringResource(R.string.registered_prefix, it.take(16).replace("T", " ")),
                            color = C.muted,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    Text(
                        statusLabel(p.status),
                        color = statusColor(p.status),
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    p.delivered_to?.let {
                        Text(
                            stringResource(R.string.delivered_to_prefix, it),
                            color = C.muted,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }
    }
}
