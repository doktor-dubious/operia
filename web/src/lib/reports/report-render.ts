// Fælles dokumentmodel for rapporter + renderere til PDF (jspdf) og Word (docx).
// Rapportindholdet bygges én gang (report-builders.ts) og renderes identisk i
// begge formater. Bibliotekerne er tunge og importeres derfor først ved
// generering (dynamic import), så route-chunken forbliver lille.

export type ReportBlock =
  | { kind: 'kpis'; items: { label: string; value: string }[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'text'; text: string }

export type ReportSection = { heading?: string; blocks: ReportBlock[] }

export type ReportDoc = {
  title: string
  company: string
  metaLines: string[]
  footer: string
  sections: ReportSection[]
}

// Operia-navy (#13315C) bruges til titel og tabelhoveder i begge formater.
const NAVY: [number, number, number] = [19, 49, 92]
const NAVY_HEX = '13315C'

const PAGE_W = 210
const MARGIN = 15
const CONTENT_W = PAGE_W - 2 * MARGIN
const PAGE_BREAK_Y = 272

export async function renderPdf(report: ReportDoc, filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 18

  const ensure = (needed: number) => {
    if (y + needed > PAGE_BREAK_Y) {
      doc.addPage()
      y = 18
    }
  }

  // Titelblok
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...NAVY)
  doc.text(report.title, MARGIN, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(report.company, MARGIN, y)
  y += 5.5
  doc.setFontSize(9)
  doc.setTextColor(120)
  for (const line of report.metaLines) {
    doc.text(line, MARGIN, y)
    y += 4.5
  }
  y += 1
  doc.setDrawColor(210)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 7

  for (const section of report.sections) {
    if (section.heading) {
      ensure(14)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(30)
      doc.text(section.heading, MARGIN, y)
      y += 6
    }
    for (const block of section.blocks) {
      if (block.kind === 'text') {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9.5)
        doc.setTextColor(70)
        const lines = doc.splitTextToSize(block.text, CONTENT_W) as string[]
        ensure(lines.length * 4.5 + 2)
        doc.text(lines, MARGIN, y)
        y += lines.length * 4.5 + 3
      } else if (block.kind === 'kpis') {
        autoTable(doc, {
          startY: y,
          head: [block.items.map((i) => i.label)],
          body: [block.items.map((i) => i.value)],
          theme: 'plain',
          margin: { left: MARGIN, right: MARGIN },
          headStyles: { fontSize: 8, textColor: [120, 125, 122], fontStyle: 'normal', cellPadding: { bottom: 0.5, top: 1, left: 1, right: 1 } },
          bodyStyles: { fontSize: 13, fontStyle: 'bold', textColor: [25, 25, 25], cellPadding: { top: 0.5, left: 1, right: 1, bottom: 1 } },
        })
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
      } else {
        autoTable(doc, {
          startY: y,
          head: [block.columns],
          body: block.rows,
          theme: 'striped',
          margin: { left: MARGIN, right: MARGIN },
          headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
          styles: { fontSize: 8.5, cellPadding: 2.2, textColor: [35, 35, 35] },
          alternateRowStyles: { fillColor: [246, 248, 247] },
        })
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
      }
    }
  }

  // Sidefod med genereringslinje + sidetal på alle sider
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(report.footer, MARGIN, 290)
    doc.text(`${p} / ${pages}`, PAGE_W - MARGIN, 290, { align: 'right' })
  }

  doc.save(`${filename}.pdf`)
}

// CSV-eksport af rapporten: samme dokumentmodel skrevet fladt ud. Sektioner og
// blokke skrives sekventielt (overskrift, KPI'er som label/værdi-par, tabeller
// som header + rækker), adskilt af tomme linjer. UTF-8 med BOM så Excel læser
// æ/ø/å, felter citeres efter RFC 4180.
export async function renderCsv(report: ReportDoc, filename: string): Promise<void> {
  const SEP = ','
  const esc = (v: string) => {
    const s = v ?? ''
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows: string[][] = [[report.title], [report.company]]
  for (const line of report.metaLines) rows.push([line])
  rows.push([])

  for (const section of report.sections) {
    if (section.heading) rows.push([section.heading])
    for (const block of section.blocks) {
      if (block.kind === 'text') {
        rows.push([block.text])
      } else if (block.kind === 'kpis') {
        for (const item of block.items) rows.push([item.label, item.value])
      } else {
        rows.push(block.columns)
        for (const row of block.rows) rows.push(row)
      }
      rows.push([])
    }
  }
  rows.push([report.footer])

  const text = '\ufeff' + rows.map((r) => r.map(esc).join(SEP)).join('\r\n') + '\r\n'
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function renderDocx(report: ReportDoc, filename: string): Promise<void> {
  const docx = await import('docx')
  const { saveAs } = await import('file-saver')
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    Footer,
    PageNumber,
  } = docx

  // Størrelser i docx er halve punkter (size: 22 = 11 pt).
  const cell = (text: string, opts?: { bold?: boolean; color?: string; fill?: string; size?: number }) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({ text, bold: opts?.bold, color: opts?.color, size: opts?.size ?? 18 }),
          ],
        }),
      ],
      shading: opts?.fill ? { fill: opts.fill } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
    })

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      children: [new TextRun({ text: report.title, bold: true, size: 32, color: NAVY_HEX })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: report.company, size: 20, color: '555555' })],
      spacing: { after: 40 },
    }),
    ...report.metaLines.map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, size: 18, color: '777777' })],
          spacing: { after: 30 },
        }),
    ),
  ]

  for (const section of report.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: section.heading, bold: true, size: 24, color: '222222' })],
          spacing: { before: 300, after: 120 },
        }),
      )
    }
    for (const block of section.blocks) {
      if (block.kind === 'text') {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, size: 19, color: '444444' })],
            spacing: { after: 120 },
          }),
        )
      } else if (block.kind === 'kpis') {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: block.items.map((i) => cell(i.label, { fill: 'E5E7EB', size: 16 })),
              }),
              new TableRow({
                children: block.items.map((i) => cell(i.value, { bold: true, size: 24 })),
              }),
            ],
          }),
          new Paragraph({ spacing: { after: 120 } }),
        )
      } else {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: block.columns.map((c) =>
                  cell(c, { bold: true, color: 'FFFFFF', fill: NAVY_HEX }),
                ),
              }),
              ...block.rows.map((row) => new TableRow({ children: row.map((v) => cell(v)) })),
            ],
          }),
          new Paragraph({ spacing: { after: 120 } }),
        )
      }
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [
      {
        properties: {},
        children,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [new TextRun({ text: report.footer, size: 16, color: '888888' })],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '888888',
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  saveAs(blob, `${filename}.docx`)
}
