"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getAvailableBalance as calcAvailableBalance } from "@/lib/balance"
import { amountToLempiras } from "@/lib/currency"
import { getDefaultRate } from "@/lib/exchange-rate"
import {
  calcWishlistSavedAmount,
  recordWishlistPurchase,
} from "@/lib/wishlist-purchase"

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
      .filter((t) => t.type === "expense" && t.category === "Ahorro")
      .reduce((sum, t) => {
        const val = t.amount.toNumber()
        const converted = (t.currency === "$" && t.exchangeRate)
          ? val * t.exchangeRate.toNumber()
          : val
        return sum + converted
      }, 0)

    const totalRetirado = item.transactions
      .filter((t) => t.type === "income" && t.category === "Retiro Ahorro")
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

  const item = await prisma.wishlistItem.findUnique({
    where: { id: parsed.data },
    include: {
      transactions: { where: { deletedAt: null, userId: session.user.id } },
    },
  })
  if (!item) return { error: "El elemento no existe" }
  if (item.userId !== session.user.id) return { error: "No autorizado" }

  if (!item.purchased) {
    const rate = await getDefaultRate()
    const purchaseAmount =
      item.estimatedPrice?.toNumber() ?? calcWishlistSavedAmount(item.transactions, rate)

    if (purchaseAmount > 0) {
      await recordWishlistPurchase({
        userId: session.user.id,
        itemId: item.id,
        itemName: item.name,
        purchaseAmount,
        currency: item.currency,
        exchangeRate: item.exchangeRate?.toNumber() ?? null,
        existingTransactions: item.transactions,
      })
    } else {
      await prisma.wishlistItem.update({
        where: { id: parsed.data },
        data: { purchased: true },
      })
    }
  } else {
    await prisma.wishlistItem.update({
      where: { id: parsed.data },
      data: { purchased: false },
    })
  }

  revalidatePath("/")
  revalidatePath("/wishlist")
  revalidatePath("/transacciones")
  revalidatePath("/historial")
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
    .filter((t) => t.type === "expense" && t.category === "Ahorro")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0) + amount

  const totalRetirado = item.transactions
    .filter((t) => t.type === "income" && t.category === "Retiro Ahorro")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0)

  const nuevoAhorro = totalAportado - totalRetirado

  if (item.estimatedPrice && nuevoAhorro >= item.estimatedPrice.toNumber() && !item.purchased) {
    const updatedTransactions = [
      ...item.transactions,
      {
        type: "expense",
        amount: { toNumber: () => amount },
        currency: "L",
        exchangeRate: null,
        category: "Ahorro",
      },
    ]

    await recordWishlistPurchase({
      userId: session.user.id,
      itemId: item.id,
      itemName: item.name,
      purchaseAmount: item.estimatedPrice.toNumber(),
      currency: item.currency,
      exchangeRate: item.exchangeRate?.toNumber() ?? null,
      existingTransactions: updatedTransactions,
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
    .filter((t) => t.type === "expense" && t.category === "Ahorro")
    .reduce((sum, t) => sum + t.amount.toNumber(), 0)

  const totalRetirado = item.transactions
    .filter((t) => t.type === "income" && t.category === "Retiro Ahorro")
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

  const rate = await getDefaultRate()
  const allTransactions = await prisma.transaction.findMany({
    where: { userId: session.user.id, deletedAt: null },
  })

  return calcAvailableBalance(allTransactions, (t) =>
    amountToLempiras(t.amount.toNumber(), t.currency, rate),
  )
}
