package com.dcalogic.operia.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.fragment.app.FragmentActivity
import com.dcalogic.operia.AppViewModel
import com.dcalogic.operia.R
import com.dcalogic.operia.data.Biometrics
import com.dcalogic.operia.data.findFragmentActivity
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.FieldLabel
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.brandColor
import com.dcalogic.operia.ui.operiaFieldColors
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(vm: AppViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val fillBoth = stringResource(R.string.login_fill_both)
    val wrongCreds = stringResource(R.string.login_wrong)
    val network = stringResource(R.string.login_network)
    val failedPrefix = stringResource(R.string.login_failed)
    val biometricExpired = stringResource(R.string.biometric_login_expired)
    val biometricNotAllowed = stringResource(R.string.biometric_login_not_allowed)

    val ctx = LocalContext.current
    val activity = ctx.findFragmentActivity()
    val promptTitle = stringResource(R.string.biometric_login_title)
    val promptSubtitle = stringResource(R.string.biometric_prompt_subtitle)
    val cancelText = stringResource(R.string.cancel)

    // Fingeraftryk-login tilbydes kun når enheden HUSKER en bruger (gemt
    // legitimation) og sensoren kan svare. Ellers er der intet at logge ind som.
    var canBiometrics by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { canBiometrics = Biometrics.available(ctx) }
    val cred = vm.biometricCredential
    val biometricOffered = cred != null && canBiometrics && activity != null

    fun mapError(err: com.dcalogic.operia.LoginError?): String? = when (err) {
        null -> null
        is com.dcalogic.operia.LoginError.WrongCredentials -> wrongCreds
        is com.dcalogic.operia.LoginError.Network -> network
        is com.dcalogic.operia.LoginError.BiometricExpired -> biometricExpired
        is com.dcalogic.operia.LoginError.BiometricNotAllowed -> biometricNotAllowed
        is com.dcalogic.operia.LoginError.Other -> failedPrefix.format(err.message)
    }

    // Sat når et forsøg er endt uden login — så (og kun så) vises knappen som
    // vej tilbage. I det normale forløb rører man bare sensoren, og skærmen
    // forbliver fri for ekstra knapper.
    var biometricRetry by remember { mutableStateOf(false) }

    fun biometricSubmit() {
        if (activity == null || busy) return
        busy = true
        error = null
        scope.launch {
            val ok = Biometrics.prompt(activity, promptTitle, promptSubtitle, cancelText)
            if (ok is Biometrics.Result.Success) {
                error = mapError(vm.loginWithBiometrics())
            } else if (ok is Biometrics.Result.Failed && ok.permanent) {
                // Sensoren kan ikke længere svare — lad ikke en knap stå og
                // love noget, den ikke kan holde.
                vm.forgetBiometricLogin()
            }
            busy = false
            // Lykkedes det, skifter skærmen alligevel væk herfra.
            biometricRetry = true
        }
    }

    // Husker enheden en bruger, vises prompten AF SIG SELV, når login-skærmen
    // åbner: så er "log ind" bare at røre sensoren, uden først at trykke på en
    // knap. (Android tillader ikke at lytte på sensoren uden en systemdialog —
    // den kan kun vises automatisk, ikke skjules.)
    //
    // Kun ét automatisk forsøg pr. skærm: afbryder brugeren — typisk fordi en
    // ANDEN skal logge ind på en delt terminal — må dialogen ikke poppe op igen
    // og spærre for adgangskodefelterne. Knappen nedenfor står tilbage til et
    // nyt forsøg.
    var autoPrompted by remember { mutableStateOf(false) }
    LaunchedEffect(biometricOffered) {
        if (biometricOffered && !autoPrompted) {
            autoPrompted = true
            biometricSubmit()
        }
    }

    fun submit() {
        if (email.isBlank() || password.isEmpty()) {
            error = fillBoth
            return
        }
        busy = true
        error = null
        scope.launch {
            val err = vm.login(email, password)
            busy = false
            error = mapError(err)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(C.bg)
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(vm.brand.name, color = C.txt, fontSize = 36.sp, fontWeight = FontWeight.Black, letterSpacing = 0.5.sp)
            Text(stringResource(R.string.terminal), color = C.muted, modifier = Modifier.padding(top = 6.dp))
        }
        FieldLabel(stringResource(R.string.email))
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            placeholder = { Text(stringResource(R.string.email_placeholder)) },
            singleLine = true,
            colors = operiaFieldColors(),
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        FieldLabel(stringResource(R.string.password), topPadding = 16)
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            placeholder = { Text("••••••••") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            colors = operiaFieldColors(),
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        BigButton(
            stringResource(R.string.sign_in),
            color = brandColor(vm.brand.color),
            busy = busy,
            modifier = Modifier.padding(top = 22.dp),
        ) { submit() }
        // Fingeraftryk som ALTERNATIV til adgangskoden — ikke et ekstra trin.
        // Vises kun når enheden husker en bruger; teksten nævner hvem, så det
        // er tydeligt hvilken konto knappen logger ind som på en delt terminal.
        if (biometricOffered && biometricRetry) {
            Text(
                stringResource(R.string.or_divider),
                color = C.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
            )
            GhostButton(
                text = cred.email.ifBlank { stringResource(R.string.biometric_login_generic) }
                    .let { stringResource(R.string.biometric_login_as, it) },
                textColor = C.txt,
                modifier = Modifier.padding(top = 12.dp),
            ) { biometricSubmit() }
            Text(
                stringResource(R.string.biometric_forget),
                color = C.muted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .clickable { vm.forgetBiometricLogin() },
            )
        }
        error?.let {
            Text(
                it,
                color = C.red,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            )
        }
    }
}
