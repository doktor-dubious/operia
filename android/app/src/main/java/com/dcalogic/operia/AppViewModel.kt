package com.dcalogic.operia

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dcalogic.operia.data.AssetLocation
import com.dcalogic.operia.data.Brand
import com.dcalogic.operia.data.Department
import com.dcalogic.operia.data.Employee
import com.dcalogic.operia.data.HandheldConfig
import com.dcalogic.operia.data.LocalStore
import com.dcalogic.operia.data.supabase
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import com.dcalogic.operia.data.Repository
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Session + bootstrap-tilstand for hele appen. Skærmene læser stamdata
 * (afdelinger, medarbejdere, features, branding) herfra; selve pakke-/
 * lageroperationerne kalder Repository direkte.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    var sessionState by mutableStateOf<SessionState>(SessionState.Checking)
        private set

    var companyId by mutableStateOf<String?>(null); private set
    var userName by mutableStateOf(""); private set
    var departments by mutableStateOf<List<Department>>(emptyList())
    var employees by mutableStateOf<List<Employee>>(emptyList())
    var assetLocations by mutableStateOf<List<AssetLocation>>(emptyList())
    var storageLocations by mutableStateOf<List<com.dcalogic.operia.data.StorageLocation>>(emptyList())
    var carriers by mutableStateOf<List<com.dcalogic.operia.data.Carrier>>(emptyList())
    var handlingClasses by mutableStateOf<List<com.dcalogic.operia.data.HandlingClass>>(emptyList())
    var brand by mutableStateOf(Brand()); private set
    /** Platformens handheld-design (Operia → Handheld-design). Tom = appens
     *  standardudseende, så skærmen virker før/uden konfiguration. */
    var handheld by mutableStateOf(HandheldConfig()); private set
    var pendingCount by mutableStateOf(0); private set
    var bootstrapError by mutableStateOf<String?>(null); private set

    private var validFeatures: Set<String> = emptySet()
    private var handheldConfigured = false
    // null = rollerne er ikke kendt endnu (fx fejlede hentningen). Da hver flise
    // nu også rolle-gates, ville et tomt sæt ved en forbigående netværksfejl
    // skjule ALLE fliser og efterlade en tom, fastlåst startskærm; ukendt
    // behandles derfor tilladende (som has()'s default-open), så featuren alene
    // stadig viser fliserne.
    private var roles: Set<String>? = null

    /** Prototype-semantik: er ingen hh_*-features sat op i admin → vis alt. */
    fun has(featureKey: String): Boolean =
        if (handheldConfigured) featureKey in validFeatures else true

    /** Rollemodel v2: manager kan alt; ellers kræves den konkrete
     *  håndterminal-rolle (fx handheld_parcel_handler). Kun UI-gating —
     *  RLS er den reelle håndhævelse. Ukendte roller (endnu ikke hentet/fejlet)
     *  behandles tilladende, så en fejl ikke tømmer startskærmen. */
    fun hasRole(role: String): Boolean {
        val r = roles ?: return true
        return "manager" in r || role in r
    }

    init {
        brand = LocalStore.brand(app)
        handheld = LocalStore.handheld(app)
        viewModelScope.launch {
            supabase.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Initializing -> sessionState = SessionState.Checking
                    is SessionStatus.Authenticated -> {
                        if (sessionState !is SessionState.Ready) {
                            sessionState = SessionState.Loading
                            bootstrap()
                        }
                    }
                    else -> sessionState = SessionState.LoggedOut
                }
            }
        }
    }

    private suspend fun bootstrap() {
        val ctx = getApplication<Application>()
        try {
            val au = Repository.currentAppUser()
            if (au == null) {
                // Platform-admins (DCA) har ikke nødvendigvis en app_users-række —
                // håndterminalen er tenant-personale-værktøj.
                bootstrapError = ctx.getString(R.string.err_no_company)
                sessionState = SessionState.Ready
                return
            }
            companyId = au.company_id
            userName = au.full_name.ifBlank { au.email ?: "" }
            val cid = au.company_id

            // Stamdata-listerne er indbyrdes uafhængige — hent dem samtidig i
            // stedet for i syv serielle rundture, så login-til-forside ikke
            // vokser lineært med hver ny liste (mærkbart på warehouse-Wi-Fi).
            coroutineScope {
                val rolesD = async { runCatching { Repository.currentRoles() }.getOrNull() }
                val deptD = async { runCatching { Repository.departments(cid) }.getOrDefault(emptyList()) }
                val empD = async { runCatching { Repository.employees(cid) }.getOrDefault(emptyList()) }
                val assetLocD = async { runCatching { Repository.assetLocations(cid) }.getOrDefault(emptyList()) }
                val storageD = async { runCatching { Repository.storageLocations(cid) }.getOrDefault(emptyList()) }
                val carrierD = async { runCatching { Repository.carriers(cid) }.getOrDefault(emptyList()) }
                val handlingD = async { runCatching { Repository.handlingClasses(cid) }.getOrDefault(emptyList()) }
                val featureD = async { runCatching { Repository.featureRows(cid) }.getOrNull() }
                val handheldD = async { runCatching { Repository.handheldConfig(cid) }.getOrNull() }
                val appearanceD = async { runCatching { Repository.appearance(cid) }.getOrNull() }

                roles = rolesD.await()
                departments = deptD.await()
                employees = empD.await()
                assetLocations = assetLocD.await()
                storageLocations = storageD.await()
                carriers = carrierD.await()
                handlingClasses = handlingD.await()

                featureD.await()?.let { rows ->
                    val now = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).toString()
                    handheldConfigured = rows.any { it.feature_key.startsWith("hh_") }
                    validFeatures = rows
                        .filter { it.valid_until == null || it.valid_until > now }
                        .map { it.feature_key }
                        .toSet()
                }

                // Handheld-designet er platform-globalt (ikke pr. virksomhed) —
                // fejler hentningen, beholder vi det cachede/standarden.
                handheldD.await()?.let { cfg ->
                    handheld = cfg
                    LocalStore.cacheHandheld(ctx, cfg)
                }

                appearanceD.await()?.let { ap ->
                    val b = Brand(
                        name = ap.header_name?.takeIf { it.isNotBlank() } ?: "Operia",
                        color = ap.header_color?.takeIf { it.isNotBlank() } ?: "#2D6FF0",
                    )
                    brand = b
                    LocalStore.cacheBrand(ctx, b)
                }
            }

            refreshPending()
            runCatching { LocalStore.sync(ctx) }
            refreshPending()
            sessionState = SessionState.Ready
        } catch (e: Exception) {
            bootstrapError = e.message
            sessionState = SessionState.Ready
        }
    }

    fun refreshPending() {
        pendingCount = LocalStore.pending(getApplication()).size
    }

    suspend fun syncPending(): LocalStore.SyncResult {
        val r = LocalStore.sync(getApplication())
        refreshPending()
        return r
    }

    suspend fun login(email: String, password: String): String? = try {
        supabase.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        null
    } catch (e: Exception) {
        e.message ?: "Login fejlede"
    }

    fun logout() {
        viewModelScope.launch { runCatching { supabase.auth.signOut() } }
    }
}

sealed interface SessionState {
    data object Checking : SessionState
    data object LoggedOut : SessionState
    data object Loading : SessionState
    data object Ready : SessionState
}
