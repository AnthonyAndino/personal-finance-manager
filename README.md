# Personal Finance Manager

Aplicación web para llevar el control de ingresos y gastos personales. Diseñada para personas sin experiencia con tecnología: interfaz simple, botones grandes, texto claro.

## Funcionalidades

- **Dashboard** — resumen del mes actual: ingresos, gastos, saldo neto
- **Ingresos/Gastos** — registrar transacciones por tipo, categoría, monto y fecha
- **Historial** — tabla interactiva con búsqueda, ordenamiento y paginación
- **Gráficos** — distribución de gastos por categoría y evolución mensual
- **Lista de deseos** — productos que quieres comprar, con link y prioridad
- **Exportar a Excel** — descarga todas las transacciones en formato XLSX
- **Papelera** — recuperar o eliminar permanentemente transacciones borradas

## Stack

- **Framework**: [Next.js](https://nextjs.org) 16 + App Router + Turbopack
- **Base de datos**: PostgreSQL via [Prisma](https://prisma.io) ORM
- **Autenticación**: [Auth.js](https://authjs.dev) v5 (credentials, bcrypt, JWT)
- **Estilos**: Tailwind CSS 4
- **Íconos**: [reicon-react](https://www.npmjs.com/package/reicon-react)
- **Tabla interactiva**: [@tanstack/react-table](https://tanstack.com/table)
- **Date picker**: [react-datepicker](https://reactdatepicker.com)
- **Gráficos**: [recharts](https://recharts.org)

## Requisitos

- Node.js 20+
- Docker Desktop (para desarrollo local)
- Cuenta en [Supabase](https://supabase.com) (para producción)

## Desarrollo local

```bash
# 1. Clonar
git clone https://github.com/tu-usuario/personal-finance-manager.git
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

### Usuarios de prueba (seed)

| Email | Contraseña |
|-------|-----------|
| uber@cuentas.com | uber123 |
| angeles@cuentas.com | angeles123 |
| ethel@cuentas.com | ethel123 |
| renan@cuentas.com | renan123 |

## Deploy

```bash
# Construir para producción
npm run build
```

### Vercel + Supabase

1. Crea un proyecto en [Vercel](https://vercel.com) conectando el repositorio
2. Crea un proyecto en [Supabase](https://supabase.com)
3. En Vercel, agrega estas variables de entorno:
   - `DATABASE_URL` — connection string de Supabase
   - `AUTH_SECRET` — generado con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Corre migraciones contra la DB de producción:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

## Seguridad

- Autenticación con bcrypt + JWT
- Rate limiting en login (5 intentos/15min) y exportación (30/min)
- CSP, X-Frame-Options, X-Content-Type-Options
- Soft delete: las transacciones se marcan como eliminadas, no se borran
- Sin secreto en el código fuente

## Licencia

MIT
