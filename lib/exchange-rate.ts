import prisma from "@/lib/prisma"
import { FALLBACK_EXCHANGE_RATE } from "@/lib/currency"

/** Cada cuánto se consulta la API de nuevo (1 hora) */
export const EXCHANGE_RATE_REFRESH_MS = 60 * 60 * 1000

const RATE_SETTING_KEY = "usd_hnl_exchange_rate"

let memoryCache: { rate: number; fetchedAt: number } | null = null

async function fetchRateFromApi(): Promise<number | null> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    next: { revalidate: EXCHANGE_RATE_REFRESH_MS / 1000 },
  })
  const data = await res.json()
  if (typeof data.rates?.HNL === "number" && data.rates.HNL > 0) {
    return data.rates.HNL
  }
  return null
}

async function persistRate(rate: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: RATE_SETTING_KEY },
    create: { key: RATE_SETTING_KEY, value: rate.toString() },
    update: { value: rate.toString() },
  })
}

async function loadStoredRate(): Promise<number | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: RATE_SETTING_KEY } })
  if (!row) return null
  const rate = Number(row.value)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

function isMemoryCacheFresh(): boolean {
  if (!memoryCache) return false
  return Date.now() - memoryCache.fetchedAt < EXCHANGE_RATE_REFRESH_MS
}

/**
 * Obtiene la tasa USD → Lempiras.
 * 1. Si hay caché en memoria de menos de 1 h, la usa.
 * 2. Si no, consulta open.er-api.com y guarda el resultado.
 * 3. Si la API falla, usa la última tasa guardada en BD.
 * 4. Solo si nunca hubo una tasa guardada, usa el respaldo inicial (26.75).
 */
export async function getDefaultRate(): Promise<number> {
  if (isMemoryCacheFresh()) {
    return memoryCache!.rate
  }

  try {
    const apiRate = await fetchRateFromApi()
    if (apiRate) {
      await persistRate(apiRate)
      memoryCache = { rate: apiRate, fetchedAt: Date.now() }
      return apiRate
    }
  } catch {
    // Continuar al respaldo persistido
  }

  const storedRate = await loadStoredRate()
  if (storedRate) {
    memoryCache = { rate: storedRate, fetchedAt: Date.now() }
    return storedRate
  }

  return FALLBACK_EXCHANGE_RATE
}
