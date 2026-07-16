package com.dcalogic.operia.ui

import android.graphics.Bitmap
import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.dcalogic.operia.R
import java.io.ByteArrayOutputStream

/**
 * Underskrift på skærm (spec §handover, feature 'signature').
 * Tegnes med fingeren; gemmes som PNG-bytes (hvid baggrund, sort streg)
 * klar til upload i den private 'signatures'-bucket.
 */
@Composable
fun SignatureDialog(
    onDismiss: () -> Unit,
    onSaved: (ByteArray) -> Unit,
) {
    val strokes = remember { mutableStateListOf<List<Offset>>() }
    var current by remember { mutableStateOf<List<Offset>>(emptyList()) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(Modifier.fillMaxSize().background(Color.White)) {
            Column(
                Modifier.fillMaxWidth().background(C.panel).padding(bottom = 14.dp),
            ) {
                Spacer(Modifier.statusBarsPadding())
                Text(
                    stringResource(R.string.signature_title),
                    color = C.txt,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(start = 16.dp, top = 8.dp),
                )
                Text(
                    stringResource(R.string.signature_hint),
                    color = C.muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(start = 16.dp, top = 2.dp),
                )
            }

            Canvas(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .onSizeChanged { canvasSize = it }
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { current = listOf(it) },
                            onDrag = { change, _ -> current = current + change.position },
                            onDragEnd = {
                                if (current.size > 1) strokes.add(current)
                                current = emptyList()
                            },
                        )
                    },
            ) {
                (strokes + listOf(current)).forEach { stroke ->
                    if (stroke.size > 1) {
                        val path = Path().apply {
                            moveTo(stroke.first().x, stroke.first().y)
                            stroke.drop(1).forEach { lineTo(it.x, it.y) }
                        }
                        drawPath(
                            path,
                            Color.Black,
                            style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                        )
                    }
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .navigationBarsPadding(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                GhostButton(
                    stringResource(R.string.cancel),
                    textColor = C.red,
                    modifier = Modifier.weight(1f),
                ) { onDismiss() }
                GhostButton(
                    stringResource(R.string.signature_clear),
                    textColor = Color(0xFF0B1220),
                    modifier = Modifier.weight(1f),
                ) { strokes.clear() }
                BigButton(
                    stringResource(R.string.save),
                    color = C.green,
                    contentColor = C.greenInk,
                    modifier = Modifier.weight(1.4f),
                ) {
                    if (strokes.isEmpty()) return@BigButton
                    onSaved(renderPng(strokes, canvasSize))
                    onDismiss()
                }
            }
        }
    }
}

private fun renderPng(strokes: List<List<Offset>>, size: IntSize): ByteArray {
    val w = size.width.coerceAtLeast(1)
    val h = size.height.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.WHITE)
    val paint = Paint().apply {
        color = android.graphics.Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }
    strokes.forEach { stroke ->
        val path = android.graphics.Path().apply {
            moveTo(stroke.first().x, stroke.first().y)
            stroke.drop(1).forEach { lineTo(it.x, it.y) }
        }
        canvas.drawPath(path, paint)
    }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    return out.toByteArray()
}
