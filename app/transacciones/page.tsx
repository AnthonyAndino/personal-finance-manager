import { auth } from "@/lib/auth.config"
import { redirect } from "next/navigation"
import { TransactionForm } from "@/components/transaction-form"
import { RecentTransactions } from "@/components/recent-transactions"
import { Sidebar } from "@/components/sidebar"
import { getDefaultRate } from "@/lib/exchange-rate"

export default async function TransactionsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const defaultRate = await getDefaultRate()

  return (
    <div className="flex flex-1 flex-col w-full min-h-screen lg:pl-64 pb-16 lg:pb-0">
      <Sidebar userName={session.user?.name} userEmail={session.user?.email} />

      <header className="border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-900 hover:opacity-95 transition-opacity">
            <span className="bg-[#2563EB] text-white px-2 py-0.5 rounded-md text-sm font-black">G</span>
            <span>Control<span className="text-[#2563EB] font-black">Gastos</span></span>
          </a>
          <div className="hidden sm:flex flex-col items-end text-right">
            <span className="text-sm font-bold text-slate-800">{session.user.name ?? session.user.email}</span>
            <span className="text-xs text-slate-400 font-medium">Panel de Control</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none">
            Registrar Transacción
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Registra un nuevo ingreso o gasto. También puedes vincular gastos a tus deseos.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5">
            <TransactionForm defaultRate={defaultRate} />
          </div>
          <div className="lg:col-span-7">
            <RecentTransactions prefCurrency="L" />
          </div>
        </div>
      </main>
    </div>
  )
}
