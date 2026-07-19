package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.rememberToast

/**
 * Pakke-gruppens underside: én mappe-flise på startskærmen fører hertil, hvor
 * pakke-fliserne (Modtag, Udlever, Flyt, Søg) vises — men kun dem brugeren har
 * adgang til (samme entitlement- + rolle-porte som startskærmen). Fliserne
 * tegnes med TileCard, så de ser ud som på startskærmen. Konfigureres i
 * Operia → Handheld-design ved at tilføje "Pakker"-flisen.
 */
@Composable
fun ParcelGroupScreen(vm: AppViewModel, onBack: () -> Unit, onNavigate: (String) -> Unit) {
    val toast = rememberToast()
    val children = resolveGroupChildren(
        "parcel_group",
        vm.handheld.tiles,
        { vm.has(it) },
        { vm.hasRole(it) },
    )

    // Brug den evt. tilpassede flise-titel som sidetitel, ellers standarden.
    val title = vm.handheld.tiles.firstOrNull { it.key == "parcel_group" }
        ?.title?.takeIf { it.isNotBlank() }
        ?: stringResource(R.string.tile_parcel_group)

    Screen(title = title, onBack = onBack, toast = toast) {
        if (children.isEmpty()) {
            EmptyBox("📥", stringResource(R.string.parcel_group_empty))
        } else {
            children.chunked(2).forEach { rowTiles ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    rowTiles.forEach { (tile, cfg) ->
                        TileCard(tile, cfg, vm.handheld.design.iconTheme, Modifier.weight(1f)) {
                            onNavigate(tile.route)
                        }
                    }
                    if (rowTiles.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}
