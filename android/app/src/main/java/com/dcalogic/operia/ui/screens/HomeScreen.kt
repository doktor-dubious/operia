package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddBox
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AssignmentTurnedIn
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Handshake
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.Warehouse
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AssignmentTurnedIn
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Inventory
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Warehouse
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.HandheldTileCfg
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.RemoteImage
import com.dcalogic.operia.ui.ToastOverlay
import com.dcalogic.operia.ui.ToastState
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch
import java.util.Calendar

/**
 * Startskærmens flisekatalog. `key` og `icon` SKAL matche HANDHELD_TILES i
 * web/src/lib/handheld-tiles.ts — designet gemt i Operia → Handheld-design
 * refererer fliserne på netop de nøgler.
 */
private data class Tile(
    val key: String,
    val icon: String,
    val titleRes: Int,
    val subRes: Int,
    val route: String,
    val feature: String,
)

// Standard-ikonerne SKAL matche HANDHELD_TILES i web/src/lib/handheld-tiles.ts
// — de er skrivebordsappens egne ikoner for de samme funktioner (nav.ts).
private val CATALOG = listOf(
    Tile("receive", "parcel-add", R.string.tile_receive, R.string.tile_receive_sub, "receive", "hh_receive"),
    Tile("handout", "parcel-check", R.string.tile_handout, R.string.tile_handout_sub, "handout", "hh_handout"),
    Tile("search", "search", R.string.tile_search, R.string.tile_search_sub, "search", "hh_search"),
    Tile("route", "route", R.string.tile_route, R.string.tile_route_sub, "route", "hh_route"),
    Tile("stock", "boxes", R.string.tile_stock, R.string.tile_stock_sub, "stock", "hh_stock"),
)

/**
 * Ikonnøgle → emoji + vektorikon. Spejler HANDHELD_ICONS i
 * web/src/lib/handheld-tiles.ts: dér er hvert ikon en emoji (tema 'happy') plus
 * et lucide-ikon (øvrige temaer). Compose har ikke lucide, så vi bruger det
 * nærmeste Material-ikon — nøglerne og deres betydning er de samme, så et
 * ikonvalg i webben giver samme ikon her.
 */
private data class IconSpec(
    val emoji: String,
    val outlined: ImageVector,
    val filled: ImageVector,
    /** Lucide-tegningen fra skrivebordsappen (tema 'desktop'). Genereret fra
     *  webbens egen lucide-react-pakke — se web/scripts/gen-lucide-android-icons.mjs. */
    val lucide: Int,
)

private val ICONS = mapOf(
    // Skrivebordsappens ikoner for de samme funktioner — standardfliserne bruger disse.
    "parcel-add" to IconSpec("📦", Icons.Outlined.AddBox, Icons.Filled.AddBox, R.drawable.ic_lucide_parcel_add),
    "parcel-check" to IconSpec("📤", Icons.Outlined.AssignmentTurnedIn, Icons.Filled.AssignmentTurnedIn, R.drawable.ic_lucide_parcel_check),
    "parcel-in" to IconSpec("📦", Icons.Outlined.Inventory2, Icons.Filled.Inventory2, R.drawable.ic_lucide_parcel_in),
    "parcel-out" to IconSpec("📤", Icons.Outlined.Upload, Icons.Filled.Upload, R.drawable.ic_lucide_parcel_out),
    "search" to IconSpec("🔎", Icons.Outlined.Search, Icons.Filled.Search, R.drawable.ic_lucide_search),
    "map" to IconSpec("🗺️", Icons.Outlined.Map, Icons.Filled.Map, R.drawable.ic_lucide_map),
    "stock" to IconSpec("🗄️", Icons.Outlined.Archive, Icons.Filled.Archive, R.drawable.ic_lucide_stock),
    "inbox" to IconSpec("📥", Icons.Outlined.Inbox, Icons.Filled.Inbox, R.drawable.ic_lucide_inbox),
    "scan" to IconSpec("📷", Icons.Outlined.DocumentScanner, Icons.Filled.DocumentScanner, R.drawable.ic_lucide_scan),
    "barcode" to IconSpec("🏷️", Icons.Outlined.QrCode2, Icons.Filled.QrCode2, R.drawable.ic_lucide_barcode),
    "truck" to IconSpec("🚚", Icons.Outlined.LocalShipping, Icons.Filled.LocalShipping, R.drawable.ic_lucide_truck),
    "route" to IconSpec("🧭", Icons.Outlined.Route, Icons.Filled.Route, R.drawable.ic_lucide_route),
    "boxes" to IconSpec("📚", Icons.Outlined.Inventory, Icons.Filled.Inventory, R.drawable.ic_lucide_boxes),
    "warehouse" to IconSpec("🏬", Icons.Outlined.Warehouse, Icons.Filled.Warehouse, R.drawable.ic_lucide_warehouse),
    "delivered" to IconSpec("✅", Icons.Outlined.CheckCircle, Icons.Filled.CheckCircle, R.drawable.ic_lucide_delivered),
    "signature" to IconSpec("✍️", Icons.Outlined.Draw, Icons.Filled.Draw, R.drawable.ic_lucide_signature),
    "handover" to IconSpec("🤝", Icons.Outlined.Handshake, Icons.Filled.Handshake, R.drawable.ic_lucide_handover),
    "list" to IconSpec("📋", Icons.Outlined.ListAlt, Icons.Filled.ListAlt, R.drawable.ic_lucide_list),
    "bell" to IconSpec("🔔", Icons.Outlined.Notifications, Icons.Filled.Notifications, R.drawable.ic_lucide_bell),
)

