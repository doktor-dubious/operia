package com.dcalogic.operia.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.LocalStore
import com.dcalogic.operia.data.Parcel
import com.dcalogic.operia.data.ParcelInsert
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.data.supabase
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.ConfirmDialog
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.FoldSection
import com.dcalogic.operia.ui.GhostButton
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
    // Valgfrit tilstandsfoto for netop denne pakke (fx synlig skade) —
    // uploades efter gemning; offline droppes det med en henvisning til
    // Tilstand-fanen (fotoet kan ikke hægtes på en pakke, serveren ikke har).
    val photo: ByteArray? = null,
)

// Spejler webbens notify-contact-regler (web/src/lib/notify-contact.ts), som
// igen spejler toMsisdn i dispatcheren: 8 cifre antages dansk, ellers kræves
// landekode (9–15 cifre i alt).
private fun hasValidEmail(email: String?): Boolean {
    val e = email?.trim() ?: return false
    return e.contains('@') && !e.startsWith("@") && !e.endsWith("@")
}

private fun hasValidMsisdn(phone: String?): Boolean {
    if (phone.isNullOrBlank()) return false
    var digits = phone.filter { it.isDigit() }
    if (digits.startsWith("00")) digits = digits.substring(2)
    return digits.length == 8 || digits.length in 9..15
}

