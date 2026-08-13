package com.dcalogic.operia.data

import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.storage.storage
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Alle databasekald samlet ét sted. RLS på serveren er den reelle
 * adgangskontrol — alt her er scoped til brugerens company_id alligevel,
 * så listerne også er rigtige når brugeren er platform-admin.
 */
object Repository {

    /** Minimal returrække til at verificere at en UPDATE faktisk ramte noget. */
    @Serializable
    private data class IdRow(val id: String)

    @Serializable
    private data class UserRoleRow(val role: String)

    // ---------- bootstrap ----------

    suspend fun currentAppUser(): AppUser? {
        val uid = supabase.auth.currentUserOrNull()?.id ?: return null
        return supabase.from("app_users")
            .select { filter { eq("user_id", uid) }; limit(1) }
            .decodeList<AppUser>()
            .firstOrNull()
    }

    /** Brugerens roller (user_roles) — afgør hvilke fliser terminalen viser.
     *  RLS er den reelle håndhævelse; dette er kun UI-gating. */
    suspend fun currentRoles(): Set<String> {
        val uid = supabase.auth.currentUserOrNull()?.id ?: return emptySet()
        return supabase.from("user_roles")
            .select(Columns.list("role")) { filter { eq("user_id", uid) } }
            .decodeList<UserRoleRow>()
            .map { it.role }
            .toSet()
    }

    suspend fun departments(companyId: String): List<Department> =
        supabase.from("departments")
            .select(Columns.list("id", "name")) {
                filter { eq("company_id", companyId) }
                order("name", Order.ASCENDING)
            }.decodeList()

    suspend fun employees(companyId: String): List<Employee> =
        supabase.from("employees")
            .select(Columns.list("id", "full_name", "initials", "email", "phone", "department_id")) {
                filter {
                    eq("company_id", companyId)
                    eq("is_active", true)
                }
                order("full_name", Order.ASCENDING)
            }.decodeList()

    suspend fun storageLocations(companyId: String): List<StorageLocation> =
        supabase.from("storage_locations")
            .select(Columns.list("id", "name", "barcode")) {
                filter {
                    eq("company_id", companyId)
                    eq("is_active", true)
                }
                order("name", Order.ASCENDING)
            }.decodeList()

    /** Fragtfirmaer (app-ejede stamdata) — valgfrit ved modtagelse, som på webben. */
    suspend fun carriers(companyId: String): List<Carrier> =
        supabase.from("carriers")
            .select(Columns.list("id", "name")) {
                filter {
                    eq("company_id", companyId)
                    eq("is_active", true)
                }
                order("name", Order.ASCENDING)
            }.decodeList()

    /** Håndteringsklasser (app-ejede stamdata) — valgfrit ved modtagelse. */
    suspend fun handlingClasses(companyId: String): List<HandlingClass> =
        supabase.from("handling_classes")
            .select(Columns.list("id", "name")) {
                filter { eq("company_id", companyId) }
                order("name", Order.ASCENDING)
            }.decodeList()

    /** Afsender-forslag til modtagelsen: virksomhedens egne tidligere
     *  afsendere, hyppigst brugte først. Afsender er fri tekst uden
     *  stamdata-tabel, så forslagene kommer fra parcels.sender (RPC'en er
     *  SECURITY INVOKER — RLS afgør hvad brugeren kan se). */
    suspend fun senderSuggestions(companyId: String): List<String> =
        supabase.postgrest.rpc(
            "parcel_sender_suggestions",
            buildJsonObject { put("p_company_id", companyId) },
        ).decodeList<String>()

    /** Virksomhedens notifikations-override (kanaler + ankomstbesked). */
    suspend fun companyNotifySettings(companyId: String): CompanyNotifyRow? =
        supabase.from("companies")
            .select(
                Columns.list("notify_email_enabled", "notify_sms_enabled", "parcel_arrival_enabled"),
            ) {
                filter { eq("id", companyId) }
                limit(1)
            }.decodeList<CompanyNotifyRow>().firstOrNull()

