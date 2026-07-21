"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { listTrashedTransactions, recoverTransaction, permanentDeleteTransaction } from "@/lib/actions/transactions"
import { useSession } from "next-auth/react"
import { Sidebar } from "@/components/sidebar"
import ConfirmDialog from "@/components/confirm-dialog"
import MonthPicker from "@/components/month-picker"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  createColumnHelper,
  flexRender,
  type SortingState,
} from "@tanstack/react-table"
import { Trash2, Refresh, Trash, ChevronLeft, ChevronRight, ChevronExpandY, ArrowUp, ArrowDown, AlertTriangle } from "reicon-react"
import { amountToLempiras, totalFromLempiras } from "@/lib/currency"
import { fetchDefaultRate } from "@/lib/actions/currency"

type Tx = Awaited<ReturnType<typeof listTrashedTransactions>>[number]

export default function PapeleraPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "deletedAt", desc: true }])
  const [recoverId, setRecoverId] = useState<string | null>(null)
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState("all")
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [exchangeRate, setExchangeRate] = useState(26.75)
  const prefCurrency = session?.user?.currency ?? "L"

  const load = useCallback(async () => {
    setLoading(true)
    const [data, rate] = await Promise.all([listTrashedTransactions(), fetchDefaultRate()])
    setTransactions(data)
    setExchangeRate(rate)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filteredData = useMemo(() => {
    return transactions.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false
      if (monthFilter) {
        const txMonth = t.date.slice(0, 7)
        if (txMonth !== monthFilter) return false
      }
      return true
    })
  }, [transactions, typeFilter, monthFilter])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const handleRecover = async () => {
    if (!recoverId) return
    await recoverTransaction(recoverId)
    setTransactions((prev) => prev.filter((t) => t.id !== recoverId))
    setRecoverId(null)
    showToast("Transacción recuperada con éxito")
    router.refresh()
  }

  const handlePermanentDelete = async () => {
    if (!permanentDeleteId) return
    await permanentDeleteTransaction(permanentDeleteId)
    setTransactions((prev) => prev.filter((t) => t.id !== permanentDeleteId))
    setPermanentDeleteId(null)
    showToast("Transacción eliminada permanentemente")
    router.refresh()
  }

  const columnHelper = createColumnHelper<Tx>()

  const columns = useMemo(() => [
    columnHelper.accessor("date", {
      header: "Fecha",
      cell: (info) => new Date(info.getValue()).toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" }),
      sortingFn: "datetime",
    }),
    columnHelper.accessor("type", {
      header: "Tipo",
      cell: (info) => (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
          info.getValue() === "income"
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {info.getValue() === "income" ? "Ingreso" : "Gasto"}
        </span>
      ),
    }),
    columnHelper.accessor("category", {
      header: "Categoría",
      cell: (info) => <span className="text-slate-800 font-bold">{info.getValue()}</span>,
    }),
    columnHelper.accessor("description", {
      header: "Descripción",
      cell: (info) => <span className="text-slate-500 max-w-[200px] truncate block">{info.getValue() || "—"}</span>,
    }),
    columnHelper.accessor("amount", {
      header: "Monto",
      cell: (info) => {
        const row = info.row.original
        const amount = row.amount
        const txCurrency = row.currency ?? "L"
        const converted = txCurrency === prefCurrency
          ? amount
          : totalFromLempiras(amountToLempiras(amount, txCurrency, exchangeRate), prefCurrency, exchangeRate)
        const displayCurrency = prefCurrency === "$" && txCurrency === "L" ? "~$" : prefCurrency === "L" && txCurrency === "$" ? "~L" : prefCurrency
        return (
          <span className={`font-extrabold tabular-nums ${row.type === "income" ? "text-green-600" : "text-red-500"}`}>
            {row.type === "income" ? "+" : "-"}{displayCurrency}{converted.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )
      },
      sortingFn: (a, b) => a.original.amount - b.original.amount,
    }),
    columnHelper.accessor("deletedAt", {
      header: "Eliminado",
      cell: (info) => (
        <span className="text-xs text-slate-400 font-medium tabular-nums">
          {new Date(info.getValue()).toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" })}
        </span>
      ),
      sortingFn: "datetime",
    }),
    columnHelper.display({
      id: "actions",
      header: "Acción",
      cell: ({ row }) => (
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => setRecoverId(row.original.id)}
            className="p-2 rounded-xl text-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
            title="Recuperar"
          >
            <Refresh size={16} />
          </button>
          <button
            onClick={() => setPermanentDeleteId(row.original.id)}
            className="p-2 rounded-xl text-red-400 hover:bg-red-50 transition-all cursor-pointer"
            title="Eliminar permanentemente"
          >
            <Trash size={15} />
          </button>
        </div>
      ),
    }),
  ], [prefCurrency, exchangeRate, columnHelper])

  const globalFilter = useMemo(() => search, [search])

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
    globalFilterFn: "includesString",
  })

  return (
    <div className="flex flex-1 flex-col w-full min-h-screen lg:pl-64 pb-16 lg:pb-0">
      <Sidebar userName={session?.user?.name} userEmail={session?.user?.email} />

      <header className="border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900 hover:opacity-95 transition-opacity">
            <span className="bg-[#2563EB] text-white px-2 py-0.5 rounded-md text-sm font-black">G</span>
            <span>Control<span className="text-[#2563EB] font-black">Gastos</span></span>
          </a>
          <a href="/historial" className="text-sm font-bold text-[#2563EB] hover:underline">
            ← Volver
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center">
            <Trash2 size={20} color="#EF4444" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none">
              Papelera
            </h1>
            <p className="text-slate-500 text-sm font-medium">
              Las transacciones aquí pueden recuperarse o eliminarse definitivamente.
            </p>
          </div>
        </div>

        {/* Filtros + búsqueda */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {[
              { value: "all", label: "Todos" },
              { value: "income", label: "Ingresos" },
              { value: "expense", label: "Gastos" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTypeFilter(opt.value)}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  typeFilter === opt.value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <MonthPicker value={monthFilter} onChange={setMonthFilter} />

          <input
            type="text"
            placeholder="Buscar en la papelera..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#2563EB] placeholder:text-slate-400"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-12 flex flex-col items-center gap-4">
            <Trash2 size={40} color="#CBD5E1" />
            <p className="text-slate-400 text-sm font-medium">La papelera está vacía</p>
            <a href="/historial" className="text-sm font-bold text-[#2563EB] hover:underline">
              Ir al historial
            </a>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-12 flex flex-col items-center gap-4">
            <p className="text-slate-400 text-sm font-medium">No hay resultados con los filtros actuales</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
                        {hg.headers.map((header) => (
                          <th
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className={`text-left px-4 py-3.5 text-[10px] font-black text-slate-500 uppercase tracking-wider ${
                              header.column.getCanSort() ? "cursor-pointer select-none hover:text-slate-800" : ""
                            } ${header.id === "amount" ? "text-right" : ""} ${header.id === "actions" ? "text-center w-24" : ""}`}
                          >
                            <span className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getCanSort() && (
                                <span className="text-slate-300">
                                  {header.column.getIsSorted() === "asc" ? <ArrowUp size={10} /> :
                                   header.column.getIsSorted() === "desc" ? <ArrowDown size={10} /> :
                                   <ChevronExpandY size={10} />}
                                </span>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {table.getRowModel().rows.map((row, i) => (
                      <tr key={row.id} className={`transition-colors hover:bg-slate-50 ${i % 2 === 1 ? "bg-slate-50/50" : ""}`}>
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className={`px-4 py-3.5 ${
                            cell.column.id === "amount" ? "text-right" : ""
                          } ${cell.column.id === "actions" ? "text-center" : ""}`}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginación */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                {table.getFilteredRowModel().rows.length} transacciones
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="bg-white border border-slate-200 hover:bg-slate-50 active:scale-95 text-slate-700 font-extrabold text-xs rounded-xl py-2 px-4 transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-bold text-slate-500 tabular-nums">
                  {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
                </span>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="bg-white border border-slate-200 hover:bg-slate-50 active:scale-95 text-slate-700 font-extrabold text-xs rounded-xl py-2 px-4 transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      <ConfirmDialog
        open={!!recoverId}
        onClose={() => setRecoverId(null)}
        onConfirm={handleRecover}
        title="Recuperar transacción"
        message="Esta transacción volverá a aparecer en el historial como si nunca se hubiera eliminado."
        confirmLabel="Recuperar"
        variant="info"
      />

      <ConfirmDialog
        open={!!permanentDeleteId}
        onClose={() => setPermanentDeleteId(null)}
        onConfirm={handlePermanentDelete}
        title="Eliminar permanentemente"
        message="Esta acción no se puede deshacer. La transacción se borrará para siempre."
        confirmLabel="Eliminar definitivamente"
        variant="danger"
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
          {toast}
        </div>
      )}
    </div>
  )
}
