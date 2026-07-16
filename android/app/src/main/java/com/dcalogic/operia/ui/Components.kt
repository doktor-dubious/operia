package com.dcalogic.operia.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dcalogic.operia.R
import kotlinx.coroutines.delay

/* ---------- skærm-skelet: topbar + indhold + toast-overlay ---------- */

@Composable
fun Screen(
    title: String,
    onBack: (() -> Unit)? = null,
    toast: ToastState,
    scrollable: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize().background(C.bg)) {
        Column(Modifier.fillMaxSize()) {
            TopBar(title, onBack)
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .let { if (scrollable) it.verticalScroll(rememberScrollState()) else it }
                    .padding(16.dp),
                content = content,
            )
        }
        ToastOverlay(toast)
    }
}

@Composable
fun TopBar(title: String, onBack: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(C.panel)) {
        Spacer(Modifier.statusBarsPadding())
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                Text(
                    "‹",
                    color = C.txt,
                    fontSize = 30.sp,
                    modifier = Modifier
                        .size(44.dp)
                        .clickable(onClick = onBack)
                        .padding(horizontal = 14.dp),
                )
            }
            Text(title, color = C.txt, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(C.line))
    }
}

/* ---------- toast ---------- */

class ToastState {
    var message by mutableStateOf<String?>(null)
    var kind by mutableStateOf("info")
    var stamp by mutableStateOf(0L)

    fun show(kind: String, message: String) {
        this.kind = kind
        this.message = message
        this.stamp = System.currentTimeMillis()
    }
}

@Composable
fun rememberToast(): ToastState = remember { ToastState() }