    /** Platformens notifikations-standarder + hovedafbryder (RLS: using(true)). */
    suspend fun platformNotifySettings(): PlatformNotifyRow? =
        supabase.from("platform_settings")
            .select(
                Columns.list(
                    "notify_email_enabled", "notify_sms_enabled",
                    "parcel_notifications_enabled", "parcel_arrival_enabled",
                ),
            ) { limit(1) }
            .decodeList<PlatformNotifyRow>().firstOrNull()

    /** Er biometrisk login tilladt for brugerens virksomhed? Platformens
     *  hovedafbryder AND virksomhedens override (null = arv). Fejler et af
     *  opslagene, er svaret null = ukendt, og kalderen lader indstillingen
     *  stå urørt frem for at slå funktionen fra ved et netværksudfald. */
    suspend fun biometricLoginAllowed(companyId: String): Boolean? =
        loginPolicy(companyId)?.biometricAllowed

    /** Effektiv login-politik: platformens værdier med firmaets override
     *  (null = arv). Ét opslag, så biometri-tilladelse og gen-login-vinduet
     *  ikke koster to rundture ved hver bootstrap. */
    suspend fun loginPolicy(companyId: String): LoginPolicy? {
        val platform = runCatching {
            supabase.from("platform_settings")
                .select(
                    Columns.list(
                        "login_password_enabled", "login_biometric_enabled",
                        "handheld_reauth_minutes",
                    ),
                ) { limit(1) }
                .decodeList<LoginMethodsRow>().firstOrNull()
        }.getOrNull() ?: return null
        val company = runCatching {
            supabase.from("companies")
                .select(
                    Columns.list(
                        "login_password_enabled", "login_biometric_enabled",
                        "handheld_reauth_minutes",
                    ),
                ) {
                    filter { eq("id", companyId) }
                    limit(1)
                }
                .decodeList<LoginMethodsRow>().firstOrNull()
        }.getOrNull()
        return LoginPolicy(
            biometricAllowed = (platform.login_biometric_enabled ?: true) &&
                (company?.login_biometric_enabled ?: true),
            reauthMinutes = company?.handheld_reauth_minutes
                ?: platform.handheld_reauth_minutes
                ?: 0,
        )
    }

    data class LoginPolicy(val biometricAllowed: Boolean, val reauthMinutes: Int)

    /** Alle feature-rækker for virksomheden — gyldighed (valid_until) afgøres af kalderen. */
    suspend fun featureRows(companyId: String): List<CompanyFeature> =
        supabase.from("company_features")
            .select(Columns.list("feature_key", "valid_until")) { filter { eq("company_id", companyId) } }
            .decodeList()

    suspend fun products(companyId: String): Set<String> =
        supabase.from("company_products")
            .select(Columns.list("product_key", "valid_until")) { filter { eq("company_id", companyId) } }
            .decodeList<CompanyProduct>()
            .filter { it.valid_until == null || it.valid_until > nowIso() }
            .map { it.product_key }
            .toSet()

    /**
     * Handheld-designet for virksomheden: kundens eget (Konfigurér →
     * Handheld-design) hvis det findes, ellers platformens standard (Operia →
     * Handheld-design). Samme fald-tilbage-regel som Home-designet på webben —
     * en kunde uden egen række arver platformens design, og en ændring af
     * standarden slår derfor igennem hos alle der ikke har taget stilling.
     *
     * platform_settings_select er `using (true)`, og company_handheld_config er
     * læsbar for alle i virksomheden, så begge opslag virker som handler.
     */
    suspend fun handheldConfig(companyId: String): HandheldConfig? {
        val own = runCatching {
            supabase.from("company_handheld_config")
                .select(Columns.list("handheld_tiles", "handheld_design")) {
                    filter { eq("company_id", companyId) }
                    limit(1)
                }
                .decodeList<PlatformHandheldRow>()
                .firstOrNull()
        }.getOrNull()
        if (own != null) return HandheldConfig(own.handheld_tiles, own.handheld_design)

        return supabase.from("platform_settings")
            .select(Columns.list("handheld_tiles", "handheld_design")) { limit(1) }
            .decodeList<PlatformHandheldRow>()
            .firstOrNull()
            ?.let { HandheldConfig(it.handheld_tiles, it.handheld_design) }
    }

