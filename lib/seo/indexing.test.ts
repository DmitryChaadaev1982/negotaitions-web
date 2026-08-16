import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicIndexablePath,
  privateIndexingMetadata,
  publicIndexingMetadata,
  shouldNoindexPath,
} from "@/lib/seo/indexing";

test("public homepage and legal documents remain indexable", () => {
  for (const path of [
    "/",
    "/privacy",
    "/terms",
    "/cookie-policy",
    "/data-processing-consent",
    "/ai-processing-notice",
  ]) {
    assert.equal(isPublicIndexablePath(path), true, path);
    assert.equal(shouldNoindexPath(path), false, path);
  }
  assert.ok(
    publicIndexingMetadata.robots &&
      typeof publicIndexingMetadata.robots === "object" &&
      publicIndexingMetadata.robots.index === true,
  );
});

test("private auth, app, and runtime categories are noindex", () => {
  const privatePaths = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/pending-approval",
    "/account/rejected",
    "/account/blocked",
    "/account/settings",
    "/dashboard",
    "/cases",
    "/cases/new",
    "/events",
    "/events/abc/lobby",
    "/events/abc/join",
    "/sessions",
    "/admin",
    "/join/token",
    "/rejoin",
    "/room/session-1",
    "/voximplant-test",
  ];

  for (const path of privatePaths) {
    assert.equal(shouldNoindexPath(path), true, path);
    assert.equal(isPublicIndexablePath(path), false, path);
  }
  assert.ok(
    privateIndexingMetadata.robots &&
      typeof privateIndexingMetadata.robots === "object" &&
      privateIndexingMetadata.robots.index === false,
  );
});