@Composable
fun ToastOverlay(toast: ToastState) {
    val msg = toast.message ?: return
    LaunchedEffect(toast.stamp) {
        delay(2400)
        toast.message = null
    }
    val bg = when (toast.kind) {
        "ok" -> C.green
        "err" -> C.red
        else -> C.panel2
    }
    val fg = when (toast.kind) {
        "ok" -> C.greenInk
        "err" -> Color(0xFF2A0606)
        else -> C.txt
    }
    Box(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 16.dp)
            .padding(top = 78.dp)
            .background(bg, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) {
        Text(
            msg,
            color = fg,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/* ---------- byggesten ---------- */

@Composable
fun FieldLabel(text: String, topPadding: Int = 0) {
    Text(
        text.uppercase(),
        color = C.muted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.5.sp,
        modifier = Modifier.padding(top = topPadding.dp, bottom = 6.dp),
    )
}

@Composable
fun operiaFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = C.panel,
    unfocusedContainerColor = C.panel,
    focusedBorderColor = C.blue,
    unfocusedBorderColor = C.line,
    focusedTextColor = C.txt,
    unfocusedTextColor = C.txt,
    cursorColor = C.blue,
    focusedPlaceholderColor = C.placeholder,
    unfocusedPlaceholderColor = C.placeholder,
)

@Composable
fun BigButton(
    text: String,
    color: Color,
    contentColor: Color = Color.White,
    enabled: Boolean = true,
    busy: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        colors = ButtonDefaults.buttonColors(
            containerColor = color,
            contentColor = contentColor,
            disabledContainerColor = color.copy(alpha = 0.55f),
            disabledContentColor = contentColor.copy(alpha = 0.7f),
        ),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = 58.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(22.dp), color = contentColor, strokeWidth = 2.dp)
        } else {
            Text(text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
fun GhostButton(
    text: String,
    textColor: Color = C.txt,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 58.dp)
            .border(1.5.dp, C.line, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = textColor, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
fun EmptyBox(emoji: String, text: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(emoji, fontSize = 38.sp)
        Text(
            text,
            color = C.muted,
            modifier = Modifier.padding(top = 8.dp),
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 14.dp)
            .border(1.dp, C.line, RoundedCornerShape(16.dp))
            .background(C.panel, RoundedCornerShape(16.dp))
            .padding(16.dp),
        content = content,
    )
}

/* ---------- scan-felt ----------
 * Håndterminal-scannere opfører sig som tastaturer: koden kommer som
 * hurtige tastetryk, ofte afsluttet med Enter. Feltet sender automatisk:
 *  - ved Enter/linjeskift i input
 *  - i scan-tilstand: når input holder pause i 250 ms
 * ⌨-knappen slår soft-keyboard til for manuel indtastning.
 */
@Composable
fun ScanBox(
    label: String,
    onScan: (String) -> Unit,
    focusStamp: Long = 0L,
) {
    var value by remember { mutableStateOf("") }
    var keyboardMode by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val kb = LocalSoftwareKeyboardController.current

    fun fire(code: String) {
        value = ""
        if (code.isNotBlank()) onScan(code.trim())
    }

    LaunchedEffect(focusStamp) {
        delay(300)
        runCatching { focusRequester.requestFocus() }
        if (!keyboardMode) kb?.hide()
    }

    // scan-tilstand: auto-send når der ikke er kommet nye tegn i 250 ms
    LaunchedEffect(value, keyboardMode) {
        if (!keyboardMode && value.isNotBlank()) {
            delay(250)
            fire(value)
        }
    }

    Column {
        FieldLabel(label)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = value,
                onValueChange = { text ->
                    if (text.contains('\n') || text.contains('\r')) {
                        fire(text.replace("\r", "").replace("\n", ""))
                    } else {
                        value = text
                    }
                },
                placeholder = { Text(stringResource(R.string.scan_placeholder)) },
                singleLine = true,
                colors = operiaFieldColors(),
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { fire(value) }),
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester),
            )
            Box(
                Modifier
                    .size(width = 64.dp, height = 56.dp)
                    .border(1.5.dp, if (keyboardMode) C.blue else C.line, RoundedCornerShape(14.dp))
                    .clickable {
                        keyboardMode = !keyboardMode
                        focusRequester.requestFocus()
                        if (keyboardMode) kb?.show() else kb?.hide()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text("⌨", fontSize = 22.sp, color = C.txt)
            }
        }
        Text(
            stringResource(R.string.scan_hint),
            color = C.muted,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

/* ---------- opslags-vælger (afdeling / medarbejder) ----------
 * Ren udvælgelse — stamdata oprettes i admin-webappen (master data-politik:
 * medarbejdere ejes af Flow 0-importen, afdelinger af manageren).
 */
@Composable
fun LookupPicker(
    title: String,
    items: List<Pair<String, String>>, // id → visningsnavn
    selectedId: String?,
    onSelect: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val selected = items.firstOrNull { it.first == selectedId }

    Column(Modifier.padding(bottom = 12.dp)) {
        FieldLabel(title)
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .border(1.5.dp, if (open) C.blue else C.line, RoundedCornerShape(14.dp))
                .background(C.panel, RoundedCornerShape(14.dp))
                .clickable { open = !open }
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                selected?.second ?: "",
                color = if (selected != null) C.txt else C.muted,
                fontSize = 18.sp,
            )
        }
        if (open) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .border(1.dp, C.line, RoundedCornerShape(14.dp))
                    .background(C.panel2, RoundedCornerShape(14.dp))
                    .padding(10.dp),
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text(stringResource(R.string.search_placeholder)) },
                    singleLine = true,
                    colors = operiaFieldColors(),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                )
                Text(
                    stringResource(R.string.n_in_company, items.size),
                    color = C.muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
                val q = query.trim().lowercase()
                items
                    .filter { q.isEmpty() || it.second.lowercase().contains(q) }
                    .take(50)
                    .forEach { (id, name) ->
                        val isSel = id == selectedId
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(bottom = 6.dp)
                                .border(1.dp, if (isSel) C.green else C.line, RoundedCornerShape(12.dp))
                                .background(if (isSel) C.panel2 else C.panel, RoundedCornerShape(12.dp))
                                .clickable {
                                    onSelect(id)
                                    open = false
                                    query = ""
                                }
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(name, color = C.txt, fontSize = 16.sp, modifier = Modifier.weight(1f))
                            if (isSel) Text("✓", color = C.green, fontSize = 18.sp)
                        }
                    }
                if (selectedId != null) {
                    Text(
                        stringResource(R.string.clear_selection),
                        color = C.muted,
                        modifier = Modifier
                            .padding(vertical = 8.dp)
                            .clickable {
                                onSelect(null)
                                open = false
                            },
                    )
                }
            }
        }
    }
}
