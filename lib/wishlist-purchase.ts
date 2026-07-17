import prisma from "@/lib/prisma"
import { WISHLIST_PURCHASE_CATEGORY } from "@/lib/transaction-categories"

export type WishlistItemTx = {
  type: string
  amount: { toNumber(): number }
  currency: string
  exchangeRate?: { toNumber(): number } | null
  category: string
}

function toLempiras(t: WishlistItemTx): number {
  const val = t.amount.toNumber()
  return t.currency === "$" && t.exchangeRate ? val * t.exchangeRate.toNumber() : val
}

export function calcWishlistSavedAmount(transactions: WishlistItemTx[]): number {
  const aportado = transactions
    .filter((t) => t.type === "expense" && t.category === "Ahorro")
    .reduce((sum, t) => sum + toLempiras(t), 0)

  const retirado = transactions
    .filter((t) => t.type === "income" && t.category === "Retiro Ahorro")
    .reduce((sum, t) => sum + toLempiras(t), 0)

  return Math.max(0, aportado - retirado)
}

export function hasWishlistPurchaseExpense(transactions: WishlistItemTx[]): boolean {
  return transactions.some((t) => t.type === "expense" && t.category !== "Ahorro")
}

/** Registra la compra real del deseo y libera el ahorro acumulado si aplica */
export async function recordWishlistPurchase({
  userId,
  itemId,
  itemName,
  purchaseAmount,
  currency = "L",
  exchangeRate = null as number | null,
  date = new Date(),
  description,
  skipPurchaseExpense = false,
  existingTransactions = [] as WishlistItemTx[],
}: {
  userId: string
  itemId: string
  itemName: string
  purchaseAmount: number
  currency?: string
  exchangeRate?: number | null
  date?: Date
  description?: string
  skipPurchaseExpense?: boolean
  existingTransactions?: WishlistItemTx[]
}) {
  const savedAmount = calcWishlistSavedAmount(existingTransactions)
  const purchaseInL = currency === "$" && exchangeRate ? purchaseAmount * exchangeRate : purchaseAmount
  const releaseAmount = Math.min(savedAmount, purchaseInL)

  if (!skipPurchaseExpense && !hasWishlistPurchaseExpense(existingTransactions)) {
    await prisma.transaction.create({
      data: {
        type: "expense",
        amount: purchaseAmount,
        category: WISHLIST_PURCHASE_CATEGORY,
        description: description ?? `Compra: ${itemName}`,
        date,
        userId,
        wishlistItemId: itemId,
        currency,
        exchangeRate,
      },
    })
  }

  if (releaseAmount > 0) {
    await prisma.transaction.create({
      data: {
        type: "income",
        amount: releaseAmount,
        category: "Retiro Ahorro",
        description: `Ahorro aplicado a compra: ${itemName}`,
        date,
        userId,
        wishlistItemId: itemId,
        currency: "L",
      },
    })
  }

  await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { purchased: true },
  })
}
