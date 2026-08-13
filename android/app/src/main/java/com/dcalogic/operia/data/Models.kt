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
    val phone: String? = null,
    val department_id: String? = null,
)

/** Virksomhedens notifikations-override (null = arv platformens standard). */
@Serializable
data class CompanyNotifyRow(
    val notify_email_enabled: Boolean? = null,
    val notify_sms_enabled: Boolean? = null,
    val parcel_arrival_enabled: Boolean? = null,
)

/** Tilladte login-metoder. Læses både fra platform_settings (standard) og
 *  companies (override, null = arv). Effektiv værdi = platform AND
 *  coalesce(firma, true) — et firma kan indsnævre, aldrig udvide. */
@Serializable
data class LoginMethodsRow(
    val login_password_enabled: Boolean? = null,
    val login_biometric_enabled: Boolean? = null,
    /** Minutters inaktivitet før terminalen kræver login igen. 0 = aldrig;
     *  null på firma-rækken = arv platformens værdi. */
    val handheld_reauth_minutes: Int? = null,
)

/** Platformens standard-udløb for udlån (platform_settings, singleton).
 *  null = udlån uden udløb (og dermed uden påmindelser). */
@Serializable
data class PlatformLoanTtlRow(
    val locker_loan_ttl_hours: Int? = null,
)

/** Platformens notifikations-standarder (singleton-rækken i platform_settings). */
@Serializable
data class PlatformNotifyRow(
    val notify_email_enabled: Boolean = true,
    val notify_sms_enabled: Boolean = false,
    val parcel_notifications_enabled: Boolean = false,
    val parcel_arrival_enabled: Boolean = true,
)

/** Effektive ankomstbesked-indstillinger (override ?? platform, SMS kræver
 *  sms_notifications-tilvalget) — bruges kun til intake-advarslen "modtageren
 *  kan ikke få besked". Selve afsendelsen afgøres server-side af dispatcheren. */
data class NotifyPrefs(
    val arrivalActive: Boolean,
    val emailOn: Boolean,
    val smsOn: Boolean,
)

@Serializable
data class StorageLocation(val id: String, val name: String, val barcode: String? = null)

@Serializable
data class Carrier(val id: String, val name: String)

@Serializable
data class HandlingClass(val id: String, val name: String)

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
    val batch_id: String? = null,
)

/** En batch samler flere pakker til ÉN modtager (kurv fra fragtmanden). Én
 *  besked sendes, og hele batchen kan udleveres/afvises ved at scanne én pakke
 *  eller batch-labelen (batch_code, OPB-…). */
@Serializable
data class ParcelBatch(
    val id: String,
    val company_id: String,
    val batch_code: String,
    val receiver_employee_id: String? = null,
    val department_id: String? = null,
    val status: String = "open",
)

/** Insert-payload: batch_code genereres server-side af parcel_batches_guard.
 *  Status 'finished' ⇒ batchen er klar til notifikation + label. */
@Serializable
data class ParcelBatchInsert(
    val company_id: String,
    val receiver_employee_id: String,
    val department_id: String? = null,
    val status: String = "finished",
    val created_by: String? = null,
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
    val sender: String? = null,
    val department_id: String? = null,
    val storage_location_id: String? = null,
    val carrier_id: String? = null,
    val handling_class_id: String? = null,
    val condition_note: String? = null,
    val registered_by: String? = null,
    val client_key: String? = null,
    // Sat i batch-tilstand: parcels_guard tvinger modtageren = batchens modtager.
    val batch_id: String? = null,
)

@Serializable
data class ParcelDocument(
    val id: String,
    val storage_path: String,
    val note: String? = null,
    val created_at: String? = null,
)

@Serializable
data class ParcelDocumentInsert(
    val parcel_id: String,
    val company_id: String,
    val storage_path: String,
    val note: String? = null,
    val created_by: String? = null,
)

@Serializable
data class CompanyFeature(val feature_key: String, val valid_until: String? = null)

@Serializable
data class CompanyProduct(val product_key: String, val valid_until: String? = null)

/** Appens faste navn og accentfarve. Kunde-white-labeling (product_appearance)
 *  er fjernet 2026-07-28 sammen med Logo/Udseende-siderne i webben. */
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
    /** Kun for gruppe-fliser: børnefliserne vist på undersiden (rækkefølge +
     *  overstyringer). Spejler `children` i web/src/lib/handheld-tiles.ts. */
    val children: List<HandheldTileCfg>? = null,
)

