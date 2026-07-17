"use server"

import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { getAvailableBalance as calcAvailableBalance } from "@/lib/balance"
import { amountToLempiras } from "@/lib/currency"
import { getDefaultRate } from "@/lib/exchange-rate"

export async function getEmergencyFundBalance() {
  const session = await auth()
  if (!session?.user?.id) return 0

  const rate = await getDefaultRate()
  const tx = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
  })

  const deposits = tx
    .filter((t) => t.type === "expense" && t.category === "Fondo Emergencia")
    .reduce((sum, t) => sum + amountToLempiras(t.amount.toNumber(), t.currency, rate), 0)

  const withdrawals = tx
    .filter((t) => t.type === "income" && t.category === "Retiro Fondo Emergencia")
    .reduce((sum, t) => sum + amountToLempiras(t.amount.toNumber(), t.currency, rate), 0)

  return deposits - withdrawals
}

export async function getEmergencyFundGoal() {
  const session = await auth()
  if (!session?.user?.id) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { emergencyFundGoal: true },
  })

  return user?.emergencyFundGoal?.toNumber() ?? null
}

export async function setEmergencyFundGoal(goal: number) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  if (goal < 0) return { error: "La meta debe ser mayor o igual a cero" }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { emergencyFundGoal: goal },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function depositToEmergencyFund(amount: number) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  if (amount <= 0) return { error: "El monto debe ser mayor a cero" }

  const rate = await getDefaultRate()
  const allTransactions = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
  })

  const saldoDisponible = calcAvailableBalance(allTransactions, (t) =>
    amountToLempiras(t.amount.toNumber(), t.currency, rate),
  )

  if (amount > saldoDisponible) {
    return {
      error: `Saldo insuficiente. Solo tienes L${saldoDisponible.toFixed(2)} disponible${
        saldoDisponible <= 0 ? ". Primero registra un ingreso." : "."
      }`,
    }
  }

  await prisma.transaction.create({
    data: {
      type: "expense",
      amount,
      category: "Fondo Emergencia",
      description: "Aporte al fondo de emergencia",
      date: new Date(),
      userId: session.user.id,
    },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function withdrawFromEmergencyFund(amount: number) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  if (amount <= 0) return { error: "El monto debe ser mayor a cero" }

  const balance = await getEmergencyFundBalance()

  if (amount > balance) {
    return { error: `Solo tienes L${balance.toFixed(2)} en el fondo de emergencia.` }
  }

  await prisma.transaction.create({
    data: {
      type: "income",
      amount,
      category: "Retiro Fondo Emergencia",
      description: "Retiro del fondo de emergencia",
      date: new Date(),
      userId: session.user.id,
    },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}
