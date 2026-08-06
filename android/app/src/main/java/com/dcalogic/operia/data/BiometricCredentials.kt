package com.dcalogic.operia.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * Det gemte refresh-token, der gør fingeraftryk-login muligt FRA login-skærmen.
 *
 * Uden dette ville biometrien kun være en lås oven på en session, der allerede
 * var logget ind — altså ingen hjælp efter et log ud. Med tokenet kan
 * BiometricPrompt erstatte adgangskoden: prompten godkendes, tokenet hentes
 * frem, og sessionen genskabes via `auth.refreshSession(...)`.
 *
 * Lagring: EncryptedSharedPreferences (AES256-GCM, nøglen i Android Keystore),
 * IKKE almindelige prefs som resten af LocalStore. Tokenet er en
 * legitimation — det er den ene ting i appen, der er værd at stjæle.
 * Restrisiko: en oplåst, rootet enhed kan stadig bede Keystore om at
 * dekryptere. Det fjernes kun af en nøgle med `setUserAuthenticationRequired`,
 * som til gengæld kræver BIOMETRIC_STRONG og dermed udelukker svag
 * ansigtsgenkendelse; valgt fra bevidst, jf. docs/compliance-map.md.
 *
 * Der gemmes ét sæt ad gangen: en delt terminal husker den seneste bruger, der
 * slog funktionen til. Slår en anden bruger den til, overskrives det.
 */
object BiometricCredentials {

    private const val PREFS = "operia_secure"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_EMAIL = "email"
    private const val KEY_REFRESH = "refresh_token"

    data class Stored(val userId: String, val email: String, val refreshToken: String)

    /** Kryptolaget kan fejle (nøglen tabt ved gendannelse af enheden, ødelagt
     *  fil). Da er svaret "ingen gemt legitimation" frem for et nedbrud —
     *  brugeren logger bare ind med adgangskode. */
    // security-crypto 1.0.0 (stabil): MasterKeys + parameterrækkefølgen
    // (filnavn, nøglealias, context, …). MasterKey.Builder findes først i
    // 1.1.0-alpha, og en alpha-afhængighed er valgt fra til produktion.
    private fun prefs(ctx: Context): SharedPreferences? = runCatching {
        val keyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            PREFS,
            keyAlias,
            ctx,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrNull()

    fun save(ctx: Context, userId: String, email: String, refreshToken: String) {
        if (refreshToken.isBlank()) return
        prefs(ctx)?.edit()
            ?.putString(KEY_USER_ID, userId)
            ?.putString(KEY_EMAIL, email)
            ?.putString(KEY_REFRESH, refreshToken)
            ?.apply()
    }

    fun stored(ctx: Context): Stored? {
        val p = prefs(ctx) ?: return null
        val userId = p.getString(KEY_USER_ID, null) ?: return null
        val token = p.getString(KEY_REFRESH, null) ?: return null
        return Stored(userId, p.getString(KEY_EMAIL, null).orEmpty(), token)
    }

    fun clear(ctx: Context) {
        prefs(ctx)?.edit()?.clear()?.apply()
    }
}
