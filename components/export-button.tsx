"use client"

import { Download } from "reicon-react"

export function ExportButton({
  month,
  period = "month",
  label = "Exportar",
}: {
  month: string
  period?: "month" | "all"
  label?: string
}) {
  const handleExport = async () => {
    const query = period === "all" ? "period=all" : `month=${month}`
    const res = await fetch(`/api/export?${query}`)
    if (!res.ok) {
      alert("Error al generar el reporte")
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download =
      period === "all" ? "Control-Gastos-Historico-Acumulado.xlsx" : `Control-Gastos-${month}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white rounded-xl text-sm font-bold hover:bg-[#1d4ed8] transition-all shadow-md shadow-blue-500/20"
    >
      <Download size={18} />
      {label}
    </button>
  )
}