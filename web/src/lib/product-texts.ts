// Katalog over overskrivbare tekster ("app_labels") pr. produkt. Hver slot har en
// stabil nøgle (text_key i product_text_override), en gruppe til visuel gruppering
// og en standardtekst PR. SPROG. Kunde-overrides lægges oven på disse ved opslag,
// separat for hvert sprog — standardteksterne redigeres aldrig ind i i18n-filerne.
//
// Kilde: prototypens tekstliste. Parcels/Assets/Inventory deler samme (lager-)liste;
// Room booking har sin egen; Route planning og Shipping har ingen endnu.

// Sprog med standardtekster (svarer til app'ens locale-filer). Sprogvælgeren i
// Tekster-popup'en tilbyder disse.
export const TEXT_LANGS = ['da', 'en'] as const
export type TextLang = (typeof TEXT_LANGS)[number]

export type TextSlot = {
  key: string
  group: Record<TextLang, string>
  defaults: Record<TextLang, string>
}

// Deterministisk slug — nøglen udledes af den DANSKE (kanoniske) gruppe + label,
// så text_key er sprog-uafhængig og stabil.
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// [groupDa, groupEn, da, en] → TextSlot. key = slug(groupDa).slug(da).
function slots(rows: [string, string, string, string][]): TextSlot[] {
  return rows.map(([gDa, gEn, da, en]) => ({
    key: `${slug(gDa)}.${slug(da)}`,
    group: { da: gDa, en: gEn },
    defaults: { da, en },
  }))
}

// Lager-/varestyrings-tekster — delt af Parcels, Assets og Inventory.
const INVENTORY_SLOTS = slots([
  ['Menu', 'Menu', 'Overblik', 'Overview'],
  ['Menu', 'Menu', 'Lager', 'Stock'],
  ['Menu', 'Menu', 'Lokationer', 'Locations'],
  ['Menu', 'Menu', 'Indkøbsordrer', 'Purchase orders'],
  ['Menu', 'Menu', 'Bevægelser', 'Movements'],
  ['Menu', 'Menu', 'Rapport', 'Report'],
  ['Menu', 'Menu', 'Indstillinger', 'Settings'],
  ['Menu', 'Menu', 'Aktiver', 'Assets'],
  ['Lager', 'Stock', 'Vareindgang-knap', 'Goods-in button'],
  ['Lager', 'Stock', 'Vareudgang-knap', 'Goods-out button'],
  ['Lager', 'Stock', 'Ny vare-knap', 'New item button'],
  ['Lager', 'Stock', 'Lavt lager-badge', 'Low stock badge'],
  ['Lager', 'Stock', 'OK-badge', 'OK badge'],
  ['Lager', 'Stock', 'Genbestil-knap', 'Reorder button'],
  ['Kolonne', 'Column', 'SKU', 'SKU'],
  ['Kolonne', 'Column', 'Vare', 'Item'],
  ['Kolonne', 'Column', 'Kategori', 'Category'],
  ['Kolonne', 'Column', 'Lokation', 'Location'],
  ['Kolonne', 'Column', 'Salgspris', 'Sales price'],
  ['Kolonne', 'Column', 'Beholdning', 'On hand'],
  ['Kolonne', 'Column', 'Genbest.', 'Reorder'],
  ['Kolonne', 'Column', 'Status', 'Status'],
  ['Lokationer', 'Locations', 'Titel', 'Title'],
  ['Lokationer', 'Locations', 'Undertekst', 'Subtitle'],
  ['Lokationer', 'Locations', 'Bestil alt lavt-knap', 'Order all low button'],
  ['Varekort', 'Item card', 'Titel', 'Title'],
  ['Varekort', 'Item card', 'Navn', 'Name'],
  ['Varekort', 'Item card', 'Nummer', 'Number'],
  ['Varekort', 'Item card', 'Stregkode', 'Barcode'],
  ['Varekort', 'Item card', 'Beskrivelse', 'Description'],
  ['Varekort', 'Item card', 'Enhed', 'Unit'],
  ['Varekort', 'Item card', 'Varegruppe', 'Item group'],
  ['Varekort', 'Item card', 'Rabatgruppe', 'Discount group'],
  ['Varekort', 'Item card', 'Afdeling', 'Department'],
  ['Varekort', 'Item card', 'Standard lokation', 'Default location'],
  ['Varekort', 'Item card', 'Leverandør', 'Supplier'],
  ['Varekort', 'Item card', 'Leverandør varenr.', 'Supplier item no.'],
  ['Varekort', 'Item card', 'Variation', 'Variant'],
  ['Varekort', 'Item card', 'Priser (overskrift)', 'Prices (heading)'],
  ['Varekort', 'Item card', 'Salgspris', 'Sales price'],
  ['Varekort', 'Item card', 'Kostpris', 'Cost price'],
  ['Varekort', 'Item card', 'Vejl. salgspris', 'RRP'],
  ['Varekort', 'Item card', 'Forventet kostpris', 'Expected cost price'],
  ['Varekort', 'Item card', 'Ekstra kost', 'Extra cost'],
  ['Varekort', 'Item card', 'Avance', 'Markup'],
  ['Varekort', 'Item card', 'Dækningsgrad', 'Margin'],
  ['Varekort', 'Item card', 'Lager (overskrift)', 'Stock (heading)'],
  ['Varekort', 'Item card', 'Min. beholdning', 'Min. on hand'],
  ['Varekort', 'Item card', 'Min. bestillingsantal', 'Min. order qty'],
  ['Varekort', 'Item card', 'Min. salgsantal', 'Min. sales qty'],
  ['Varekort', 'Item card', 'Vægt', 'Weight'],
  ['Varekort', 'Item card', 'Størrelse', 'Size'],
  ['Varekort', 'Item card', 'Gem-knap', 'Save button'],
  ['Varekort', 'Item card', 'Slet-knap', 'Delete button'],
  ['Ordrer', 'Orders', 'Titel', 'Title'],
  ['Ordrer', 'Orders', 'Undertekst', 'Subtitle'],
  ['Ordrer', 'Orders', 'Modtag-knap', 'Receive button'],
  ['Ordrer', 'Orders', 'Annullér-knap', 'Cancel button'],
  ['Ordrer', 'Orders', 'Gensend-knap', 'Resend button'],
  ['Ordrer', 'Orders', 'Status Sendt', 'Status Sent'],
  ['Ordrer', 'Orders', 'Status Delvist', 'Status Partial'],
  ['Ordrer', 'Orders', 'Status Modtaget', 'Status Received'],
  ['Ordrer', 'Orders', 'Status Annulleret', 'Status Cancelled'],
  ['Ordre', 'Order', 'Send-dialog titel', 'Send dialog title'],
  ['Ordre', 'Order', 'Send-knap', 'Send button'],
  ['Bevægelse', 'Movement', 'Vareindgang', 'Goods in'],
  ['Bevægelse', 'Movement', 'Vareudgang', 'Goods out'],
  ['Bevægelse', 'Movement', 'Vare', 'Item'],
  ['Bevægelse', 'Movement', 'Antal', 'Quantity'],
])