/** Indholdselementer + ikon-tema. */
@Serializable
data class HandheldDesignCfg(
    val iconTheme: String = "happy",
    /** Enhedens farvetema (baggrund/panel/tekst). Spejler HANDHELD_PALETTES i
     *  web/src/lib/handheld-tiles.ts og Theme.kt. Tom/ukendt = "midnight" (enhedens
     *  oprindelige farver). */
    val theme: String = "midnight",
    val welcomeTitle: String = "",
    // Titel-linjen er tændt som standard: med tom welcomeTitle falder den tilbage
    // til brugerens fornavn, så en virksomhed der aldrig har rørt handheld-
    // designet stadig får den personlige hilsen (ellers forsvandt navnet helt).
    val welcomeTitleEnabled: Boolean = true,
    val subtitle: String = "",
    val subtitleEnabled: Boolean = true,
    /** Rækkefølgen af hilsen-elementerne (undertitel/titel). */
    val greetingOrder: List<String> = listOf("subtitle", "title"),
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

// ---------- aktiver ----------

@Serializable
data class Asset(
    val id: String,
    val company_id: String,
    val asset_tag: String? = null,
    val name: String,
    val serial_no: String? = null,
    val barcode: String? = null,
    val status: String,
    val condition: String? = null,
    val is_active: Boolean = true,
    val location_id: String? = null,
    val assigned_to_employee_id: String? = null,
)

@Serializable
data class AssetCategory(val id: String, val name: String)

/** Retur fra create_asset_handheld: aktivets id + det servertildelte Aktiv-nr. */
@Serializable
data class CreatedAsset(val id: String, val asset_tag: String? = null)

@Serializable
data class AssetDocument(
    val id: String,
    // Nullable i modsætning til pakkernes: en post kan være en ren note.
    val storage_path: String? = null,
    val note: String? = null,
    val created_at: String? = null,
)

@Serializable
data class AssetDocumentInsert(
    val asset_id: String,
    val company_id: String,
    val storage_path: String? = null,
    val note: String? = null,
    val created_by: String? = null,
)

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

// ---------- AI-label-læsning ----------

/** Felterne edge-funktionen ai-read-label kan udtrække af en pakkelabel.
 *  Spejler LABEL_SCHEMA i supabase/functions/ai-read-label/index.ts. */
@Serializable
data class AiLabelFields(
    val receiver_name: String? = null,
    val receiver_address: String? = null,
    val receiver_phone: String? = null,
    val sender_name: String? = null,
    val sender_address: String? = null,
    val sender_phone: String? = null,
    val carrier: String? = null,
    val service: String? = null,
    val tracking_number: String? = null,
    val reference: String? = null,
    val weight_kg: Double? = null,
    val label_date: String? = null,
)

/** Svar fra ai-read-label: felter ved succes, ellers en maskin-læsbar årsag. */
data class AiLabelResult(val fields: AiLabelFields?, val reason: String?)

@Serializable
data class PlatformAiRow(
    val ai_enabled: Boolean? = null,
    val ai_providers: List<String>? = null,
    val ai_models: List<String>? = null,
)

@Serializable
data class CompanyAiRow(
    val provider: String? = null,
    val model: String? = null,
    // Fortolkningslaget: skal AI-aflæste navne matches mod virksomhedens egne
    // data (dansk foldning + fuzzy)? Slået fra ⇒ som før, kun entydige match.
    val match_enabled: Boolean = true,
    // Har virksomheden bekræftet oplysningen om hvad der sendes til hvilken
    // udbyder (Konfigurér → Integrationer)? Uden den afviser edge-funktionen
    // aflæsningen ('not_accepted'), så knappen skal heller ikke vises her.
    val disclosure_accepted: Boolean = false,
)

/** Virksomhedens AI-opsætning som skærmene bruger den: kan vi scanne, skal
 *  navnene fortolkes, og HVEM sendes labelfotoet til (oplysningslinjen). */
data class AiSetup(
    val available: Boolean,
    val matchEnabled: Boolean,
    val provider: String?,
)

// ---------- Fortolkningslag over AI-aflæsningen (RPC ai_match_label_fields) --

/** Én medarbejder-kandidat med score 0–1. */
@Serializable
data class MatchedEmployee(
    val id: String,
    val full_name: String,
    val initials: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val department_id: String? = null,
    val department_name: String? = null,
    val score: Double = 0.0,
)

@Serializable
data class MatchedCarrier(val id: String, val name: String, val score: Double = 0.0)

@Serializable
data class MatchedSender(val name: String, val score: Double = 0.0)

/** Ét felts resultat: `auto` = ét entydigt match klienten må udfylde direkte,
 *  ellers er kandidaterne forslag et menneske skal vælge imellem. */
@Serializable
data class MatchField<T>(
    val raw: String? = null,
    val auto: Boolean = false,
    val candidates: List<T> = emptyList(),
)

@Serializable
data class LabelMatch(
    val receiver: MatchField<MatchedEmployee>? = null,
    val carrier: MatchField<MatchedCarrier>? = null,
    val sender: MatchField<MatchedSender>? = null,
)
