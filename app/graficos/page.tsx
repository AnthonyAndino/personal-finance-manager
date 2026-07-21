import { auth } from "@/lib/auth.config"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { Sidebar } from "@/components/sidebar"
import { ExportButton } from "@/components/export-button"
import { CurrencyToggle } from "@/components/currency-toggle"
import { amountToLempiras, formatMoney, totalFromLempiras } from "@/lib/currency"
import { getDefaultRate } from "@/lib/exchange-rate"
import { isOperationalExpense, isOperationalIncome } from "@/lib/transaction-categories"
import { getGananciaNeta } from "@/lib/balance"

const HONDURAS_OFFSET_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function toLocal(d: Date): Date {
  return new Date(d.getTime() - HONDURAS_OFFSET_MS)
}

function getMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 1))
  return { start, end }
}

async function getMonthTransactions(
  year: number,
  month: number,
  userId: string,
  extraWhere?: Record<string, unknown>,
) {
  const { start, end } = getMonthRange(year, month)
  const raw = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      ...extraWhere,
      date: { gte: new Date(start.getTime() - DAY_MS), lt: new Date(end.getTime() + DAY_MS) },
    } as any,
    select: { date: true, type: true, amount: true, currency: true, category: true },
  })
  return raw.filter((t) => {
    const local = toLocal(t.date)
    return local.getFullYear() === year && local.getMonth() === month
  })
}

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

