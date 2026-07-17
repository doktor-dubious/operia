import { readFileSync, writeFileSync } from 'node:fs'
const DIR = new URL('../node_modules/@material-design-icons/svg', import.meta.url).pathname
// Ikonnøgle → Material-ikonnavn. Skal matche ICONS i HomeScreen.kt.
const MAP = {
  'parcel-add': 'add_box', 'parcel-check': 'assignment_turned_in',
  'parcel-in': 'inventory_2', 'parcel-out': 'upload', search: 'search', map: 'map',
  stock: 'archive', inbox: 'inbox', scan: 'document_scanner', barcode: 'qr_code_2',
  truck: 'local_shipping', route: 'route', boxes: 'inventory', warehouse: 'warehouse',
  delivered: 'check_circle', signature: 'draw', handover: 'handshake', list: 'list_alt',
  bell: 'notifications',
}
const grab = (variant, name) => {
  const svg = readFileSync(`${DIR}/${variant}/${name}.svg`, 'utf8')
  const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
  if (!ds.length) throw new Error(`no path in ${variant}/${name}`)
  return ds.join(' ')
}
let out = `// GENERERET — rediger ikke i hånden.\n`
out += `// Material-ikonernes path-data, udtrukket af @material-design-icons/svg, så\n`
out += `// mock-up'en i Handheld-design kan tegne PRÆCIS de ikoner Android tegner for\n`
out += `// temaerne outline/solid/mono (Compose bruger samme Material-sæt). Uden dette\n`
out += `// ville forhåndsvisningen vise lucide og enheden Material — altså lyve.\n`
out += `// Kilde: web/scripts/gen-material-icon-paths.mjs\n\n`
out += `export type MaterialIconPaths = { outlined: string; filled: string }\n\n`
out += `export const MATERIAL_ICON_PATHS: Record<string, MaterialIconPaths> = {\n`
for (const [key, name] of Object.entries(MAP)) {
  out += `  '${key}': {\n    outlined: '${grab('outlined', name)}',\n    filled: '${grab('filled', name)}',\n  },\n`
}
out += `}\n`
writeFileSync(new URL('../src/lib/material-icon-paths.ts', import.meta.url).pathname, out)
console.log('skrev material-icon-paths.ts —', Object.keys(MAP).length, 'ikoner')
