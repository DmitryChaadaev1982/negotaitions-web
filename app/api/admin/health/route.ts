import { apiRequireAdminUser } from "@/lib/auth/api-guards";
import {
  ADMIN_HEALTH_EMERGENCY_RESPONSE,
  ADMIN_HEALTH_ERROR_CODE,
  RUNTIME_CONFIGURATION_ERROR_CODE,
  createAdminHealthGet,
} from "@/lib/services/admin-health-route-handler";
import { getEnvironmentConfigStatus } from "@/lib/services/admin-health";
import { hasRecentCriticalServiceErrors } from "@/lib/services/external-service-events";
import { getMonthlyUsageSummary } from "@/lib/services/usage-counters";
import { prisma } from "@/lib/prisma";
import {
  buildVoximplantRecordingWebhookUrlStateWithoutDb,
  getVoximplantRecordingWebhookUrlState,
} from "@/lib/voximplant/recording-webhook-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export {
  ADMIN_HEALTH_EMERGENCY_RESPONSE,
  ADMIN_HEALTH_ERROR_CODE,
  RUNTIME_CONFIGURATION_ERROR_CODE,
};

export const GET = createAdminHealthGet({
  authorize: apiRequireAdminUser,
  hasRecentErrors: hasRecentCriticalServiceErrors,
  findRecentEvents: () =>
    prisma.externalServiceEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  getUsage: getMonthlyUsageSummary,
  getWebhookState: getVoximplantRecordingWebhookUrlState,
  getWebhookFallback: buildVoximplantRecordingWebhookUrlStateWithoutDb,
  getConfig: getEnvironmentConfigStatus,
});
