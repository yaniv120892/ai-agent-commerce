import { PrismaPg } from "@prisma/adapter-pg";
import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { environment } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Each serverless instance gets its own pool, so the cap is per-instance and
// multiplies by concurrency against the database's connection limit.
const CONNECTIONS_PER_INSTANCE = 3;

const prismaAdapter = new PrismaPg({
  connectionString: environment.databaseUrl,
  max: CONNECTIONS_PER_INSTANCE,
});

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: prismaAdapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
