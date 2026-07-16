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

    // ---------- bootstrap ----------

    suspend fun currentAppUser(): AppUser? {
        val uid = supabase.auth.currentUserOrNull()?.id ?: return null
        return supabase.from("app_users")
            .select { filter { eq("user_id", uid) }; limit(1) }
            .decodeList<AppUser>()
            .firstOrNull()
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

    suspend fun moveParcel(parcelId: String, toLocationId: String, toStatus: String = "in_storage") {
        val updated = supabase.from("parcels").update({
            set("storage_location_id", toLocationId)
            set("status", toStatus)
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
