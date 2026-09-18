import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/app/generated/prisma/client";
import { extractPrismaSchema } from "@/lib/prisma-connection-string";

export function createE2ePrisma(connectionString: string): {
  prisma: PrismaClient;
  pool: Pool;
} {
  const schema = extractPrismaSchema(connectionString);
  const pool = new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5_000,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, schema ? { schema } : undefined),
  });
  return { prisma, pool };
}
