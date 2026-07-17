"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

const createSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(120).trim(),
  estimatedPrice: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().positive("El precio debe ser positivo").optional(),
  ),
  priority: z.enum(["baja", "media", "alta"]).default("media"),
  currency: z.enum(["$", "L"]).default("L"),
  exchangeRate: z.string().optional(),
})

const idSchema = z.string().min(1, "El ID es requerido")

export async function createWishlistItem(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    estimatedPrice: formData.get("estimatedPrice"),
    priority: formData.get("priority") || undefined,
    currency: formData.get("currency") || "L",
    exchangeRate: formData.get("exchangeRate") || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  await prisma.wishlistItem.create({
    data: {
      name: parsed.data.name,
      estimatedPrice: parsed.data.estimatedPrice,
      priority: parsed.data.priority,
      currency: parsed.data.currency,
      exchangeRate: parsed.data.exchangeRate ? Number(parsed.data.exchangeRate) : undefined,
      userId: session.user.id,
    },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function listWishlistItems() {
  const session = await auth()
  if (!session?.user?.id) return []

  const data = await prisma.wishlistItem.findMany({
    where: { userId: session.user.id },
    include: {
      transactions: {
        where: { deletedAt: null, userId: session.user.id },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return data.map((item) => {
    const totalAportado = item.transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => {
        const val = t.amount.toNumber()
        const converted = (t.currency === "$" && t.exchangeRate)
          ? val * t.exchangeRate.toNumber()
          : val
        return sum + converted
      }, 0)

    const totalRetirado = item.transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => {
        const val = t.amount.toNumber()
        const converted = (t.currency === "$" && t.exchangeRate)
          ? val * t.exchangeRate.toNumber()
          : val
        return sum + converted
      }, 0)

    const savedAmount = Math.max(0, totalAportado - totalRetirado)

    return {
      id: item.id,
      name: item.name,
      estimatedPrice: item.estimatedPrice?.toNumber() ?? null,
      priority: item.priority,
      purchased: item.purchased,
      currency: item.currency,
      exchangeRate: item.exchangeRate?.toNumber() ?? null,
      userId: item.userId,
      createdAt: item.createdAt,
      savedAmount,
    }
  })
}

export async function listUnpurchasedWishlistItems() {
  const session = await auth()
  if (!session?.user?.id) return []

  const data = await prisma.wishlistItem.findMany({
    where: { userId: session.user.id, purchased: false },
    orderBy: { createdAt: "desc" },
  })

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    estimatedPrice: item.estimatedPrice?.toNumber() ?? null,
  }))
}

export async function togglePurchased(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const parsed = idSchema.safeParse(id)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const item = await prisma.wishlistItem.findUnique({ where: { id: parsed.data } })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.wishlistItem.update({
    where: { id: parsed.data },
    data: { purchased: !item.purchased },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function deleteWishlistItem(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const parsed = idSchema.safeParse(id)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const item = await prisma.wishlistItem.findUnique({ where: { id: parsed.data } })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.transaction.deleteMany({ where: { wishlistItemId: parsed.data } })
  await prisma.wishlistItem.delete({ where: { id: parsed.data } })

  revalidatePath("/")
  revalidatePath("/wishlist")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
  return { success: true }
}

export async function addFundsToWishlist(id: string, amount: number) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  if (amount <= 0) return { error: "El monto debe ser mayor a cero" }

  const item = await prisma.wishlistItem.findUnique({
    where: { id },
    include: {
      transactions: { where: { deletedAt: null, userId: session.user.id } }
    }
  })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  // Verificar saldo disponible del usuario (excluye ahorros/retiros de deseos)
  const allTransactions = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
  })

  const toLempiras = (t: { amount: { toNumber(): number }; currency: string; exchangeRate?: { toNumber(): number } | null }) => {
    const val = t.amount.toNumber()
    return t.currency === "$" && t.exchangeRate ? val * t.exchangeRate.toNumber() : val
  }

  const totalIncome = allTransactions
    .filter((t) => t.type === "income" && !["Retiro Ahorro", "Retiro Fondo Emergencia"].includes(t.category))
    .reduce((sum, t) => sum + toLempiras(t), 0)

  const totalExpenses = allTransactions
    .filter((t) => t.type === "expense" && !["Ahorro", "Fondo Emergencia"].includes(t.category))
    .reduce((sum, t) => sum + toLempiras(t), 0)

  const saldoDisponible = totalIncome - totalExpenses

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
      amount: amount,
      category: "Ahorro",
      description: `Aporte a ahorro: ${item.name}`,
      date: new Date(),
      userId: session.user.id,
      wishlistItemId: item.id,
    }
  })

  // Verificar si con este aporte se alcanza la meta
  const totalAportado = item.transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0) + amount

  const totalRetirado = item.transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0)

  const nuevoAhorro = totalAportado - totalRetirado

  if (item.estimatedPrice && nuevoAhorro >= item.estimatedPrice.toNumber() && !item.purchased) {
    await prisma.wishlistItem.update({
      where: { id: item.id },
      data: { purchased: true }
    })
  }

  revalidatePath("/")
  revalidatePath("/wishlist")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
  return { success: true }
}

