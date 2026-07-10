package com.dcalogic.operia.data

import com.dcalogic.operia.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.storage.Storage

/**
 * Delt Supabase-klient. Auth-session persisteres automatisk på enheden.
 * RLS på serveren er den reelle adgangskontrol — klienten er untrusted.
 */
val supabase: SupabaseClient = createSupabaseClient(
    supabaseUrl = BuildConfig.SUPABASE_URL,
    supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
) {
    install(Auth)
    install(Postgrest)
    install(Storage)
    install(Functions)
}
