import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import sharp from "sharp"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

// ─── HELPERS ─────────────────────────────────

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

// ─── SVG CHART GENERATORS (shapes only, no text) ─

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle - Math.PI / 2),
    y: cy + r * Math.sin(angle - Math.PI / 2),
  }
}

/** Donut chart — only arcs and center hole, NO text or legend */
function generateDonutSVG(
  segments: { label: string; value: number; color: string }[],
): string {
  const size = 300
  const cx = size / 2
  const cy = size / 2
  const outerR = 130
  const innerR = 75
  const total = segments.reduce((s, seg) => s + seg.value, 0)

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="white" rx="8"/><circle cx="${cx}" cy="${cy}" r="${outerR}" fill="#F1F5F9" stroke="#E2E8F0" stroke-width="2"/></svg>`
  }

  let currentAngle = 0
  const paths: string[] = []

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
    currentAngle = endAngle
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="white" rx="8" />
    ${paths.join("\n")}
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="white" />
  </svg>`
}

/** Bar chart — only rectangles and grid lines, NO text */
function generateBarChartSVG(
  data: { label: string; value: number; color: string }[],
): string {
  const width = 380
  const height = 260
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const chartLeft = 20
  const chartRight = width - 20
  const chartTop = 20
  const chartBottom = height - 20
  const chartHeight = chartBottom - chartTop
  const barWidth = Math.min(80, ((chartRight - chartLeft) / data.length) * 0.55)
  const totalBarsWidth = barWidth * data.length
  const gap = ((chartRight - chartLeft) - totalBarsWidth) / (data.length + 1)

  // Grid lines
  const gridLines: string[] = []
  for (let i = 0; i <= 4; i++) {
    const y = chartBottom - (i / 4) * chartHeight
    gridLines.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />`)
  }

  // Bars
  const bars = data.map((d, i) => {
    const barH = Math.max(4, (d.value / maxValue) * chartHeight)
    const x = chartLeft + gap + i * (barWidth + gap)
    const y = chartBottom - barH
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${d.color}" rx="6" />`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="white" rx="8" />
    ${gridLines.join("\n")}
    <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="#CBD5E1" stroke-width="1" />
    ${bars.join("\n")}
  </svg>`
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

function aggregateByCategory(
  txs: { category: string; amount: { toNumber(): number } }[],
): { label: string; value: number; color: string }[] {
  const map = new Map<string, number>()
  txs.forEach((t) => {
    map.set(t.category, (map.get(t.category) || 0) + t.amount.toNumber())
  })
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      label,
      value: Math.round(value * 100) / 100,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
}

// ─── BUILD DETAIL SHEET ──────────────────────

function buildDetailSheet(
  sheet: ExcelJS.Worksheet,
  rows: { date: Date; category: string; description: string | null; amount: { toNumber(): number }; type: string }[],
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
    { width: 18 },
  ]

  // Title
  sheet.mergeCells("B1:E1")
  const titleCell = sheet.getCell("B1")
  titleCell.value = title
  titleCell.font = { bold: true, size: 16, color: { argb: "FF0F172A" }, name: "Calibri" }
  sheet.getRow(1).height = 36

  // Count & total subtitle
  const total = rows.reduce((s, t) => s + t.amount.toNumber(), 0)
  sheet.mergeCells("B2:E2")
  const subCell = sheet.getCell("B2")
  subCell.value = `${rows.length} transacciones  •  Total: $${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
  subCell.font = { size: 11, color: { argb: "FF64748B" }, name: "Calibri" }

  // Header row
  const hRow = sheet.getRow(4)
  hRow.height = 30
  const headers = ["#", "Fecha", "Categoría", "Descripción", "Monto"]
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
  sheet.autoFilter = { from: { row: 4, column: 2 }, to: { row: 4, column: 6 } }

  // Data rows
  let rowIdx = 5
  rows.forEach((t, i) => {
    const row = sheet.getRow(rowIdx)

    row.getCell(2).value = i + 1
    row.getCell(2).font = { size: 9, color: { argb: "FF94A3B8" }, name: "Calibri" }
    row.getCell(2).alignment = { horizontal: "center" }

    row.getCell(3).value = formatDate(t.date)
    row.getCell(3).font = DATA_FONT
    row.getCell(3).alignment = { horizontal: "center" }

    row.getCell(4).value = t.category
    row.getCell(4).font = { ...DATA_FONT, bold: true }

    row.getCell(5).value = t.description ?? "—"
    row.getCell(5).font = DATA_FONT

    row.getCell(6).value = t.amount.toNumber()
    row.getCell(6).numFmt = '"$"#,##0.00'
    row.getCell(6).font = { bold: true, size: 11, color: { argb: accentColor }, name: "Calibri" }
    row.getCell(6).alignment = { horizontal: "right" }

    if (i % 2 === 1) {
      for (let c = 2; c <= 6; c++) row.getCell(c).fill = ZEBRA_FILL
    }
    for (let c = 2; c <= 6; c++) row.getCell(c).border = THIN_BORDER

    rowIdx++
  })

  // Total row
  const totalRow = sheet.getRow(rowIdx + 1)
  totalRow.getCell(4).value = "TOTAL"
  totalRow.getCell(4).font = { bold: true, size: 12, color: { argb: "FF0F172A" }, name: "Calibri" }
  totalRow.getCell(4).alignment = { horizontal: "right" }
  totalRow.getCell(6).value = total
  totalRow.getCell(6).numFmt = '"$"#,##0.00'
  totalRow.getCell(6).font = { bold: true, size: 13, color: { argb: accentColor }, name: "Calibri" }
  for (let c = 2; c <= 6; c++) {
    totalRow.getCell(c).border = {
      ...THIN_BORDER,
      top: { style: "double", color: { argb: "FF475569" } },
    }
  }

  // Summary
  const sRow = rowIdx + 4
  const avg = rows.length > 0 ? total / rows.length : 0
  sheet.getCell(`C${sRow}`).value = "Resumen"
  sheet.getCell(`C${sRow}`).font = { bold: true, size: 12, color: { argb: "FF0F172A" }, name: "Calibri" }
  sheet.getCell(`C${sRow + 1}`).value = "Transacciones:"
  sheet.getCell(`C${sRow + 1}`).font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
  sheet.getCell(`D${sRow + 1}`).value = rows.length
  sheet.getCell(`D${sRow + 1}`).font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF1E293B" } }
  sheet.getCell(`C${sRow + 2}`).value = "Promedio:"
  sheet.getCell(`C${sRow + 2}`).font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
  sheet.getCell(`D${sRow + 2}`).value = avg
  sheet.getCell(`D${sRow + 2}`).numFmt = '"$"#,##0.00'
  sheet.getCell(`D${sRow + 2}`).font = { bold: true, size: 11, name: "Calibri", color: { argb: accentColor } }
}

// ─── HELPER: Write color legend in Excel cells ──

function writeColorLegend(
  ws: ExcelJS.Worksheet,
  categories: { label: string; value: number; color: string }[],
  startRow: number,
  startCol: number,
  total: number,
  accentArgb: string,
) {
  // Header
  const headers = ["", "Categoría", "Monto", "%"]
  headers.forEach((h, i) => {
    const cell = ws.getCell(startRow, startCol + i)
    cell.value = h
    cell.font = { bold: true, size: 9, color: { argb: "FF64748B" }, name: "Calibri" }
    cell.alignment = { horizontal: i === 2 ? "right" : i === 3 ? "center" : "left" }
    cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } }
  })

  categories.forEach((cat, i) => {
    const row = startRow + 1 + i
    const pct = total > 0 ? (cat.value / total) * 100 : 0

    // Color swatch
    const colorCell = ws.getCell(row, startCol)
    colorCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
    colorCell.border = THIN_BORDER

    // Category name
    const nameCell = ws.getCell(row, startCol + 1)
    nameCell.value = cat.label
    nameCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF334155" } }
    nameCell.border = THIN_BORDER

    // Amount
    const amountCell = ws.getCell(row, startCol + 2)
    amountCell.value = cat.value
    amountCell.numFmt = '"$"#,##0.00'
    amountCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: accentArgb } }
    amountCell.alignment = { horizontal: "right" }
    amountCell.border = THIN_BORDER

    // Percentage
    const pctCell = ws.getCell(row, startCol + 3)
    pctCell.value = pct / 100
    pctCell.numFmt = "0.0%"
    pctCell.font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } }
    pctCell.alignment = { horizontal: "center" }
    pctCell.border = THIN_BORDER

    // Zebra
    if (i % 2 === 1) {
      for (let c = startCol; c < startCol + 4; c++) {
        ws.getCell(row, c).fill = c === startCol
          ? { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
          : ZEBRA_FILL
      }
    }
  })
}

