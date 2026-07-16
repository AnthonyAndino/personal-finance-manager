export const dynamic = "force-dynamic"

export async function GET() {
  const vars: Record<string, string> = {}
  for (const v of ["AUTH_SECRET", "NEXTAUTH_SECRET", "POSTGRES_PRISMA_URL", "POSTGRES_URL"]) {
    const val = process.env[v]
    vars[v] = val ? `SET (len=${val.length})` : "NOT SET"
  }
  vars["AUTH_SECRET_first"] = (process.env.AUTH_SECRET || "").slice(0, 10)
  return Response.json(vars)
}
