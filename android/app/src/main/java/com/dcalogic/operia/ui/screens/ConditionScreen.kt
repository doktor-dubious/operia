package com.dcalogic.operia.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Parcel
import com.dcalogic.operia.data.ParcelDocument
import com.dcalogic.operia.data.ParcelDocumentInsert
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.data.supabase
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.Card
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import com.dcalogic.operia.ui.statusColor
import com.dcalogic.operia.ui.statusLabel
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

private const val MAX_DIM = 1600

/** Rotationsvinklen der bringer et billede opret ud fra dets EXIF-Orientation. */
private fun exifRotationDegrees(raw: ByteArray): Float = runCatching {
    when (ExifInterface(ByteArrayInputStream(raw)).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
    )) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
}.getOrDefault(0f)

/** Læs et billede fra en Uri, nedskalér til ~MAX_DIM og komprimér til JPEG, så
 *  uploads holdes små uanset kameraets opløsning. Kamera-JPEG'er bærer typisk
 *  orienteringen i EXIF-tagget frem for i pixeldataene; da re-komprimeringen
 *  fjerner EXIF, brænder vi rotationen ind i pixels, så bevisbilledet ikke
 *  ender liggende på både enhed og web. */
private fun readScaledJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
    val raw = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DIM) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size, opts) ?: return null
    val rotation = exifRotationDegrees(raw)
    val bmp = if (rotation == 0f) {
        decoded
    } else {
        Bitmap.createBitmap(
            decoded, 0, 0, decoded.width, decoded.height,
            Matrix().apply { postRotate(rotation) }, true,
        )
    }
    ByteArrayOutputStream().use { out ->
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        out.toByteArray()
    }
}.getOrNull()

/** Midlertidig fil-Uri til kamera-optagelse, delt via FileProvider. */
private fun newCaptureUri(context: Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "cap_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

/**
 * Tilstand (dokumentation): scan en pakke → se dens dokumentation → tilføj et
 * foto (kamera eller galleri) med en valgfri note. Fotos lander i den private
 * parcel-photos-bucket; hver post logges i pakkens historik ('documented').
 * Miniaturer vises i fuld størrelse på webbens pakke-detalje.
 */
@Composable
fun ConditionScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current

    var parcel by remember { mutableStateOf<Parcel?>(null) }
    var docs by remember { mutableStateOf<List<ParcelDocument>>(emptyList()) }
    var note by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.handout_not_found)
    val msgLookupFailed = stringResource(R.string.handout_lookup_failed)
    val msgPhotoRequired = stringResource(R.string.condition_photo_required)
    val msgPhotoFailed = stringResource(R.string.condition_photo_failed)
    val msgCameraDenied = stringResource(R.string.condition_camera_denied)
    val msgSaved = stringResource(R.string.condition_saved)
    val msgSaveFailed = stringResource(R.string.condition_save_failed)

    fun loadDocs(pid: String) {
        scope.launch { docs = runCatching { Repository.parcelDocuments(pid) }.getOrDefault(emptyList()) }
    }

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findParcels(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    parcel = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                val p = found.first()
                parcel = p
                note = ""
                photo = null
                preview = null
                loadDocs(p.id)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    fun applyPhoto(uri: Uri?) {
        if (uri == null) return
        val bytes = readScaledJpeg(ctx, uri)
        if (bytes == null) {
            toast.show("err", msgPhotoFailed)
            return
        }
        photo = bytes
        preview = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
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

    fun save() {
        val p = parcel ?: return
        val bytes = photo
        if (bytes == null) {
            toast.show("err", msgPhotoRequired)
            return
        }
        busy = true
        scope.launch {
            try {
                val uid = supabase.auth.currentUserOrNull()?.id
                val path = Repository.uploadParcelPhoto(p.company_id, p.id, bytes)
                Repository.insertParcelDocument(
                    ParcelDocumentInsert(
                        parcel_id = p.id,
                        company_id = p.company_id,
                        storage_path = path,
                        note = note.trim().ifBlank { null },
                        created_by = uid,
                    ),
                )
                toast.show("ok", msgSaved)
                note = ""
                photo = null
                preview = null
                loadDocs(p.id)
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", "$msgSaveFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.condition_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.condition_scan_label), onScan = ::find, focusStamp = focusStamp)

        val p = parcel
        if (p == null) {
            EmptyBox("📷", stringResource(R.string.condition_empty))
        } else {
            Card {
                Text(p.barcode ?: p.id.take(8), color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    stringResource(R.string.receiver_prefix, receiverLabel(vm, p)),
                    color = C.muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    statusLabel(p.status),
                    color = statusColor(p.status),
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            // Eksisterende dokumentation (uden miniaturer — vises i fuld på webben).
            FieldLabel(stringResource(R.string.condition_existing, docs.size), topPadding = 16)
            if (docs.isEmpty()) {
                Text(stringResource(R.string.condition_none), color = C.muted, fontSize = 13.sp)
            } else {
                docs.forEach { d ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 6.dp)
                            .border(1.dp, C.line, RoundedCornerShape(12.dp))
                            .background(C.panel, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("📷", fontSize = 20.sp, modifier = Modifier.padding(end = 10.dp))
                        Column(Modifier.weight(1f)) {
                            d.created_at?.let {
                                Text(formatLocalTimestamp(it), color = C.muted, fontSize = 12.sp)
                            }
                            if (!d.note.isNullOrBlank()) {
                                Text(
                                    d.note,
                                    color = C.txt,
                                    fontSize = 14.sp,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                        }
                    }
                }
            }

            // Nyt foto (påkrævet for en dokumentationspost).
            FieldLabel(stringResource(R.string.condition_photo_label), topPadding = 16)
            val pv = preview
            if (pv != null) {
                Image(
                    bitmap = pv,
                    contentDescription = null,
                    modifier = Modifier.fillMaxWidth().height(200.dp),
                    contentScale = ContentScale.Fit,
                )
                GhostButton(
                    stringResource(R.string.condition_remove_photo),
                    textColor = C.red,
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    photo = null
                    preview = null
                }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GhostButton(stringResource(R.string.condition_take_photo), modifier = Modifier.weight(1f)) {
                        onTakePhoto()
                    }
                    GhostButton(stringResource(R.string.condition_pick_gallery), modifier = Modifier.weight(1f)) {
                        pickImage.launch("image/*")
                    }
                }
            }

            FieldLabel(stringResource(R.string.note_optional), topPadding = 14)
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                placeholder = { Text(stringResource(R.string.note_placeholder)) },
                colors = operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            BigButton(
                stringResource(R.string.condition_save),
                color = C.green,
                contentColor = C.greenInk,
                busy = busy,
                modifier = Modifier.padding(top = 20.dp),
            ) { save() }
        }
    }
}