// Room booking — egne tekster (defaults fra prototypen, engelsk + dansk).
const BOOKING_SLOTS = slots([
  ['Booking', 'Booking', '+ Ny booking', '+ New booking'],
  ['Booking', 'Booking', 'Lokaler', 'Rooms'],
  ['Booking', 'Booking', 'Bookinger', 'Bookings'],
  ['Booking', 'Booking', 'Klar til fakturering', 'Ready for invoicing'],
  ['Booking', 'Booking', 'Indstillinger', 'Settings'],
  ['Booking', 'Booking', 'Rapport', 'Report'],
  ['Booking', 'Booking', 'Bogføring', 'Accounting'],
  ['Booking', 'Booking', 'Ny booking (overskrift)', 'New booking (heading)'],
  ['Booking', 'Booking', 'Lokale', 'Room'],
  ['Booking', 'Booking', 'Navn / firma', 'Name / company'],
  ['Booking', 'Booking', 'Skift system', 'Switch system'],
  ['Booking', 'Booking', 'Adminportal', 'Admin portal'],
])

// Produktnøgle → tekst-slots. Produkter uden overskrivbare tekster udelades.
export const PRODUCT_TEXT_SLOTS: Record<string, TextSlot[]> = {
  parcels: INVENTORY_SLOTS,
  booking: BOOKING_SLOTS,
  assets: INVENTORY_SLOTS,
  lager: INVENTORY_SLOTS,
}

export function textSlotsFor(productKey: string): TextSlot[] {
  return PRODUCT_TEXT_SLOTS[productKey] ?? []
}