export async function withdrawFundsFromWishlist(id: string, amount: number) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  if (amount <= 0) return { error: "El monto debe ser mayor a cero" }

  const item = await prisma.wishlistItem.findUnique({
    where: { id },
    include: {
      transactions: { where: { deletedAt: null, userId: session.user.id } }
    }
  })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  const totalAportado = item.transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0)

  const totalRetirado = item.transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0)

  const ahorroActual = totalAportado - totalRetirado

  if (amount > ahorroActual) {
    return { error: `Monto insuficiente. Solo tienes L${ahorroActual.toFixed(2)} en esta alcancía.` }
  }

  await prisma.transaction.create({
    data: {
      type: "income",
      amount: amount,
      category: "Retiro Ahorro",
      description: `Retiro de ahorro: ${item.name}`,
      date: new Date(),
      userId: session.user.id,
      wishlistItemId: item.id,
    }
  })

  const nuevoAhorro = ahorroActual - amount
  if (item.estimatedPrice && nuevoAhorro < item.estimatedPrice.toNumber() && item.purchased) {
    await prisma.wishlistItem.update({
      where: { id: item.id },
      data: { purchased: false }
    })
  }

  revalidatePath("/")
  revalidatePath("/wishlist")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
  return { success: true }
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "El nombre es requerido").max(120).trim(),
  estimatedPrice: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().positive("El precio debe ser positivo").optional(),
  ),
  priority: z.enum(["baja", "media", "alta"]).default("media"),
  currency: z.enum(["$", "L"]).default("L"),
  exchangeRate: z.string().optional(),
})

export async function updateWishlistItem(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autorizado" }

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    estimatedPrice: formData.get("estimatedPrice"),
    priority: formData.get("priority") || undefined,
    currency: formData.get("currency") || "L",
    exchangeRate: formData.get("exchangeRate") || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const item = await prisma.wishlistItem.findUnique({ where: { id: parsed.data.id } })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  await prisma.wishlistItem.update({
    where: { id: parsed.data.id },
    data: {
      name: parsed.data.name,
      estimatedPrice: parsed.data.estimatedPrice,
      priority: parsed.data.priority,
      currency: parsed.data.currency,
      exchangeRate: parsed.data.exchangeRate ? Number(parsed.data.exchangeRate) : null,
    },
  })

  revalidatePath("/")
  revalidatePath("/wishlist")
  return { success: true }
}

export async function getAvailableBalance() {
  const session = await auth()
  if (!session?.user?.id) return 0

  const allTransactions = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
  })

  const toLempiras = (t: { amount: { toNumber(): number }; currency: string; exchangeRate?: { toNumber(): number } | null }) => {
    const val = t.amount.toNumber()
    return t.currency === "$" && t.exchangeRate ? val * t.exchangeRate.toNumber() : val
  }

  const totalIncome = allTransactions
    .filter((t) => t.type === "income" && !["Retiro Ahorro", "Retiro Fondo Emergencia"].includes(t.category))
    .reduce((sum, t) => sum + toLempiras(t), 0)

  const totalExpenses = allTransactions
    .filter((t) => t.type === "expense" && !["Ahorro", "Fondo Emergencia"].includes(t.category))
    .reduce((sum, t) => sum + toLempiras(t), 0)

  return totalIncome - totalExpenses
}
