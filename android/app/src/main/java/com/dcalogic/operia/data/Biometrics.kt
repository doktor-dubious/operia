package com.dcalogic.operia.data

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Biometrisk oplåsning af den gemte session.
 *
 * Enheden afgør selv HVILKEN verifikation der bruges — fingeraftryk,
 * ansigtsgenkendelse eller enheds-PIN/mønster. Appen kan hverken vælge eller
 * aflæse metoden, og der forlader ingen biometriske data enheden: Android
 * svarer kun "det var den rigtige bruger".
 *
 * Sessionen ligger allerede gemt af supabase-kt (auto-genoptages ved
 * appstart). Biometrien er derfor en LÅS foran den gemte session, ikke et
 * nyt login mod GoTrue — derfor virker den også uden netværk.
 */
/**
 * Find aktiviteten bag en Compose-Context.
 *
 * Et simpelt `ctx as? FragmentActivity` er IKKE nok: indhold i en dialog eller
 * en ModalBottomSheet komponeres i sit eget vindue, hvor LocalContext er en
 * ContextWrapper omkring aktiviteten. Castet gav derfor null, og biometri-UI
 * forsvandt tavst — netop dér hvor kontakten skulle sidde.
 */
tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}

object Biometrics {

    /**
     * KUN biometri — enhedens PIN/mønster er bevidst IKKE en gyldig svarmulighed
     * (valgt 2026-08-04).
     *
     * Med DEVICE_CREDENTIAL i sættet viser systemet en "Brug PIN"-knap, og så
     * kunne enhver, der kender terminalens skærmlåskode, logge ind som den
     * bruger, enheden husker. På delte håndterminaler er netop den kode typisk
     * fælles viden, og hele pointen med fingeraftryk-login ville falde bort.
     *
     * Konsekvens: en håndterminal uden fingeraftryks-/ansigtssensor tilbyder
     * slet ikke funktionen (available() er falsk), og brugeren logger ind med
     * sin Operia-adgangskode som hidtil. Det samme gælder, hvis fingeren ikke
     * kan læses — adgangskoden er altid vejen udenom.
     *
     * BIOMETRIC_WEAK frem for STRONG: ansigtsgenkendelse er på mange enheder
     * klassificeret som "weak", og kravet her er bekvem indlogning, ikke
     * beskyttelse af krypto-nøgler.
     */
    private val authenticators: Int
        get() = BiometricManager.Authenticators.BIOMETRIC_WEAK

    /** Kan enheden overhovedet bruge biometrisk oplåsning netop nu?
     *  Falsk hvis hardwaren mangler, eller brugeren ikke har tilmeldt noget. */
    fun available(ctx: Context): Boolean =
        BiometricManager.from(ctx).canAuthenticate(authenticators) ==
            BiometricManager.BIOMETRIC_SUCCESS

    sealed interface Result {
        data object Success : Result
        /** Brugeren afbrød selv (tilbage-knap/annullér) — vis ingen fejl. */
        data object Cancelled : Result
        /** `permanent` = enheden kan ikke længere svare på prompten (sensor
         *  væk, ingen tilmeldte fingeraftryk, skærmlås fjernet, varig
         *  udelukkelse). Kalderen SKAL da slippe låsen — sessionen er gyldig,
         *  og ellers er appen låst ude for altid. */
        data class Failed(val message: String?, val permanent: Boolean) : Result
    }

    /** Fejl hvor et nyt forsøg aldrig kan lykkes, før brugeren selv ændrer
     *  enhedens indstillinger — kun DE må slå funktionen fra.
     *
     *  ERROR_HW_UNAVAILABLE hører bevidst IKKE med: den betyder "sensoren er
     *  optaget lige nu, prøv igen" (ses fx lige efter appstart). Regnede vi den
     *  for permanent, ville et øjebliks travlhed i sensoren slå brugerens
     *  fingeraftryk-login fra uden at nogen bad om det. */
    private fun isPermanent(code: Int): Boolean = code in setOf(
        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
    )

    /**
     * Viser systemets prompt og venter på svaret. Kaldes fra en composable via
     * aktiviteten; suspenderer indtil brugeren har taget stilling.
     */
    suspend fun prompt(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        cancelLabel: String,
    ): Result = suspendCancellableCoroutine { cont ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (cont.isActive) cont.resume(Result.Success)
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) {
                if (!cont.isActive) return
                // Afbrydelser er brugerens eget valg og må ikke se ud som en fejl.
                val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED ||
                    code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    code == BiometricPrompt.ERROR_CANCELED
                cont.resume(
                    if (cancelled) Result.Cancelled
                    else Result.Failed(message.toString(), isPermanent(code)),
                )
            }

            // onAuthenticationFailed = ét mislykket forsøg (forkert finger).
            // Prompten bliver stående og lader brugeren prøve igen, så der
            // svares først når systemet melder endeligt resultat.
        }

        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            callback,
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(authenticators)
            // Uden enhedskode i sættet leverer systemet ingen egen udgang —
            // en negativ knap er da påkrævet af API'et (og er brugerens vej
            // tilbage til adgangskode-formularen).
            .setNegativeButtonText(cancelLabel)
            .build()
        prompt.authenticate(info)

        cont.invokeOnCancellation { prompt.cancelAuthentication() }
    }
}
