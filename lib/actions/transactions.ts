"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { recordWishlistPurchase } from "@/lib/wishlist-purchase"

const createSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive("El monto debe ser positivo").max(999_999_999),
  category: z.string().min(1, "La categoría es requerida").max(80).trim(),
  description: z.string().max(500).optional(),
  date: z.string().min(1, "La fecha es requerida"),
  wishlistItemId: z.string().optional(),
  currency: z.enum(["$", "L"]).default("L"),
  exchangeRate: z.string().optional(),
})

export async function createTransaction(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const parsed = createSchema.safeParse({
    type: formData.get("type"),
    amount: formData.get("amount") ? Number(formData.get("amount")) : undefined,
    category: formData.get("category"),
    description: formData.get("description") || undefined,
    date: formData.get("date"),
    wishlistItemId: formData.get("wishlistItemId") || undefined,
    currency: formData.get("currency") || "L",
    exchangeRate: formData.get("exchangeRate") || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const [y, m, d] = parsed.data.date.split("-").map(Number)
  const parsedDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: "Fecha inválida" }
  }

  let wishlistItemId: string | null = null
  let wishlistItem: { id: string; name: string; purchased: boolean; transactions: { type: string; amount: { toNumber(): number }; currency: string; exchangeRate: { toNumber(): number } | null; category: string }[] } | null = null

  if (parsed.data.wishlistItemId) {
    if (parsed.data.type !== "expense") {
      return { error: "Solo puedes vincular un deseo a gastos" }
    }

    const item = await prisma.wishlistItem.findUnique({
      where: { id: parsed.data.wishlistItemId },
      include: {
        transactions: { where: { deletedAt: null, userId: session.user.id } },
      },
    })
    if (!item || item.userId !== session.user.id) {
      return { error: "El deseo seleccionado no es válido" }
    }
    if (item.purchased) {
      return { error: "Este deseo ya está marcado como comprado" }
    }
    wishlistItemId = item.id
    wishlistItem = item
  }

  let exchangeRate: number | null = null
  if (parsed.data.exchangeRate) {
    const rate = Number(parsed.data.exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 9999) {
      return { error: "Tipo de cambio inválido" }
    }
    exchangeRate = rate
  }

  await prisma.transaction.create({
    data: {
      type: parsed.data.type,
      amount: parsed.data.amount,
      category: parsed.data.category,
      description: parsed.data.description,
      date: parsedDate,
      userId: session.user.id,
      wishlistItemId,
      currency: parsed.data.currency,
      exchangeRate,
    },
  })

  if (wishlistItem && wishlistItemId) {
    await recordWishlistPurchase({
      userId: session.user.id,
      itemId: wishlistItemId,
      itemName: wishlistItem.name,
      purchaseAmount: parsed.data.amount,
      currency: parsed.data.currency,
      exchangeRate,
      date: parsedDate,
      description: parsed.data.description ?? `Compra: ${wishlistItem.name}`,
      skipPurchaseExpense: true,
      existingTransactions: wishlistItem.transactions,
    })
  }

  revalidatePath("/")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function listTransactions() {
  const session = await auth()
  if (!session?.user?.id) return []

  const data = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  })

  return data.map((t) => ({
    ...t,
    amount: t.amount.toNumber(),
    currency: t.currency,
    exchangeRate: t.exchangeRate?.toNumber() ?? null,
  }))
}

export async function listAllTransactions(filters: {
  type?: "income" | "expense" | "all"
  month?: string
  search?: string
}) {
  const session = await auth()
  if (!session?.user?.id) return []

  const where: Record<string, unknown> = { userId: session.user.id, deletedAt: null }

  if (filters.type && filters.type !== "all") {
    where.type = filters.type
  }

  if (filters.month) {
    const [y, m] = filters.month.split("-").map(Number)
    where.date = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) }
  }

  if (filters.search) {
    where.OR = [
      { category: { contains: filters.search } },
      { description: { contains: filters.search } },
    ]
  }

  const data = await prisma.transaction.findMany({
    where: where as any,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { wishlistItem: { select: { id: true, name: true } } },
  })

  return data.map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount.toNumber(),
    category: t.category,
    description: t.description,
    date: t.date.toISOString(),
    wishlistItem: t.wishlistItem,
    currency: t.currency,
    exchangeRate: t.exchangeRate?.toNumber() ?? null,
    createdAt: t.createdAt.toISOString(),
  }))
}

export async function deleteTransaction(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const item = await prisma.transaction.findUnique({ where: { id } })
  if (!item) return { error: "La transacción no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.transaction.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  revalidatePath("/")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
  revalidatePath("/papelera")
  return { success: true }
}

export async function recoverTransaction(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const item = await prisma.transaction.findUnique({ where: { id } })
  if (!item) return { error: "La transacción no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.transaction.update({
    where: { id },
    data: { deletedAt: null },
  })

  revalidatePath("/papelera")
  revalidatePath("/")
  revalidatePath("/historial")
  return { success: true }
}

export async function permanentDeleteTransaction(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const item = await prisma.transaction.findUnique({ where: { id } })
  if (!item) return { error: "La transacción no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.transaction.delete({ where: { id } })

  revalidatePath("/papelera")
  return { success: true }
}

export async function listTrashedTransactions() {
  const session = await auth()
  if (!session?.user?.id) return []

  const data = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    include: { wishlistItem: { select: { id: true, name: true } } },
  })

  return data.map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount.toNumber(),
    category: t.category,
    description: t.description,
    date: t.date.toISOString(),
    wishlistItem: t.wishlistItem,
    currency: t.currency,
    exchangeRate: t.exchangeRate?.toNumber() ?? null,
    deletedAt: t.deletedAt!.toISOString(),
    createdAt: t.createdAt.toISOString(),
  }))
}
