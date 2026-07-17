package com.dcalogic.operia.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

// Lille billedhenter til designbilleder (logo/hero fra den offentlige
// company-logos-bucket). Bevidst uden Coil: appen viser to små billeder, og et
// bibliotek ville koste mere end denne fil. Hukommelses-cache så startskærmen
// ikke henter igen ved hver visning; fejl (offline, død URL) viser ingenting —
// skærmen skal aldrig vælte på pynt.

private val cache = LruCache<String, ImageBitmap>(8)

// Store uploads (fotos som hero) samples ned før afkodning, så et 12 MP-billede
// ikke lægger et ~50 MB-bitmap i en 130 dp høj ramme.
private const val MAX_DIMENSION = 1600

private fun decode(bytes: ByteArray): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DIMENSION) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.asImageBitmap()
}

@Composable
fun RemoteImage(
    url: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
) {
    var image by remember(url) { mutableStateOf(cache.get(url)) }
    LaunchedEffect(url) {
        if (image != null) return@LaunchedEffect
        val loaded = withContext(Dispatchers.IO) {
            runCatching { decode(URL(url).openStream().use { it.readBytes() }) }.getOrNull()
        }
        if (loaded != null) {
            cache.put(url, loaded)
            image = loaded
        }
    }
    image?.let {
        Image(bitmap = it, contentDescription = contentDescription, modifier = modifier, contentScale = contentScale)
    }
}
