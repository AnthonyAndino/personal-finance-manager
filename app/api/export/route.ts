import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import sharp from "sharp"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { getDefaultRate } from "@/lib/currency"
import { sanitizeExcelCell } from "@/lib/sanitize"

// ─── HELPERS ─────────────────────────────────

interface TxLike {
  amount: { toNumber(): number }
  currency: string
  exchangeRate: { toNumber(): number } | null
}

function toLempiras(t: TxLike, defaultRate: number): number {
  const raw = t.amount.toNumber()
  if (t.currency === "$") return raw * (t.exchangeRate?.toNumber() ?? defaultRate)
  return raw
}

function sumByCurrency(txs: TxLike[], currency: "$" | "L"): number {
  return txs
    .filter((t) => t.currency === currency)
    .reduce((s, t) => s + t.amount.toNumber(), 0)
}

function currencySymbol(t: TxLike): string {
  return t.currency === "$" ? "$" : "L"
}

const USD_FMT = '"$"#,##0.00'
const LPS_FMT = '"L"#,##0.00'

function formatTotalsSubtitle(txs: TxLike[]): string {
  const totalUsd = sumByCurrency(txs, "$")
  const totalLps = sumByCurrency(txs, "L")
  const parts = [`${txs.length} transacciones`]
  if (totalUsd > 0) {
    parts.push(`USD: $${totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
  }
  if (totalLps > 0) {
    parts.push(`LPS: L${totalLps.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
  }
  return parts.join("  •  ")
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// ─── CHART COLORS ────────────────────────────

const CHART_COLORS = [
  "#2563EB", "#059669", "#DC2626", "#F59E0B", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
]

// ─── SVG CHART GENERATORS (with inline labels) ─

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle - Math.PI / 2),
    y: cy + r * Math.sin(angle - Math.PI / 2),
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function truncateLabel(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function formatChartUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatChartLps(n: number): string {
  return `L${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function categoryAmountLabel(cat: CategorySplit): string {
  const parts: string[] = []
  if (cat.usd > 0) parts.push(formatChartUsd(cat.usd))
  if (cat.lps > 0) parts.push(formatChartLps(cat.lps))
  return parts.join(" · ") || "—"
}

/** Donut chart with category labels and legend baked into the image */
function generateDonutSVG(categories: CategorySplit[]): string {
  const width = 520
  const height = Math.max(300, 56 + categories.length * 28)
  const cx = 155
  const cy = height / 2
  const outerR = 115
  const innerR = 65
  const segments = categories.map((c) => ({ label: c.label, value: c.valueL, color: c.color }))
  const total = segments.reduce((s, seg) => s + seg.value, 0)

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="white" rx="8"/>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="14" fill="#94A3B8">Sin gastos este mes</text>
    </svg>`
  }

  let currentAngle = 0
  const paths: string[] = []
  const sliceLabels: string[] = []

  segments.forEach((seg) => {
    const sliceAngle = (seg.value / total) * Math.PI * 2
    if (sliceAngle < 0.005) { currentAngle += sliceAngle; return }

    const startAngle = currentAngle
    const endAngle = currentAngle + sliceAngle
    const outerStart = polarToCartesian(cx, cy, outerR, startAngle)
    const outerEnd = polarToCartesian(cx, cy, outerR, endAngle)
    const innerStart = polarToCartesian(cx, cy, innerR, endAngle)
    const innerEnd = polarToCartesian(cx, cy, innerR, startAngle)
    const largeArc = sliceAngle > Math.PI ? 1 : 0

    const d = [
      `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
      `Z`,
    ].join(" ")

    paths.push(`<path d="${d}" fill="${seg.color}" />`)

    const pct = (seg.value / total) * 100
    if (pct >= 8) {
      const midAngle = startAngle + sliceAngle / 2
      const labelR = (outerR + innerR) / 2
      const pos = polarToCartesian(cx, cy, labelR, midAngle)
      sliceLabels.push(
        `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 4).toFixed(1)}" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="10" font-weight="bold" fill="white">${escapeXml(truncateLabel(seg.label, 10))}</text>`,
        `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 10).toFixed(1)}" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="9" fill="white">${pct.toFixed(0)}%</text>`,
      )
    }

    currentAngle = endAngle
  })

  const legendX = 300
  let legendY = 36
  const legendItems = categories.map((cat) => {
    const pct = total > 0 ? (cat.valueL / total) * 100 : 0
    const y = legendY
    legendY += 28
    return `
      <rect x="${legendX}" y="${y - 10}" width="12" height="12" rx="2" fill="${cat.color}" />
      <text x="${legendX + 18}" y="${y}" font-family="Calibri, Arial, sans-serif" font-size="11" font-weight="bold" fill="#334155">${escapeXml(truncateLabel(cat.label))}</text>
      <text x="${legendX + 18}" y="${y + 14}" font-family="Calibri, Arial, sans-serif" font-size="9" fill="#64748B">${escapeXml(categoryAmountLabel(cat))} · ${pct.toFixed(1)}%</text>
    `
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="white" rx="8" />
    <text x="${legendX}" y="22" font-family="Calibri, Arial, sans-serif" font-size="12" font-weight="bold" fill="#0F172A">Gastos por categoría</text>
    ${paths.join("\n")}
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="white" />
    ${sliceLabels.join("\n")}
    ${legendItems.join("\n")}
  </svg>`
}

/** Bar chart with value and category labels inside the image */
function generateBarChartSVG(
  data: { label: string; value: number; color: string; fmt?: string }[],
): string {
  const width = 480
  const height = 300
  const chartLeft = 50
  const chartRight = width - 30
  const chartTop = 50
  const chartBottom = height - 55
  const chartHeight = chartBottom - chartTop
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const barWidth = Math.min(72, ((chartRight - chartLeft) / data.length) * 0.55)
  const totalBarsWidth = barWidth * data.length
  const gap = ((chartRight - chartLeft) - totalBarsWidth) / (data.length + 1)

  const gridLines: string[] = []
  for (let i = 0; i <= 4; i++) {
    const y = chartBottom - (i / 4) * chartHeight
    gridLines.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />`)
  }

  const barsAndLabels = data.map((d, i) => {
    const barH = Math.max(6, (d.value / maxValue) * chartHeight)
    const x = chartLeft + gap + i * (barWidth + gap)
    const y = chartBottom - barH
    const valueLabel = d.fmt === "usd"
      ? formatChartUsd(d.value)
      : d.fmt === "lps"
        ? formatChartLps(d.value)
        : formatChartLps(d.value)
    const labelX = x + barWidth / 2
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${d.color}" rx="6" />
      <text x="${labelX}" y="${y - 8}" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="10" font-weight="bold" fill="${d.color}">${escapeXml(valueLabel)}</text>
      <text x="${labelX}" y="${chartBottom + 22}" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="10" font-weight="bold" fill="#334155">${escapeXml(d.label)}</text>
    `
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="white" rx="8" />
    <text x="${width / 2}" y="28" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="13" font-weight="bold" fill="#0F172A">Ingresos vs Gastos</text>
    ${gridLines.join("\n")}
    <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="#CBD5E1" stroke-width="1" />
    ${barsAndLabels.join("\n")}
  </svg>`
}

function placeChartImage(
  ws: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
  png: Buffer,
  startRow: number,
  rowSpan: number,
) {
  for (let r = startRow; r < startRow + rowSpan; r++) {
    ws.getRow(r).height = 22
  }
  const imageId = wb.addImage({ buffer: png as any, extension: "png" })
  ws.addImage(imageId, {
    tl: { col: 1, row: startRow - 1 } as ExcelJS.Anchor,
    br: { col: 7, row: startRow - 1 + rowSpan } as ExcelJS.Anchor,
    editAs: "oneCell",
  })
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ quality: 100 }).toBuffer() as unknown as Promise<Buffer>
}

