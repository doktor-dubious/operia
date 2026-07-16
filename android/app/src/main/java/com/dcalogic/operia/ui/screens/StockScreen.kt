package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.InventoryItem
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.brandColor
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch

/**
 * Lager (produkt 'lager', feature hh_stock): scan en vare (SKU),
 * se beholdning og registrér ind/ud/optælling.
 */
@Composable
fun StockScreen(vm: AppViewModel, onBack: () -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var item by remember { mutableStateOf<InventoryItem?>(null) }
    var qtyInput by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.stock_not_found)
    val msgLookupFailed = stringResource(R.string.stock_lookup_failed)
    val msgEnterQty = stringResource(R.string.stock_enter_qty)
    val msgEnterCount = stringResource(R.string.stock_enter_count)
    val msgNegative = stringResource(R.string.stock_negative)
    val msgUpdateFailed = stringResource(R.string.stock_update_failed)
    val msgIn = stringResource(R.string.stock_moved_in)
    val msgOut = stringResource(R.string.stock_moved_out)
    val msgAdjusted = stringResource(R.string.stock_adjusted)
    val unitDefault = stringResource(R.string.stock_unit_default)

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findInventoryItem(vm.companyId ?: return@launch, code)
                if (found == null) {
                    item = null
                    toast.show("err", "$msgNotFound: $code")
                } else {
                    item = found
                    qtyInput = ""
                }
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    fun move(kind: String) {
        val it0 = item ?: return
        val n = qtyInput.replace(',', '.').toDoubleOrNull()
        if (kind != "adjust" && (n == null || n <= 0)) {
            toast.show("err", msgEnterQty)
            return
        }
        if (kind == "adjust" && n == null) {
            toast.show("err", msgEnterCount)
            return
        }
        val newQty = when (kind) {
            "in" -> it0.quantity + n!!
            "out" -> it0.quantity - n!!
            else -> n!!
        }
        if (newQty < 0) {
            toast.show("err", msgNegative)
            return
        }
        busy = true
        scope.launch {
            try {
                Repository.setInventoryQuantity(it0.id, newQty)
                item = it0.copy(quantity = newQty)
                qtyInput = ""
                val prefix = when (kind) {
                    "in" -> msgIn
                    "out" -> msgOut
                    else -> msgAdjusted
                }
                toast.show("ok", "$prefix → ${fmt(newQty)} ${it0.unit ?: unitDefault}")
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", msgUpdateFailed)
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.stock_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.stock_scan_label), onScan = ::find, focusStamp = focusStamp)

        val it0 = item
        if (it0 == null) {
            EmptyBox("🗄️", stringResource(R.string.stock_empty))
        } else {
            val accent = brandColor(vm.brand.color)
            Card {
                Text(it0.name, color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    "SKU: ${it0.sku ?: "—"}",
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
                Text(
                    stringResource(
                        R.string.stock_location_prefix,
                        vm.assetLocations.firstOrNull { it.id == it0.location_id }?.name ?: "—",
                    ),
                    color = C.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 10.dp)) {
                    Text(fmt(it0.quantity), color = accent, fontSize = 38.sp, fontWeight = FontWeight.Black)
                    Text(
                        stringResource(R.string.stock_on_hand_suffix, it0.unit ?: unitDefault),
                        color = C.muted,
                        fontSize = 16.sp,
                        modifier = Modifier.padding(start = 6.dp, bottom = 6.dp),
                    )
                }
                val rp = it0.reorder_point
                if (rp != null && rp > 0 && it0.quantity <= rp) {
                    Text(
                        stringResource(R.string.stock_reorder_warning, fmt(rp)),
                        color = C.amber,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            FieldLabel(stringResource(R.string.stock_qty_label), topPadding = 16)
            OutlinedTextField(
                value = qtyInput,
                onValueChange = { qtyInput = it },
                placeholder = { Text(stringResource(R.string.stock_qty_placeholder)) },
                singleLine = true,
                colors = com.dcalogic.operia.ui.operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )

            Row(
                Modifier.fillMaxWidth().padding(top = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BigButton(
                    stringResource(R.string.stock_in),
                    color = C.green,
                    contentColor = C.greenInk,
                    busy = busy,
                    modifier = Modifier.weight(1f),
                ) { move("in") }
                BigButton(
                    stringResource(R.string.stock_out),
                    color = C.red,
                    busy = busy,
                    modifier = Modifier.weight(1f),
                ) { move("out") }
            }
            GhostButton(
                stringResource(R.string.stock_adjust),
                modifier = Modifier.padding(top = 10.dp),
            ) { move("adjust") }
        }
    }
}

private fun fmt(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