// ─── HELPER: Write bar chart labels in Excel cells ──

function writeBarLabels(
  ws: ExcelJS.Worksheet,
  data: { label: string; value: number; color: string }[],
  startRow: number,
  startCol: number,
) {
  data.forEach((d, i) => {
    const col = startCol + i * 2

    // Color swatch
    const colorCell = ws.getCell(startRow, col)
    colorCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: d.color.replace("#", "FF") } }
    colorCell.border = THIN_BORDER

    // Label + value
    const labelCell = ws.getCell(startRow, col + 1)
    labelCell.value = d.label
    labelCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF334155" } }

    const valueCell = ws.getCell(startRow + 1, col + 1)
    valueCell.value = d.value
    valueCell.numFmt = '"$"#,##0.00'
    valueCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: d.color.replace("#", "FF") } }
  })
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

  const withinLimit = rateLimit(`export:${ip}`, 30, 60_000)
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

  const incomes = transactions.filter((t) => t.type === "income")
  const expenses = transactions.filter((t) => t.type === "expense")

  const totalIncome = incomes.reduce((s, t) => s + t.amount.toNumber(), 0)
  const totalExpense = expenses.reduce((s, t) => s + t.amount.toNumber(), 0)
  const balance = totalIncome - totalExpense

  const expenseCategories = aggregateByCategory(expenses)
  const incomeCategories = aggregateByCategory(incomes)

  const monthName = new Date(year, monthNum - 1).toLocaleString("es-MX", {
    month: "long",
    year: "numeric",
  })

  // ─── GENERATE CHART IMAGES (shapes only) ────
  const [donutPng, barPng] = await Promise.all([
    svgToPng(generateDonutSVG(expenseCategories)),
    svgToPng(
      generateBarChartSVG([
        { label: "Ingresos", value: totalIncome, color: "#059669" },
        { label: "Gastos", value: totalExpense, color: "#DC2626" },
        { label: "Balance", value: Math.abs(balance), color: balance >= 0 ? "#2563EB" : "#F59E0B" },
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
    { width: 16 },  // H - amount
    { width: 10 },  // I - percentage
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

  // ── Metric Cards (row 6-8) ──
  const metrics = [
    { label: "Ingresos", value: totalIncome, argb: "FF059669", count: incomes.length },
    { label: "Gastos", value: totalExpense, argb: "FFDC2626", count: expenses.length },
    { label: "Balance", value: balance, argb: balance >= 0 ? "FF059669" : "FFDC2626", count: transactions.length },
  ]

  ws.getRow(row).height = 22
  ws.getRow(row + 1).height = 48
  ws.getRow(row + 2).height = 22

  metrics.forEach((m, i) => {
    const col = 2 + i

    ws.getCell(row, col).value = m.label
    ws.getCell(row, col).font = { bold: true, size: 10, color: { argb: "FF64748B" }, name: "Calibri" }
    ws.getCell(row, col).alignment = { horizontal: "center" }

    const valueCell = ws.getCell(row + 1, col)
    valueCell.value = m.value
    valueCell.numFmt = '"$"#,##0.00'
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.argb } }
    valueCell.font = { bold: true, size: 20, color: { argb: "FFFFFFFF" }, name: "Calibri" }
    valueCell.alignment = { horizontal: "center", vertical: "middle" }
    valueCell.border = {
      top: { style: "medium", color: { argb: "FFE2E8F0" } },
      bottom: { style: "medium", color: { argb: "FFE2E8F0" } },
      left: { style: "medium", color: { argb: "FFE2E8F0" } },
      right: { style: "medium", color: { argb: "FFE2E8F0" } },
    }

    ws.getCell(row + 2, col).value = `${m.count} transacciones`
    ws.getCell(row + 2, col).font = { size: 9, color: { argb: "FF94A3B8" }, name: "Calibri" }
    ws.getCell(row + 2, col).alignment = { horizontal: "center" }
  })
  row += 4 // after metrics + blank

  // ── Section: Gastos por Categoría (Donut + Legend) ──
  ws.mergeCells(`B${row}:D${row}`)
  ws.getCell(`B${row}`).value = "Gastos por Categoría"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  // Donut image on left (col B, spans ~16 rows)
  const donutImgId = wb.addImage({ buffer: donutPng as any, extension: "png" })
  const donutRow = row
  ws.addImage(donutImgId, {
    tl: { col: 1, row: donutRow },
    ext: { width: 280, height: 280 },
  })

  // Legend on right (col F-I) at same height
  writeColorLegend(ws, expenseCategories, donutRow, 6, totalExpense, "FFDC2626")

  // Advance past donut image (280px ≈ 15 rows at default height ~20px)
  const donutRows = Math.max(15, expenseCategories.length + 2)
  row += donutRows + 1

  // ── Section: Ingresos vs Gastos (Bar chart + labels) ──
  ws.mergeCells(`B${row}:D${row}`)
  ws.getCell(`B${row}`).value = "Ingresos vs Gastos"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  // Bar chart image
  const barImgId = wb.addImage({ buffer: barPng as any, extension: "png" })
  const barRow = row
  ws.addImage(barImgId, {
    tl: { col: 1, row: barRow },
    ext: { width: 350, height: 240 },
  })

  // Bar labels on the right
  const barData = [
    { label: "Ingresos", value: totalIncome, color: "#059669" },
    { label: "Gastos", value: totalExpense, color: "#DC2626" },
    { label: "Balance", value: Math.abs(balance), color: balance >= 0 ? "#2563EB" : "#F59E0B" },
  ]
  barData.forEach((d, i) => {
    const legendRow = barRow + 1 + i * 2

    ws.getCell(legendRow, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: d.color.replace("#", "FF") } }
    ws.getCell(legendRow, 6).border = THIN_BORDER

    ws.getCell(legendRow, 7).value = d.label
    ws.getCell(legendRow, 7).font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF334155" } }

    ws.getCell(legendRow, 8).value = d.value
    ws.getCell(legendRow, 8).numFmt = '"$"#,##0.00'
    ws.getCell(legendRow, 8).font = { bold: true, size: 12, name: "Calibri", color: { argb: d.color.replace("#", "FF") } }
  })

  // Advance past bar chart (240px ≈ 13 rows)
  row += 14

  // ── Section: Desglose Completo - Gastos ──
  ws.mergeCells(`B${row}:H${row}`)
  ws.getCell(`B${row}`).value = "Desglose Completo de Gastos"
  ws.getCell(`B${row}`).font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" }
  ws.getRow(row).height = 28
  row++

  // Table header
  const catHeaders = ["", "Categoría", "Monto", "% del Total", "Transacciones"]
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
    const pct = totalExpense > 0 ? (cat.value / totalExpense) * 100 : 0

    // Color swatch
    ws.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
    ws.getCell(r, 2).border = THIN_BORDER

    ws.getCell(r, 3).value = cat.label
    ws.getCell(r, 3).font = { ...DATA_FONT, bold: true }
    ws.getCell(r, 3).border = THIN_BORDER

    ws.getCell(r, 4).value = cat.value
    ws.getCell(r, 4).numFmt = '"$"#,##0.00'
    ws.getCell(r, 4).font = { bold: true, size: 11, color: { argb: "FFDC2626" }, name: "Calibri" }
    ws.getCell(r, 4).alignment = { horizontal: "right" }
    ws.getCell(r, 4).border = THIN_BORDER

    ws.getCell(r, 5).value = pct / 100
    ws.getCell(r, 5).numFmt = "0.0%"
    ws.getCell(r, 5).font = DATA_FONT
    ws.getCell(r, 5).alignment = { horizontal: "center" }
    ws.getCell(r, 5).border = THIN_BORDER

    ws.getCell(r, 6).value = txCount
    ws.getCell(r, 6).font = DATA_FONT
    ws.getCell(r, 6).alignment = { horizontal: "center" }
    ws.getCell(r, 6).border = THIN_BORDER

    if (i % 2 === 1) {
      for (let c = 3; c <= 6; c++) ws.getCell(r, c).fill = ZEBRA_FILL
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
    const pct = totalIncome > 0 ? (cat.value / totalIncome) * 100 : 0

    ws.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.color.replace("#", "FF") } }
    ws.getCell(r, 2).border = THIN_BORDER

    ws.getCell(r, 3).value = cat.label
    ws.getCell(r, 3).font = { ...DATA_FONT, bold: true }
    ws.getCell(r, 3).border = THIN_BORDER

    ws.getCell(r, 4).value = cat.value
    ws.getCell(r, 4).numFmt = '"$"#,##0.00'
    ws.getCell(r, 4).font = { bold: true, size: 11, color: { argb: "FF1D4ED8" }, name: "Calibri" }
    ws.getCell(r, 4).alignment = { horizontal: "right" }
    ws.getCell(r, 4).border = THIN_BORDER

    ws.getCell(r, 5).value = pct / 100
    ws.getCell(r, 5).numFmt = "0.0%"
    ws.getCell(r, 5).font = DATA_FONT
    ws.getCell(r, 5).alignment = { horizontal: "center" }
    ws.getCell(r, 5).border = THIN_BORDER

    ws.getCell(r, 6).value = txCount
    ws.getCell(r, 6).font = DATA_FONT
    ws.getCell(r, 6).alignment = { horizontal: "center" }
    ws.getCell(r, 6).border = THIN_BORDER

    if (i % 2 === 1) {
      for (let c = 3; c <= 6; c++) ws.getCell(r, c).fill = ZEBRA_FILL
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
