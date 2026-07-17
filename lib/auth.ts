import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { z } from "zod"
import prisma from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { authConfig } from "./auth.config"

const DUMMY_HASH = bcrypt.hashSync("__invalid-login__", 12)

const loginSchema = z.object({
  email: z.string().email("Correo inválido"),
  password: z.string().min(1, "Contraseña requerida"),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
      }
      if (user || trigger === "update") {
        if (token.id) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { currency: true },
          })
          token.currency = dbUser?.currency ?? "L"
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.currency = (token.currency as string) ?? "L"
      }
      return session
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Correo", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("x-real-ip") ??
          "unknown"

        const withinLimit = await rateLimit(`login:${ip}:${parsed.data.email}`, 5, 15 * 60_000)
        if (!withinLimit.success) return null

        const { email, password } = parsed.data

        const user = await prisma.user.findUnique({ where: { email } })
        const valid = user
          ? await bcrypt.compare(password, user.password)
          : await bcrypt.compare(password, DUMMY_HASH)
        if (!user || !valid) return null

        return { id: user.id, name: user.name, email: user.email }
      },
    }),
  ],
})