// "Ligner en webadresse" — samme bevidst løse regel som webbens barcode-rules:
// fanger typisk QR-indhold (https://…, www.…), ikke alt der kunne være en URI.
private val URL_LIKE = Regex("""^(https?://|www\.)""", RegexOption.IGNORE_CASE)

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
    var sender by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<ScannedItem>>(emptyList()) }
    var confirmUnassignedOpen by remember { mutableStateOf(false) }
    // Scan-værn (samme warn-and-allow som webbens modtag-formular): URL-
    // lignende koder bekræftes før brug, og en kode der allerede står som åben
    // pakke bekræftes efter tilføjelsen. Køer, ikke enkeltfelter — scanneren
    // kan nå at fyre igen, mens en dialog står åben, og så må den første kode
    // ikke overskrives og forsvinde.
    var pendingUrls by remember { mutableStateOf<List<String>>(emptyList()) }
    var pendingDups by remember { mutableStateOf<List<String>>(emptyList()) }
    // Foto-dialogens mål: stregkoden på posten der fotograferes. null = lukket.
    var photoTarget by remember { mutableStateOf<String?>(null) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var lastCount by remember { mutableStateOf(0) }
    var focusStamp by remember { mutableStateOf(0L) }
    // Batch-tilstand: samme modtager for alle scannede pakker → én besked. Kræver
    // forbindelse (batch_id skal kendes før indsæt); offline falder vi tilbage til
    // den normale kø uden gruppering.
    var batchMode by remember { mutableStateOf(false) }

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
    val msgBatchSaved = stringResource(R.string.receive_batch_saved)
    val msgBatchOffline = stringResource(R.string.receive_batch_offline)
    val msgBatchReceiver = stringResource(R.string.receive_batch_receiver_required)
    val msgPhotoFailed = stringResource(R.string.condition_photo_failed)
    val msgCameraDenied = stringResource(R.string.condition_camera_denied)
    val msgPhotoUploadFailed = stringResource(R.string.receive_photo_upload_failed)
    val msgPhotoOffline = stringResource(R.string.receive_photo_offline)

    // Ingen modtager kræves for at scanne — som på webben kan pakker
    // registreres uden modtager (bliver 'unassigned'); det bekræftes ved
    // gemning, ikke ved scanning.
    // Tilføjelsen er SYNKRON (offline-first): posten skal stå i listen med det
    // samme — også uden net, og før en gemning kan nå at snapshotte listen.
    // Dublet-opslaget (som webbens modtag-formular) kører bagefter i
    // baggrunden; står koden allerede som åben pakke, bekræftes den i en
    // dialog (behold/fjern). Offline fejler opslaget stille — serverens
    // dublet-regler gælder stadig ved synkroniseringen.
    fun commitScan(code: String) {
        if (items.any { it.barcode == code }) {
            toast.show("info", "$msgAlready: $code")
            return
        }
        items = listOf(
            ScannedItem(
                barcode = code,
                departmentId = if (showDept) deptId else null,
                employeeId = if (showEmp) empId else null,
                label = currentLabel(),
            ),
        ) + items
        toast.show("ok", "$msgAdded: $code")
        val companyId = vm.companyId ?: return
        scope.launch {
            val dup = runCatching { Repository.hasOpenParcel(companyId, code) }.getOrDefault(false)
            // Kun hvis koden stadig står i listen — er den fjernet eller gemt
            // inden svaret kom, er der intet at bekræfte.
            if (dup && items.any { it.barcode == code } && code !in pendingDups) {
                pendingDups = pendingDups + code
            }
        }
    }

    fun addScan(code: String) {
        if (items.any { it.barcode == code }) {
            toast.show("info", "$msgAlready: $code")
            return
        }
        // URL-lignende QR-koder (fx et link på en leverandørlabel) bekræftes
        // først — samme warn-and-allow som på webben.
        if (URL_LIKE.containsMatchIn(code)) {
            if (code !in pendingUrls) pendingUrls = pendingUrls + code
            return
        }
        commitScan(code)
    }

    // ----- pr.-pakke-tilstandsfoto (samme kamera/galleri-flow som Tilstand) -----

    fun setItemPhoto(code: String, jpeg: ByteArray?) {
        items = items.map { if (it.barcode == code) it.copy(photo = jpeg) else it }
    }

    fun applyPhoto(uri: Uri?) {
        if (uri == null) return
        val target = photoTarget ?: return
        val bytes = readScaledJpeg(ctx, uri)
        if (bytes == null) {
            toast.show("err", msgPhotoFailed)
            return
        }
        setItemPhoto(target, bytes)
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) applyPhoto(pendingUri)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        applyPhoto(uri)
    }

    fun launchCamera() {
        val uri = newCaptureUri(ctx)
        pendingUri = uri
        takePicture.launch(uri)
    }

    // Kameraet kræver runtime-tilladelse, fordi appen deklarerer CAMERA i manifestet.
    val requestCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else toast.show("err", msgCameraDenied)
    }

    fun onTakePhoto() {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) launchCamera() else requestCamera.launch(Manifest.permission.CAMERA)
    }

    // Upload pr.-pakke-fotos efter en vellykket gemning. Pakkerne ER gemt på
    // det tidspunkt — fejler et foto, advares der (med henvisning til
    // Tilstand) i stedet for at rulle tilbage.
    suspend fun uploadPhotos(inserted: List<Parcel>, photos: Map<String, ByteArray>) {
        if (photos.isEmpty()) return
        var failed = 0
        inserted.forEach { p ->
            val jpeg = p.barcode?.let(photos::get) ?: return@forEach
            runCatching { Repository.uploadIntakePhoto(p.company_id, p.id, jpeg) }
                .onFailure { failed++ }
        }
        if (failed > 0) toast.show("info", msgPhotoUploadFailed.format(failed))
    }

    // Byg insert-rækkerne. Med batchId sat er modtageren batchens (enmodtager),
    // og parcels_guard tvinger den alligevel; ellers gælder den normale
    // (multidept-)logik.
    fun rowsFor(batchId: String?): List<ParcelInsert> {
        val companyId = vm.companyId ?: return emptyList()
        val uid = supabase.auth.currentUserOrNull()?.id
        return items.map { item ->
            ParcelInsert(
                company_id = companyId,
                barcode = item.barcode,
                department_id = if (batchId != null) deptId else if (multidept) item.departmentId else deptId.takeIf { showDept },
                receiver_employee_id = if (batchId != null) empId else if (multidept) item.employeeId else empId.takeIf { showEmp },
                storage_location_id = locationId,
                carrier_id = carrierId,
                handling_class_id = handlingId,
                sender = sender.trim().ifBlank { null },
                condition_note = note.trim().ifBlank { null },
                registered_by = uid,
                // Idempotens-nøgle: har serveren allerede committet (svar tabt),
                // afvises gensendingen fra offline-køen som dublet i stedet for
                // at oprette pakken igen.
                client_key = java.util.UUID.randomUUID().toString(),
                batch_id = batchId,
            )
        }
    }

    fun doSave() {
        confirmUnassignedOpen = false
        val rows = rowsFor(null)
        if (rows.isEmpty()) return
        // Fotos fanges FØR listen ryddes, så de kan uploades efter indsættet.
        val photos = items.mapNotNull { item -> item.photo?.let { item.barcode to it } }.toMap()
        busy = true
        scope.launch {
            try {
                val inserted = Repository.insertParcels(rows)
                lastCount = rows.size
                toast.show("ok", msgSaved.format(rows.size))
                items = emptyList()
                sender = ""
                note = ""
                uploadPhotos(inserted, photos)
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
                sender = ""
                note = ""
                // Fotos kan ikke hægtes på pakker serveren ikke har endnu —
                // de droppes med en henvisning til Tilstand-fanen efter synk.
                if (photos.isNotEmpty()) toast.show("info", msgPhotoOffline.format(photos.size))
            }
            busy = false
            focusStamp = System.currentTimeMillis()
        }
    }

    // Afslut batch: opret batchen (server genererer batch_code), indsæt alle
    // pakker med batch_id → én notifikation. Uden forbindelse kan batchen ikke
    // grupperes (batch_id ukendt) → læg pakkerne i den normale kø uden gruppe.
    fun doSaveBatch() {
        val companyId = vm.companyId ?: return
        val receiver = empId ?: return
        busy = true
        scope.launch {
            val batch = try {
                Repository.createParcelBatch(companyId, receiver, deptId)
            } catch (e: RestException) {
                toast.show("err", "$msgSaveFailed: ${e.message ?: ""}")
                busy = false
                return@launch
            } catch (e: Exception) {
                null // offline — falder tilbage til ugrupperet kø nedenfor
            }
            val rows = rowsFor(batch?.id)
            val photos = items.mapNotNull { item -> item.photo?.let { item.barcode to it } }.toMap()
            try {
                if (batch == null) throw IllegalStateException("offline")
                val inserted = Repository.insertParcels(rows)
                lastCount = rows.size
                toast.show("ok", msgBatchSaved.format(rows.size, batch.batch_code))
                items = emptyList()
                sender = ""
                note = ""
                uploadPhotos(inserted, photos)
            } catch (e: RestException) {
                toast.show("err", "$msgSaveFailed: ${e.message ?: ""}")
            } catch (e: Exception) {
                // Kø PRÆCIS de forsøgte rækker: client_key skal genbruges, så et
                // svar-tab efter server-commit bliver en dublet-no-op ved synk
                // (samme princip som doSave). Er batchen nået at blive oprettet,
                // beholder rækkerne også batch_id → grupperingen overlever.
                LocalStore.queue(ctx, rows)
                vm.refreshPending()
                lastCount = rows.size
                toast.show("info", msgBatchOffline.format(rows.size))
                items = emptyList()
                sender = ""
                note = ""
                // Fotos kan ikke hægtes på pakker serveren ikke har endnu.
                if (photos.isNotEmpty()) toast.show("info", msgPhotoOffline.format(photos.size))
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
        // Batch kræver netop én modtager (det er hele pointen — én besked).
        if (batchMode) {
            if (empId == null) {
                toast.show("err", msgBatchReceiver)
                return
            }
            doSaveBatch()
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
        // Kunne stamdata ikke hentes, er vælgerne tomme af en grund brugeren
        // ellers ikke kan se — vis den frem for at lade skærmen se "forkert
        // opsat" ud.
        vm.masterDataError?.let { msg ->
            Text(
                msg,
                color = C.red,
                fontSize = 12.sp,
                modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
            )
        }

        // Batch-tilstand til/fra: flere pakker til samme modtager → én besked.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp)
                .border(1.dp, if (batchMode) C.green else C.line, RoundedCornerShape(12.dp))
                .background(C.panel, RoundedCornerShape(12.dp))
                .clickable { batchMode = !batchMode; focusStamp = System.currentTimeMillis() }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.receive_batch_mode), color = C.txt, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(
                    stringResource(R.string.receive_batch_hint),
                    color = C.muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Text(
                if (batchMode) "☑" else "☐",
                color = if (batchMode) C.green else C.muted,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 22.sp,
            )
        }

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
            // Ville ankomstbeskeden blive sendt, men modtageren kan ikke nås på
            // nogen aktiveret kanal (mangler gyldig e-mail/mobil)? Meldes her
            // ved modtagelsen — pakken kan stadig registreres.
            val notify = vm.notifyPrefs
            val selEmp = vm.employees.firstOrNull { it.id == empId }
            val unreachable = notify != null && notify.arrivalActive &&
                (notify.emailOn || notify.smsOn) && selEmp != null &&
                !(
                    (notify.emailOn && hasValidEmail(selEmp.email)) ||
                        (notify.smsOn && hasValidMsisdn(selEmp.phone))
                    )
            if (unreachable) {
                Text(
                    stringResource(R.string.receive_no_contact_warning),
                    color = C.red,
                    fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                )
            }
        }
        if (showDept) {
            // Afdeling er valgfri når der også er en modtager (som på webben) og
            // foldes derfor sammen; i "modtag til afdeling"-tilstand (uden
            // medarbejder) er afdelingen selve modtageren og vises altid.
            if (showEmp) {
                FoldSection(title = stringResource(R.string.department), summary = deptName(deptId)) { collapse ->
                    LookupPicker(
                        title = stringResource(R.string.department),
                        items = vm.departments.map { it.id to it.name },
                        selectedId = deptId,
                        onSelect = { deptId = it; focusStamp = System.currentTimeMillis(); collapse() },
                        embedded = true,
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
        // Afsender (spec Flow 1: valgfri) — fri tekst med forslag fra
        // virksomhedens tidligere afsendere (hyppigste først). Tryk på et
        // forslag udfylder feltet; der kan stadig skrives frit.
        FoldSection(
            title = stringResource(R.string.sender),
            summary = sender.trim().ifBlank { null },
        ) { collapse ->
            OutlinedTextField(
                value = sender,
                onValueChange = { sender = it },
                placeholder = { Text(stringResource(R.string.receive_sender_placeholder)) },
                singleLine = true,
                colors = operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            val query = sender.trim()
            val suggestions = vm.senderSuggestions
                .filter { query.isBlank() || it.contains(query, ignoreCase = true) }
                .filterNot { it.equals(query, ignoreCase = true) }
                .take(8)
            if (suggestions.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .horizontalScroll(rememberScrollState()),
                ) {
                    suggestions.forEach { s ->
                        Text(
                            s,
                            color = C.txt,
                            fontSize = 13.sp,
                            modifier = Modifier
                                .padding(end = 6.dp)
                                .border(1.dp, C.line, RoundedCornerShape(999.dp))
                                .background(C.panel, RoundedCornerShape(999.dp))
                                .clickable { sender = s; focusStamp = System.currentTimeMillis(); collapse() }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
        if (vm.carriers.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.carrier),
                summary = vm.carriers.firstOrNull { it.id == carrierId }?.name,
            ) { collapse ->
                LookupPicker(
                    title = stringResource(R.string.carrier),
                    items = vm.carriers.map { it.id to it.name },
                    selectedId = carrierId,
                    onSelect = { carrierId = it; focusStamp = System.currentTimeMillis(); collapse() },
                    embedded = true,
                )
            }
        }
        if (vm.handlingClasses.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.handling),
                summary = vm.handlingClasses.firstOrNull { it.id == handlingId }?.name,
            ) { collapse ->
                LookupPicker(
                    title = stringResource(R.string.handling),
                    items = vm.handlingClasses.map { it.id to it.name },
                    selectedId = handlingId,
                    onSelect = { handlingId = it; focusStamp = System.currentTimeMillis(); collapse() },
                    embedded = true,
                )
            }
        }
        if (vm.storageLocations.isNotEmpty()) {
            FoldSection(
                title = stringResource(R.string.storage_location),
                summary = vm.storageLocations.firstOrNull { it.id == locationId }?.name,
            ) { collapse ->
                LookupPicker(
                    title = stringResource(R.string.storage_location),
                    items = vm.storageLocations.map { it.id to it.name },
                    selectedId = locationId,
                    onSelect = { locationId = it; focusStamp = System.currentTimeMillis(); collapse() },
                    embedded = true,
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
                // Tilstandsfoto for netop denne pakke — grøn ramme = foto sat.
                Text(
                    "📷",
                    fontSize = 20.sp,
                    modifier = Modifier
                        .let {
                            if (item.photo != null) {
                                it.border(1.5.dp, C.green, RoundedCornerShape(8.dp))
                            } else {
                                it
                            }
                        }
                        .clickable { photoTarget = item.barcode }
                        .padding(4.dp),
                )
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
            if (batchMode) {
                stringResource(R.string.receive_batch_finish, items.size)
            } else {
                stringResource(R.string.receive_save_button, items.size)
            },
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

    // Warn-and-allow for URL-lignende scanninger: "brug alligevel" tilføjer
    // koden som en almindelig scanning. Kø — dialogen viser første ventende
    // kode, næste følger efter.
    pendingUrls.firstOrNull()?.let { code ->
        ConfirmDialog(
            title = stringResource(R.string.scan_url_title),
            body = stringResource(R.string.scan_url_body, code),
            confirmText = stringResource(R.string.scan_url_confirm),
            onDismiss = { pendingUrls = pendingUrls - code },
            onConfirm = {
                pendingUrls = pendingUrls - code
                commitScan(code)
            },
        )
    }

    // Koden står allerede som en åben pakke i databasen. Den ER tilføjet
    // (synkront — en scanning må aldrig vente på netværket), så dialogen
    // spørger om den skal fjernes igen; annullér/luk beholder den. Kun koder
    // der stadig står i listen bekræftes — resten af køen er forældet.
    val activeDup = pendingDups.firstOrNull { code -> items.any { it.barcode == code } }
    if (pendingDups.isNotEmpty() && activeDup == null) pendingDups = emptyList()
    activeDup?.let { code ->
        ConfirmDialog(
            title = stringResource(R.string.receive_dup_title),
            body = stringResource(R.string.receive_dup_body, code),
            confirmText = stringResource(R.string.receive_dup_confirm),
            confirmColor = C.red,
            contentColor = Color.White,
            onDismiss = { pendingDups = pendingDups - code },
            onConfirm = {
                items = items.filter { it.barcode != code }
                pendingDups = pendingDups - code
            },
        )
    }

    // Tilstandsfoto for én scannet pakke (kamera/galleri som Tilstand-fanen).
    photoTarget?.let { target ->
        val item = items.firstOrNull { it.barcode == target }
        if (item == null) {
            photoTarget = null
        } else {
            Dialog(onDismissRequest = { photoTarget = null }) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(C.panel, RoundedCornerShape(18.dp))
                        .padding(20.dp),
                ) {
                    Text(
                        stringResource(R.string.receive_photo_title),
                        color = C.txt,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(target, color = C.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    val preview = remember(item.photo) {
                        item.photo?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
                    }
                    if (preview != null) {
                        Image(
                            bitmap = preview,
                            contentDescription = null,
                            modifier = Modifier.fillMaxWidth().height(200.dp).padding(top = 12.dp),
                            contentScale = ContentScale.Fit,
                        )
                        GhostButton(
                            stringResource(R.string.condition_remove_photo),
                            textColor = C.red,
                            modifier = Modifier.padding(top = 8.dp),
                        ) { setItemPhoto(target, null) }
                    } else {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            GhostButton(
                                stringResource(R.string.condition_take_photo),
                                modifier = Modifier.weight(1f),
                            ) { onTakePhoto() }
                            GhostButton(
                                stringResource(R.string.condition_pick_gallery),
                                modifier = Modifier.weight(1f),
                            ) { pickImage.launch("image/*") }
                        }
                    }
                    BigButton(
                        stringResource(R.string.close),
                        color = C.green,
                        contentColor = C.greenInk,
                        modifier = Modifier.padding(top = 18.dp),
                    ) { photoTarget = null }
                }
            }
        }
    }
}
