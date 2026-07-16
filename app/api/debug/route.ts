export const dynamic = "force-dynamic"

export async function GET() {
  const vars = [
    "DATABASE_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
  ]
  const result: Record<string, string> = {}
  for (const v of vars) {
    result[v] = process.env[v] ? "SET (length=" + process.env[v]!.length + ", starts=" + process.env[v]!.slice(0, 20) + "...)" : "NOT SET"
  }
  return Response.json(result)
}
