// Genererer Android VectorDrawables ud fra PRÆCIS de lucide-ikoner webben
// bruger (samme node_modules-pakke), så handheld'ens "desktop"-ikontema viser
// nøjagtig de samme ikoner som skrivebordsappen — ikke blot noget der ligner.
//
// Kør: node scripts/gen-lucide-android-icons.mjs   (fra web/)
import { writeFileSync } from 'node:fs'

// Ikonnøgle → lucide-modulnavn. Skal matche HANDHELD_ICONS i
// web/src/lib/handheld-tiles.ts.
const MAP = {
  // skrivebordsappens egne ikoner (nav.ts) — handheld'ens standardfliser
  'parcel-add': 'package-plus',
  'parcel-check': 'package-check',
  'parcel-in': 'package',
  'parcel-out': 'upload',
  search: 'search',
  map: 'map',
  stock: 'archive',
  inbox: 'inbox',
  scan: 'scan-line',
  barcode: 'qr-code',
  truck: 'truck',
  route: 'route',
  boxes: 'boxes',
  warehouse: 'warehouse',
  delivered: 'package-check',
  signature: 'signature',
  handover: 'handshake',
  list: 'clipboard-list',
  bell: 'bell',
}

const num = (v) => Number(v)
const pts = (s) => String(s).trim().split(/[\s,]+/).map(Number)

// Android VectorDrawable kan kun <path>, så lucides øvrige SVG-elementer
// konverteres til pathData.
function toPath(type, a) {
  switch (type) {
    case 'path':
      return a.d
    case 'line':
      return `M${num(a.x1)},${num(a.y1)} L${num(a.x2)},${num(a.y2)}`
    case 'polyline':
    case 'polygon': {
      const p = pts(a.points)
      let d = `M${p[0]},${p[1]}`
      for (let i = 2; i < p.length; i += 2) d += ` L${p[i]},${p[i + 1]}`
      return type === 'polygon' ? d + ' Z' : d
    }
    case 'circle': {
      const cx = num(a.cx), cy = num(a.cy), r = num(a.r)
      // to halvbuer = hel cirkel
      return `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`
    }
    case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry)
      return `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`
    }
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height)
      const rx = a.rx != null ? num(a.rx) : 0
      const ry = a.ry != null ? num(a.ry) : rx
      if (!rx && !ry) return `M${x},${y} H${x + w} V${y + h} H${x} Z`
      return (
        `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0,1 ${x + w},${y + ry} ` +
        `V${y + h - ry} A${rx},${ry} 0 0,1 ${x + w - rx},${y + h} H${x + rx} ` +
        `A${rx},${ry} 0 0,1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0,1 ${x + rx},${y} Z`
      )
    }
    default:
      throw new Error(`uhåndteret SVG-element: ${type}`)
  }
}

const OUT = new URL('../../android/app/src/main/res/drawable', import.meta.url).pathname
let count = 0
const kinds = new Set()

for (const [key, mod] of Object.entries(MAP)) {
  const { __iconNode } = await import(new URL(`../node_modules/lucide-react/dist/esm/icons/${mod}.mjs`, import.meta.url).href)
  const paths = __iconNode.map(([type, attrs]) => {
    kinds.add(type)
    return toPath(type, attrs)
  })
  // Lucide-stil: stroke 2, runde hjørner/ender, ingen fyld, viewBox 24x24.
  // strokeColor er sort og opak, så Compose' Icon(tint=…) kan farve den om.
  const body = paths
    .map(
      (d) =>
        `    <path\n` +
        `        android:pathData="${d}"\n` +
        `        android:strokeColor="#FF000000"\n` +
        `        android:strokeWidth="2"\n` +
        `        android:strokeLineCap="round"\n` +
        `        android:strokeLineJoin="round"\n` +
        `        android:fillColor="#00000000" />`,
    )
    .join('\n')
  const xml =
    `<!-- Genereret fra lucide-react (ISC) — samme ikon som skrivebordsappen.\n` +
    `     Rediger ikke i hånden: kør generatoren igen (web/scripts/gen-lucide-android-icons.mjs). Nøgle: ${key} → ${mod} -->\n` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
    `    android:width="24dp"\n` +
    `    android:height="24dp"\n` +
    `    android:viewportWidth="24"\n` +
    `    android:viewportHeight="24">\n${body}\n</vector>\n`
  const file = `${OUT}/ic_lucide_${key.replace(/-/g, '_')}.xml`
  writeFileSync(file, xml)
  count++
}
console.log(`skrev ${count} drawables`)
console.log('elementtyper set:', [...kinds].join(', '))