    // ---------- pakker ----------

    suspend fun insertParcels(rows: List<ParcelInsert>): List<Parcel> =
        supabase.from("parcels").insert(rows) { select() }.decodeList()

    /** Står koden allerede som en åben pakke? Spejler webbens dublet-værn på
     *  modtag-formularen: kun slutstatusserne (delivered/returned/rejected/
     *  removed) frigiver koden til genregistrering — 'unassigned' tæller med
     *  som åben. */
    suspend fun hasOpenParcel(companyId: String, code: String): Boolean =
        supabase.from("parcels")
            .select(Columns.list("id")) {
                filter {
                    eq("company_id", companyId)
                    eq("barcode", code)
                    isIn("status", listOf("unassigned") + OPEN_STATUSES)
                }
                limit(1)
            }.decodeList<IdRow>().isNotEmpty()

    suspend fun findParcels(companyId: String, code: String, limit: Long = 15): List<Parcel> =
        supabase.from("parcels")
            .select {
                filter {
                    eq("company_id", companyId)
                    eq("barcode", code)
                }
                order("registered_at", Order.DESCENDING)
                limit(limit)
            }.decodeList()

    // ---------- batches ----------

    /** Åbne statusser = dem en batch-handling må ramme (samme som DELIVERABLE i
     *  HandoutScreen). Både udlevering og afvisning (→ returned) er tilladt herfra. */
    private val OPEN_STATUSES = listOf("registered", "in_storage", "in_transit", "in_locker")

    /** Opret en afsluttet batch (server genererer batch_code + validerer tenant).
     *  Kræver forbindelse — batch_id skal kendes før pakkerne kan indsættes. */
    suspend fun createParcelBatch(companyId: String, receiverId: String, departmentId: String?): ParcelBatch =
        supabase.from("parcel_batches")
            .insert(
                ParcelBatchInsert(
                    company_id = companyId,
                    receiver_employee_id = receiverId,
                    department_id = departmentId,
                    status = "finished",
                    created_by = supabase.auth.currentUserOrNull()?.id,
                ),
            ) { select() }
            .decodeSingle()

    /** Slå en batch op på dens scanbare kode (batch-labelen). */
    suspend fun batchByCode(companyId: String, code: String): ParcelBatch? =
        supabase.from("parcel_batches")
            .select {
                filter {
                    eq("company_id", companyId)
                    eq("batch_code", code)
                }
                limit(1)
            }.decodeList<ParcelBatch>().firstOrNull()

    suspend fun batchById(batchId: String): ParcelBatch? =
        supabase.from("parcel_batches")
            .select { filter { eq("id", batchId) }; limit(1) }
            .decodeList<ParcelBatch>().firstOrNull()

    /** Åbne medlemmer af en batch — repræsentant (til formularen) + antal ("alle N"). */
    suspend fun batchOpenMembers(batchId: String): List<Parcel> =
        supabase.from("parcels")
            .select {
                filter {
                    eq("batch_id", batchId)
                    isIn("status", OPEN_STATUSES)
                }
                order("registered_at", Order.ASCENDING)
            }.decodeList()

