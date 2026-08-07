import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalService,
  ExternalServiceErrorCode,
} from "@/app/generated/prisma/client";
import { classifyExternalServiceError } from "@/lib/services/error-classifier";

test("APP timeout is not classified as missing configuration", () => {
  const classified = classifyExternalServiceError(
    ExternalService.APP,
    new Error("Yandex AI analysis request timed out after 45000ms."),
    "ai_analysis",
  );

  assert.equal(classified.errorCode, ExternalServiceErrorCode.NETWORK_ERROR);
});

test("APP missing provider configuration remains CONFIG_MISSING", () => {
  const classified = classifyExternalServiceError(
    ExternalService.APP,
    new Error("Yandex AI configuration is missing."),
    "ai_analysis",
  );

  assert.equal(classified.errorCode, ExternalServiceErrorCode.CONFIG_MISSING);
});
