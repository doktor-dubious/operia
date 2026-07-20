package com.dcalogic.operia.data

import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.storage.storage
import kotlinx.serialization.Serializable

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
            .select(Columns.list("id", "full_name", "initials", "email", "department_id")) {
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

    /** White-labeling pr. produkt — håndterminalen følger 'parcels'-produktets udseende. */
    suspend fun appearance(companyId: String): ProductAppearance? =
        supabase.from("product_appearance")
            .select(Columns.list("product_key", "header_name", "header_color", "logo_url")) {
                filter {
                    eq("company_id", companyId)
                    eq("product_key", "parcels")
                }
                limit(1)
            }.decodeList<ProductAppearance>().firstOrNull()

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
     * Afvis pakke (spec §handover: modtageren nægter at modtage). Årsagen er
     * påkrævet — afvisninger er undtagelseshændelser, der havner i
     * dashboardets undtagelsesliste og eskaleres i audit-loggen, så en
     * afvisning uden begrundelse er ubrugelig for den, der skal følge op.
     * Underskrift er valgfri (samme som udlevering): modtageren står typisk
     * ved skranken og kan kvittere for selve afvisningen, men kan ikke tvinges.
     *
     * delivered_to nulstilles med vilje — ingen har modtaget pakken.
     * Tilladt fra registered/in_storage/in_transit (jf. state-maskinen i
     * parcel_transition_allowed — bemærk at in_locker IKKE må afvises).
     */
    suspend fun rejectParcel(parcelId: String, note: String, signaturePath: String?) {
        val updated = supabase.from("parcels").update({
            set("status", "rejected")
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

    private fun nowIso(): String =
        java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).toString()
}