    /** Udlever hele batchen: alle åbne medlemmer → delivered i én operation.
     *  Hver række går gennem guard + hændelseslog (chain-of-custody pr. pakke).
     *  Returnerer antal ramte pakker. */
    suspend fun deliverBatch(batchId: String, deliveredTo: String, note: String?, signaturePath: String?): Int {
        val updated = supabase.from("parcels").update({
            set("status", "delivered")
            set("delivered_to", deliveredTo)
            set("delivered_note", note)
            if (signaturePath != null) set("delivered_signature_path", signaturePath)
        }) {
            select(Columns.list("id"))
            filter {
                eq("batch_id", batchId)
                isIn("status", OPEN_STATUSES)
            }
        }.decodeList<IdRow>()
        requireUpdated(updated)
        return updated.size
    }

    /** Afvis hele batchen: alle åbne medlemmer → returned (retur til afsender). */
    suspend fun rejectBatch(batchId: String, note: String, signaturePath: String?): Int {
        val updated = supabase.from("parcels").update({
            set("status", "returned")
            set("delivered_to", null as String?)
            set("delivered_note", note)
            if (signaturePath != null) set("delivered_signature_path", signaturePath)
        }) {
            select(Columns.list("id"))
            filter {
                eq("batch_id", batchId)
                isIn("status", OPEN_STATUSES)
            }
        }.decodeList<IdRow>()
        requireUpdated(updated)
        return updated.size
    }

    /** RLS filtrerer en uautoriseret UPDATE til 0 rækker uden fejl — uden
     *  denne kontrol ville appen vise succes mens intet blev gemt (samme
     *  vagt som webbens udleveringsdialog). */
    private fun requireUpdated(updated: List<IdRow>) {
        check(updated.isNotEmpty()) { "Ingen rækker opdateret — afvist af serveren (RLS)" }
    }

