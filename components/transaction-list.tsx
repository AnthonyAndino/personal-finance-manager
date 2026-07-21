"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { listTransactions, deleteTransaction } from "@/lib/actions/transactions"
import { Trash, DocumentText2 } from "reicon-react"
import { amountToLempiras, totalFromLempiras } from "@/lib/currency"
import { fetchDefaultRate } from "@/lib/actions/currency"

type Transaction = Awaited<ReturnType<typeof listTransactions>>[number]

export function TransactionList({ currency = "L" }: { currency?: string }) {
  const router = useRouter()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [exchangeRate, setExchangeRate] = useState(26.75)

  const load = useCallback(async () => {
    setLoading(true)
    const [data, rate] = await Promise.all([listTransactions(), fetchDefaultRate()])
    setTransactions(data)
    setExchangeRate(rate)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (id: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar esta transacción?")) {
      await deleteTransaction(id)
      setTransactions((prev) => prev.filter((t) => t.id !== id))
      router.refresh()
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 flex items-center justify-center min-h-[150px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Cargando historial...</p>
        </div>
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-8 text-center flex flex-col items-center justify-center min-h-[200px]">
        <DocumentText2 size={40} color="#94a3b8" />
        <h2 className="text-lg font-black text-slate-900 mb-1">
          Historial vacío
        </h2>
        <p className="text-sm text-slate-400 max-w-xs font-medium">
          Aún no has registrado ninguna transacción este mes.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6">
      <div className="flex flex-col">
        <h2 className="text-xl font-black text-slate-900">
          Historial de Movimientos
        </h2>
        <p className="text-xs text-slate-400 font-medium">Lista de ingresos y gastos registrados recientemente.</p>
      </div>

      <div className="flex flex-col gap-3">
        {transactions.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-2xl border border-slate-100 p-4 bg-slate-50/50 hover:bg-slate-50 transition-colors"
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                    t.type === "income"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {t.type === "income" ? "Ingreso" : "Gasto"}
                </span>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate">
                  {t.category}
                </span>
              </div>
              {t.description && (
                <p className="text-sm font-semibold text-slate-700 truncate">
                  {t.description}
                </p>
              )}
              <p className="text-[11px] font-bold text-slate-400">
                {new Date(t.date).toLocaleDateString("es-MX", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span
                className={`text-lg font-black ${
                  t.type === "income" ? "text-green-600" : "text-red-500"
                }`}
              >
                {t.type === "income" ? "+" : "-"}{t.currency}{t.amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {t.currency !== currency && (
                  <span className="text-[10px] text-slate-400 font-medium ml-1">
                    (~{currency}
                    {totalFromLempiras(amountToLempiras(t.amount, t.currency, exchangeRate), currency, exchangeRate).toLocaleString("es-MX", { minimumFractionDigits: 0 })})
                  </span>
                )}
              </span>
              <button
                onClick={() => handleDelete(t.id)}
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-xl transition-all duration-200 cursor-pointer"
                title="Eliminar movimiento"
              >
                <Trash size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
