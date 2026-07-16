package com.dcalogic.operia.data

import android.content.Context
import android.content.SharedPreferences
import io.github.jan.supabase.exceptions.RestException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Lokal lagring: offline-kø for modtagelser + cachet branding.
 * Modtagelser gemmes lokalt når nettet er væk og synkroniseres senere —
 * en håndterminal skal kunne scanne videre i en kælder uden dækning.
 */
object LocalStore {

    private const val PREFS = "operia_local"
    private const val KEY_PENDING = "pending_receives"
    private const val KEY_BRAND = "brand"

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

    // ---------- branding-cache ----------

    fun brand(ctx: Context): Brand {
        val raw = prefs(ctx).getString(KEY_BRAND, null) ?: return Brand()
        return runCatching { json.decodeFromString(Brand.serializer(), raw) }.getOrDefault(Brand())
    }

    fun cacheBrand(ctx: Context, brand: Brand) {
        prefs(ctx).edit().putString(KEY_BRAND, json.encodeToString(Brand.serializer(), brand)).apply()
    }
}
