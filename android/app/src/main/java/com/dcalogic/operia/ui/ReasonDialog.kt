package com.dcalogic.operia.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.dcalogic.operia.R

/**
 * Bekræft en undtagelseshandling (afvis/returnér) med en PÅKRÆVET årsag.
 *
 * Hvorfor en dialog frem for et felt på skærmen: udlevering klarer sig uden
 * note, mens afvis/returnér kræver en begrundelse — ét felt kan ikke mærkes
 * for begge regler på én gang. Dialogen holder den valgfrie note på skærmen
 * adskilt fra den påkrævede årsag, og det ekstra trin er samtidig en spærre
 * mod fejltryk på en håndholdt enhed.
 *
 * Årsagen er ikke pynt: afvisninger/returneringer er undtagelseshændelser, der
 * havner i dashboardets undtagelsesliste og eskaleres i audit-loggen (NIS2).
 *
 * @param title      dialogens overskrift, fx "Afvis pakke"
 * @param confirmText tekst på bekræft-knappen
 * @param confirmColor bekræft-knappens farve (rød ved afvis, gul ved retur)
 * @param busy       spærrer knapperne mens handlingen kører
 * @param onConfirm  kaldes med den trimmede årsag (aldrig tom)
 */
@Composable
fun ReasonDialog(
    title: String,
    confirmText: String,
    confirmColor: Color,
    busy: Boolean = false,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var reason by remember { mutableStateOf("") }
    val trimmed = reason.trim()

    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        Column(
            Modifier
                .fillMaxWidth()
                .background(C.panel, RoundedCornerShape(18.dp))
                .padding(20.dp),
        ) {
            Text(title, color = C.txt, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)

            FieldLabel(stringResource(R.string.reason_required), topPadding = 16)
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                placeholder = { Text(stringResource(R.string.reason_placeholder)) },
                singleLine = true,
                colors = operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Row(
                Modifier.fillMaxWidth().padding(top = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                GhostButton(
                    text = stringResource(R.string.cancel),
                    modifier = Modifier.weight(1f),
                ) { if (!busy) onDismiss() }
                BigButton(
                    text = confirmText,
                    color = confirmColor,
                    enabled = trimmed.isNotEmpty(),
                    busy = busy,
                    modifier = Modifier.weight(1f),
                ) { onConfirm(trimmed) }
            }
        }
    }
}
