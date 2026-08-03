"use client"

import { MoneyReceive, MoneySend, WalletMoney, ThumbsUp } from "reicon-react"
import { formatMoney } from "@/lib/currency"

export function DashboardCards({
  ingresos,
  gastos,
  balance,
  currency = "L",
  ingresosLabel = "Ingresos del Mes",
  gastosLabel = "Gastos del Mes",
  balanceLabel = "Ganancia Neta",
}: {
  ingresos: number
  gastos: number
  balance: number
  currency?: string
  ingresosLabel?: string
  gastosLabel?: string
  balanceLabel?: string
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_rgba(0,0,0,0.02)] p-6 flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{ingresosLabel}</span>
          <span className="text-3xl font-black text-slate-950">{currency}{formatMoney(ingresos)}</span>
        </div>
        <div className="p-3 bg-green-50 border border-green-200/30 rounded-2xl">
          <MoneyReceive size={24} color="#16a34a" />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_rgba(0,0,0,0.02)] p-6 flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{gastosLabel}</span>
          <span className="text-3xl font-black text-slate-950">{currency}{formatMoney(gastos)}</span>
        </div>
        <div className="p-3 bg-red-50 border border-red-200/30 rounded-2xl">
          <MoneySend size={24} color="#dc2626" />
        </div>
      </div>

      <div className={`rounded-3xl border p-6 flex items-start justify-between shadow-[0_12px_30px_rgba(0,0,0,0.02)] ${
        balance >= 0
          ? "bg-blue-50/20 border-blue-200/60"
          : "bg-red-50/20 border-red-200/60"
      }`}>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{balanceLabel}</span>
          <span className={`text-3xl font-black ${
            balance >= 0 ? "text-blue-600" : "text-red-600"
          }`}>
            {currency}{formatMoney(balance)}
          </span>
        </div>
        <div className={`p-3 rounded-2xl ${
          balance >= 0 ? "bg-blue-50 border border-blue-200/30" : "bg-red-50 border border-red-200/30"
        }`}>
          <WalletMoney size={24} color={balance >= 0 ? "#2563eb" : "#dc2626"} />
        </div>
      </div>
    </div>
  )
}

export function EmptyCategory() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-100 rounded-2xl">
      <ThumbsUp size={24} color="#64748b" />
      <p className="text-sm font-bold text-slate-800">Sin gastos este mes</p>
      <p className="text-xs text-slate-400">Todo el dinero está guardado.</p>
    </div>
  )
}
