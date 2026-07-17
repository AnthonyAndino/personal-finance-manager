"use server"

import { getDefaultRate } from "@/lib/exchange-rate"

export async function fetchDefaultRate(): Promise<number> {
  return getDefaultRate()
}