    /** Tildel modtager på en 'unassigned' pakke (kræves før udlevering —
     *  state-maskinen tillader ikke unassigned → delivered). */
    suspend fun assignReceiver(parcelId: String, employeeId: String) {
        val updated = supabase.from("parcels").update({
            set("receiver_employee_id", employeeId)
            set("status", "registered")
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    suspend fun deliverParcel(
        parcelId: String,
        deliveredTo: String,
        note: String?,
        signaturePath: String?,
    ) {
        val updated = supabase.from("parcels").update({
            set("status", "delivered")
            set("delivered_to", deliveredTo)
            set("delivered_note", note)
            if (signaturePath != null) set("delivered_signature_path", signaturePath)
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    /**
     * Afvis pakke (spec §handover: modtageren nægter at modtage). En afvisning
     * betyder "send retur til afsender": pakken går derfor DIREKTE til 'returned'
     * (ikke det mellemliggende 'rejected'). Årsagen er påkrævet — afvisninger er
     * undtagelseshændelser, der havner i dashboardets undtagelsesliste og
     * eskaleres i audit-loggen, så en afvisning uden begrundelse er ubrugelig for
     * den, der skal følge op. Underskrift er valgfri (samme som udlevering):
     * modtageren står typisk ved skranken og kan kvittere for selve afvisningen,
     * men kan ikke tvinges.
     *
     * delivered_to nulstilles med vilje — ingen har modtaget pakken.
     * Tilladt fra registered/in_storage/in_transit (jf. state-maskinen i
     * parcel_transition_allowed; registered → returned blev åbnet i
     * 20260728170000). Bemærk at in_locker IKKE må afvises (returnér i stedet).
     */
    suspend fun rejectParcel(parcelId: String, note: String, signaturePath: String?) {
        val updated = supabase.from("parcels").update({
            set("status", "returned")
            set("delivered_to", null as String?)
            set("delivered_note", note)
            if (signaturePath != null) set("delivered_signature_path", signaturePath)
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    /**
     * Returnér pakke (retur til afsender). Årsagen er påkrævet — som ved
     * afvisning. Ingen underskrift: der er ingen modtager til stede at kvittere.
     * Tilladt fra unassigned/in_storage/in_transit/in_locker/rejected
     * (jf. state-maskinen — bemærk at 'registered' IKKE må returneres).
     */
    suspend fun returnParcel(parcelId: String, note: String) {
        val updated = supabase.from("parcels").update({
            set("status", "returned")
            set("delivered_to", null as String?)
            set("delivered_note", note)
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    /**
     * Flyt en pakke (Flow 2, relokering): sæt flytte-status (in_storage /
     * in_transit / in_locker) og placering. Placeringen er nullable — 'in_transit'
     * kan være uden fast plads. State-maskinen (parcel_transition_allowed) afviser
     * ugyldige overgange, og triggeren logger både 'status_changed' og 'moved' i
     * parcel_events, så sporbarheden skrives af sig selv.
     */
    suspend fun moveParcel(parcelId: String, toStatus: String, toLocationId: String?) {
        val updated = supabase.from("parcels").update({
            set("status", toStatus)
            set("storage_location_id", toLocationId)
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    /** Dokumentation (fotos + noter) for en pakke, nyeste først. */
    suspend fun parcelDocuments(parcelId: String): List<ParcelDocument> =
        supabase.from("parcel_documents")
            .select(Columns.list("id", "storage_path", "note", "created_at")) {
                filter { eq("parcel_id", parcelId) }
                order("created_at", Order.DESCENDING)
            }.decodeList()

    /** Upload et tilstandsfoto til parcel-photos-bucket'en. Sti-konvention:
     *  <company_id>/<parcel_id>/<tid>.jpg (RLS binder første mappe til tenant'en). */
    suspend fun uploadParcelPhoto(companyId: String, parcelId: String, jpeg: ByteArray): String {
        val path = "$companyId/$parcelId/${System.currentTimeMillis()}.jpg"
        supabase.storage.from("parcel-photos").upload(path, jpeg) { upsert = false }
        return path
    }

    suspend fun insertParcelDocument(row: ParcelDocumentInsert) {
        supabase.from("parcel_documents").insert(row)
    }

    /** Intake-tilstandsfoto fra Modtag-skærmen: samme sti og kolonne som webbens
     *  modtag-formular (<company_id>/<parcel_id>.jpg + condition_photo_path),
     *  så fotoet vises som pakkens tilstandsfoto på webbens pakke-detalje. */
    suspend fun uploadIntakePhoto(companyId: String, parcelId: String, jpeg: ByteArray) {
        val path = "$companyId/$parcelId.jpg"
        supabase.storage.from("parcel-photos").upload(path, jpeg) { upsert = true }
        val updated = supabase.from("parcels").update({
            set("condition_photo_path", path)
        }) {
            select(Columns.list("id"))
            filter { eq("id", parcelId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    suspend fun parcelEvents(parcelId: String): List<ParcelEvent> =
        supabase.from("parcel_events")
            .select(Columns.list("id", "event_type", "from_status", "to_status", "created_at")) {
                filter { eq("parcel_id", parcelId) }
                order("created_at", Order.DESCENDING)
                limit(20)
            }.decodeList()

    /** Underskrift → privat bucket, tenant-mappe-mønster <company_id>/<fil>. */
    suspend fun uploadSignature(companyId: String, parcelId: String, png: ByteArray): String {
        val path = "$companyId/$parcelId-${System.currentTimeMillis()}.png"
        supabase.storage.from("signatures").upload(path, png) { upsert = true }
        return path
    }

    // ---------- lager ----------

    suspend fun findInventoryItem(companyId: String, code: String): InventoryItem? =
        supabase.from("inventory_items")
            .select(Columns.list("id", "name", "sku", "quantity", "unit", "reorder_point", "location_id")) {
                filter {
                    eq("company_id", companyId)
                    eq("is_active", true)
                    eq("sku", code)
                }
                limit(5)
            }.decodeList<InventoryItem>().firstOrNull()

    suspend fun setInventoryQuantity(itemId: String, quantity: Double) {
        val updated = supabase.from("inventory_items").update({
            set("quantity", quantity)
        }) {
            select(Columns.list("id"))
            filter { eq("id", itemId) }
        }.decodeList<IdRow>()
        requireUpdated(updated)
    }

    suspend fun assetLocations(companyId: String): List<AssetLocation> =
        supabase.from("asset_locations")
            .select(Columns.list("id", "name")) { filter { eq("company_id", companyId) } }
            .decodeList()

    /** Aktiv-kategorier (stamdata) — valgfri ved oprettelse af et nyt aktiv. */
    suspend fun assetCategories(companyId: String): List<AssetCategory> =
        supabase.from("asset_categories")
            .select(Columns.list("id", "name")) {
                filter { eq("company_id", companyId) }
                order("name", Order.ASCENDING)
            }.decodeList()

    // ---------- aktiver ----------
    //
    // Flow-handlingerne (tjek ud/ind, flyt, udlån) går gennem SECURITY
    // DEFINER-RPC'er, der gentjekker rettigheder server-side og skriver
    // hændelsen i den immutable asset_events-log — aldrig direkte
    // status-skrivninger fra terminalen (jf. 20260801090200_asset_flow_rpcs).

    /** Opslag på identifikator: stregkode, serienummer ELLER aktiv-nr. — alle
     *  tre skal virke (spec). Flere træffere kan forekomme (serienumre er ikke
     *  garanteret unikke); kalderen vælger. */
    suspend fun findAssets(companyId: String, code: String): List<Asset> =
        supabase.from("assets")
            .select(
                Columns.list(
                    "id", "company_id", "asset_tag", "name", "serial_no", "barcode",
                    "status", "condition", "is_active", "location_id", "assigned_to_employee_id",
                ),
            ) {
                filter {
                    eq("company_id", companyId)
                    or {
                        eq("barcode", code)
                        eq("serial_no", code)
                        eq("asset_tag", code)
                    }
                }
                order("name", Order.ASCENDING)
                limit(10)
            }.decodeList()

    /** Opret et nyt aktiv fra terminalen. Går gennem create_asset_handheld
     *  (SECURITY DEFINER), fordi selve registeret er manager-territorium:
     *  RPC'en kan KUN oprette, og gentjekker flow-rollerne server-side.
     *  Aktiv-nr. tildeles af serveren og kommer retur, så skærmen kan vise det. */
    suspend fun createAsset(
        companyId: String,
        name: String,
        serialNo: String?,
        barcode: String?,
        categoryId: String?,
        locationId: String?,
    ): CreatedAsset? =
        supabase.postgrest.rpc(
            "create_asset_handheld",
            buildJsonObject {
                put("p_company_id", companyId)
                put("p_name", name)
                if (!serialNo.isNullOrBlank()) put("p_serial_no", serialNo)
                if (!barcode.isNullOrBlank()) put("p_barcode", barcode)
                if (categoryId != null) put("p_category_id", categoryId)
                if (locationId != null) put("p_location_id", locationId)
            },
        ).decodeList<CreatedAsset>().firstOrNull()

    /** Tjek ud: fast tildeling til en medarbejder (in_stock → assigned). */
    suspend fun checkoutAsset(assetId: String, employeeId: String, note: String?) {
        supabase.postgrest.rpc(
            "checkout_asset",
            buildJsonObject {
                put("p_asset_id", assetId)
                put("p_employee_id", employeeId)
                if (!note.isNullOrBlank()) put("p_note", note)
            },
        )
    }

    /** Udlån til en medarbejder fra kartoteket (in_stock → on_loan). Kontakt-
     *  oplysninger snapshottes server-side fra medarbejderen. Udløbet følger
     *  platformens standard (locker_loan_ttl_hours — samme startværdi som
     *  webbens udlånsdialog), så påmindelses-maskineriet også dækker
     *  terminal-udlån; uden udløb ville lånet aldrig blive overskredet og
     *  dispatcheren aldrig minde nogen om det. null-standard = intet udløb. */
    suspend fun lendAssetToEmployee(assetId: String, employeeId: String, note: String?) {
        val ttlHours = supabase.from("platform_settings")
            .select(Columns.list("locker_loan_ttl_hours")) { limit(1) }
            .decodeList<PlatformLoanTtlRow>()
            .firstOrNull()?.locker_loan_ttl_hours
        supabase.postgrest.rpc(
            "lend_asset",
            buildJsonObject {
                put("p_asset_id", assetId)
                put("p_employee_id", employeeId)
                if (ttlHours != null) put("p_ttl_hours", ttlHours)
                if (!note.isNullOrBlank()) put("p_note", note)
            },
        )
    }

    /** Tjek ind: aktivet er tilbage på lager (lukker evt. åbent udlån). */
    suspend fun checkinAsset(assetId: String, locationId: String?, condition: String?, note: String?) {
        supabase.postgrest.rpc(
            "checkin_asset",
            buildJsonObject {
                put("p_asset_id", assetId)
                if (locationId != null) put("p_location_id", locationId)
                if (!condition.isNullOrBlank()) put("p_condition", condition)
                if (!note.isNullOrBlank()) put("p_note", note)
            },
        )
    }

    /** Flyt: ny placering, status uændret. */
    suspend fun moveAsset(assetId: String, locationId: String, note: String?) {
        supabase.postgrest.rpc(
            "move_asset",
            buildJsonObject {
                put("p_asset_id", assetId)
                put("p_location_id", locationId)
                if (!note.isNullOrBlank()) put("p_note", note)
            },
        )
    }

    /** Dokumentation (fotos + noter) for et aktiv, nyeste først. */
    suspend fun assetDocuments(assetId: String): List<AssetDocument> =
        supabase.from("asset_documents")
            .select(Columns.list("id", "storage_path", "note", "created_at")) {
                filter { eq("asset_id", assetId) }
                order("created_at", Order.DESCENDING)
            }.decodeList()

    /** Upload et aktiv-foto til asset-photos-bucket'en. Sti-konvention:
     *  <company_id>/<asset_id>/<tid>.jpg (RLS binder første mappe til tenant'en). */
    suspend fun uploadAssetPhoto(companyId: String, assetId: String, jpeg: ByteArray): String {
        val path = "$companyId/$assetId/${System.currentTimeMillis()}.jpg"
        supabase.storage.from("asset-photos").upload(path, jpeg) { upsert = false }
        return path
    }

    suspend fun insertAssetDocument(row: AssetDocumentInsert) {
        supabase.from("asset_documents").insert(row)
    }

    // ---------- ruter ----------

    suspend fun routes(companyId: String): List<RouteRow> =
        supabase.from("routes")
            .select(
                Columns.list(
                    "id", "name", "description", "from_address", "to_address",
                    "stops", "round_trip", "transport_type",
                ),
            ) {
                filter {
                    eq("company_id", companyId)
                    eq("is_active", true)
                }
                order("name", Order.ASCENDING)
            }.decodeList()

    // ---------- AI-label-læsning ----------

    /** Modeller der kan læse billeder — spejler `vision` i web/src/lib/ai.ts og
     *  kataloget i edge-funktionen ai-read-label. Bruges kun til at afgøre om
     *  AI-knappen vises; serveren genchecker alligevel. */
    private val AI_VISION_MODELS = setOf(
        "claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "claude-fable-5",
        "gemini-3.6-flash", "gemini-3.5-flash",
        "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview",
        "mistral-ocr-latest",
    )

    /**
     * Virksomhedens AI-opsætning. Kæden er den samme som serverens: platformens
     * hovedafbryder → kundens valg inden for udvalget → vision-model → kundens
     * bekræftelse af oplysningen om hvad der sendes hvorhen (GDPR; edge-
     * funktionen afviser ellers med 'not_accepted').
     *
     * Fejler et opslag (offline), er svaret "ikke tilgængelig" — knappen skjules
     * frem for at fejle ved tryk — mens fortolkningslaget antages TIL, samme
     * standard som kolonnen, så en netværksfejl ikke stille slår hjælpen fra.
     */
    suspend fun aiLabelSetup(companyId: String): AiSetup {
        val off = AiSetup(available = false, matchEnabled = true, provider = null)
        val platform = runCatching {
            supabase.from("platform_settings")
                .select(Columns.list("ai_enabled", "ai_providers", "ai_models")) { limit(1) }
                .decodeList<PlatformAiRow>().firstOrNull()
        }.getOrNull() ?: return off
        val cfg = runCatching {
            supabase.from("company_ai_config")
                .select(
                    Columns.list("provider", "model", "match_enabled", "disclosure_accepted"),
                ) {
                    filter { eq("company_id", companyId) }
                    limit(1)
                }
                .decodeList<CompanyAiRow>().firstOrNull()
        }.getOrNull() ?: return off
        val provider = cfg.provider
        val model = cfg.model
        val available = platform.ai_enabled == true &&
            provider != null &&
            model != null &&
            model in AI_VISION_MODELS &&
            provider in platform.ai_providers.orEmpty() &&
            model in platform.ai_models.orEmpty() &&
            cfg.disclosure_accepted
        return AiSetup(available = available, matchEnabled = cfg.match_enabled, provider = provider)
    }

    /**
     * Fortolk de AI-aflæste navne mod virksomhedens egne data: dansk foldning
     * (æ/ø/å) + fuzzy-lighed, så "AAse Østergård" og "Åse Ostergård" finder
     * Åse Østergård, og "PostNorb" finder PostNord.
     *
     * Reglerne ligger i databasen (RPC ai_match_label_fields), IKKE her —
     * webben og terminalen skal træffe præcis samme valg. Fejler kaldet,
     * returneres null — IKKE et tomt resultat: et tomt resultat betyder "intet
     * match, udfyld ikke", mens en fejl betyder "fald tilbage til de gamle
     * eksakte regler". Blandes de to, slår en forbigående netværksfejl al
     * auto-udfyldning fra.
     */
    suspend fun matchLabelFields(
        companyId: String,
        receiver: String?,
        carrier: String?,
        sender: String?,
    ): LabelMatch? = runCatching {
        supabase.postgrest.rpc(
            "ai_match_label_fields",
            buildJsonObject {
                put("p_company_id", companyId)
                if (!receiver.isNullOrBlank()) put("p_receiver", receiver.trim())
                if (!carrier.isNullOrBlank()) put("p_carrier", carrier.trim())
                if (!sender.isNullOrBlank()) put("p_sender", sender.trim())
            },
        ).decodeAs<LabelMatch>()
    }.getOrNull()

    private val aiJson = Json { ignoreUnknownKeys = true }

    /**
     * Læs en pakkelabel med kundens valgte AI-model. Selve AI-kaldet sker i
     * edge-funktionen ai-read-label (API-nøglen findes kun på serveren);
     * appen sender blot et nedskaleret JPEG som base64.
     *
     * Serveren logger hver aflæsning (ai.label_read) med virksomhed, bruger,
     * udbyder, model og udfald — "source" fortæller at den kom herfra.
     */
    suspend fun aiReadLabel(jpeg: ByteArray): AiLabelResult {
        val b64 = android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP)
        val response = supabase.functions.invoke("ai-read-label") {
            setBody(
                buildJsonObject {
                    put("image", b64)
                    put("mediaType", "image/jpeg")
                    put("source", "handheld")
                },
            )
            contentType(ContentType.Application.Json)
        }
        val obj = aiJson.parseToJsonElement(response.bodyAsText()).jsonObject
        val ok = obj["ok"]?.jsonPrimitive?.content == "true"
        if (!ok) return AiLabelResult(fields = null, reason = obj["reason"]?.jsonPrimitive?.content)
        val fields = obj["fields"]?.let { aiJson.decodeFromJsonElement<AiLabelFields>(it) }
        return AiLabelResult(fields = fields, reason = null)
    }

    private fun nowIso(): String =
        java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).toString()
}
