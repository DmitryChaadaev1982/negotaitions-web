import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/app/generated/prisma/client";
import {
  parseServerRuntimeSetting,
  readServerRuntimeSettingRaw,
} from "@/lib/config/server-runtime-settings";
import { extractPrismaSchema } from "@/lib/prisma-connection-string";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaClientVersion: string | undefined;
};

const PRISMA_CLIENT_VERSION = "20260629200500-add-video-provider-identity";

function createPrismaClient() {
  const connectionString = readServerRuntimeSettingRaw("DATABASE_URL");
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const schema = extractPrismaSchema(connectionString);
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(
    pool,
    schema ? { schema } : undefined,
  );

  return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prismaClientVersion === PRISMA_CLIENT_VERSION &&
  globalForPrisma.prisma
    ? globalForPrisma.prisma
    : createPrismaClient();

if (parseServerRuntimeSetting("NODE_ENV") !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClientVersion = PRISMA_CLIENT_VERSION;
}
