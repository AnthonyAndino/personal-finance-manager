import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const CATEGORIES_INCOME = ["Viaje Uber", "Viaje Didi", "Propina", "Pago directo", "Otro ingreso"]
const CATEGORIES_EXPENSE = ["Gasolina", "Lavado", "Mantenimiento", "Comida", "Renta", "Seguro", "Llanta", "Refacción"]

function randomPick(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomAmount(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

async function main() {
  console.log("Seeding demo data...")

  const hashed = await bcrypt.hash("demo123", 10)
  const user = await prisma.user.upsert({
    where: { email: "demo@test.com" },
    update: {},
    create: { name: "Demo", email: "demo@test.com", password: hashed },
  })
  console.log(`  ✓ Demo user (demo@test.com / demo123)`)

  await prisma.transaction.deleteMany({ where: { userId: user.id } })
  await prisma.wishlistItem.deleteMany({ where: { userId: user.id } })

  const now = new Date()
  const transactions: { date: Date; type: "income" | "expense"; amount: number; category: string; description: string; userId: string }[] = []

  for (let m = 0; m < 6; m++) {
    const month = now.getMonth() - m
    const year = now.getFullYear() + (month < 0 ? -1 : 0)
    const adjMonth = ((month % 12) + 12) % 12
    const daysInMonth = new Date(year, adjMonth + 1, 0).getDate()

    const numIncomes = 5 + Math.floor(Math.random() * 6)
    for (let i = 0; i < numIncomes; i++) {
      const day = 1 + Math.floor(Math.random() * daysInMonth)
      transactions.push({
        date: new Date(year, adjMonth, day, 10 + Math.floor(Math.random() * 10)),
        type: "income",
        amount: randomAmount(80, 600),
        category: randomPick(CATEGORIES_INCOME),
        description: `Viaje #${Math.floor(Math.random() * 9000 + 1000)}`,
        userId: user.id,
      })
    }

    const numExpenses = 8 + Math.floor(Math.random() * 8)
    for (let i = 0; i < numExpenses; i++) {
      const day = 1 + Math.floor(Math.random() * daysInMonth)
      const cat = randomPick(CATEGORIES_EXPENSE)
      const min = cat === "Gasolina" ? 400 : cat === "Seguro" ? 800 : cat === "Renta" ? 3000 : 50
      const max = cat === "Gasolina" ? 1200 : cat === "Seguro" ? 1500 : cat === "Renta" ? 6000 : cat === "Mantenimiento" ? 2000 : 400
      transactions.push({
        date: new Date(year, adjMonth, day, 8 + Math.floor(Math.random() * 14)),
        type: "expense",
        amount: randomAmount(min, max),
        category: cat,
        description: cat === "Gasolina" ? "Tanque lleno" : cat === "Lavado" ? "Lavado completo" : cat === "Comida" ? "Comida del día" : "",
        userId: user.id,
      })
    }
  }

  for (const desc of ["Viaje a la zona", "Viaje al aeropuerto", "Viaje corto"]) {
    const dayOffset = Math.floor(Math.random() * 3)
    const d = new Date(now)
    d.setDate(d.getDate() - dayOffset)
    d.setHours(9 + Math.floor(Math.random() * 12))
    transactions.push({
      date: d,
      type: "income",
      amount: randomAmount(120, 350),
      category: "Viaje Uber",
      description: desc,
      userId: user.id,
    })
  }

  const gasDate = new Date(now)
  gasDate.setDate(gasDate.getDate() - Math.floor(Math.random() * 2))
  transactions.push({
    date: gasDate,
    type: "expense",
    amount: randomAmount(600, 1100),
    category: "Gasolina",
    description: "Tanque lleno",
    userId: user.id,
  })
  await prisma.transaction.createMany({ data: transactions })

  const incomeTotal = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0)
  const expenseTotal = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0)
  console.log(`  ✓ ${transactions.length} transactions ($${incomeTotal.toFixed(0)} income, $${expenseTotal.toFixed(0)} expense)`)

  const wishlistItems = [
    { name: "Llantas nuevas", estimatedPrice: 4800, priority: "alta", purchased: false },
    { name: "Cambio de aceite", estimatedPrice: 850, priority: "alta", purchased: false },
    { name: "Stereo nuevo", estimatedPrice: 2500, priority: "media", purchased: false },
    { name: "Cobertura para asientos", estimatedPrice: 1200, priority: "baja", purchased: false },
    { name: "Lavado a detalle", estimatedPrice: 600, priority: "baja", purchased: true },
    { name: "Cámara de reversa", estimatedPrice: 1800, priority: "media", purchased: false },
  ]

  for (const item of wishlistItems) {
    await prisma.wishlistItem.create({
      data: { ...item, userId: user.id },
    })
  }
  console.log(`  ✓ ${wishlistItems.length} wishlist items`)

  console.log("\nDone! Login: demo@test.com / demo123")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
