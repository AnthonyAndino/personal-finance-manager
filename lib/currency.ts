/** Solo si nunca se obtuvo una tasa de la API ni hay una guardada */
export const FALLBACK_EXCHANGE_RATE = 26.75

/** Convierte un monto individual a lempiras (sin redondear) */
export function amountToLempiras(amount: number, currency: string, rate: number): number {
  if (currency === "$") return amount * rate
  return amount
}

/** Convierte un total ya sumado en L a la moneda de visualización (un solo paso) */
export function totalFromLempiras(totalL: number, displayCurrency: string, rate: number): number {
  if (displayCurrency === "$") return totalL / rate
  return totalL
}

/** Redondeo solo para mostrar en pantalla (2 decimales) */
export function formatMoney(value: number): string {
  return value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
