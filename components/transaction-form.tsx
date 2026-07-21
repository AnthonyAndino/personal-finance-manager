"use client"

import { useActionState, useState, useEffect, useRef } from "react"
import { createTransaction } from "@/lib/actions/transactions"
import { listUnpurchasedWishlistItems } from "@/lib/actions/wishlist"
import { WISHLIST_PURCHASE_CATEGORY } from "@/lib/transaction-categories"
import DatePicker from "react-datepicker"
import "react-datepicker/dist/react-datepicker.css"
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from "reicon-react"

type WishlistItem = { id: string; name: string; estimatedPrice: number | null }

const dayNamesMap: { [key: string]: string } = {
  Su: "Do",
  Mo: "Lu",
  Tu: "Ma",
  We: "Mi",
  Th: "Ju",
  Fr: "Vi",
  Sa: "Sá"
}

function CustomSelect({
  value,
  options,
  onChange,
  className = "",
  variant = "default",
  fullWidth = false,
}: {
  value: number | string
  options: { value: number | string; label: string }[]
  onChange: (value: any) => void
  className?: string
  variant?: "default" | "ghost"
  fullWidth?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [isOpen])

  const selectedOption = options.find((o) => o.value === value)

  const btnClasses = variant === "ghost"
      ? `bg-transparent hover:bg-slate-100/60 active:bg-slate-100 text-slate-800 font-extrabold text-sm rounded-xl px-2.5 py-1.5 outline-none transition-all cursor-pointer flex items-center gap-1 justify-center ${className}`
      : `bg-slate-50 hover:bg-slate-100/80 active:bg-slate-100 text-slate-800 font-extrabold text-xs rounded-xl border border-slate-200/80 px-3 py-2 outline-none focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10 transition-all cursor-pointer flex items-center gap-1.5 ${fullWidth ? "w-full" : "min-w-[72px]"} justify-between ${className}`

  return (
    <div ref={ref} className={fullWidth ? "relative w-full" : "relative inline-block text-left"}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={btnClasses}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown size={variant === "ghost" ? 10 : 12} className={`text-slate-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className={`absolute ${variant === "ghost" ? "left-1/2 -translate-x-1/2" : "left-0"} mt-1 z-[60] ${fullWidth ? "w-full" : "min-w-[180px]"} bg-white border border-slate-200/80 rounded-2xl shadow-xl p-1.5 max-h-60 overflow-y-auto scrollbar-thin flex flex-col gap-0.5`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value)
                setIsOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                opt.value === value
                  ? "bg-[#2563EB] text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TransactionForm({ defaultRate = 26.75 }: { defaultRate?: number }) {
  const [state, formAction, pending] = useActionState(createTransaction, null)
  const [type, setType] = useState("income")
  const [txCurrency, setTxCurrency] = useState("L")
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [selectedWishlist, setSelectedWishlist] = useState("")
  const [amount, setAmount] = useState("")
  const [category, setCategory] = useState("")

  useEffect(() => {
    if (state?.success) {
      setTimeout(() => window.location.reload(), 1200)
    }
  }, [state?.success])

  useEffect(() => {
    if (type === "expense") {
      listUnpurchasedWishlistItems().then(setWishlistItems)
    } else {
      setSelectedWishlist("")
    }
  }, [type])

  const handleWishlistSelect = (wishlistId: string) => {
    setSelectedWishlist(wishlistId)
    if (!wishlistId) return

    const item = wishlistItems.find((i) => i.id === wishlistId)
    if (!item) return

    if (item.estimatedPrice) {
      setAmount(item.estimatedPrice.toString())
    }
    setCategory(WISHLIST_PURCHASE_CATEGORY)
  }

  return (
    <form
      action={formAction}
      className="bg-white rounded-3xl border border-slate-200/60 shadow-[0_15px_40px_rgba(0,0,0,0.03)] p-6 md:p-8 flex flex-col gap-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-black text-slate-900">
          Nueva Transacción
        </h2>
        <p className="text-xs text-slate-400 font-medium">Registra tus ingresos o gastos.</p>
      </div>

      {state?.error && (
        <div className="rounded-xl bg-red-50 border border-red-200/80 p-3.5 text-sm text-red-600 font-semibold text-center">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="rounded-xl bg-green-50 border border-green-200/80 p-3.5 text-sm text-green-600 font-semibold text-center">
          ¡Transacción registrada con éxito!
        </div>
      )}

      {/* Selector de Tipo */}
      <div className="flex gap-4">
        <label
          onClick={() => setType("income")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-2xl border-2 p-4 cursor-pointer transition-all ${
            type === "income"
              ? "border-green-500 bg-green-50/50"
              : "border-slate-100 bg-slate-50 hover:bg-slate-100/50"
          }`}
        >
          <input type="radio" name="type" value="income" defaultChecked className="hidden" />
          <span className={`text-sm font-black ${type === "income" ? "text-green-700" : "text-slate-700"}`}>
            Ingreso
          </span>
        </label>
        <label
          onClick={() => setType("expense")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-2xl border-2 p-4 cursor-pointer transition-all ${
            type === "expense"
              ? "border-red-500 bg-red-50/50"
              : "border-slate-100 bg-slate-50 hover:bg-slate-100/50"
          }`}
        >
          <input type="radio" name="type" value="expense" className="hidden" />
          <span className={`text-sm font-black ${type === "expense" ? "text-red-700" : "text-slate-700"}`}>
            Gasto
          </span>
        </label>
      </div>

      {/* Moneda */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Moneda</label>
        <div className="flex gap-4">
          <label
            onClick={() => setTxCurrency("L")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-2xl border-2 p-4 cursor-pointer transition-all ${
              txCurrency === "L"
                ? "border-blue-500 bg-blue-50/50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <input type="radio" name="currency" value="L" defaultChecked className="hidden" />
            <span className={`text-sm font-black ${txCurrency === "L" ? "text-blue-700" : "text-slate-600"}`}>Lempiras (L)</span>
          </label>
          <label
            onClick={() => setTxCurrency("$")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-2xl border-2 p-4 cursor-pointer transition-all ${
              txCurrency === "$"
                ? "border-green-500 bg-green-50/50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <input type="radio" name="currency" value="$" className="hidden" />
            <span className={`text-sm font-black ${txCurrency === "$" ? "text-green-700" : "text-slate-600"}`}>Dólares ($)</span>
          </label>
        </div>
      </div>

      {/* Monto */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Monto ({txCurrency})</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">{txCurrency}</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white text-slate-900 placeholder-slate-400 rounded-xl border border-slate-200 py-3.5 pl-8 pr-4 text-base font-extrabold outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
          />
        </div>
      </div>

      {/* Categoría */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Categoría</label>
        <input
          name="category"
          type="text"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Ej. Gasolina, Lavado, Comida"
          className="bg-white text-slate-900 placeholder-slate-400 rounded-xl border border-slate-200 py-3.5 px-4 text-sm outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
        />
      </div>

      {/* Descripción */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Descripción</label>
        <input
          name="description"
          type="text"
          placeholder="Opcional"
          className="bg-white text-slate-900 placeholder-slate-400 rounded-xl border border-slate-200 py-3.5 px-4 text-sm outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
        />
      </div>

      {/* Tasa de cambio (solo dólares) */}
      {txCurrency === "$" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tasa de cambio (L por $)</label>
          <input
            name="exchangeRate"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Ej. 25.00"
            defaultValue={defaultRate.toFixed(2)}
            className="w-full bg-white text-slate-900 placeholder-slate-400 rounded-xl border border-slate-200 py-3.5 px-4 text-sm outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
          />
        </div>
      )}

      {/* Vincular a deseo (solo gastos — cuenta como compra real) */}
      {type === "expense" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Vincular a deseo (compra)
          </label>
          {wishlistItems.length > 0 ? (
            <div className="relative">
              <CustomSelect
                value={selectedWishlist}
                options={[
                  { value: "", label: "Sin vínculo" },
                  ...wishlistItems.map((item) => ({
                    value: item.id,
                    label: `${item.name}${item.estimatedPrice ? ` (L${item.estimatedPrice})` : ""}`,
                  })),
                ]}
                onChange={(v) => handleWishlistSelect(v as string)}
                fullWidth
              />
              <input type="hidden" name="wishlistItemId" value={selectedWishlist} />
            </div>
          ) : (
            <p className="text-xs text-slate-400 font-medium bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5">
              No tienes deseos activos. Crea uno en la sección Deseos.
            </p>
          )}
          {selectedWishlist && (
            <p className="text-xs text-blue-600 font-semibold">
              Al registrar, el deseo se marcará como comprado y el monto contará en tus gastos del mes.
            </p>
          )}
        </div>
      )}

      {/* Fecha */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Fecha</label>
        <div className="relative">
          <DatePicker
            selected={selectedDate}
            onChange={(date: Date | null) => {
              if (date) setSelectedDate(date)
            }}
            dateFormat="dd/MM/yyyy"
            className="w-full bg-white text-slate-900 rounded-xl border border-slate-200 py-3.5 px-4 text-sm outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10 cursor-pointer"
            calendarClassName="!border !border-slate-100 !rounded-3xl !shadow-[0_25px_60px_-15px_rgba(15,23,42,0.12)] !bg-white !p-4"
            wrapperClassName="w-full"
            popperClassName="!z-50"
            fixedHeight
            formatWeekDay={(nameOfDay) => dayNamesMap[nameOfDay.substring(0, 2)] || nameOfDay}
            renderCustomHeader={({
              date,
              changeMonth,
              decreaseMonth,
              increaseMonth,
              prevMonthButtonDisabled,
              nextMonthButtonDisabled,
            }) => {
              const months = [
                "Enero",
                "Febrero",
                "Marzo",
                "Abril",
                "Mayo",
                "Junio",
                "Julio",
                "Agosto",
                "Septiembre",
                "Octubre",
                "Noviembre",
                "Diciembre",
              ]

              const monthOptions = months.map((m, idx) => ({ value: idx, label: m }))

              return (
                <div className="flex items-center justify-between px-2 py-1 bg-white mb-3">
                  <button
                    type="button"
                    onClick={decreaseMonth}
                    disabled={prevMonthButtonDisabled}
                    className="w-8 h-8 rounded-xl hover:bg-slate-100/80 active:scale-95 transition-all text-slate-600 disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center border border-transparent"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <CustomSelect
                    value={date.getMonth()}
                    options={monthOptions}
                    onChange={changeMonth}
                    variant="ghost"
                  />

                  <button
                    type="button"
                    onClick={increaseMonth}
                    disabled={nextMonthButtonDisabled}
                    className="w-8 h-8 rounded-xl hover:bg-slate-100/80 active:scale-95 transition-all text-slate-600 disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center border border-transparent"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )
            }}
          />
          <Calendar size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input type="hidden" name="date" value={`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#2563EB] text-white font-extrabold tracking-wider text-sm rounded-2xl py-4 px-4 uppercase hover:bg-blue-700 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:pointer-events-none cursor-pointer mt-2"
      >
        {pending ? "Guardando..." : "Registrar Transacción"}
      </button>
    </form>
  )
}
