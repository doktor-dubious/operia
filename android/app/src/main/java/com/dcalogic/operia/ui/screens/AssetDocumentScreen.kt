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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Asset
import com.dcalogic.operia.data.AssetDocument
import com.dcalogic.operia.data.AssetDocumentInsert
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.data.supabase
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.ScanBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.operiaFieldColors
import com.dcalogic.operia.ui.rememberToast
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

// Foto-hjælperne spejler ConditionScreen (fil-private dér, så de gentages her
// med samme regler: nedskalér til ASSET_MAX_DIM, brænd EXIF-rotationen ind, JPEG 85).
private const val ASSET_MAX_DIM = 1600

private fun assetExifRotationDegrees(raw: ByteArray): Float = runCatching {
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

private fun assetReadScaledJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
    val raw = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ASSET_MAX_DIM) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size, opts) ?: return null
    val rotation = assetExifRotationDegrees(raw)
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

private fun assetNewCaptureUri(context: Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "asset_cap_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

/**
 * Dokumentér aktiv: scan → se hidtidig dokumentation → tilføj foto og/eller
 * note (mindst ét af dem — spejler asset_documents-checket). Fotos lander i
 * den private asset-photos-bucket; hver post logges i aktivets historik
 * ('documented').
 */
@Composable
fun AssetDocumentScreen(vm: AppViewModel, onBack: () -> Unit, initialCode: String? = null) {
    val toast = rememberToast()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current

    var asset by remember { mutableStateOf<Asset?>(null) }
    var docs by remember { mutableStateOf<List<AssetDocument>>(emptyList()) }
    var note by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var focusStamp by remember { mutableStateOf(0L) }

    val msgNotFound = stringResource(R.string.asset_not_found)
    val msgLookupFailed = stringResource(R.string.asset_lookup_failed)
    val msgNeedContent = stringResource(R.string.asset_document_need_content)
    val msgPhotoFailed = stringResource(R.string.condition_photo_failed)
    val msgCameraDenied = stringResource(R.string.condition_camera_denied)
    val msgSaved = stringResource(R.string.asset_document_saved)
    val msgSaveFailed = stringResource(R.string.asset_document_save_failed)
    val msgLoadFailed = stringResource(R.string.asset_document_load_failed)

    fun loadDocs(aid: String) {
        scope.launch {
            try {
                docs = Repository.assetDocuments(aid)
            } catch (e: Exception) {
                // En fejlet hentning må ikke ligne "ingen dokumentation" —
                // så ville handleren dokumentere dobbelt eller melde bevis savnet.
                docs = emptyList()
                toast.show("err", msgLoadFailed)
            }
        }
    }

    fun find(code: String) {
        scope.launch {
            try {
                val found = Repository.findAssets(vm.companyId ?: return@launch, code)
                if (found.isEmpty()) {
                    asset = null
                    toast.show("err", "$msgNotFound: $code")
                    return@launch
                }
                val a = found.first()
                asset = a
                note = ""
                photo = null
                preview = null
                loadDocs(a.id)
            } catch (e: Exception) {
                toast.show("err", msgLookupFailed)
            }
        }
    }

    LaunchedEffect(Unit) { initialCode?.takeIf { it.isNotBlank() }?.let { find(it) } }

    fun applyPhoto(uri: Uri?) {
        if (uri == null) return
        val bytes = assetReadScaledJpeg(ctx, uri)
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
        val uri = assetNewCaptureUri(ctx)
        pendingUri = uri
        takePicture.launch(uri)
    }

    val requestCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else toast.show("err", msgCameraDenied)
    }

    fun onTakePhoto() {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) launchCamera() else requestCamera.launch(Manifest.permission.CAMERA)
    }

    fun save() {
        val a = asset ?: return
        val bytes = photo
        if (bytes == null && note.trim().isBlank()) {
            toast.show("err", msgNeedContent)
            return
        }
        busy = true
        scope.launch {
            try {
                val uid = supabase.auth.currentUserOrNull()?.id
                val path = bytes?.let { Repository.uploadAssetPhoto(a.company_id, a.id, it) }
                Repository.insertAssetDocument(
                    AssetDocumentInsert(
                        asset_id = a.id,
                        company_id = a.company_id,
                        storage_path = path,
                        note = note.trim().ifBlank { null },
                        created_by = uid,
                    ),
                )
                toast.show("ok", msgSaved)
                note = ""
                photo = null
                preview = null
                loadDocs(a.id)
                focusStamp = System.currentTimeMillis()
            } catch (e: Exception) {
                toast.show("err", "$msgSaveFailed: ${e.message ?: ""}")
            }
            busy = false
        }
    }

    Screen(title = stringResource(R.string.asset_document_title), onBack = onBack, toast = toast) {
        ScanBox(label = stringResource(R.string.asset_scan_label), onScan = ::find, focusStamp = focusStamp)

        val a = asset
        if (a == null) {
            EmptyBox("📷", stringResource(R.string.asset_document_empty))
        } else {
            AssetCard(vm, a)

            // Eksisterende dokumentation (uden miniaturer — vises i fuld på webben).
            FieldLabel(stringResource(R.string.asset_document_existing, docs.size), topPadding = 16)
            if (docs.isEmpty()) {
                Text(stringResource(R.string.asset_document_none), color = C.muted, fontSize = 13.sp)
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
                        Text(
                            if (d.storage_path != null) "📷" else "📝",
                            fontSize = 20.sp,
                            modifier = Modifier.padding(end = 10.dp),
                        )
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

            FieldLabel(stringResource(R.string.asset_document_photo_label), topPadding = 16)
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
                stringResource(R.string.asset_document_save),
                color = C.green,
                contentColor = C.greenInk,
                busy = busy,
                modifier = Modifier.padding(top = 20.dp),
            ) { save() }
        }
    }
}
