import { UserRole } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const DEMO_FACILITATOR_EMAIL = "demo@example.com";

export async function getDemoFacilitator() {
  const facilitator = await prisma.user.findUnique({
    where: { email: DEMO_FACILITATOR_EMAIL },
  });

  if (!facilitator) {
    throw new Error(
      `Demo facilitator not found. Run "npm run db:seed" to create ${DEMO_FACILITATOR_EMAIL}.`,
    );
  }

  if (facilitator.role !== UserRole.FACILITATOR) {
    throw new Error("Demo user exists but is not a facilitator.");
  }

  return facilitator;
}
