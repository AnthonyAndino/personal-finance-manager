const WEAK_PASSWORDS = new Set(["demo123", "password", "12345678", "123456789"])

export function isWeakPassword(password: string, email: string): boolean {
  if (password.length < 10) return true
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return true

  const local = email.split("@")[0]?.toLowerCase() ?? ""
  if (local && password.toLowerCase() === `${local}123`) return true
  if (local && password.toLowerCase() === local) return true

  return false
}
