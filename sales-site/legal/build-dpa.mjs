#!/usr/bin/env node
// Bygger legal/dpa.html ud fra docs/gdpr/dpa/bilag-da.md, så den offentlige
// databehandleraftale aldrig driver fra den tekst, der ligger i repoet.
//
//   node sales-site/legal/build-dpa.mjs
//
// Lille markdown-oversætter uden afhængigheder: overskrifter, afsnit, lister,
// tabeller, blockquote, fed/kursiv/kode og links. Relative links til de
// interne docs (../ropa.md m.fl.) er ikke offentlige og skrives som ren tekst.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', '..', 'docs', 'gdpr', 'dpa', 'bilag-da.md')
const OUT = join(here, 'dpa.html')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Bilagene henviser til de øvrige GDPR-dokumenter ved filnavn, fordi de bor i
// samme mappe i repoet. Dokumenterne udleveres til kunden ved underskrift, men
// filnavnene siger en offentlig læser intet — de oversættes derfor til
// læsbare navne. Et nyt dokument uden en linje her fremgår som sit filnavn.
const DOC_NAMES = {
  '../ropa.md': 'fortegnelsen over behandlingsaktiviteter',
  '../subprocessors.md': 'fortegnelsen over underdatabehandlere',
  '../toms.md': 'beskrivelsen af tekniske og organisatoriske foranstaltninger',
  '../retention-schedule.md': 'opbevaringsoversigten',
  '../incident-response.md': 'proceduren ved brud på persondatasikkerheden',
  '../compliance-map.md': 'den tekniske dokumentation',
}
const docName = (path) => DOC_NAMES[path] ?? path

function inline(s) {
  let t = esc(s)
  // Interne dokumenthenvisninger først — både [`../x.md`](../x.md) og en bar
  // kodestump `../x.md` — så de aldrig når frem som filnavne i kode-stil.
  t = t.replace(/\[`?(\.\.\/[^\]`]+)`?\]\(\.\.\/[^)]+\)/g, (_, p) => docName(p))
  t = t.replace(/`(\.\.\/[^`]+)`/g, (_, p) => docName(p))
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Kursiverede pladsholdere *[...]* fremhæves, så de er lette at finde.
  t = t.replace(/\*(\[[^\]]+\])\*/g, '<span class="fill">$1</span>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  t = t.replace(/\[([^\]]+)\]\((\.\.\/[^)]+)\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  return t
}

const lines = readFileSync(SRC, 'utf8').split('\n')
const out = []
let i = 0
let para = []
const flush = () => {
  if (para.length) {
    out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
}

while (i < lines.length) {
  const line = lines[i]
  if (/^\s*$/.test(line)) { flush(); i++; continue }
  if (/^---\s*$/.test(line)) { flush(); i++; continue }
  const h = line.match(/^(#{1,3})\s+(.*)$/)
  if (h) {
    flush()
    // Filens H1 er sidens titel og udelades; # Bilag X → h2, ## X.n → h3.
    if (h[1].length === 1 && i === 0) { i++; continue }
    const level = h[1].length === 1 ? 2 : 3
    out.push(`<h${level}>${inline(h[2])}</h${level}>`)
    i++
    continue
  }
  if (line.startsWith('>')) {
    flush()
    const q = []
    while (i < lines.length && lines[i].startsWith('>')) {
      q.push(lines[i].replace(/^>\s?/, ''))
      i++
    }
    out.push(`<div class="note"><p>${inline(q.join(' '))}</p></div>`)
    continue
  }
  if (line.startsWith('|')) {
    flush()
    const rows = []
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i]), i++
    const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
    const body = rows.filter((r) => !/^\|\s*-+/.test(r) && !/^\|(\s*-+\s*\|)+\s*$/.test(r))
    const [head, ...rest] = body
    const headCells = cells(head)
    // Parts-tabellen i toppen har en tom headerrække (`| | |`). Uden head
    // droppes rækken helt — ellers blev den tegnet som en tom række øverst.
    const hasHead = headCells.some((c) => c !== '')
    let html = '<div class="tablewrap"><table>'
    if (hasHead) html += `<thead><tr>${headCells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
    html += '<tbody>'
    for (const r of rest) html += `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`
    html += '</tbody></table></div>'
    out.push(html)
    continue
  }
  const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
  if (li) {
    flush()
    const ordered = /\d+\./.test(li[2])
    const items = []
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
      if (m && m[1].length === li[1].length) { items.push(m[3]); i++; continue }
      // fortsættelseslinjer (indrykkede) hører til forrige punkt
      if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue }
      break
    }
    const tag = ordered ? 'ol' : 'ul'
    out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
    continue
  }
  para.push(line.trim())
  i++
}
flush()

const version = (readFileSync(SRC, 'utf8').match(/`(DCA-DPA-[\d.]+)`/) || [])[1] ?? 'DCA-DPA-1.0'

const html = `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Databehandleraftale – Operia</title>
<meta name="description" content="DCA Logics databehandleraftale for Operia: Datatilsynets standardkontraktsbestemmelser med bilag A–D (behandling, underdatabehandlere, instruks, øvrige forhold).">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="legal.css">
</head>
<body>
<main class="legal">
  <div class="legal-top">
    <a href="/">Operia</a>
    <nav>
      <a href="eula.html">Vilkår</a>
      <a href="privacy.html">Privatliv</a>
      <a href="dpa.html" aria-current="page">Databehandleraftale</a>
    </nav>
  </div>

  <h1>Databehandleraftale (DPA)</h1>
  <p class="meta">DCA Logic · bilag version <code>${version}</code> · genereret ${new Date().toISOString().slice(0, 10)}</p>

  <p>DCA Logics databehandleraftale for Operia består af to dele:</p>
  <ol>
    <li><strong>Selve bestemmelserne</strong>: <a href="https://www.datatilsynet.dk/hvad-siger-reglerne/vejledning/databehandlere/standardkontraktsbestemmelser">Datatilsynets standardkontraktsbestemmelser</a> (januar 2020), der anvendes uændret. Kundens databeskyttelsesrådgiver genkender dem, så gennemgangen kan koncentrere sig om bilagene.</li>
    <li><strong>Bilag A–D</strong>, som er DCA Logics udfyldning og gengives i fuld længde nedenfor: oplysninger om behandlingen, underdatabehandlere, instruks (herunder sikkerhed, opbevaring og lokalitet) og parternes øvrige regulering.</li>
  </ol>
  <div class="note"><p>Aftalen underskrives sammen med hovedaftalen og altid før første behandling af rigtige personoplysninger. Den underskrevne version registreres i Operia på kundens virksomhed, og kunden kan selv se registreringen under Konfigurér → Databeskyttelse. Felter markeret med gult udfyldes pr. kunde ved underskrift.</p></div>

${out.join('\n')}

  <footer>DCA Logic · <span class="fill">[CVR-nr.]</span> · Databehandleraftale, bilag ${version} ·
  Se også <a href="eula.html">vilkårene</a> og <a href="privacy.html">privatlivspolitikken</a>.</footer>
</main>
</body>
</html>
`
writeFileSync(OUT, html)
console.log(`skrev ${OUT} (${html.length} tegn, ${out.length} blokke)`)
