package com.dcalogic.operia.ui.screens

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

// Fælles foto-hjælpere for tilstandsdokumentation — delt af Tilstand-skærmen
// og Modtag-skærmens pr.-pakke-fotos.

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
internal fun readScaledJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
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
internal fun newCaptureUri(context: Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "cap_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}
