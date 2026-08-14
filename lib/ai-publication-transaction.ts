import { Prisma } from "@/app/generated/prisma/client";

export const AI_PUBLICATION_TRANSACTION_ATTEMPTS = 2;

/**
 * PostgreSQL serializable transactions intentionally reject one contender
 * under concurrent Publish/Unshare requests. Retrying once re-reads the
 * canonical AiAnalysis row and preserves the request's linearized semantics.
 */
export function isAiPublicationSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }
    if (
      error.code === "P2010" &&
      String(error.meta?.code ?? "") === "40001"
    ) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Code: `40001`") &&
    message.includes("could not serialize access")
  );
}

export async function retryAiPublicationTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastConflict: unknown;

  for (let attempt = 0; attempt < AI_PUBLICATION_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isAiPublicationSerializationConflict(error) ||
        attempt === AI_PUBLICATION_TRANSACTION_ATTEMPTS - 1
      ) {
        throw error;
      }
      lastConflict = error;
    }
  }

  throw lastConflict;
}
