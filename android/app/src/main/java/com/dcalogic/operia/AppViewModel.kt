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
import com.dcalogic.operia.data.LocalStore
import com.dcalogic.operia.data.supabase
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import com.dcalogic.operia.data.Repository
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
    var brand by mutableStateOf(Brand()); private set
    var pendingCount by mutableStateOf(0); private set
    var bootstrapError by mutableStateOf<String?>(null); private set

    private var validFeatures: Set<String> = emptySet()
    private var handheldConfigured = false

    /** Prototype-semantik: er ingen hh_*-features sat op i admin → vis alt. */
    fun has(featureKey: String): Boolean =
        if (handheldConfigured) featureKey in validFeatures else true

    init {
        brand = LocalStore.brand(app)
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

            departments = runCatching { Repository.departments(au.company_id) }.getOrDefault(emptyList())
            employees = runCatching { Repository.employees(au.company_id) }.getOrDefault(emptyList())
            assetLocations = runCatching { Repository.assetLocations(au.company_id) }.getOrDefault(emptyList())
            storageLocations = runCatching { Repository.storageLocations(au.company_id) }.getOrDefault(emptyList())

            runCatching {
                val rows = Repository.featureRows(au.company_id)
                val now = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).toString()
                handheldConfigured = rows.any { it.feature_key.startsWith("hh_") }
                validFeatures = rows
                    .filter { it.valid_until == null || it.valid_until > now }
                    .map { it.feature_key }
                    .toSet()
            }

            runCatching {
                Repository.appearance(au.company_id)?.let { ap ->
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
