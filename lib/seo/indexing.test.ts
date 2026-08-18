import assert from "node:assert/strict";
import test from "node:test";

import {
  isCredentialBearingPath,
  isLegalDocumentPath,
  isPublicAnalyticsPath,
  isPublicIndexablePath,
  isSitemapPath,
  legalIndexingMetadata,
  privateIndexingMetadata,
  publicIndexingMetadata,
  shouldFollowPath,
  shouldNoindexPath,
} from "@/lib/seo/indexing";

test("public marketing pages remain indexable and are the sitemap allowlist", () => {
  for (const path of ["/", "/about", "/support", "/faq"]) {
    assert.equal(isPublicIndexablePath(path), true, path);
    assert.equal(isSitemapPath(path), true, path);
    assert.equal(isPublicAnalyticsPath(path), true, path);
    assert.equal(shouldNoindexPath(path), false, path);
    assert.equal(shouldFollowPath(path), true, path);
  }
  assert.ok(
    publicIndexingMetadata.robots &&
      typeof publicIndexingMetadata.robots === "object" &&
      publicIndexingMetadata.robots.index === true,
  );
});

test("legal documents are public but noindex follow and excluded from sitemap", () => {
  for (const path of [
    "/privacy",
    "/terms",
    "/cookie-policy",
    "/data-processing-consent",
    "/ai-processing-notice",
    "/privacy?returnTo=/dashboard&returnContext=app",
  ]) {
    assert.equal(isLegalDocumentPath(path), true, path);
    assert.equal(isPublicIndexablePath(path), false, path);
    assert.equal(isSitemapPath(path), false, path);
    assert.equal(isPublicAnalyticsPath(path), false, path);
    assert.equal(shouldNoindexPath(path), true, path);
    assert.equal(shouldFollowPath(path), true, path);
  }
  assert.ok(
    legalIndexingMetadata.robots &&
      typeof legalIndexingMetadata.robots === "object" &&
      legalIndexingMetadata.robots.index === false &&
      legalIndexingMetadata.robots.follow === true,
  );
});

test("private auth, app, and runtime categories are noindex nofollow", () => {
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
    "/legal-update",
    "/voximplant-test",
  ];

  for (const path of privatePaths) {
    assert.equal(shouldNoindexPath(path), true, path);
    assert.equal(isPublicIndexablePath(path), false, path);
    assert.equal(isSitemapPath(path), false, path);
    assert.equal(isPublicAnalyticsPath(path), false, path);
    assert.equal(shouldFollowPath(path), false, path);
  }
  assert.ok(
    privateIndexingMetadata.robots &&
      typeof privateIndexingMetadata.robots === "object" &&
      privateIndexingMetadata.robots.index === false &&
      privateIndexingMetadata.robots.follow === false,
  );
  assert.equal(privateIndexingMetadata.alternates?.canonical, null);
});

test("credential-bearing routes are identified and never sitemap entries", () => {
  for (const path of [
    "/join/abcTokenValue",
    "/events/join/publicCode",
    "/room/session-1",
  ]) {
    assert.equal(isCredentialBearingPath(path), true, path);
    assert.equal(isSitemapPath(path), false, path);
  }
  assert.equal(isCredentialBearingPath("/about"), false);
  assert.equal(isCredentialBearingPath("/join"), false);
});
