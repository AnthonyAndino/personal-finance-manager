# Personal Finance Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Aplicación web para llevar el control de ingresos y gastos personales. Diseñada para personas sin experiencia con tecnología: interfaz simple, botones grandes, texto claro.

**Demo en producción:** [finance-manager-anthony.vercel.app](https://finance-manager-anthony.vercel.app)

## Funcionalidades

- **Dashboard** — resumen del mes: ingresos, gastos y saldo en USD y LPS
- **Multi-moneda** — registra transacciones en dólares ($) o lempiras (L), con tipo de cambio por operación
- **Ingresos / Gastos** — registrar transacciones por tipo, categoría, monto, moneda y fecha
- **Historial** — tabla interactiva con búsqueda, ordenamiento y paginación
- **Gráficos** — distribución de gastos por categoría y comparativa mensual
- **Lista de deseos** — productos por comprar, con link, prioridad y moneda
- **Fondo de emergencia** — meta de ahorro y progreso en el dashboard
- **Exportar a Excel** — reporte mensual con hojas de resumen, ingresos y gastos (montos en su moneda original)
- **Papelera** — recuperar o eliminar permanentemente transacciones borradas

## Stack

- **Framework**: [Next.js](https://nextjs.org) 16 + App Router
- **Base de datos**: PostgreSQL + [Prisma](https://prisma.io) 7
- **Autenticación**: [Auth.js](https://authjs.dev) v5 (credentials, bcrypt, JWT)
- **Estilos**: Tailwind CSS 4
- **Íconos**: [reicon-react](https://www.npmjs.com/package/reicon-react)
- **Tabla interactiva**: [@tanstack/react-table](https://tanstack.com/table)
- **Date picker**: [react-datepicker](https://reactdatepicker.com)
- **Excel**: [ExcelJS](https://github.com/exceljs/exceljs) + Sharp (gráficos embebidos)

## Requisitos

- Node.js 20+
- Docker Desktop (para desarrollo local)
- Cuenta en [Supabase](https://supabase.com) (producción)

## Desarrollo local

```bash
# 1. Clonar
git clone https://github.com/AnthonyAndino/personal-finance-manager.git
cd personal-finance-manager

# 2. Instalar dependencias
npm install

# 3. Levantar PostgreSQL con Docker
docker compose up -d

# 4. Copiar y configurar variables de entorno
cp .env.example .env

# 5. Correr migraciones y seed
npx prisma migrate deploy
npx prisma db seed

# 6. Iniciar servidor de desarrollo
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### Datos de prueba (solo desarrollo)

El seed **no corre en producción**. En local, define una contraseña segura en `.env`:

```bash
DEMO_PASSWORD="tu_contraseña_segura_de_al_menos_10_caracteres"
npx prisma db seed
```

Crea el usuario `demo@test.com` solo en tu base de datos local.

## Deploy (Vercel + Supabase)

1. Conecta el repositorio en [Vercel](https://vercel.com)
2. Crea la base de datos en [Supabase](https://supabase.com)
3. Agrega estas variables de entorno en Vercel:
   - `DATABASE_URL` — connection string de Supabase (pooler)
   - `AUTH_SECRET` — genera uno con:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
4. Al hacer deploy, las migraciones y el hardening de seguridad se aplican automáticamente (`vercel-build`)
5. Para rotar contraseñas de usuarios `@cuentas.com` en un deploy, define temporalmente en Vercel:
   - `FAMILY_NEW_PASSWORD` — contraseña nueva (mín. 10 caracteres, compártela solo con tu familia)
   - Elimínala de Vercel después del deploy

Para migrar manualmente contra producción:

```bash
npx prisma migrate deploy
```

## Scripts útiles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run db:migrate` | Nueva migración (desarrollo) |
| `npm run db:seed` | Datos de prueba |
| `npm run db:studio` | Prisma Studio |

## Seguridad

- Autenticación con bcrypt + JWT
- Rate limiting en login (5 intentos / 15 min) y exportación (30 / min)
- CSP, X-Frame-Options, X-Content-Type-Options
- Soft delete: las transacciones se marcan como eliminadas, no se borran de inmediato
- Sin secretos en el código fuente

## Licencia

Este proyecto está bajo la licencia MIT. Ver el archivo [LICENSE](LICENSE) para más detalles.