// ─── STYLE CONSTANTS ─────────────────────────

const BLUE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } }
const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } }
const ZEBRA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" }
const DATA_FONT: Partial<ExcelJS.Font> = { size: 10, name: "Calibri", color: { argb: "FF334155" } }
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE2E8F0" } },
  bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
}

// ─── AGGREGATE BY CATEGORY ───────────────────

interface CategorySplit {
  label: string
  usd: number
  lps: number
  valueL: number
  color: string
}

function aggregateByCategory(
  txs: (TxLike & { category: string })[],
  defaultRate: number,
): CategorySplit[] {
  const map = new Map<string, { usd: number; lps: number }>()
  txs.forEach((t) => {
    const entry = map.get(t.category) ?? { usd: 0, lps: 0 }
    const raw = t.amount.toNumber()
    if (t.currency === "$") entry.usd += raw
    else entry.lps += raw
    map.set(t.category, entry)
  })
  return Array.from(map.entries())
    .map(([label, { usd, lps }]) => ({
      label,
      usd: Math.round(usd * 100) / 100,
      lps: Math.round(lps * 100) / 100,
      valueL: Math.round((usd * defaultRate + lps) * 100) / 100,
    }))
    .sort((a, b) => b.valueL - a.valueL)
    .map((cat, i) => ({
      ...cat,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
}

// ─── BUILD DETAIL SHEET ──────────────────────

function buildDetailSheet(
  sheet: ExcelJS.Worksheet,
  rows: (TxLike & { date: Date; category: string; description: string | null; type: string })[],
  title: string,
  headerFill: ExcelJS.Fill,
  accentColor: string,
) {
  sheet.columns = [
    { width: 4 },
    { width: 5 },
    { width: 16 },
    { width: 28 },
    { width: 42 },
    { width: 10 },
    { width: 18 },
  ]

  const totalUsd = sumByCurrency(rows, "$")
  const totalLps = sumByCurrency(rows, "L")
  const usdRows = rows.filter((t) => t.currency === "$")
  const lpsRows = rows.filter((t) => t.currency === "L")

  // Title
  sheet.mergeCells("B1:F1")
  const titleCell = sheet.getCell("B1")
  titleCell.value = title
  titleCell.font = { bold: true, size: 16, color: { argb: "FF0F172A" }, name: "Calibri" }
  sheet.getRow(1).height = 36

  // Count & totals by currency
  sheet.mergeCells("B2:F2")
  const subCell = sheet.getCell("B2")
  subCell.value = formatTotalsSubtitle(rows)
  subCell.font = { size: 11, color: { argb: "FF64748B" }, name: "Calibri" }

  // Header row
  const hRow = sheet.getRow(4)
  hRow.height = 30
  const headers = ["#", "Fecha", "Categoría", "Descripción", "Moneda", "Monto"]
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 2)
    cell.value = h
    cell.font = HEADER_FONT
    cell.fill = headerFill
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = THIN_BORDER
  })

  // Freeze header + autofilter
  sheet.views = [{ state: "frozen", ySplit: 4 }]
  sheet.autoFilter = { from: { row: 4, column: 2 }, to: { row: 4, column: 7 } }

  // Data rows
  let rowIdx = 5
  rows.forEach((t, i) => {
    const row = sheet.getRow(rowIdx)
    const sym = currencySymbol(t)

    row.getCell(2).value = i + 1
    row.getCell(2).font = { size: 9, color: { argb: "FF94A3B8" }, name: "Calibri" }
    row.getCell(2).alignment = { horizontal: "center" }

    row.getCell(3).value = formatDate(t.date)
    row.getCell(3).font = DATA_FONT
    row.getCell(3).alignment = { horizontal: "center" }

    row.getCell(4).value = sanitizeExcelCell(t.category)
    row.getCell(4).font = { ...DATA_FONT, bold: true }

    row.getCell(5).value = sanitizeExcelCell(t.description)
    row.getCell(5).font = DATA_FONT

    row.getCell(6).value = sym
    row.getCell(6).font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF64748B" } }
    row.getCell(6).alignment = { horizontal: "center" }

    row.getCell(7).value = t.amount.toNumber()
    row.getCell(7).numFmt = sym === "$" ? USD_FMT : LPS_FMT
    row.getCell(7).font = { bold: true, size: 11, color: { argb: accentColor }, name: "Calibri" }
    row.getCell(7).alignment = { horizontal: "right" }

    if (i % 2 === 1) {
      for (let c = 2; c <= 7; c++) row.getCell(c).fill = ZEBRA_FILL
    }
    for (let c = 2; c <= 7; c++) row.getCell(c).border = THIN_BORDER

    rowIdx++
  })

  // Total rows — one per currency present
  let totalRowIdx = rowIdx + 1
  const totalRows: { label: string; value: number; fmt: string }[] = []
  if (totalUsd > 0) totalRows.push({ label: "TOTAL USD", value: totalUsd, fmt: USD_FMT })
  if (totalLps > 0) totalRows.push({ label: "TOTAL LPS", value: totalLps, fmt: LPS_FMT })

  totalRows.forEach((tr) => {
    const totalRow = sheet.getRow(totalRowIdx)
    totalRow.getCell(5).value = tr.label
    totalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FF0F172A" }, name: "Calibri" }
    totalRow.getCell(5).alignment = { horizontal: "right" }
    totalRow.getCell(7).value = tr.value
    totalRow.getCell(7).numFmt = tr.fmt
    totalRow.getCell(7).font = { bold: true, size: 13, color: { argb: accentColor }, name: "Calibri" }
    totalRow.getCell(7).alignment = { horizontal: "right" }
    for (let c = 2; c <= 7; c++) {
      totalRow.getCell(c).border = {
        ...THIN_BORDER,
        top: { style: "double", color: { argb: "FF475569" } },
      }
    }
    totalRowIdx++
  })

  // Summary
  const sRow = totalRowIdx + 2
  sheet.getCell(`C${sRow}`).value = "Resumen"
  sheet.getCell(`C${sRow}`).font = { bold: true, size: 12, color: { argb: "FF0F172A" }, name: "Calibri" }
  sheet.getCell(`C${sRow + 1}`).value = "Transacciones:"
  sheet.getCell(`C${sRow + 1}`).font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
  sheet.getCell(`D${sRow + 1}`).value = rows.length
  sheet.getCell(`D${sRow + 1}`).font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF1E293B" } }

  let summaryOffset = 2
  if (usdRows.length > 0) {
    sheet.getCell(`C${sRow + summaryOffset}`).value = "Promedio USD:"
    sheet.getCell(`C${sRow + summaryOffset}`).font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
    sheet.getCell(`D${sRow + summaryOffset}`).value = totalUsd / usdRows.length
    sheet.getCell(`D${sRow + summaryOffset}`).numFmt = USD_FMT
    sheet.getCell(`D${sRow + summaryOffset}`).font = { bold: true, size: 11, name: "Calibri", color: { argb: accentColor } }
    summaryOffset++
  }
  if (lpsRows.length > 0) {
    sheet.getCell(`C${sRow + summaryOffset}`).value = "Promedio LPS:"
    sheet.getCell(`C${sRow + summaryOffset}`).font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
    sheet.getCell(`D${sRow + summaryOffset}`).value = totalLps / lpsRows.length
    sheet.getCell(`D${sRow + summaryOffset}`).numFmt = LPS_FMT
    sheet.getCell(`D${sRow + summaryOffset}`).font = { bold: true, size: 11, name: "Calibri", color: { argb: accentColor } }
  }
}