export default async function GraficosPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const userId = session.user.id
  const now = new Date()
  const localNow = toLocal(now)
  const currentMonth = localNow.getUTCMonth()
  const currentYear = localNow.getUTCFullYear()

  const userPref = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  })
  const preferredCurrency = userPref?.currency ?? "L"
  const exchangeRate = await getDefaultRate()

  // ── 1. Monthly Evolution (last 6 months) ──
  const monthlyData: { label: string; income: number; expense: number }[] = []
  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i
    let y = currentYear
    if (m < 0) { m += 12; y-- }
    const totals = await getMonthTransactions(y, m, userId)

    let incomeL = 0
    let expenseL = 0
    totals.forEach((t) => {
      const enL = amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate)
      if (isOperationalIncome(t.type, t.category)) incomeL += enL
      else if (isOperationalExpense(t.type, t.category)) expenseL += enL
    })

    monthlyData.push({
      label: MONTHS_SHORT[m],
      income: totalFromLempiras(incomeL, preferredCurrency, exchangeRate),
      expense: totalFromLempiras(expenseL, preferredCurrency, exchangeRate),
    })
  }

  const maxMonthly = Math.max(...monthlyData.flatMap((d) => [d.income, d.expense]), 100)

  // ── 2. Expense Distribution ──
  const monthExpenses = await getMonthTransactions(currentYear, currentMonth, userId, { type: "expense" })

  const gastosPorCategoriaL: Record<string, number> = {}
  monthExpenses
    .filter((t) => isOperationalExpense(t.type, t.category))
    .forEach((t) => {
      const cat = t.category.trim().toLowerCase()
      const catF = cat.charAt(0).toUpperCase() + cat.slice(1)
      const enL = amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate)
      gastosPorCategoriaL[catF] = (gastosPorCategoriaL[catF] || 0) + enL
    })

  const categorias = Object.entries(gastosPorCategoriaL)
    .map(([name, valueL]) => ({ name, value: totalFromLempiras(valueL, preferredCurrency, exchangeRate) }))
    .sort((a, b) => b.value - a.value)

  const totalGastos = categorias.reduce((s, c) => s + c.value, 0)

  // ── 3. Accumulated Balance (last 6 months) ──
  let accBalanceL = 0
  const balanceData: { label: string; balance: number }[] = []
  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i
    let y = currentYear
    if (m < 0) { m += 12; y-- }
    const totals = await getMonthTransactions(y, m, userId)

    accBalanceL += getGananciaNeta(totals, (t) =>
      amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate),
    )

    balanceData.push({
      label: MONTHS_SHORT[m],
      balance: totalFromLempiras(accBalanceL, preferredCurrency, exchangeRate),
    })
  }

  const maxBalance = Math.max(...balanceData.map((d) => d.balance), 100)
  const minBalance = Math.min(...balanceData.map((d) => d.balance), 0)
  const balanceRange = maxBalance - minBalance || 1

  const DONUT_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"]

  const monthStr = String(currentMonth + 1).padStart(2, "0")
  const mesAno = `${currentYear}-${monthStr}`

  return (
    <div className="flex flex-1 flex-col w-full min-h-screen lg:pl-64 pb-16 lg:pb-0">
      <Sidebar userName={session.user.name} userEmail={session.user.email} />

      <header className="border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900 hover:opacity-95 transition-opacity">
            <span className="bg-[#2563EB] text-white px-2 py-0.5 rounded-md text-sm font-black">G</span>
            <span>Control<span className="text-[#2563EB] font-black">Gastos</span></span>
          </a>
          <div className="flex items-center gap-3">
            <CurrencyToggle defaultCurrency={preferredCurrency} />
            <ExportButton month={mesAno} label="Exportar" />
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-sm font-bold text-slate-800">{session.user.name}</span>
              <span className="text-xs text-slate-400 font-medium">Panel de Control</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-10">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-black text-[#2563EB] uppercase tracking-widest bg-blue-50 border border-blue-200/50 rounded-full px-3 py-1 w-fit">
            Visualización
          </span>
          <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-none">
            Gráficos {" "}
            <span className="bg-gradient-to-r from-[#2563EB] to-blue-500 bg-clip-text text-transparent">
              Financieros.
            </span>
          </h1>
          <p className="text-slate-500 text-sm md:text-base max-w-xl font-medium">
            Analiza la evolución de tus ingresos, gastos y balance en el tiempo.
          </p>
        </div>

        {/* Chart 1: Monthly Evolution */}
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <h3 className="font-extrabold text-slate-900 text-lg">Evolución Mensual</h3>
              <span className="text-xs text-slate-400 font-medium">Últimos 6 meses — ingresos vs gastos</span>
            </div>
            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-green-500 inline-block" />
                <span className="text-slate-500">Ingresos</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-500 inline-block" />
                <span className="text-slate-500">Gastos</span>
              </div>
            </div>
          </div>

          {monthlyData.some((d) => d.income > 0 || d.expense > 0) ? (
            <div className="relative w-full overflow-hidden">
              <svg className="w-full h-auto min-h-[250px]" viewBox="0 0 600 250" fill="none">
                <line x1="50" y1="40" x2="570" y2="40" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="50" y1="92.5" x2="570" y2="92.5" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="50" y1="145" x2="570" y2="145" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="50" y1="197.5" x2="570" y2="197.5" stroke="#f8fafc" strokeWidth="2" />

                {monthlyData.map((d, i) => {
                  const xBase = 65 + i * 82
                  const barW = 30
                  const gap = 10
                  const hIncome = d.income > 0 ? (d.income / maxMonthly) * 140 : 2
                  const hExpense = d.expense > 0 ? (d.expense / maxMonthly) * 140 : 2
                  const yIncome = 200 - hIncome
                  const yExpense = 200 - hExpense

                  return (
                    <g key={i}>
                      <rect x={xBase} y={yIncome} width={barW} height={hIncome} rx="4" fill="#10b981" className="cursor-pointer" />
                      <rect x={xBase + barW + gap} y={yExpense} width={barW} height={hExpense} rx="4" fill="#ef4444" className="cursor-pointer" />
                      <text x={xBase + barW / 2} y={yIncome - 6} textAnchor="middle" fill="#0f172a" className="text-[9px] font-bold">
                        {d.income > 0 ? `${preferredCurrency}${Math.round(d.income)}` : ""}
                      </text>
                      <text x={xBase + barW + gap + barW / 2} y={yExpense - 6} textAnchor="middle" fill="#ef4444" className="text-[9px] font-bold">
                        {d.expense > 0 ? `${preferredCurrency}${Math.round(d.expense)}` : ""}
                      </text>
                      <text x={xBase + barW / 2 + gap / 2} y="222" textAnchor="middle" fill="#64748b" className="text-xs font-bold">{d.label}</text>
                    </g>
                  )
                })}
              </svg>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-slate-400 text-sm font-medium">Sin ingresos ni gastos en los últimos 6 meses</p>
            </div>
          )}
        </div>

        {/* Chart 2 & 3 Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Chart 2: Expense Distribution (Donut) */}
          <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
            <div className="flex flex-col">
              <h3 className="font-extrabold text-slate-900 text-lg">Distribución de Gastos</h3>
              <span className="text-xs text-slate-400 font-medium">Este mes por categoría</span>
            </div>

            {categorias.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <p className="text-slate-400 text-sm font-medium">Sin gastos este mes</p>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row items-center gap-8 flex-1">
                <svg width="180" height="180" viewBox="0 0 180 180" className="shrink-0">
                  {(() => {
                    const cx = 90, cy = 90, r = 70
                    const segments: { path: string; color: string; percent: number }[] = []
                    let currentAngle = -Math.PI / 2

                    categorias.forEach((cat, i) => {
                      const percent = cat.value / totalGastos
                      const angle = percent * Math.PI * 2
                      const x1 = cx + r * Math.cos(currentAngle)
                      const y1 = cy + r * Math.sin(currentAngle)
                      const x2 = cx + r * Math.cos(currentAngle + angle)
                      const y2 = cy + r * Math.sin(currentAngle + angle)
                      const largeArc = angle > Math.PI ? 1 : 0

                      segments.push({
                        path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`,
                        color: DONUT_COLORS[i % DONUT_COLORS.length],
                        percent,
                      })

                      currentAngle += angle
                    })

                    return segments.map((s, i) => (
                      <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" className="cursor-pointer" />
                    ))
                  })()}
                  <circle cx={90} cy={90} r={45} fill="white" />
                  <text x={90} y={85} textAnchor="middle" fill="#0f172a" className="text-lg font-bold">
                    {totalGastos > 0 ? Math.round((categorias[0]?.value ?? 0) / totalGastos * 100) : 0}%
                  </text>
                  <text x={90} y={102} textAnchor="middle" fill="#64748b" className="text-xs font-medium">
                    top
                  </text>
                </svg>

                <div className="flex flex-col gap-2.5 flex-1 w-full">
                  {categorias.slice(0, 6).map((cat, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm inline-block shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="font-bold text-slate-700">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 font-medium tabular-nums">
                          {Math.round((cat.value / totalGastos) * 100)}%
                        </span>
                        <span className="font-extrabold text-slate-900 tabular-nums">{preferredCurrency}{formatMoney(cat.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Chart 3: Accumulated Balance (Line) */}
          <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
            <div className="flex flex-col">
              <h3 className="font-extrabold text-slate-900 text-lg">Balance Acumulado</h3>
              <span className="text-xs text-slate-400 font-medium">Evolución del balance mes a mes</span>
            </div>

            <div className="relative w-full overflow-hidden">
              <svg className="w-full h-auto min-h-[220px]" viewBox="0 0 500 220" fill="none">
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} x1="40" y1={30 + i * 50} x2="470" y2={30 + i * 50} stroke="#f1f5f9" strokeWidth="1" />
                ))}

                {(() => {
                  const points = balanceData.map((d, i) => {
                    const x = 60 + i * 75
                    const y = 180 - ((d.balance - minBalance) / balanceRange) * 150
                    return { x, y, label: d.label, val: d.balance }
                  })

                  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
                  const areaD = pathD + ` L${points[points.length - 1].x},180 L${points[0].x},180 Z`

                  return (
                    <>
                      <path d={areaD} fill="url(#balanceGradient)" />
                      <path d={pathD} stroke="#2563EB" strokeWidth="3" fill="none" className="cursor-pointer" />
                      {points.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r="5" fill="#2563EB" stroke="white" strokeWidth="2" className="cursor-pointer" />
                          <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#0f172a" className="text-[9px] font-bold">
                            {preferredCurrency}{formatMoney(Math.round(p.val))}
                          </text>
                          <text x={p.x} y="200" textAnchor="middle" fill="#64748b" className="text-xs font-bold">{p.label}</text>
                        </g>
                      ))}
                    </>
                  )
                })()}

                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
