package com.dcalogic.operia.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Håndterminal-tema: mørkt, høj kontrast, store touch-flader.
 * Terminalen bruges i modtagelser/kældre — mørk baggrund uanset systemtema.
 */
object C {
    val bg = Color(0xFF0B1220)
    val panel = Color(0xFF16213A)
    val panel2 = Color(0xFF1D2B47)
    val line = Color(0xFF293752)
    val txt = Color(0xFFEEF3FC)
    val muted = Color(0xFF8FA2C4)
    val blue = Color(0xFF2D6FF0)
    val green = Color(0xFF22C55E)
    val amber = Color(0xFFF59E0B)
    val red = Color(0xFFEF4444)
    val greenInk = Color(0xFF04210F)
    val placeholder = Color(0xFF5B6B8A)
}

/** Brandfarve fra product_appearance ("#RRGGBB") med sikkert fallback. */
fun brandColor(hex: String?): Color = try {
    Color(android.graphics.Color.parseColor(hex ?: "#2D6FF0"))
} catch (_: Exception) {
    C.blue
}

@Composable
fun OperiaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = C.blue,
            background = C.bg,
            surface = C.panel,
            surfaceVariant = C.panel2,
            onPrimary = Color.White,
            onBackground = C.txt,
            onSurface = C.txt,
            outline = C.line,
            error = C.red,
        ),
        content = content,
    )
}
