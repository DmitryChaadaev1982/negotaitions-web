import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../app/generated/prisma/client";
import {
  redactSeedFailure,
  runSeed,
  type DemoSeedStore,
} from "./seed-demo";

function createPrismaClient(connectionString: string): DemoSeedStore {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return {
    findDemoUser(email) {
      return prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
    },
    async updateDemoUser(email, data) {
      await prisma.user.update({
        where: { email },
        data,
      });
    },
    createDemoUser(data) {
      return prisma.user.create({
        data,
        select: { id: true, email: true },
      });
    },
    async deleteDemoCases(facilitatorId, titles) {
      await prisma.negotiationCase.deleteMany({
        where: {
          facilitatorId,
          title: { in: [...titles] },
        },
      });
    },
    async createDemoCase(data) {
      await prisma.negotiationCase.create({ data });
    },
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}

runSeed({
  databaseUrl: process.env.DATABASE_URL,
  createClient: createPrismaClient,
  log: (line) => {
    console.log(line);
  },
}).catch((error: unknown) => {
  console.error(redactSeedFailure(error, process.env.DATABASE_URL));
  process.exit(1);
});
