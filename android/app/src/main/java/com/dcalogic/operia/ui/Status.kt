package com.dcalogic.operia.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import com.dcalogic.operia.R

/** Danske statuslabels for parcel_status-enum'en. */
@Composable
fun statusLabel(status: String): String = stringResource(
    when (status) {
        "unassigned" -> R.string.status_unassigned
        "registered" -> R.string.status_registered
        "in_storage" -> R.string.status_in_storage
        "in_transit" -> R.string.status_in_transit
        "in_locker" -> R.string.status_in_locker
        "delivered" -> R.string.status_delivered
        "rejected" -> R.string.status_rejected
        "returned" -> R.string.status_returned
        else -> R.string.status_unknown
    },
)

fun statusColor(status: String): Color = when (status) {
    "delivered" -> C.green
    "rejected", "returned" -> C.red
    else -> C.amber
}
