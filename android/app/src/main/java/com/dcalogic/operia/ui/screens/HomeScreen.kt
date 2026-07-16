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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.ToastOverlay
import com.dcalogic.operia.ui.ToastState
import com.dcalogic.operia.ui.rememberToast
import kotlinx.coroutines.launch
import java.util.Calendar

private data class Tile(val emoji: String, val titleRes: Int, val subRes: Int, val route: String, val feature: String)

@Composable
fun HomeScreen(vm: AppViewModel, onNavigate: (String) -> Unit) {
    val toast: ToastState = rememberToast()
    val scope = rememberCoroutineScope()
    val syncedMsg = stringResource(R.string.sync_done)

    val tiles = listOf(
        Tile("📦", R.string.tile_receive, R.string.tile_receive_sub, "receive", "hh_receive"),
        Tile("📤", R.string.tile_handout, R.string.tile_handout_sub, "handout", "hh_handout"),
        Tile("🔎", R.string.tile_search, R.string.tile_search_sub, "search", "hh_search"),
        Tile("🗺️", R.string.tile_route, R.string.tile_route_sub, "route", "hh_route"),
        Tile("🗄️", R.string.tile_stock, R.string.tile_stock_sub, "stock", "hh_stock"),
    ).filter { vm.has(it.feature) }

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
                Text(
                    vm.brand.name,
                    color = C.txt,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                )
                Box(Modifier.fillMaxWidth().height(1.dp).background(C.line))
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                Text("$greeting,", color = C.muted, fontSize = 15.sp)
                Text(
                    vm.userName.split(" ").firstOrNull() ?: "",
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
                        rowTiles.forEach { tile ->
                            Column(
                                Modifier
                                    .weight(1f)
                                    .heightIn(min = 130.dp)
                                    .border(1.dp, C.line, RoundedCornerShape(16.dp))
                                    .background(C.panel, RoundedCornerShape(16.dp))
                                    .clickable { onNavigate(tile.route) }
                                    .padding(18.dp),
                                verticalArrangement = Arrangement.Center,
                            ) {
                                Text(tile.emoji, fontSize = 38.sp)
                                Text(
                                    stringResource(tile.titleRes),
                                    color = C.txt,
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                                Text(
                                    stringResource(tile.subRes),
                                    color = C.muted,
                                    fontSize = 12.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
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
