import { pathToFileURL } from "node:url";

const clientPath = process.argv[2];
if (!clientPath) {
  process.stderr.write("PRISMA_CLIENT_INTEGRITY_FAILED missing generated client path\n");
  process.exit(2);
}

const moduleExports = await import(pathToFileURL(clientPath).href);
const Prisma = moduleExports.Prisma;

if (typeof Prisma?.sql !== "function") {
  process.stderr.write("PRISMA_CLIENT_INTEGRITY_FAILED Prisma.sql is not a callable function\n");
  process.exit(2);
}

if (typeof Prisma?.join !== "function") {
  process.stderr.write("PRISMA_CLIENT_INTEGRITY_FAILED Prisma.join is not a callable function\n");
  process.exit(2);
}

process.stdout.write("PRISMA_CLIENT_INTEGRITY_OK\n");
