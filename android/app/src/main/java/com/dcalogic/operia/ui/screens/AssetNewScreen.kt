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
import com.dcalogic.operia.data.CreatedAsset
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.LookupPicker
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch

// "Ligner en webadresse" — samme løse regel som Modtag pakke (og webbens
// barcode-rules): fanger typisk QR-indhold, ikke alt der kunne være en URI.
private val ASSET_URL_LIKE = Regex("""^(https?://|www\.)""", RegexOption.IGNORE_CASE)

/**
 * Nyt aktiv — terminalens modstykke til webbens /assets/new. Aktivet oprettes
 * dér hvor det pakkes ud, i stedet for at vente på en manager ved en pc.
 *
 * Aktiv-nr. tastes ikke: create_asset_handheld (SECURITY DEFINER) lader
 * assets_guard tildele nummeret og sender det retur, så skærmen kan vise
 * netop det nummer, der blev gemt. Modsat webben hentes nummeret altså FØRST
 * ved oprettelsen — en terminal, der står åben på en flise hele dagen, ville
 * ellers brænde numre af en fortløbende serie uden at oprette noget.
 *
 * Efter oprettelsen nulstilles felterne, og det oprettede aktiv står som et
 * kvitteringskort med genvej til Dokumentér (foto af mærkeplade/stand) — så
 * det næste aktiv kan scannes med det samme.
 */
@Composable
fun AssetNewScreen(vm: AppViewModel, onBack: () -> Unit, onNavigate: (String) -> Unit) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf("") }
    var serialNo by remember { mutableStateOf("") }
    var barcode by remember { mutableStateOf("") }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var locationId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }
    // Sidst oprettede aktiv (navn + tildelt nummer) — kvitteringen der bliver
    // stående, mens det næste aktiv tastes ind.
    var created by remember { mutableStateOf<Pair<String, CreatedAsset>?>(null) }

    val msgNameRequired = stringResource(R.string.asset_new_name_required)
    val msgBarcodeTaken = stringResource(R.string.asset_new_barcode_taken)
    val msgNoAccess = stringResource(R.string.asset_new_no_access)
    val msgFailed = stringResource(R.string.asset_new_failed)
    val msgCreated = stringResource(R.string.asset_new_created)

    fun submit() {
        val cid = vm.companyId ?: return
        val trimmed = name.trim()
        if (trimmed.isBlank()) {
            toast.show("err", msgNameRequired)
            return
        }
        busy = true
        scope.launch {
            try {
                val row = Repository.createAsset(
                    companyId = cid,
                    name = trimmed,
                    serialNo = serialNo.trim().ifBlank { null },
                    barcode = barcode.trim().ifBlank { null },
                    categoryId = categoryId,
                    locationId = locationId,
                )
                if (row == null) {
                    toast.show("err", msgFailed)
                } else {
                    created = trimmed to row
                    toast.show("ok", msgCreated)
                    // Kun identiteten nulstilles. Kategori/placering bliver
                    // stående: oprettes en stak ens aktiver, er de ens for dem
                    // alle, og hver nulstilling ville koste to valg pr. aktiv.
                    name = ""
                    serialNo = ""
                    barcode = ""
                    focusStamp = System.currentTimeMillis()
                }
            } catch (e: Exception) {
                // Fejlkoderne kommer fra RPC'en (raise exception '<kode>').
                val m = e.message ?: ""
                toast.show(
                    "err",
                    when {
                        m.contains("barcode_taken") -> msgBarcodeTaken
                        m.contains("no_access") -> msgNoAccess
                        m.contains("name_required") -> msgNameRequired
                        else -> "$msgFailed: $m"
                    },
                )
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.asset_new_title), onBack = onBack, toast = toast) {
        // Scanningen lander i stregkodefeltet frem for at oprette noget: her
        // scannes den label, aktivet SKAL have — ikke en kode der slås op.
        ScanBox(
            label = stringResource(R.string.asset_new_scan_label),
            onScan = { barcode = it },
            focusStamp = focusStamp,
        )

        created?.let { (createdName, row) ->
            Card {
                Text(
                    stringResource(R.string.asset_new_last_created),
                    color = C.muted,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    createdName,
                    color = C.txt,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    stringResource(R.string.asset_new_tag_prefix, row.asset_tag ?: "—"),
                    color = C.green,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 2.dp),
                )
                // Genvej til foto/note på det netop oprettede aktiv. Kræver en
                // kode at slå op på (Dokumentér finder aktivet på stregkode/
                // serienr./aktiv-nr.) og selvfølgelig adgang til flisen.
                val code = row.asset_tag
                if (!code.isNullOrBlank() && vm.has("hh_asset_document") &&
                    vm.hasRole("handheld_asset_handler")
                ) {
                    GhostButton(
                        stringResource(R.string.asset_new_document),
                        modifier = Modifier.padding(top = 12.dp),
                    ) { onNavigate("asset_document?code=$code") }
                }
            }
        }

        FieldLabel(stringResource(R.string.asset_new_name_label), topPadding = 14)
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            placeholder = { Text(stringResource(R.string.asset_new_name_placeholder)) },
            singleLine = true,
            colors = operiaFieldColors(),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        )

        FieldLabel(stringResource(R.string.asset_new_barcode_label))
        OutlinedTextField(
            value = barcode,
            onValueChange = { barcode = it },
            placeholder = { Text(stringResource(R.string.asset_new_barcode_placeholder)) },
            singleLine = true,
            colors = operiaFieldColors(),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth(),
        )
        // Warn-and-allow som Modtag pakke, men uden dialog: koden står i et
        // felt, brugeren kan rette FØR den gemmes — en advarsel er nok.
        if (ASSET_URL_LIKE.containsMatchIn(barcode.trim())) {
            Text(
                stringResource(R.string.asset_new_barcode_url_warning),
                color = C.amber,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        FieldLabel(stringResource(R.string.asset_new_serial_label), topPadding = 12)
        OutlinedTextField(
            value = serialNo,
            onValueChange = { serialNo = it },
            placeholder = { Text(stringResource(R.string.asset_new_serial_placeholder)) },
            singleLine = true,
            colors = operiaFieldColors(),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        )

        LookupPicker(
            title = stringResource(R.string.asset_new_category_label),
            items = vm.assetCategories.map { it.id to it.name },
            selectedId = categoryId,
            onSelect = { categoryId = it },
        )

        LookupPicker(
            title = stringResource(R.string.asset_new_location_label),
            items = vm.assetLocations.map { it.id to it.name },
            selectedId = locationId,
            onSelect = { locationId = it },
        )

        BigButton(
            stringResource(R.string.asset_new_button),
            color = C.green,
            contentColor = C.greenInk,
            enabled = name.isNotBlank(),
            busy = busy,
            modifier = Modifier.padding(top = 8.dp),
        ) { submit() }
    }
}
