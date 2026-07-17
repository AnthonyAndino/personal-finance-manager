-- CreateTable
CREATE TABLE "RateLimitEntry" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("key")
);

-- Remove public demo account and related data
DELETE FROM "Transaction" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" = 'demo@test.com');
DELETE FROM "WishlistItem" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" = 'demo@test.com');
DELETE FROM "User" WHERE "email" = 'demo@test.com';
