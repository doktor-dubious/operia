package com.dcalogic.operia

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dcalogic.operia.data.AssetLocation
import com.dcalogic.operia.data.BiometricCredentials
import com.dcalogic.operia.data.Brand
import com.dcalogic.operia.data.Department
import com.dcalogic.operia.data.Employee
import com.dcalogic.operia.data.HandheldConfig
import com.dcalogic.operia.data.LocalStore
import com.dcalogic.operia.data.supabase
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import com.dcalogic.operia.data.Repository
import java.io.IOException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Session + bootstrap-tilstand for hele appen. Skærmene læser stamdata
 * (afdelinger, medarbejdere, features) herfra; selve pakke-/
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
    var assetCategories by mutableStateOf<List<com.dcalogic.operia.data.AssetCategory>>(emptyList())
    var storageLocations by mutableStateOf<List<com.dcalogic.operia.data.StorageLocation>>(emptyList())
    var carriers by mutableStateOf<List<com.dcalogic.operia.data.Carrier>>(emptyList())
    var handlingClasses by mutableStateOf<List<com.dcalogic.operia.data.HandlingClass>>(emptyList())
    /** Afsender-forslag til modtagelsen (tidligere brugte, hyppigste først).
     *  Ren nice-to-have: fejler hentningen, er feltet bare uden forslag. */
    var senderSuggestions by mutableStateOf<List<String>>(emptyList())
    /** Appens faste brand (navn + accentfarve) — ikke længere kundetilpasset. */
    val brand = Brand()
    /** Platformens handheld-design (Operia → Handheld-design). Tom = appens
     *  standardudseende, så skærmen virker før/uden konfiguration. */
    var handheld by mutableStateOf(HandheldConfig()); private set
    /** Effektive ankomstbesked-indstillinger — driver intake-advarslen
     *  "modtageren kan ikke få besked". null = ukendt (hentning fejlede) →
     *  ingen advarsel frem for en falsk. */
    var notifyPrefs by mutableStateOf<com.dcalogic.operia.data.NotifyPrefs?>(null); private set
    var pendingCount by mutableStateOf(0); private set
    var bootstrapError by mutableStateOf<String?>(null); private set
    /** Stamdata-lister der ikke kunne hentes ved bootstrap. Uden dette ville et
     *  fejlet opslag give en tom vælger uden nogen forklaring — umuligt at skelne
     *  fra "der er ikke oprettet nogen" i admin. */
    var masterDataError by mutableStateOf<String?>(null); private set

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

    /** Er biometrisk oplåsning slået til på DENNE enhed? (enhedslokalt valg) */
    var biometricEnabled by mutableStateOf(false); private set
    /** Tillader platform + virksomhed biometrisk login? null = endnu ukendt
     *  (hentes ved bootstrap) — indstillingen vises først når svaret kendes. */
    var biometricAllowed by mutableStateOf<Boolean?>(null); private set

    /** Sat når en gemt session er låst bag biometrien og venter på oplåsning.
     *  Nulstilles ved unlock, så et skift til baggrunden ikke låser midt i et
     *  scanneflow — låsen gælder appstart. */
    private var unlocked = false

    /** Brugeren som den gemte session tilhører — nøglen til det enhedslokale
     *  biometri-valg (flaget gemmes pr. bruger, se LocalStore). */
    private var currentUserId: String? = null

    /** Gemt legitimation, der lader login-skærmen tilbyde fingeraftryk i
     *  stedet for adgangskode. null = enheden husker ingen. */
    var biometricCredential by mutableStateOf<BiometricCredentials.Stored?>(null)
        private set

    /** Den gemte legitimation, hvis den tilhører den AKTUELT indloggede bruger
     *  — ellers null. På en delt terminal kan enheden huske en tidligere
     *  brugers legitimation; den må hverken vises som denne brugers identitet
     *  eller ændre, hvordan denne bruger logges ud. */
    val ownBiometricCredential: BiometricCredentials.Stored?
        get() = biometricCredential?.takeIf { it.userId == currentUserId }

    /** Skal startskærmen tilbyde at slå fingeraftryk-login til? Sættes ved
     *  bootstrap og kun for brugere, der ikke er blevet spurgt før. */
    var offerBiometricSetup by mutableStateOf(false); private set

    /** Luk tilbuddet — uanset svaret spørges der ikke igen på denne enhed. */
    fun dismissBiometricOffer() {
        currentUserId?.let { LocalStore.setBiometricOfferSeen(getApplication(), it) }
        offerBiometricSetup = false
    }

    init {
        handheld = LocalStore.handheld(app)
        biometricCredential = BiometricCredentials.stored(app)
        viewModelScope.launch {
            supabase.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Initializing -> sessionState = SessionState.Checking
                    is SessionStatus.Authenticated -> {
                        // Slå valget op for NETOP denne bruger: på en delt
                        // terminal må næste bruger ikke arve den forriges lås.
                        currentUserId = status.session.user?.id
                        biometricEnabled = currentUserId
                            ?.let { LocalStore.biometricEnabled(app, it) } == true
                        // Hold det gemte refresh-token friskt. Tokens roterer
                        // (config.toml), så det gemte bliver forældet, hver
                        // gang sessionen fornyes — og fingeraftryk-login ville
                        // så fejle netop når det trængtes.
                        if (biometricEnabled) rememberCredential(status.session)
                        // Har terminalen stået ubrugt længere end vinduet,
                        // tæller den gemte session ikke længere som "logget
                        // ind": så skal der bekræftes igen (biometri hvis slået
                        // til, ellers adgangskode).
                        if (!unlocked && reauthExpired()) {
                            if (biometricEnabled) {
                                sessionState = SessionState.Locked
                            } else {
                                runCatching { supabase.auth.clearSession() }
                            }
                            return@collect
                        }
                        // Den gemte session genoptages automatisk ved appstart.
                        // Har brugeren slået biometrisk login til, skal den låses
                        // op først — ellers ville "biometrisk login" reelt være
                        // ingen login overhovedet.
                        if (biometricEnabled && !unlocked) {
                            sessionState = SessionState.Locked
                        } else if (sessionState !is SessionState.Ready) {
                            // Adgangen gives HER — fra nu af tæller sessionen
                            // som låst op. supabase-kt gen-udsender Authenticated
                            // ved hver token-fornyelse, og uden flaget ville
                            // gen-login-vinduet kunne smide en AKTIVT arbejdende
                            // bruger ud midt i et flow (onPause er aldrig nået
                            // at opdatere lastActive). Tjekkene ovenfor gælder
                            // appstart, ikke en kørende session.
                            unlocked = true
                            sessionState = SessionState.Loading
                            bootstrap()
                        }
                    }
                    else -> {
                        unlocked = false
                        currentUserId = null
                        biometricEnabled = false
                        sessionState = SessionState.LoggedOut
                    }
                }
            }
        }
    }

    /**
     * Er terminalen stået ubrugt længere end det konfigurerede vindue?
     * 0 (standard) = aldrig, og da opfører appen sig præcis som hidtil.
     */
    private fun reauthExpired(): Boolean {
        val ctx = getApplication<Application>()
        val minutes = LocalStore.reauthMinutes(ctx)
        if (minutes <= 0) return false
        val last = LocalStore.lastActiveAt(ctx)
        if (last == 0L) return false // ingen registreret aktivitet endnu
        return System.currentTimeMillis() - last > minutes * 60_000L
    }

    /** Kaldes fra aktiviteten, når appen bruges/går i baggrunden, så
     *  inaktivitet måles fra sidste reelle brug og ikke fra login. */
    fun touchActivity() {
        LocalStore.touchLastActive(getApplication(), System.currentTimeMillis())
    }

    /**
     * Kaldes når systemets biometriske prompt er godkendt.
     *
     * Sessionen er allerede gyldig, men administratorens fravalg skal
     * håndhæves FØR adgangen gives: bootstrap() opdager det først bagefter, og
     * så var brugeren reelt kommet ind med fingeraftryk, efter at kunden havde
     * slået metoden fra. Er den slået fra, kastes sessionen i stedet, og man
     * er tilbage på login-skærmen med adgangskode.
     *
     * Kan politikken ikke hentes (offline), gives adgang — en netværksfejl må
     * ikke spærre en lovlig bruger ude af sin egen, gyldige session.
     */
    fun onBiometricUnlocked() {
        unlocked = true
        if (sessionState is SessionState.Locked) {
            sessionState = SessionState.Loading
            viewModelScope.launch {
                if (biometricBlockedForCompany()) {
                    forgetBiometricLogin()
                    runCatching { supabase.auth.clearSession() }
                    unlocked = false
                    return@launch // session-collectoren sætter LoggedOut
                }
                bootstrap()
            }
        }
    }

    /** Slå biometrisk oplåsning til/fra på denne enhed. Selve verifikationen
     *  (prompten) sker i UI-laget før dette kaldes ved tilvalg. */
    /**
     * Har platformen eller virksomheden slået biometrisk login fra?
     *
     * Kan først afgøres EFTER at sessionen findes: brugerens virksomhed er
     * ukendt, indtil der er en session at slå den op med. Fejler opslaget
     * (netværk), spærres der IKKE — et udfald må ikke låse en lovlig bruger
     * ude af en metode, administratoren faktisk tillader.
     */
    private suspend fun biometricBlockedForCompany(): Boolean {
        val cid = runCatching { Repository.currentAppUser() }.getOrNull()?.company_id
            ?: return false
        val allowed = runCatching { Repository.biometricLoginAllowed(cid) }.getOrNull()
        return allowed == false
    }

    /** Gem/forny den legitimation, der gør login fra login-skærmen muligt. */
    private fun rememberCredential(session: io.github.jan.supabase.auth.user.UserSession) {
        val uid = session.user?.id ?: return
        BiometricCredentials.save(
            getApplication(),
            uid,
            session.user?.email.orEmpty(),
            session.refreshToken,
        )
    }

    /** Glem enheden igen — kan også gøres fra login-skærmen, hvor der ikke er
     *  nogen session at slå indstillingen fra i. */
    fun forgetBiometricLogin() {
        // Kaldes også fra login-skærmen, hvor der ingen session er — tag da
        // bruger-id'et fra selve legitimationen. Ellers ville app-start-låsen
        // for den bruger blive stående, og et senere kodeord-login ville
        // genskabe det hele, selv om brugeren bad om at glemme enheden.
        val uid = currentUserId ?: biometricCredential?.userId
        uid?.let { LocalStore.setBiometricEnabled(getApplication(), it, false) }
        BiometricCredentials.clear(getApplication())
        biometricCredential = null
        biometricEnabled = false
    }

    fun updateBiometricLogin(on: Boolean) {
        val ctx = getApplication<Application>()
        // Uden en kendt bruger er der ingen nøgle at gemme under — sker kun
        // hvis kaldet kommer før sessionen er læst, og må da ikke skrive et
        // valg, der bagefter gælder en tilfældig bruger.
        val uid = currentUserId ?: return
        LocalStore.setBiometricEnabled(ctx, uid, on)
        biometricEnabled = on
        if (on) {
            supabase.auth.currentSessionOrNull()?.let { rememberCredential(it) }
            biometricCredential = BiometricCredentials.stored(ctx)
        } else {
            BiometricCredentials.clear(ctx)
            biometricCredential = null
        }
        // Slås den til, mens appen kører, er sessionen allerede låst op —
        // låsen træder i kraft ved næste appstart.
        if (on) unlocked = true
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
                val deptD = async { runCatching { Repository.departments(cid) } }
                val empD = async { runCatching { Repository.employees(cid) } }
                val assetLocD = async { runCatching { Repository.assetLocations(cid) } }
                val assetCatD = async { runCatching { Repository.assetCategories(cid) } }
                val storageD = async { runCatching { Repository.storageLocations(cid) } }
                val carrierD = async { runCatching { Repository.carriers(cid) } }
                val handlingD = async { runCatching { Repository.handlingClasses(cid) } }
                val sendersD = async { runCatching { Repository.senderSuggestions(cid) } }
                val featureD = async { runCatching { Repository.featureRows(cid) }.getOrNull() }
                val handheldD = async { runCatching { Repository.handheldConfig(cid) }.getOrNull() }
                val coNotifyD = async { runCatching { Repository.companyNotifySettings(cid) }.getOrNull() }
                val pfNotifyD = async { runCatching { Repository.platformNotifySettings() }.getOrNull() }
                val bioAllowedD = async { runCatching { Repository.loginPolicy(cid) }.getOrNull() }

                roles = rolesD.await()
                // En fejlet liste bliver stadig tom (skærmen skal virke), men
                // navnet samles op, så brugeren får at vide HVAD der mangler i
                // stedet for bare at se en tom vælger.
                val failed = mutableListOf<String>()
                departments = deptD.await()
                    .getOrElse { failed += ctx.getString(R.string.department); emptyList() }
                employees = empD.await()
                    .getOrElse { failed += ctx.getString(R.string.receiver); emptyList() }
                assetLocations = assetLocD.await().getOrDefault(emptyList())
                assetCategories = assetCatD.await().getOrDefault(emptyList())
                storageLocations = storageD.await()
                    .getOrElse { failed += ctx.getString(R.string.storage_location); emptyList() }
                carriers = carrierD.await()
                    .getOrElse { failed += ctx.getString(R.string.carrier); emptyList() }
                handlingClasses = handlingD.await()
                    .getOrElse { failed += ctx.getString(R.string.handling); emptyList() }
                senderSuggestions = sendersD.await().getOrDefault(emptyList())
                masterDataError =
                    if (failed.isEmpty()) null
                    else ctx.getString(R.string.err_master_data, failed.joinToString(", "))

                // valid_until er en Postgres DATE ('2026-07-26') — sammenlign dato mod
                // dato (>= i dag), som web og dispatcheren; mod et fuldt tidsstempel
                // ville sidste gyldighedsdag fejlagtigt tælle som udløbet.
                val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
                val featureRows = featureD.await()
                featureRows?.let { rows ->
                    handheldConfigured = rows.any { it.feature_key.startsWith("hh_") }
                    validFeatures = rows
                        .filter { it.valid_until == null || it.valid_until >= today }
                        .map { it.feature_key }
                        .toSet()
                }

                // Effektive ankomstbesked-indstillinger (samme regler som
                // dispatch-parcel-notifications): virksomheds-override ?? platform,
                // SMS-kanalen kræver desuden sms_notifications-tilvalget. Bruges
                // kun til intake-advarslen — featureRows (ikke has()) fordi has()
                // er default-open før hh_*-opsætning.
                val coNotify = coNotifyD.await()
                val pfNotify = pfNotifyD.await()
                if (coNotify != null && pfNotify != null) {
                    val hasSmsFeature = featureRows.orEmpty().any {
                        it.feature_key == "sms_notifications" &&
                            (it.valid_until == null || it.valid_until >= today)
                    }
                    notifyPrefs = com.dcalogic.operia.data.NotifyPrefs(
                        arrivalActive = pfNotify.parcel_notifications_enabled &&
                            (coNotify.parcel_arrival_enabled ?: pfNotify.parcel_arrival_enabled),
                        emailOn = coNotify.notify_email_enabled ?: pfNotify.notify_email_enabled,
                        smsOn = (coNotify.notify_sms_enabled ?: pfNotify.notify_sms_enabled) &&
                            hasSmsFeature,
                    )
                }

                // Er biometrisk login stadig tilladt? Slår admin metoden fra,
                // skal en enhed, der allerede har den slået til, holde op med
                // at låse — ellers ville brugeren sidde fast bag en lås, der
                // ikke længere er en gyldig login-metode.
                bioAllowedD.await()?.let { policy ->
                    val allowed = policy.biometricAllowed
                    biometricAllowed = allowed
                    // Cache vinduet, så det kan håndhæves ved næste appstart —
                    // også før/uden netværk.
                    LocalStore.cacheReauthMinutes(ctx, policy.reauthMinutes)
                    if (!allowed && biometricEnabled) updateBiometricLogin(false)
                    // Tilbyd opsætningen ÉN gang, i stedet for at lade brugeren
                    // selv finde kontakten. Kun når den reelt kan bruges: admin
                    // tillader det, enheden har en sensor/skærmlås, og brugeren
                    // hverken har slået det til eller sagt nej før.
                    val uid = currentUserId
                    offerBiometricSetup = allowed &&
                        !biometricEnabled &&
                        uid != null &&
                        !LocalStore.biometricOfferSeen(ctx, uid) &&
                        com.dcalogic.operia.data.Biometrics.available(ctx)
                }

                // Handheld-designet er platform-globalt (ikke pr. virksomhed) —
                // fejler hentningen, beholder vi det cachede/standarden.
                handheldD.await()?.let { cfg ->
                    handheld = cfg
                    LocalStore.cacheHandheld(ctx, cfg)
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

    /** Skelner mellem forkert login, manglende forbindelse og øvrige fejl, så
     *  login-skærmen kan vise en brugbar besked (og ikke "forkert adgangskode"
     *  ved fx netværksudfald). */
    suspend fun login(email: String, password: String): LoginError? {
        // Sættes FØR kaldet, ikke efter: supabase-kt offentliggør den
        // godkendte session midt i signInWith (mens den gemmes til disken), og
        // session-collectoren når at køre i den suspension. Blev flaget først
        // sat bagefter, ville den se en gyldig session med unlocked=false og
        // låse — så et helt almindeligt adgangskode-login ville kræve BÅDE
        // kodeord og fingeraftryk. Et interaktivt login HAR godtgjort, hvem
        // brugeren er, så låsen hører først til næste appstart.
        unlocked = true
        val error = attemptLogin(email, password)
        // Mislykkedes det, blev der ingen session — ryd flaget igen, så det
        // ikke ligger og venter på en fremtidig session.
        if (error != null) unlocked = false
        return error
    }

    /**
     * Login FRA login-skærmen med biometri — altså i stedet for adgangskode,
     * ikke som en lås oven på en allerede indlogget session.
     *
     * Kaldes efter en godkendt BiometricPrompt: det gemte refresh-token veksles
     * til en frisk session. Slår serveren tokenet fra (udløbet, roteret væk,
     * bruger spærret), glemmes enheden, så brugeren ikke sidder med en knap,
     * der bliver ved at fejle — der logges ind med adgangskode i stedet.
     */
    suspend fun loginWithBiometrics(): LoginError? {
        val cred = biometricCredential ?: return LoginError.Other("")
        unlocked = true // som ved adgangskode-login: identiteten er netop godtgjort
        return try {
            val session = supabase.auth.refreshSession(cred.refreshToken)
            supabase.auth.importSession(session)
            // Håndhæv administratorens fravalg HER, hvor adgangen gives.
            // bootstrap() tjekker også, men den kører først EFTER at sessionen
            // er givet — så uden dette kunne man stadig logge ind én gang med
            // fingeraftryk, efter at kunden havde slået metoden fra.
            if (biometricBlockedForCompany()) {
                forgetBiometricLogin()
                runCatching { supabase.auth.clearSession() }
                unlocked = false
                return LoginError.BiometricNotAllowed
            }
            reportSuccessfulLogin()
            null
        } catch (e: AuthRestException) {
            unlocked = false
            forgetBiometricLogin()
            LoginError.BiometricExpired
        } catch (e: RestException) {
            unlocked = false
            forgetBiometricLogin()
            LoginError.BiometricExpired
        } catch (e: HttpRequestException) {
            unlocked = false
            LoginError.Network
        } catch (e: IOException) {
            unlocked = false
            LoginError.Network
        } catch (e: Exception) {
            unlocked = false
            LoginError.Other(e.message ?: "")
        }
    }

    private suspend fun attemptLogin(email: String, password: String): LoginError? = try {
        supabase.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        // Log det vellykkede login (klient-drevet, da GoTrue-hook'en ikke er
        // tilgængelig på planen).
        reportSuccessfulLogin()
        null
    } catch (e: AuthRestException) {
        // GoTrue svarede. Ældre gateways udelader error_code — fald tilbage på teksten.
        if (e.errorCode == AuthErrorCode.InvalidCredentials ||
            e.message?.contains("invalid login credentials", ignoreCase = true) == true
        ) {
            // GoTrue returnerer samme fejl for forkert kode og ukendt email; server-
            // funktionen logger begge (login-audit er klient-drevet).
            reportFailedLogin(email)
            LoginError.WrongCredentials
        } else LoginError.Other(e.errorDescription)
    } catch (e: RestException) {
        LoginError.Other(e.message ?: "Login fejlede")
    } catch (e: HttpRequestException) {
        LoginError.Network
    } catch (e: IOException) {
        LoginError.Network
    } catch (e: Exception) {
        LoginError.Other(e.message ?: "Login fejlede")
    }

    /** Rapportér et fejlet login til revisionsloggen (fire-and-forget). Kaldet er
     *  anonymt — ingen session endnu — og enhver fejl sluges, så et logningsudfald
     *  aldrig påvirker login-flowet. */
    private fun reportFailedLogin(email: String) {
        val e = email.trim()
        if (e.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                supabase.postgrest.rpc(
                    "log_failed_login_attempt",
                    buildJsonObject { put("p_email", e) },
                )
            }
        }
    }

    /** Rapportér et vellykket login til revisionsloggen (fire-and-forget). Kaldes
     *  som den netop indloggede bruger; enhver fejl sluges, så logning aldrig
     *  påvirker login-flowet. */
    private fun reportSuccessfulLogin() {
        viewModelScope.launch {
            runCatching { supabase.postgrest.rpc("log_login_success") }
        }
    }

    // Bemærk: logout rører IKKE brugerens biometri-valg. Det er gemt pr.
    // bruger, så næste bruger på en delt terminal alligevel ikke arver låsen —
    // og den, der logger ud og ind igen, beholder sin egen indstilling.
    //
    // signOut() TILBAGEKALDER refresh-tokenet hos GoTrue. Har brugeren slået
    // fingeraftryk-login til, ville det gemte token dermed være dødt i samme
    // sekund, og knappen på login-skærmen kunne kun svare "udløbet". Derfor
    // ryddes sessionen da kun lokalt (clearSession), så tokenet overlever til
    // næste fingeraftryk-login. Vil man tilbagekalde for alvor, er vejen
    // "Glem fingeraftryk-login" — så er der ingen legitimation tilbage.
    //
    // Kun BRUGERENS EGEN gemte legitimation begrunder det lokale log ud: husker
    // terminalen en TIDLIGERE brugers legitimation, logger denne bruger ud med
    // adgangskode-reglen (signOut), så deres refresh-token faktisk
    // tilbagekaldes — den gemte legitimation er en anden brugers token og
    // berøres ikke af det.
    fun logout() {
        val keepToken = ownBiometricCredential != null
        viewModelScope.launch {
            runCatching {
                if (keepToken) supabase.auth.clearSession()
                else supabase.auth.signOut()
            }
        }
    }
}

sealed interface SessionState {
    data object Checking : SessionState
    data object LoggedOut : SessionState
    /** Gyldig gemt session, der venter på biometrisk oplåsning. */
    data object Locked : SessionState
    data object Loading : SessionState
    data object Ready : SessionState
}

/** Klassificeret login-fejl til LoginScreen. */
sealed interface LoginError {
    data object WrongCredentials : LoginError
    data object Network : LoginError
    /** Den gemte biometri-legitimation duer ikke længere — log ind med kode. */
    data object BiometricExpired : LoginError
    /** Administratoren har slået biometrisk login fra for virksomheden. */
    data object BiometricNotAllowed : LoginError
    data class Other(val message: String) : LoginError
}
