/** Neutralize Excel formula injection (=, +, -, @, tab, CR) */
export function sanitizeExcelCell(value: string | null | undefined): string {
  if (value == null || value === "") return "—"
  const dangerous = /^[=+\-@\t\r]/
  return dangerous.test(value) ? `'${value}` : value
}
