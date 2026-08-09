import { expect, test } from "@playwright/test";

import { getSanitizedE2eDatabaseDescriptor } from "./helpers/e2e-database";

function normalizeLoopbackOrigin(origin: string | undefined) {
  return origin?.replace("http://localhost:", "http://127.0.0.1:");
}

test("managed E2E runtime uses isolated database @smoke", async ({ request }, testInfo) => {
  const response = await request.get("/api/test/runtime-identity");
  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as {
    requestOrigin: string;
    appUrl: string | null;
    baseUrl: string | null;
    playwrightBaseUrl: string | null;
    externalServicesMode: string | null;
    database: {
      host: string | null;
      port: number | null;
      database: string | null;
    } | null;
  };
  const expectedDb = getSanitizedE2eDatabaseDescriptor();
  const expectedBaseUrl = testInfo.project.use.baseURL;

  expect(body.externalServicesMode).toBe("mock");
  expect(normalizeLoopbackOrigin(body.requestOrigin)).toBe(expectedBaseUrl);
  expect(body.appUrl).toBe(expectedBaseUrl);
  expect(body.baseUrl).toBe(expectedBaseUrl);
  expect(body.playwrightBaseUrl).toBe(expectedBaseUrl);
  expect(body.database).toMatchObject({
    host: expectedDb.normalizedHost,
    port: expectedDb.port,
    database: expectedDb.database,
  });
});
