"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
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
import { listAllTransactions, deleteTransaction } from "@/lib/actions/transactions"
import { useSession } from "next-auth/react"
import { Sidebar } from "@/components/sidebar"
import MonthPicker from "@/components/month-picker"
import ConfirmDialog from "@/components/confirm-dialog"

import { Trash, ChevronLeft, ChevronRight, ChevronExpandY, ArrowUp, ArrowDown } from "reicon-react"

type Tx = Awaited<ReturnType<typeof listAllTransactions>>[number]

export default function HistorialPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState("all")
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [search, setSearch] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const prefCurrency = session?.user?.currency ?? "L"

  const load = useCallback(async () => {
    setLoading(true)
    const data = await listAllTransactions({ type: typeFilter as any, month: monthFilter, search: "" })
    setTransactions(data)
    setLoading(false)
  }, [typeFilter, monthFilter])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    setDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!deleteId) return
    await deleteTransaction(deleteId)
    setTransactions((prev) => prev.filter((t) => t.id !== deleteId))
    setDeleteId(null)
    router.refresh()
  }

  const columnHelper = createColumnHelper<Tx>()

  const columns = useMemo(() => [
    columnHelper.accessor("date", {
      header: "Fecha",
      cell: (info) => new Date(info.getValue()).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
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
        const amount = info.getValue()
        const sign = row.type === "income" ? "+" : "-"
        const showEquivalent = row.currency !== prefCurrency && row.exchangeRate != null

        let equivalent: number | null = null
        if (showEquivalent) {
          if (row.currency === "L" && prefCurrency === "$") {
            equivalent = amount / row.exchangeRate!
          } else if (row.currency === "$" && prefCurrency === "L") {
            equivalent = amount * row.exchangeRate!
          }
        }

        return (
          <div className="flex flex-col items-end">
            <span className={`font-extrabold tabular-nums whitespace-nowrap ${
              row.type === "income" ? "text-green-600" : "text-red-500"
            }`}>
              {sign}{row.currency}{amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {equivalent !== null && (
              <span className="text-[10px] text-slate-400 font-semibold tabular-nums">
                ≈ {prefCurrency}{equivalent.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        )
      },
      sortingFn: "basic",
    }),
    columnHelper.accessor("wishlistItem", {
      header: "Deseo",
      cell: (info) =>
        info.getValue() ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-[10px] font-bold text-purple-700">
            {info.getValue()!.name}
          </span>
        ) : (
          <span className="text-slate-300 text-[10px]">—</span>
        ),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: (info) => (
        <button
          onClick={() => handleDelete(info.row.original.id)}
          className="text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1"
          title="Eliminar"
        >
          <Trash size={15} />
        </button>
      ),
    }),
  ], [columnHelper])

  const table = useReactTable({
    data: transactions,
    columns,
    state: {
      sorting,
      globalFilter: search,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
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
          <a href="/transacciones" className="text-sm font-bold text-[#2563EB] hover:underline">
            + Nueva
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none">
            Historial de Movimientos
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Consulta, filtra y administra todas tus transacciones registradas.
          </p>
        </div>

        {/* Filtros server-side (tipo + mes) + búsqueda cliente-side */}
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
            placeholder="Buscar en toda la tabla..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#2563EB] placeholder:text-slate-400"
          />
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-slate-400 text-sm font-medium">No hay transacciones con estos filtros</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
                        {hg.headers.map((header) => (
                          <th
                            key={header.id}
                            onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                            className={`text-left px-4 py-3.5 text-[10px] font-black text-slate-500 uppercase tracking-wider ${
                              header.column.getCanSort() ? "cursor-pointer select-none hover:text-slate-800" : ""
                            } ${header.id === "amount" ? "text-right" : header.id === "actions" ? "text-center w-12" : ""}`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getCanSort() && (
                                header.column.getIsSorted() === "asc" ? <ArrowUp size={12} /> :
                                header.column.getIsSorted() === "desc" ? <ArrowDown size={12} /> :
                                <ChevronExpandY size={12} className="text-slate-300" />
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
                          <td
                            key={cell.id}
                            className={`px-4 py-3.5 whitespace-nowrap ${
                              cell.column.id === "date" ? "text-slate-600 font-semibold" : ""
                            } ${cell.column.id === "amount" ? "text-right" : ""} ${cell.column.id === "actions" ? "text-center" : ""}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
                <p className="text-xs text-slate-500 font-medium">
                  {table.getFilteredRowModel().rows.length} movimiento{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-3">
                  <select
                    value={table.getState().pagination.pageSize}
                    onChange={(e) => table.setPageSize(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none"
                  >
                    {[10, 15, 25, 50].map((size) => (
                      <option key={size} value={size}>{size} por pág</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs font-bold text-slate-600 min-w-[60px] text-center tabular-nums">
                      Pág {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
                    </span>
                    <button
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Mover a papelera"
        message="Esta transacción se moverá a la papelera. Podrás recuperarla después si lo deseas."
        confirmLabel="Mover a papelera"
      />
    </div>
  )
}
