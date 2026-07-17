import prisma from "@/lib/prisma"

const memoryStore = new Map<string, { count: number; resetAt: number }>()
const CLEANUP_INTERVAL = 60_000
let lastCleanup = Date.now()

function cleanupMemory() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetAt) memoryStore.delete(key)
  }
}

function rateLimitMemory(
  key: string,
  maxAttempts: number,
  windowMs: number,
): { success: boolean } {
  cleanupMemory()
  const now = Date.now()
  const entry = memoryStore.get(key)

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true }
  }

  if (entry.count >= maxAttempts) return { success: false }

  entry.count++
  return { success: true }
}

export async function rateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ success: boolean }> {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)

  try {
    const entry = await prisma.rateLimitEntry.findUnique({ where: { key } })

    if (!entry || entry.resetAt < now) {
      await prisma.rateLimitEntry.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt },
      })
      return { success: true }
    }

    if (entry.count >= maxAttempts) return { success: false }

    await prisma.rateLimitEntry.update({
      where: { key },
      data: { count: entry.count + 1 },
    })
    return { success: true }
  } catch {
    return rateLimitMemory(key, maxAttempts, windowMs)
  }
}