// ─── MAIN EXPORT HANDLER ─────────────────────

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"

  const withinLimit = await rateLimit(`export:${ip}`, 30, 60_000)
  if (!withinLimit.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const month = req.nextUrl.searchParams.get("month")
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Formato inválido. Usa YYYY-MM" }, { status: 400 })
  }

  const [yearStr, monthStr] = month.split("-")
  const year = parseInt(yearStr, 10)
  const monthNum = parseInt(monthStr, 10)

  const start = new Date(year, monthNum - 1, 1)
  const end = new Date(year, monthNum, 1)

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      date: { gte: start, lt: end },
    },
    orderBy: { date: "asc" },
  })

  const defaultRate = await getDefaultRate()

  const incomes = transactions.filter((t) => t.type === "income")
  const expenses = transactions.filter((t) => t.type === "expense")

  const incomeUsd = sumByCurrency(incomes, "$")
  const incomeLps = sumByCurrency(incomes, "L")
  const expenseUsd = sumByCurrency(expenses, "$")
  const expenseLps = sumByCurrency(expenses, "L")

  const totalIncomeL = incomes.reduce((s, t) => s + toLempiras(t, defaultRate), 0)
  const totalExpenseL = expenses.reduce((s, t) => s + toLempiras(t, defaultRate), 0)
  const balanceUsd = incomeUsd - expenseUsd
  const balanceLps = incomeLps - expenseLps
  const balanceL = totalIncomeL - totalExpenseL

  const expenseCategories = aggregateByCategory(expenses, defaultRate)
  const incomeCategories = aggregateByCategory(incomes, defaultRate)

  const monthName = new Date(year, monthNum - 1).toLocaleString("es-MX", {
    month: "long",
    year: "numeric",
  })

  const donutRowSpan = Math.max(16, Math.ceil(expenseCategories.length * 1.4) + 4)
  const barRowSpan = 16

  // ─── GENERATE CHART IMAGES (labels baked into PNG) ────
  const [donutPng, barPng] = await Promise.all([
    svgToPng(generateDonutSVG(expenseCategories)),
    svgToPng(
      generateBarChartSVG([
        { label: "Ingresos USD", value: incomeUsd, color: "#059669", fmt: "usd" },
        { label: "Ingresos LPS", value: incomeLps, color: "#10B981", fmt: "lps" },
        { label: "Gastos USD", value: expenseUsd, color: "#DC2626", fmt: "usd" },
        { label: "Gastos LPS", value: expenseLps, color: "#EF4444", fmt: "lps" },
      ]),
    ),
  ])

  // ─── CREATE WORKBOOK ────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = "Control de Gastos"
  wb.created = new Date()

  // ━━━ HOJA 1: RESUMEN ━━━━━━━━━━━━━━━━━━━━━━
  const ws = wb.addWorksheet("Resumen", {
    properties: { tabColor: { argb: "FF2563EB" } },
  })
  ws.columns = [
    { width: 3 },   // A - margin
    { width: 18 },  // B
    { width: 18 },  // C
    { width: 18 },  // D
    { width: 4 },   // E - spacer
    { width: 4 },   // F - color swatch
    { width: 20 },  // G - category name
    { width: 14 },  // H - USD
    { width: 14 },  // I - LPS
    { width: 10 },  // J - percentage
  ]

  let row = 2

  // ── Title ──
  ws.mergeCells(`B${row}:D${row}`)
  ws.getCell(`B${row}`).value = "Control de Gastos"
  ws.getCell(`B${row}`).font = { bold: true, size: 24, color: { argb: "FF2563EB" }, name: "Calibri" }
  ws.getRow(row).height = 44
  row++

  ws.mergeCells(`B${row}:D${row}`)
  ws.getCell(`B${row}`).value = `Reporte Mensual — ${monthName}`
  ws.getCell(`B${row}`).font = { size: 13, color: { argb: "FF64748B" }, name: "Calibri" }
  row++

  ws.mergeCells(`B${row}:D${row}`)
  ws.getCell(`B${row}`).value = `Generado: ${formatDate(new Date())}  •  ${transactions.length} movimientos`
  ws.getCell(`B${row}`).font = { italic: true, size: 10, color: { argb: "FF94A3B8" }, name: "Calibri" }
  row += 2 // blank row

  // ── Metric Cards ──
  const metrics = [
    {
      label: "Ingresos",
      usd: incomeUsd,
      lps: incomeLps,
      argb: "FF059669",
      count: incomes.length,
    },
    {
      label: "Gastos",
      usd: expenseUsd,
      lps: expenseLps,
      argb: "FFDC2626",
      count: expenses.length,
    },
    {
      label: "Balance",
      usd: balanceUsd,
      lps: balanceLps,
      argb: balanceUsd >= 0 && balanceLps >= 0 ? "FF059669" : "FFDC2626",
      count: transactions.length,
    },
  ]

  ws.getRow(row).height = 22
  ws.getRow(row + 1).height = 32
  ws.getRow(row + 2).height = 32
  ws.getRow(row + 3).height = 22

  metrics.forEach((m, i) => {
    const col = 2 + i

    ws.getCell(row, col).value = m.label
    ws.getCell(row, col).font = { bold: true, size: 10, color: { argb: "FF64748B" }, name: "Calibri" }
    ws.getCell(row, col).alignment = { horizontal: "center" }

    const usdCell = ws.getCell(row + 1, col)
    usdCell.value = m.usd
    usdCell.numFmt = USD_FMT
    usdCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.argb } }
    usdCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" }, name: "Calibri" }
    usdCell.alignment = { horizontal: "center", vertical: "middle" }

    const lpsCell = ws.getCell(row + 2, col)
    lpsCell.value = m.lps
    lpsCell.numFmt = LPS_FMT
    lpsCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.argb } }
    lpsCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" }, name: "Calibri" }
    lpsCell.alignment = { horizontal: "center", vertical: "middle" }

    for (const r of [row + 1, row + 2]) {
      ws.getCell(r, col).border = {
        top: { style: "medium", color: { argb: "FFE2E8F0" } },
        bottom: { style: "medium", color: { argb: "FFE2E8F0" } },
        left: { style: "medium", color: { argb: "FFE2E8F0" } },
        right: { style: "medium", color: { argb: "FFE2E8F0" } },
      }
    }

    ws.getCell(row + 3, col).value = `${m.count} transacciones`
    ws.getCell(row + 3, col).font = { size: 9, color: { argb: "FF94A3B8" }, name: "Calibri" }
    ws.getCell(row + 3, col).alignment = { horizontal: "center" }
  })
  row += 5 // after metrics + blank

  // ── Section: Gastos por Categoría (donut image with inline labels) ──
  ws.mergeCells(`B${row}:H${row}`)
  ws.getCell(`B${row}`).value = "Gastos por Categoría"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  const donutRow = row
  placeChartImage(ws, wb, donutPng, donutRow, donutRowSpan)
  row += donutRowSpan + 1

  // ── Section: Ingresos vs Gastos (bar chart with inline labels) ──
  ws.mergeCells(`B${row}:H${row}`)
  ws.getCell(`B${row}`).value = "Ingresos vs Gastos"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  const barRow = row
  placeChartImage(ws, wb, barPng, barRow, barRowSpan)
  row += barRowSpan + 1

  // ── Section: Desglose Completo - Gastos ──
  ws.mergeCells(`B${row}:H${row}`)
  ws.getCell(`B${row}`).value = "Desglose Completo de Gastos"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  // Table header
  const catHeaders = ["", "Categoría", "USD", "LPS", "% del Total", "Transacciones"]
  catHeaders.forEach((h, i) => {
    const cell = ws.getCell(row, 2 + i)
    cell.value = h
    cell.font = HEADER_FONT
    cell.fill = RED_FILL
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = THIN_BORDER
  })
  ws.getRow(row).height = 28
  row++

  // Table data
  expenseCategories.forEach((cat, i) => {
    const r = row + i
    const txCount = expenses.filter((t) => t.category === cat.label).length
    const pct = totalExpenseL > 0 ? (cat.valueL / totalExpenseL) * 100 : 0

    ws.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
    ws.getCell(r, 2).border = THIN_BORDER

    ws.getCell(r, 3).value = cat.label
    ws.getCell(r, 3).font = { ...DATA_FONT, bold: true }
    ws.getCell(r, 3).border = THIN_BORDER

    ws.getCell(r, 4).value = cat.usd > 0 ? cat.usd : "—"
    if (cat.usd > 0) ws.getCell(r, 4).numFmt = USD_FMT
    ws.getCell(r, 4).font = { bold: true, size: 11, color: { argb: "FFDC2626" }, name: "Calibri" }
    ws.getCell(r, 4).alignment = { horizontal: "right" }
    ws.getCell(r, 4).border = THIN_BORDER

    ws.getCell(r, 5).value = cat.lps > 0 ? cat.lps : "—"
    if (cat.lps > 0) ws.getCell(r, 5).numFmt = LPS_FMT
    ws.getCell(r, 5).font = { bold: true, size: 11, color: { argb: "FFDC2626" }, name: "Calibri" }
    ws.getCell(r, 5).alignment = { horizontal: "right" }
    ws.getCell(r, 5).border = THIN_BORDER

    ws.getCell(r, 6).value = pct / 100
    ws.getCell(r, 6).numFmt = "0.0%"
    ws.getCell(r, 6).font = DATA_FONT
    ws.getCell(r, 6).alignment = { horizontal: "center" }
    ws.getCell(r, 6).border = THIN_BORDER

    ws.getCell(r, 7).value = txCount
    ws.getCell(r, 7).font = DATA_FONT
    ws.getCell(r, 7).alignment = { horizontal: "center" }
    ws.getCell(r, 7).border = THIN_BORDER

    if (i % 2 === 1) {
      for (let c = 3; c <= 7; c++) ws.getCell(r, c).fill = ZEBRA_FILL
    }
  })
  row += expenseCategories.length + 2

  // ── Section: Desglose Completo - Ingresos ──
  ws.mergeCells(`B${row}:H${row}`)
  ws.getCell(`B${row}`).value = "Desglose Completo de Ingresos"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  catHeaders.forEach((h, i) => {
    const cell = ws.getCell(row, 2 + i)
    cell.value = h
    cell.font = HEADER_FONT
    cell.fill = BLUE_FILL
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = THIN_BORDER
  })
  ws.getRow(row).height = 28
  row++

  incomeCategories.forEach((cat, i) => {
    const r = row + i
    const txCount = incomes.filter((t) => t.category === cat.label).length
    const pct = totalIncomeL > 0 ? (cat.valueL / totalIncomeL) * 100 : 0

    ws.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
    ws.getCell(r, 2).border = THIN_BORDER

    ws.getCell(r, 3).value = cat.label
    ws.getCell(r, 3).font = { ...DATA_FONT, bold: true }
    ws.getCell(r, 3).border = THIN_BORDER

    ws.getCell(r, 4).value = cat.usd > 0 ? cat.usd : "—"
    if (cat.usd > 0) ws.getCell(r, 4).numFmt = USD_FMT
    ws.getCell(r, 4).font = { bold: true, size: 11, color: { argb: "FF1D4ED8" }, name: "Calibri" }
    ws.getCell(r, 4).alignment = { horizontal: "right" }
    ws.getCell(r, 4).border = THIN_BORDER

    ws.getCell(r, 5).value = cat.lps > 0 ? cat.lps : "—"
    if (cat.lps > 0) ws.getCell(r, 5).numFmt = LPS_FMT
    ws.getCell(r, 5).font = { bold: true, size: 11, color: { argb: "FF1D4ED8" }, name: "Calibri" }
    ws.getCell(r, 5).alignment = { horizontal: "right" }
    ws.getCell(r, 5).border = THIN_BORDER

    ws.getCell(r, 6).value = pct / 100
    ws.getCell(r, 6).numFmt = "0.0%"
    ws.getCell(r, 6).font = DATA_FONT
    ws.getCell(r, 6).alignment = { horizontal: "center" }
    ws.getCell(r, 6).border = THIN_BORDER

    ws.getCell(r, 7).value = txCount
    ws.getCell(r, 7).font = DATA_FONT
    ws.getCell(r, 7).alignment = { horizontal: "center" }
    ws.getCell(r, 7).border = THIN_BORDER

    if (i % 2 === 1) {
      for (let c = 3; c <= 7; c++) ws.getCell(r, c).fill = ZEBRA_FILL
    }
  })

  // ━━━ HOJA 2: INGRESOS ━━━━━━━━━━━━━━━━━━━━━
  const wsIncomes = wb.addWorksheet("Ingresos", {
    properties: { tabColor: { argb: "FF1E40AF" } },
  })
  buildDetailSheet(wsIncomes, incomes, `Ingresos — ${monthName}`, BLUE_FILL, "FF1D4ED8")

  // ━━━ HOJA 3: GASTOS ━━━━━━━━━━━━━━━━━━━━━━━
  const wsExpenses = wb.addWorksheet("Gastos", {
    properties: { tabColor: { argb: "FFB91C1C" } },
  })
  buildDetailSheet(wsExpenses, expenses, `Gastos — ${monthName}`, RED_FILL, "FFDC2626")

  // ─── WRITE & RESPOND ───────────────────────
  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Control-Gastos-${month}.xlsx"`,
    },
  })
}