private val FALLBACK_ICON =
    IconSpec("📦", Icons.Outlined.Inventory2, Icons.Filled.Inventory2, R.drawable.ic_lucide_parcel_in)

/**
 * Ét flise-ikon tegnet efter designets ikon-tema. Spejler TileIcon i
 * web/src/components/handheld-design-editor.tsx, så mock-up'en i webben og
 * enheden viser det samme:
 *   happy   — emoji (appens oprindelige udseende; emoji har egne farver, så
 *             flisens accentfarve gør med vilje ingenting her)
 *   desktop — lucide, samme tegning som skrivebordsappen (vektorer genereret
 *             fra webbens egen lucide-pakke, så de er identiske — ikke bare
 *             ens-agtige). De øvrige stregtemaer bruger Material-ikoner, der
 *             hører til Android.
 *   outline — stregtegning i accentfarven (ellers normal tekstfarve)
 *   solid   — udfyldt ikon i en afrundet firkant med accentfarven som baggrund
 *   mono    — stregtegning i dæmpet farve
 */
@Composable
private fun TileIcon(iconKey: String, theme: String, accent: Color?, size: Dp = 34.dp) {
    val spec = ICONS[iconKey] ?: FALLBACK_ICON
    when (theme) {
        "desktop" -> Icon(
            painterResource(spec.lucide),
            null,
            tint = accent ?: C.txt,
            modifier = Modifier.size(size),
        )
        "outline" -> Icon(spec.outlined, null, tint = accent ?: C.txt, modifier = Modifier.size(size))
        "mono" -> Icon(spec.outlined, null, tint = accent ?: C.muted, modifier = Modifier.size(size))
        "solid" -> Box(
            Modifier
                .size(size)
                .background(accent ?: C.line, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(spec.filled, null, tint = C.txt, modifier = Modifier.size(size * 0.58f))
        }
        // "happy" og ukendte temaer: emoji
        else -> Text(spec.emoji, fontSize = 38.sp)
    }
}

/** Farve fra designet. Webbens farvevælger skriver CSS-hex (#RGB, #RGBA,
 *  #RRGGBB, #RRGGBBAA — alfa SIDST), mens Androids parseColor læser 8 cifre som
 *  AARRGGBB og afviser 3/4 cifre helt — så hex parses her selv, ellers ville
 *  enheden vise en anden farve end webbens forhåndsvisning. Andet (navngivne
 *  farver, CSS-gradienter) forsøges med parseColor og falder ellers tilbage til
 *  standarden i stedet for at crashe. */
private fun cfgColor(value: String?): Color? {
    val v = value?.trim().orEmpty()
    if (v.isEmpty()) return null
    if (!v.startsWith("#")) {
        return runCatching { Color(android.graphics.Color.parseColor(v)) }.getOrNull()
    }
    val hex = v.drop(1)
    if (hex.any { Character.digit(it, 16) < 0 }) return null
    val full = when (hex.length) {
        3, 4 -> hex.map { "$it$it" }.joinToString("")
        6, 8 -> hex
        else -> return null
    }
    val r = full.substring(0, 2).toInt(16)
    val g = full.substring(2, 4).toInt(16)
    val b = full.substring(4, 6).toInt(16)
    val a = if (full.length == 8) full.substring(6, 8).toInt(16) else 255
    return Color(r, g, b, a)
}

/**
 * Sammensæt fliserne ud fra designet: gemt rækkefølge først, derefter
 * katalogfliser der endnu ikke er i designet (spejler normalizeHandheldTiles i
 * webben, så en ny flise aldrig forsvinder). Udeladt bliver dels fliser fjernet
 * i designet (enabled == false), dels fliser uden entitlement — BEGGE porte skal
 * passeres: designet er platformens valg, entitlementet er kundens.
 */
private fun resolveTiles(
    cfg: List<HandheldTileCfg>,
    has: (String) -> Boolean,
): List<Pair<Tile, HandheldTileCfg?>> {
    val seen = mutableSetOf<String>()
    val out = mutableListOf<Pair<Tile, HandheldTileCfg?>>()
    for (c in cfg) {
        val tile = CATALOG.firstOrNull { it.key == c.key } ?: continue // ukendt nøgle
        if (!seen.add(c.key)) continue // dublet
        if (c.enabled == false) continue // fjernet i designet
        out += tile to c
    }
    for (tile in CATALOG) {
        if (tile.key in seen) continue // også fjernede er "set" — ingen genopstandelse
        out += tile to null
    }
    return out.filter { has(it.first.feature) }
}

@Composable
fun HomeScreen(vm: AppViewModel, onNavigate: (String) -> Unit) {
    val toast: ToastState = rememberToast()
    val scope = rememberCoroutineScope()
    val syncedMsg = stringResource(R.string.sync_done)

    val design = vm.handheld.design
    val tiles = resolveTiles(vm.handheld.tiles) { vm.has(it) }

    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val greeting = stringResource(
        when {
            hour < 10 -> R.string.greeting_morning
            hour < 18 -> R.string.greeting_day
            else -> R.string.greeting_evening
        },
    )

    Box(Modifier.fillMaxSize().background(C.bg)) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxWidth().background(C.panel)) {
                Spacer(Modifier.statusBarsPadding())
                // Brandbjælke: valgfrit logo fra designet foran navnet — som
                // mock-up'en i Operia → Handheld-design viser den.
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (design.logoEnabled && design.logoUrl.isNotBlank()) {
                        RemoteImage(
                            design.logoUrl,
                            null,
                            Modifier.height(20.dp).widthIn(max = 80.dp),
                        )
                    }
                    Text(
                        vm.brand.name,
                        color = C.txt,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(C.line))
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                // Hero-billede fra designet, over hilsenen som i webbens mock-up.
                if (design.heroEnabled && design.heroUrl.isNotBlank()) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 14.dp)
                            .height(110.dp)
                            .clip(RoundedCornerShape(12.dp)),
                    ) {
                        RemoteImage(
                            design.heroUrl,
                            null,
                            Modifier.fillMaxSize(),
                            ContentScale.Crop,
                        )
                    }
                }

                // Velkomstindhold fra designet. Undertitlen erstatter hilsenen;
                // velkomsttitlen erstatter brugerens fornavn. Slået fra (eller
                // tom) ⇒ appens standard.
                val firstName = vm.userName.split(" ").firstOrNull() ?: ""
                if (design.subtitleEnabled) {
                    Text(
                        design.subtitle.ifBlank { "$greeting," },
                        color = C.muted,
                        fontSize = 15.sp,
                    )
                }
                Text(
                    if (design.welcomeTitleEnabled) design.welcomeTitle.ifBlank { firstName } else firstName,
                    color = C.txt,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(bottom = 18.dp),
                )

                if (vm.pendingCount > 0) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 16.dp)
                            .border(1.dp, C.amber, RoundedCornerShape(14.dp))
                            .background(androidx.compose.ui.graphics.Color(0xFF3A2D0B), RoundedCornerShape(14.dp))
                            .clickable {
                                scope.launch {
                                    val r = vm.syncPending()
                                    toast.show(if (r.left == 0) "ok" else "info", syncedMsg.format(r.synced, r.left))
                                }
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("⏳", fontSize = 22.sp, modifier = Modifier.padding(end = 10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                stringResource(R.string.pending_banner, vm.pendingCount),
                                color = C.amber,
                                fontWeight = FontWeight.ExtraBold,
                            )
                            Text(
                                stringResource(R.string.pending_banner_sub),
                                color = C.muted,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        Text("↻", color = C.amber, fontSize = 20.sp)
                    }
                }

                tiles.chunked(2).forEach { rowTiles ->
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        rowTiles.forEach { (tile, cfg) ->
                            val title = cfg?.title?.takeIf { it.isNotBlank() }
                                ?: stringResource(tile.titleRes)
                            val sub = cfg?.subtitle?.takeIf { it.isNotBlank() }
                                ?: stringResource(tile.subRes)
                            val iconKey = (cfg?.icon ?: tile.icon).takeIf { ICONS.containsKey(it) }
                                ?: tile.icon
                            Column(
                                Modifier
                                    .weight(1f)
                                    .heightIn(min = 130.dp)
                                    .border(1.dp, C.line, RoundedCornerShape(16.dp))
                                    .background(cfgColor(cfg?.background) ?: C.panel, RoundedCornerShape(16.dp))
                                    .clickable { onNavigate(tile.route) }
                                    .padding(18.dp),
                                verticalArrangement = Arrangement.Center,
                            ) {
                                TileIcon(
                                    iconKey = iconKey,
                                    theme = design.iconTheme,
                                    accent = cfgColor(cfg?.color),
                                )
                                if (cfg?.titleEnabled != false) {
                                    Text(
                                        title,
                                        color = C.txt,
                                        fontSize = 17.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        modifier = Modifier.padding(top = 8.dp),
                                    )
                                }
                                if (cfg?.subtitleEnabled != false) {
                                    Text(
                                        sub,
                                        color = C.muted,
                                        fontSize = 12.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(top = 2.dp),
                                    )
                                }
                            }
                        }
                        if (rowTiles.size == 1) Spacer(Modifier.weight(1f))
                    }
                }

                GhostButton(
                    stringResource(R.string.sign_out),
                    modifier = Modifier.padding(top = 10.dp),
                ) { vm.logout() }
            }
        }
        ToastOverlay(toast)
    }
}
