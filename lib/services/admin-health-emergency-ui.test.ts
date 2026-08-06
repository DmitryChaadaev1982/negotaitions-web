import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminDiagnosticsEmergencyState } from "@/components/admin-diagnostics-emergency-state";
import { ADMIN_HEALTH_EMERGENCY_RESPONSE } from "@/lib/services/admin-health-route-handler";

test("admin diagnostics UI renders the emergency response contract", () => {
  const markup = renderToStaticMarkup(
    createElement(AdminDiagnosticsEmergencyState, {
      errorCode: ADMIN_HEALTH_EMERGENCY_RESPONSE.errorCode,
      message: ADMIN_HEALTH_EMERGENCY_RESPONSE.error,
    }),
  );

  assert.match(markup, /role="alert"/);
  assert.match(markup, /ADMIN_HEALTH_UNAVAILABLE/);
  assert.match(markup, /admin-diagnostics-emergency-state/);
});
