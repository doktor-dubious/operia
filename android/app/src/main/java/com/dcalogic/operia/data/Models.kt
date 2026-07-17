package com.dcalogic.operia.data

import kotlinx.serialization.Serializable

/**
 * DTO'er mod det rigtige Operia-skema (se web/src/lib/database.types.ts).
 * Kolonnenavne = feltnavne (ingen @SerialName-mapping nødvendig).
 */

@Serializable
data class AppUser(
    val user_id: String,
    val company_id: String,
    val full_name: String = "",
    val email: String? = null,
)

@Serializable
data class Department(val id: String, val name: String)

@Serializable
data class Employee(
    val id: String,
    val full_name: String,
    val initials: String? = null,
    val email: String? = null,
    val department_id: String? = null,
)

@Serializable
data class StorageLocation(val id: String, val name: String, val barcode: String? = null)

@Serializable
data class Parcel(
    val id: String,
    val company_id: String,
    val barcode: String? = null,
    val status: String,
    val parcel_type: String = "package",
    val receiver_employee_id: String? = null,
    val department_id: String? = null,
    val storage_location_id: String? = null,
    val sender: String? = null,
    val condition_note: String? = null,
    val registered_at: String? = null,
    val delivered_at: String? = null,
    val delivered_to: String? = null,
    val delivered_note: String? = null,
)

/** Insert-payload ved modtagelse. Status sættes af parcels_guard-triggeren
 *  (unassigned uden modtager, ellers registered). client_key er terminalens
 *  idempotens-nøgle: går svaret tabt efter serveren har committet, gør det
 *  unikke indeks (company_id, client_key) gensendingen til en dublet-fejl i
 *  stedet for en ekstra pakke. */
@Serializable
data class ParcelInsert(
    val company_id: String,
    val barcode: String,
    val receiver_employee_id: String? = null,
    val department_id: String? = null,
    val storage_location_id: String? = null,
    val condition_note: String? = null,
    val registered_by: String? = null,
    val client_key: String? = null,
)

@Serializable
data class CompanyFeature(val feature_key: String, val valid_until: String? = null)

@Serializable
data class CompanyProduct(val product_key: String, val valid_until: String? = null)

@Serializable
data class ProductAppearance(
    val product_key: String,
    val header_name: String? = null,
    val header_color: String? = null,
    val logo_url: String? = null,
)

/** Cachet branding (SharedPreferences) så login-skærmen kan vise det offline. */
@Serializable
data class Brand(val name: String = "Operia", val color: String = "#2D6FF0")

// ---------- handheld-design (Operia → Handheld-design) ----------
//
// Platformens opsætning af DENNE skærm, redigeret i webbens Operia-konfiguration
// og gemt på platform_settings.handheld_tiles/.handheld_design. Modellerne
// spejler web/src/lib/handheld-tiles.ts — feltnavne SKAL matche JSON'en dér.
// Alle felter har defaults: en tom/delvis konfiguration skal give appens
// standardudseende, ikke et crash.

/** Per-flise-overstyring. Udeladt felt = "brug standard". */
@Serializable
data class HandheldTileCfg(
    val key: String = "",
    /** Fjernet fra startskærmen. Fravær i listen betyder IKKE fjernet — det er
     *  et flag, jf. normalizeHandheldTiles i webben. */
    val enabled: Boolean? = null,
    val title: String? = null,
    val titleEnabled: Boolean? = null,
    val subtitle: String? = null,
    val subtitleEnabled: Boolean? = null,
    val icon: String? = null,
    val color: String? = null,
    val background: String? = null,
)

/** Indholdselementer + ikon-tema. */
@Serializable
data class HandheldDesignCfg(
    val iconTheme: String = "happy",
    val welcomeTitle: String = "",
    val welcomeTitleEnabled: Boolean = false,
    val subtitle: String = "",
    val subtitleEnabled: Boolean = true,
    val logoUrl: String = "",
    val logoEnabled: Boolean = false,
    val heroUrl: String = "",
    val heroEnabled: Boolean = false,
)

/** Samlet handheld-design, som det caches og læses af HomeScreen. */
@Serializable
data class HandheldConfig(
    val tiles: List<HandheldTileCfg> = emptyList(),
    val design: HandheldDesignCfg = HandheldDesignCfg(),
)

/** Rå række fra platform_settings (singleton). */
@Serializable
data class PlatformHandheldRow(
    val handheld_tiles: List<HandheldTileCfg> = emptyList(),
    val handheld_design: HandheldDesignCfg = HandheldDesignCfg(),
)

@Serializable
data class InventoryItem(
    val id: String,
    val name: String,
    val sku: String? = null,
    val quantity: Double = 0.0,
    val unit: String? = null,
    val reorder_point: Double? = null,
    val location_id: String? = null,
)

@Serializable
data class AssetLocation(val id: String, val name: String)

@Serializable
data class RouteStop(val address: String? = null, val lat: Double? = null, val lng: Double? = null)

@Serializable
data class RouteRow(
    val id: String,
    val name: String,
    val description: String? = null,
    val from_address: String? = null,
    val to_address: String? = null,
    val stops: List<RouteStop> = emptyList(),
    val round_trip: Boolean = false,
    val transport_type: String = "car",
)

@Serializable
data class ParcelEvent(
    val id: Long,
    val event_type: String,
    val from_status: String? = null,
    val to_status: String? = null,
    val created_at: String,
)
