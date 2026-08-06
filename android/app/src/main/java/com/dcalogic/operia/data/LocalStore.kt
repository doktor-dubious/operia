package com.dcalogic.operia.data

import android.content.Context
import android.content.SharedPreferences
import io.github.jan.supabase.exceptions.RestException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Lokal lagring: offline-kø for modtagelser + cachet handheld-design.
 * Modtagelser gemmes lokalt når nettet er væk og synkroniseres senere —
 * en håndterminal skal kunne scanne videre i en kælder uden dækning.
 */
object LocalStore {

    private const val PREFS = "operia_local"
    private const val KEY_PENDING = "pending_receives"
    private const val KEY_HANDHELD = "handheld_design"
    private const val KEY_BIOMETRIC = "biometric_login"

    private val json = Json { ignoreUnknownKeys = true }

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- offline-kø ----------

    fun pending(ctx: Context): List<ParcelInsert> {
        val raw = prefs(ctx).getString(KEY_PENDING, null) ?: return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(ParcelInsert.serializer()), raw)
        }.getOrDefault(emptyList())
    }

    fun queue(ctx: Context, rows: List<ParcelInsert>) {
        val all = pending(ctx) + rows
        prefs(ctx).edit()
            .putString(KEY_PENDING, json.encodeToString(ListSerializer(ParcelInsert.serializer()), all))
            .apply()
    }

    /**
     * Prøver at indsende køen. Netværksfejl → rækken bliver i køen.
     * Databasefejl (RLS, constraint) → rækken droppes og rapporteres,
     * ellers ville en permanent afvist række blokere køen for evigt.
     * En dublet på client_key betyder at serveren allerede har rækken
     * (svaret gik tabt ved første forsøg) — det tæller som synkroniseret.
     */
    suspend fun sync(ctx: Context): SyncResult {
        val pend = pending(ctx)
        if (pend.isEmpty()) return SyncResult(0, 0, 0)
        var synced = 0
        var dropped = 0
        val left = mutableListOf<ParcelInsert>()
        for (row in pend) {
            try {
                Repository.insertParcels(listOf(row))
                synced++
            } catch (e: RestException) {
                val alreadySaved = (e.message ?: "").contains("parcels_client_key_key")
                if (alreadySaved) synced++ else dropped++
            } catch (e: Exception) {
                left.add(row)
            }
        }
        prefs(ctx).edit()
            .putString(KEY_PENDING, json.encodeToString(ListSerializer(ParcelInsert.serializer()), left))
            .apply()
        return SyncResult(synced, left.size, dropped)
    }

    data class SyncResult(val synced: Int, val left: Int, val dropped: Int)

    /** Cachet handheld-design, så startskærmen ser rigtig ud offline / før
     *  bootstrap er færdig (samme mønster som branding). */
    fun handheld(ctx: Context): HandheldConfig {
        val raw = prefs(ctx).getString(KEY_HANDHELD, null) ?: return HandheldConfig()
        return runCatching {
            json.decodeFromString(HandheldConfig.serializer(), raw)
        }.getOrDefault(HandheldConfig())
    }

    fun cacheHandheld(ctx: Context, cfg: HandheldConfig) {
        prefs(ctx).edit()
            .putString(KEY_HANDHELD, json.encodeToString(HandheldConfig.serializer(), cfg))
            .apply()
    }

    // ---------- biometrisk login ----------

    /**
     * Har brugeren slået biometrisk oplåsning til PÅ DENNE ENHED?
     *
     * Gemmes pr. bruger (nøgle + user-id) og enhedslokalt. Begge dele er
     * bevidste: valget hører til kombinationen af konto OG enhed — dens sensor
     * og dens gemte session — så samme bruger tager stilling igen på en anden
     * terminal.
     *
     * Pr. bruger, fordi håndterminaler deles: var flaget fælles, ville næste
     * bruger arve den forriges lås (og skulle bruge enhedens fingeraftryk for
     * at komme til sin egen session). Omvendt må et log ud/ind IKKE nulstille
     * ens eget valg — derfor ikke bare "ryd ved logout".
     */
    fun biometricEnabled(ctx: Context, userId: String): Boolean =
        prefs(ctx).getBoolean(userKey(userId), false)

    fun setBiometricEnabled(ctx: Context, userId: String, on: Boolean) {
        prefs(ctx).edit().putBoolean(userKey(userId), on).apply()
    }

    private fun userKey(userId: String) = "${KEY_BIOMETRIC}_$userId"

    // ---------- gen-login efter inaktivitet ----------

    /** Vinduet caches lokalt, fordi det skal kunne håndhæves ved appstart —
     *  altså FØR bootstrap har været på nettet, og også helt uden dækning. */
    fun reauthMinutes(ctx: Context): Int = prefs(ctx).getInt("reauth_minutes", 0)

    fun cacheReauthMinutes(ctx: Context, minutes: Int) {
        prefs(ctx).edit().putInt("reauth_minutes", minutes).apply()
    }

    /** Hvornår var appen sidst i brug? Bruges kun til at måle inaktivitet.
     *  elapsedRealtime ville nulstilles ved genstart af enheden, så der gemmes
     *  vægur-tid; en bruger, der stiller uret tilbage, får blot et ekstra
     *  gen-login (fail-safe frem for fail-open). */
    fun lastActiveAt(ctx: Context): Long = prefs(ctx).getLong("last_active_at", 0L)

    fun touchLastActive(ctx: Context, now: Long) {
        prefs(ctx).edit().putLong("last_active_at", now).apply()
    }

    /** Er brugeren blevet spurgt, om de vil slå fingeraftryk-login til på denne
     *  enhed? Der spørges kun ÉN gang pr. bruger pr. enhed — et nej skal ikke
     *  møde dem igen ved hvert login; de kan altid selv slå det til på
     *  startskærmen. */
    fun biometricOfferSeen(ctx: Context, userId: String): Boolean =
        prefs(ctx).getBoolean("${KEY_BIOMETRIC}_asked_$userId", false)

    fun setBiometricOfferSeen(ctx: Context, userId: String) {
        prefs(ctx).edit().putBoolean("${KEY_BIOMETRIC}_asked_$userId", true).apply()
    }
}
