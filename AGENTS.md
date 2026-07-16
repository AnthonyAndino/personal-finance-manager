# Personal Finance Manager — AGENTS.md

## Contexto

App para que una familia lleve las cuentas de su carro de Uber. 4 usuarios
reales (uber, angeles, ethel, renan @cuentas.com) + 1 demo (demo@test.com).
Usuarios sin experiencia con tecnología: UI simple, botones grandes, texto claro.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16.2.10 (App Router, Turbopack) |
| Lenguaje | TypeScript 5.x |
| DB | PostgreSQL (Docker local port 5433, Supabase production) |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Auth | Auth.js v5 (Credentials provider, bcrypt, JWT) |
| CSS | Tailwind CSS 4 |
| Íconos | `reicon-react` |
| Tabla | `@tanstack/react-table` |
| Date picker | `react-datepicker` |
| Charts | SVG inline (sin librería) |

## Estructura

```
prisma/
  schema.prisma        → modelo de datos
  migrations/          → migraciones SQL
  seed.ts              → solo demo user con datos de prueba

app/
  layout.tsx           → root layout: SessionProvider, fonts (Outfit + Geist)
  globals.css          → estilos globales, @theme, react-datepicker overrides
  icon.tsx             → favicon PNG dinámico
  page.tsx             → dashboard (server component)
  login/               → login page (static) + login-form (client)
  transacciones/       → formulario de transacción + últimos movimientos
  historial/           → DataTable con filtros, búsqueda, paginación
  graficos/            → gráficos SVG inline (evolución, dona, balance)
  wishlist/            → lista de deseos con progreso
  papelera/            → soft delete: recuperar o eliminar permanentemente
  api/
    auth/[...nextauth] → Auth.js route handler
    export/            → exportar a Excel (xlsx)

components/
  sidebar.tsx          → sidebar desktop + bottom nav mobile
  modal.tsx            → modal reutilizable con backdrop blur
  confirm-dialog.tsx   → ConfirmDialog (danger/info variants)
  month-picker.tsx     → react-datepicker month/year picker
  transaction-form.tsx → create transaction form
  transaction-list.tsx → recent transactions list
  dashboard-cards.tsx  → dashboard summary cards
  recent-transactions.tsx → recent transactions card
  export-button.tsx    → export to Excel button
  session-provider.tsx → SessionProvider wrapper
  logout-button.tsx    → logout button
  wishlist-form.tsx    → add wishlist item form
  wishlist-list.tsx    → wishlist items with toggle/delete

lib/
  prisma.ts            → Prisma client singleton
  auth.ts              → NextAuth config with Credentials + rate limit
  auth.config.ts       → base auth config (pages, callbacks, JWT)
  rate-limit.ts        → in-memory rate limiter
  actions/
    auth.ts            → authenticate server action
    transactions.ts    → CRUD + soft delete + recover + permanent delete
    wishlist.ts        → CRUD wishlist items + toggle purchased

middleware.ts          → protege rutas, redirect a /login
next.config.ts         → security headers, devIndicators: false
```

## Convenciones

- **Íconos**: siempre de `reicon-react`. Usar `size`, `color`, `weight` props.
- **Colores**: `#2563EB` para azul primario. Usar clases Tailwind.
- **Nombres de archivo**: kebab-case.
- **Componentes client**: `"use client"` cuando usen hooks, estado, o interactividad.
- **Server components**: default (no `"use client"`). Fetch data directo con `auth()` + Prisma.
- **Formularios**: `useActionState` con server actions.
- **Estilos**: Tailwind. Sin CSS modules, sin styled-components.
- **Tipografía**: Outfit (`--font-heading`) para títulos h1-h6, Geist para body.
- **Tablas**: `@tanstack/react-table` para historial. Tablas simples manuales para papelera.

## Base de datos (Prisma)

Modelos: `User`, `Transaction`, `WishlistItem`

- `Transaction.deletedAt` — soft delete (DateTime?)
- `Transaction.wishlistItemId` — opcional, vincula gasto a deseo
- `WishlistItem.purchased` — Boolean, toggle desde UI
- Todas las queries filtran `deletedAt: null` excepto papelera

## Auth

- Auth.js v5, Credentials provider
- bcrypt para hash de contraseñas
- JWT sessions
- Rate limit: 5 intentos cada 15 min por IP
- Middleware protege todas las rutas excepto `/login`, `/api/auth`, `/_next/static`, `/_next/image`, `/favicon.svg`, `/icon`

## Seguridad

- CSP en headers: self, inline scripts/styles, Google fonts/images, form-action self
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- No secrets en código (`.env` en gitignore)
- Rate limiting en login y export (30/min)

## Comandos

```bash
npm run dev          # dev server (Turbopack)
npm run build        # producción
npx prisma migrate dev   # nueva migración
npx prisma migrate deploy # aplicar migraciones
npx prisma db seed   # sembrar demo user
docker compose up -d # levantar PostgreSQL local
```

## Deploy

- Vercel + Supabase
- Env vars en Vercel: `DATABASE_URL`, `AUTH_SECRET`
- Migraciones: `npx prisma migrate deploy` local apuntando a Supabase
- Seed: `npx prisma db seed` con DATABASE_URL de Supabase

## Diseño visual

- Fondo: gris claro con patrón de cuadrícula (`grid-bg`)
- Cards: blancas con `border border-slate-200/60` y `shadow-[0_15px_40px_rgba(0,0,0,0.03)]`
- Sidebar desktop: `w-64`, `hidden lg:flex`
- Bottom nav mobile: `lg:hidden`, fijo abajo
- Layout: `lg:pl-64` (sidebar) + `pb-16 lg:pb-0` (bottom nav)
