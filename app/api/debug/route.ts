import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::int as count FROM "User"`
    return Response.json({ users: result[0] })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
