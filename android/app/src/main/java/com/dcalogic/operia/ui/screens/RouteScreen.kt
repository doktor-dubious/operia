package com.dcalogic.operia.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Repository
import com.dcalogic.operia.data.RouteRow
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.EmptyBox
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.Screen
import com.dcalogic.operia.ui.brandColor
import com.dcalogic.operia.ui.rememberToast
import java.net.URLEncoder

/**
 * Ruteplan: viser ruter oprettet i admin (products/routes) og åbner
 * Google Maps-navigation — hele ruten eller ét stop ad gangen.
 */
@Composable
fun RouteScreen(vm: AppViewModel, onBack: () -> Unit) {
    val toast = rememberToast()
    val ctx = LocalContext.current
    var routes by remember { mutableStateOf<List<RouteRow>>(emptyList()) }
    var selected by remember { mutableStateOf<RouteRow?>(null) }
    var loading by remember { mutableStateOf(true) }

    val msgNoStart = stringResource(R.string.route_no_start)
    val msgNoStops = stringResource(R.string.route_no_stops)
    val msgMapsFailed = stringResource(R.string.route_maps_failed)

    LaunchedEffect(Unit) {
        runCatching { routes = Repository.routes(vm.companyId ?: return@LaunchedEffect) }
        loading = false
    }

    fun open(url: String) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            toast.show("err", msgMapsFailed)
        }
    }

    fun travelMode(t: String) = when (t) {
        "walk" -> "walking"
        "bike" -> "bicycling"
        else -> "driving"
    }

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    fun navFullRoute(r: RouteRow) {
        val start = r.from_address
        if (start.isNullOrBlank()) {
            toast.show("err", msgNoStart)
            return
        }
        val stops = r.stops.mapNotNull { it.address }.filter { it.isNotBlank() }
        val parts = buildList {
            add(start)
            addAll(stops)
            if (!r.to_address.isNullOrBlank()) add(r.to_address!!)
            if (r.round_trip) add(start)
        }
        // Gyldig rute = mindst to punkter: stop, slutadresse eller retur til depot.
        if (parts.size < 2) {
            toast.show("err", msgNoStops)
            return
        }
        open(
            "https://www.google.com/maps/dir/" + parts.joinToString("/") { enc(it) } +
                "?travelmode=" + travelMode(r.transport_type),
        )
    }

    val title = selected?.name ?: stringResource(R.string.route_title)
    Screen(
        title = title,
        onBack = { if (selected != null) selected = null else onBack() },
        toast = toast,
    ) {
        val accent = brandColor(vm.brand.color)
        when {
            loading -> Box(Modifier.fillMaxWidth().padding(top = 30.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = accent)
            }
            selected == null -> {
                FieldLabel(stringResource(R.string.route_pick))
                if (routes.isEmpty()) {
                    EmptyBox("🗺️", stringResource(R.string.route_empty))
                }
                routes.forEach { r ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .border(1.dp, C.line, RoundedCornerShape(12.dp))
                            .background(C.panel, RoundedCornerShape(12.dp))
                            .clickable { selected = r }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(r.name, color = C.txt, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Text(
                                stringResource(R.string.route_meta, r.stops.size, transportLabel(r.transport_type)) +
                                    if (r.round_trip) stringResource(R.string.route_round_trip_suffix) else "",
                                color = C.muted,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        Text("›", color = C.muted, fontSize = 22.sp)
                    }
                }
            }
            else -> {
                val r = selected!!
                BigButton(
                    stringResource(R.string.route_navigate_all),
                    color = accent,
                    modifier = Modifier.padding(bottom = 16.dp),
                ) { navFullRoute(r) }

                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 10.dp)
                        .border(1.dp, C.line, RoundedCornerShape(12.dp))
                        .background(C.panel, RoundedCornerShape(12.dp))
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🏁", fontSize = 20.sp, modifier = Modifier.padding(end = 10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.route_depot), color = C.muted, fontSize = 11.sp)
                        Text(r.from_address ?: "—", color = C.txt, fontSize = 15.sp)
                    }
                }

                if (!r.to_address.isNullOrBlank()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp)
                            .border(1.dp, C.line, RoundedCornerShape(12.dp))
                            .background(C.panel, RoundedCornerShape(12.dp))
                            .clickable {
                                open("https://www.google.com/maps/dir/?api=1&destination=" + enc(r.to_address!!))
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("🎯", fontSize = 20.sp, modifier = Modifier.padding(end = 10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.route_destination), color = C.muted, fontSize = 11.sp)
                            Text(r.to_address ?: "—", color = C.txt, fontSize = 15.sp)
                        }
                        Text("🧭", fontSize = 16.sp)
                    }
                }

                FieldLabel(stringResource(R.string.route_stops_header, r.stops.size), topPadding = 6)
                r.stops.forEachIndexed { i, stop ->
                    val addr = stop.address ?: return@forEachIndexed
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 6.dp)
                            .border(1.dp, C.line, RoundedCornerShape(12.dp))
                            .background(C.panel, RoundedCornerShape(12.dp))
                            .clickable {
                                open("https://www.google.com/maps/dir/?api=1&destination=" + enc(addr))
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .padding(end = 10.dp)
                                .size(26.dp)
                                .background(accent, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "${i + 1}",
                                color = androidx.compose.ui.graphics.Color.White,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 13.sp,
                            )
                        }
                        Text(addr, color = C.txt, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        Text("🧭", fontSize = 16.sp)
                    }
                }
                if (r.round_trip) {
                    Text(
                        stringResource(R.string.route_return_note),
                        color = C.muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun transportLabel(t: String): String = stringResource(
    when (t) {
        "walk" -> R.string.transport_walk
        "bike" -> R.string.transport_bike
        else -> R.string.transport_car
    },
)
