import { auth } from "@/lib/auth.config"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { Sidebar } from "@/components/sidebar"
import { DashboardCards, EmptyCategory } from "@/components/dashboard-cards"
import { EmergencyFundCard } from "@/components/emergency-fund-card"
import { amountToLempiras, formatMoney, totalFromLempiras } from "@/lib/currency"
import { getDefaultRate } from "@/lib/exchange-rate"
import { ExportButton } from "@/components/export-button"
import { CurrencyToggle } from "@/components/currency-toggle"
import { isOperationalExpense, isOperationalIncome } from "@/lib/transaction-categories"

export default async function Home() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const userId = session.user.id
  const exchangeRate = await getDefaultRate()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  })
  const currency = user?.currency ?? "L"

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  const transaccionesMes = await prisma.transaction.findMany({
    where: { userId, deletedAt: null, date: { gte: monthStart, lt: monthEnd } },
    orderBy: { date: "asc" },
  })

  let ingresosL = 0
  let gastosL = 0
  transaccionesMes.forEach((t) => {
    const enL = amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate)
    if (isOperationalIncome(t.type, t.category)) {
      ingresosL += enL
    } else if (isOperationalExpense(t.type, t.category)) {
      gastosL += enL
    }
  })

  const balanceL = ingresosL - gastosL
  const ingresos = totalFromLempiras(ingresosL, currency, exchangeRate)
  const gastos = totalFromLempiras(gastosL, currency, exchangeRate)
  const balance = totalFromLempiras(balanceL, currency, exchangeRate)
  const retorno = gastosL > 0 ? ingresosL / gastosL : ingresosL > 0 ? 1 : 0

  const metasLogradas = await prisma.wishlistItem.count({
    where: { userId, purchased: true },
  })

  const semanasData = [
    { nombre: "Semana 1", incomeL: 0, expenseL: 0 },
    { nombre: "Semana 2", incomeL: 0, expenseL: 0 },
    { nombre: "Semana 3", incomeL: 0, expenseL: 0 },
    { nombre: "Semana 4", incomeL: 0, expenseL: 0 },
  ]

  transaccionesMes.forEach((t) => {
    const dia = new Date(t.date).getDate()
    let indiceSemana = Math.floor((dia - 1) / 7)
    if (indiceSemana > 3) indiceSemana = 3
    const enL = amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate)
    if (isOperationalIncome(t.type, t.category)) {
      semanasData[indiceSemana].incomeL += enL
    } else if (isOperationalExpense(t.type, t.category)) {
      semanasData[indiceSemana].expenseL += enL
    }
  })

  const semanasDisplay = semanasData.map((d) => ({
    ...d,
    income: totalFromLempiras(d.incomeL, currency, exchangeRate),
    expense: totalFromLempiras(d.expenseL, currency, exchangeRate),
  }))

  const maxSemanaVal = Math.max(...semanasDisplay.flatMap((d) => [d.income, d.expense]), 100)

  const gastosPorCategoriaL: Record<string, number> = {}
  transaccionesMes
    .filter((t) => isOperationalExpense(t.type, t.category))
    .forEach((t) => {
      const cat = t.category.trim().toLowerCase()
      const catFormatted = cat.charAt(0).toUpperCase() + cat.slice(1)
      const enL = amountToLempiras(t.amount.toNumber(), t.currency, exchangeRate)
      gastosPorCategoriaL[catFormatted] = (gastosPorCategoriaL[catFormatted] || 0) + enL
    })

  const categoriasGastos = Object.entries(gastosPorCategoriaL)
    .map(([name, valueL]) => ({ name, value: totalFromLempiras(valueL, currency, exchangeRate) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4)

  const maxCategoriaVal = categoriasGastos.length > 0 ? Math.max(...categoriasGastos.map((c) => c.value), 10) : 10

  const nombreMes = new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })
  const mesAnoUrl = new Date().toISOString().slice(0, 7)

  return (
    <div className="flex flex-1 flex-col w-full min-h-screen lg:pl-64 pb-16 lg:pb-0">
      <Sidebar userName={session.user?.name} userEmail={session.user?.email} />

      {/* Navbar Superior */}
      <header className="border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900">
            <span className="bg-[#2563EB] text-white px-2 py-0.5 rounded-md text-sm font-black">G</span>
            <span>Control<span className="text-[#2563EB] font-black">Gastos</span></span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1 text-[10px] font-bold text-slate-500 tracking-tight">
              <span className="text-emerald-600 font-black">$1</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-600">L{exchangeRate.toFixed(2)}</span>
            </div>
            <CurrencyToggle defaultCurrency={currency} />
            <ExportButton month={mesAnoUrl} />
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-10">
        {/* Título de Bienvenida */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-black text-[#2563EB] uppercase tracking-widest bg-blue-50 border border-blue-200/50 rounded-full px-3 py-1 w-fit">
            Resumen del mes
          </span>
          <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-none capitalize">
            {nombreMes}.{" "}
            <span className="bg-gradient-to-r from-[#2563EB] to-blue-500 bg-clip-text text-transparent">
              Balance actual.
            </span>
          </h1>
          <p className="text-slate-500 text-sm md:text-base max-w-xl font-medium">
            Visualiza rápidamente el comportamiento de tus ingresos y gastos de este mes.
          </p>
        </div>

        {/* Bloque Financiero Estilo Imagen - bg-slate-950 */}
        <div className="bg-slate-950 rounded-3xl border border-slate-800 shadow-[0_20px_60px_rgba(0,0,0,0.3)] p-6 md:p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
            {/* Métrica 1: Ingreso total */}
            <div className="flex flex-col gap-1 p-4 md:p-6 border-r border-slate-800">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ingreso Mensual</span>
              <span className="text-3xl md:text-4xl font-black text-white">
                <span className="text-[#2563EB]">{currency}</span>{formatMoney(ingresos)}
              </span>
            </div>

            {/* Métrica 2: Gasto total */}
            <div className="flex flex-col gap-1 p-4 md:p-6 border-r border-slate-800">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Gasto Mensual</span>
              <span className="text-3xl md:text-4xl font-black text-white">
                {currency}{formatMoney(gastos)}
              </span>
            </div>

            {/* Métrica 3: Retorno financiero */}
            <div className="flex flex-col gap-1 p-4 md:p-6 border-r border-slate-800">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Retorno Financiero</span>
              <span className="text-3xl md:text-4xl font-black text-white">
                {retorno.toFixed(1)}<span className="text-[#2563EB]">x</span>
              </span>
            </div>

            {/* Métrica 4: Metas logradas */}
            <div className="flex flex-col gap-1 p-4 md:p-6">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Metas Logradas</span>
              <span className="text-3xl md:text-4xl font-black text-white">
                {metasLogradas}
              </span>
            </div>
          </div>
        </div>

        {/* Rejilla de Totales Rápidos */}
        <DashboardCards ingresos={ingresos} gastos={gastos} balance={balance} currency={currency} />

        {/* Sección de Gráficos SVG */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Gráfico Semanal */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h3 className="font-extrabold text-slate-900 text-lg">Historial Semanal</h3>
                <span className="text-xs text-slate-400 font-medium">Comparativa de ingresos y gastos</span>
              </div>
              <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-green-500 inline-block"></span>
                  <span className="text-slate-500">Ingresos</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-red-500 inline-block"></span>
                  <span className="text-slate-500">Gastos</span>
                </div>
              </div>
            </div>

            <div className="relative w-full overflow-hidden">
              <svg className="w-full h-auto min-h-[220px]" viewBox="0 0 500 220" fill="none">
                <line x1="40" y1="30" x2="480" y2="30" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="40" y1="80" x2="480" y2="80" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="40" y1="130" x2="480" y2="130" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="40" y1="180" x2="480" y2="180" stroke="#f8fafc" strokeWidth="2" />

                {semanasDisplay.map((d, i) => {
                  const xBase = 60 + i * 110;
                  const hIncome = d.income > 0 ? (d.income / maxSemanaVal) * 130 : 2;
                  const hExpense = d.expense > 0 ? (d.expense / maxSemanaVal) * 130 : 2;
                  const yIncome = 180 - hIncome;
                  const yExpense = 180 - hExpense;

                  return (
                    <g key={i} className="group">
                      <rect x={xBase} y={yIncome} width="32" height={hIncome} rx="6" fill="#10b981" className="transition-all duration-300 hover:fill-green-600 cursor-pointer" />
                      <rect x={xBase + 38} y={yExpense} width="32" height={hExpense} rx="6" fill="#ef4444" className="transition-all duration-300 hover:fill-red-600 cursor-pointer" />
                      {d.income > 0 && (
                        <text x={xBase + 16} y={yIncome - 6} textAnchor="middle" fill="#0f172a" className="text-[10px] font-black">{currency}{Math.round(d.income)}</text>
                      )}
                      {d.expense > 0 && (
                        <text x={xBase + 54} y={yExpense - 6} textAnchor="middle" fill="#ef4444" className="text-[10px] font-black">{currency}{Math.round(d.expense)}</text>
                      )}
                      <text x={xBase + 35} y="202" textAnchor="middle" fill="#64748b" className="text-xs font-bold">{d.nombre}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Top Gastos por Categoría */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
            <div className="flex flex-col">
              <h3 className="font-extrabold text-slate-900 text-lg">Distribución de Gastos</h3>
              <span className="text-xs text-slate-400 font-medium">Categorías en las que más has gastado</span>
            </div>

            {categoriasGastos.length === 0 ? (
              <EmptyCategory />
            ) : (
              <div className="flex flex-col gap-5 justify-center flex-1">
                {categoriasGastos.map((cat, i) => {
                  const porcentaje = (cat.value / maxCategoriaVal) * 100;
                  const coloresBarra = [
                    "from-red-500 to-rose-400",
                    "from-amber-500 to-orange-400",
                    "from-blue-500 to-indigo-400",
                    "from-purple-500 to-fuchsia-400"
                  ];

                  return (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-bold text-slate-700">{cat.name}</span>
                        <span className="font-extrabold text-slate-900">{currency}{formatMoney(cat.value)}</span>
                      </div>
                      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${coloresBarra[i % coloresBarra.length]} transition-all duration-500`} style={{ width: `${porcentaje}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <EmergencyFundCard />
      </main>
    </div>
  )
}
