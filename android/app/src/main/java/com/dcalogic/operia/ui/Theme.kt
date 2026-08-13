package com.dcalogic.operia.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

/**
 * Håndterminal-tema: mørkt, høj kontrast, store touch-flader.
 * Terminalen bruges i modtagelser/kældre — mørk baggrund uanset systemtema.
 *
 * Farverne kommer fra et valgt farvetema (Operia → Handheld-design → Tema,
 * gemt på handheld_design.theme). Skærmene læser dem via [C]; de temaafhængige
 * felter er snapshot-state, så et temaskift recomposer hele appen. [OperiaTheme]
 * skubber det valgte temas palet ind i [C].
 */

/** En enhedspalet. Spejler HANDHELD_PALETTES i web/src/lib/handheld-tiles.ts
 *  (panel2 er en let lysere paneltone, kun brugt på enheden til surfaceVariant). */
data class HandheldPalette(
    val bg: Color,
    val panel: Color,
    val panel2: Color,
    val line: Color,
    val txt: Color,
    val muted: Color,
)

// Fire temaer — samme nøgler og grundfarver som web'ens HANDHELD_PALETTES.
// 'midnight' er enhedens oprindelige farver og standard.
val HANDHELD_PALETTES: Map<String, HandheldPalette> = mapOf(
    "midnight" to HandheldPalette(
        bg = Color(0xFF0B1220), panel = Color(0xFF16213A), panel2 = Color(0xFF1D2B47),
        line = Color(0xFF293752), txt = Color(0xFFEEF3FC), muted = Color(0xFF8FA2C4),
    ),
    "graphite" to HandheldPalette(
        bg = Color(0xFF0E0F12), panel = Color(0xFF1B1D22), panel2 = Color(0xFF23262C),
        line = Color(0xFF2E3138), txt = Color(0xFFF2F3F5), muted = Color(0xFF9AA1AD),
    ),
    "forest" to HandheldPalette(
        bg = Color(0xFF0B1410), panel = Color(0xFF14241C), panel2 = Color(0xFF1B3026),
        line = Color(0xFF24382E), txt = Color(0xFFECF5EF), muted = Color(0xFF8CB4A0),
    ),
    "plum" to HandheldPalette(
        bg = Color(0xFF140E1C), panel = Color(0xFF241A33), panel2 = Color(0xFF2E2240),
        line = Color(0xFF382B4C), txt = Color(0xFFF3EEFA), muted = Color(0xFFA996C4),
    ),
    "ember" to HandheldPalette(
        bg = Color(0xFF16100C), panel = Color(0xFF291A14), panel2 = Color(0xFF35231B),
        line = Color(0xFF422C22), txt = Color(0xFFF7EFEA), muted = Color(0xFFC4A594),
    ),
)

fun handheldPalette(theme: String?): HandheldPalette =
    HANDHELD_PALETTES[theme] ?: HANDHELD_PALETTES.getValue("midnight")

object C {
    // Temaafhængige farver — sættes af [OperiaTheme] ud fra det valgte farvetema.
    // Snapshot-state, så alle C.xxx-læsere recomposer når temaet skifter. Init =
    // 'midnight' (enhedens oprindelige farver), så første frame før config er
    // hentet ser rigtig ud.
    var bg by mutableStateOf(Color(0xFF0B1220))
    var panel by mutableStateOf(Color(0xFF16213A))
    var panel2 by mutableStateOf(Color(0xFF1D2B47))
    var line by mutableStateOf(Color(0xFF293752))
    var txt by mutableStateOf(Color(0xFFEEF3FC))
    var muted by mutableStateOf(Color(0xFF8FA2C4))
    // Faste statusfarver — ens på tværs af temaer.
    val blue = Color(0xFF2D6FF0)
    val green = Color(0xFF22C55E)
    val amber = Color(0xFFF59E0B)
    val red = Color(0xFFEF4444)
    val greenInk = Color(0xFF04210F)
    val placeholder = Color(0xFF5B6B8A)
    // Kant om felter udfyldt af AI-label-læsningen. Lilla — bevidst uden for
    // statusfarverne, så markeringen ikke læses som en advarsel eller en fejl.
    // Samme rolle som webbens --ai-filled.
    val ai = Color(0xFF9F80DC)
}

/** Brandfarve fra product_appearance ("#RRGGBB") med sikkert fallback. */
fun brandColor(hex: String?): Color = try {
    Color(android.graphics.Color.parseColor(hex ?: "#2D6FF0"))
} catch (_: Exception) {
    C.blue
}

@Composable
fun OperiaTheme(themeKey: String = "midnight", content: @Composable () -> Unit) {
    val palette = handheldPalette(themeKey)
    // Skub temaets farver ind i C, så alle C.xxx-baserede skærme følger temaet.
    // SideEffect: skriv først efter en vellykket komposition (ikke under den) —
    // OperiaTheme læser ikke selv C's temafelter, så der opstår ingen løkke.
    SideEffect {
        C.bg = palette.bg
        C.panel = palette.panel
        C.panel2 = palette.panel2
        C.line = palette.line
        C.txt = palette.txt
        C.muted = palette.muted
    }
    // colorScheme bygges direkte fra paletten, så Material-flader (surface,
    // background m.m.) rammer den rigtige farve på samme frame som skiftet.
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = C.blue,
            background = palette.bg,
            surface = palette.panel,
            surfaceVariant = palette.panel2,
            onPrimary = Color.White,
            onBackground = palette.txt,
            onSurface = palette.txt,
            outline = palette.line,
            error = C.red,
        ),
        content = content,
    )
}
