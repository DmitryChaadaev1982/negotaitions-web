import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegalDocumentHref,
  inferLegalReturnContext,
  legalReturnFromLocation,
  resolveLegalDocumentReturn,
  sanitizeLegalDocumentReturnUrl,
} from "@/lib/legal/legal-document-return";
import { isCredentialBearingReturnUrl } from "@/lib/legal/legal-update-return-url";

test("no return context falls back to home", () => {
  assert.deepEqual(resolveLegalDocumentReturn({}), {
    href: "/",
    context: "home",
  });
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnTo: null, returnContext: null }),
    { href: "/", context: "home" },
  );
  assert.equal(sanitizeLegalDocumentReturnUrl(undefined), null);
});

test("legal-update context returns to /legal-update", () => {
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "/legal-update",
      returnContext: "legal-update",
    }),
    { href: "/legal-update", context: "legal-update" },
  );
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnContext: "legal-update" }),
    { href: "/legal-update", context: "legal-update" },
  );
  assert.equal(
    buildLegalDocumentHref("/privacy", {
      returnTo: "/legal-update",
      returnContext: "legal-update",
    }),
    "/privacy?returnTo=%2Flegal-update&returnContext=legal-update",
  );
});

test("registration context returns to /register", () => {
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "/register",
      returnContext: "register",
    }),
    { href: "/register", context: "register" },
  );
});

test("app safe path is preserved", () => {
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "/cases",
      returnContext: "app",
    }),
    { href: "/cases", context: "app" },
  );
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnTo: "/dashboard" }),
    { href: "/dashboard", context: "app" },
  );
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnTo: "/sessions/abc-123/materials" }),
    { href: "/sessions/abc-123/materials", context: "app" },
  );
});

test("site safe path is preserved", () => {
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "/about",
      returnContext: "site",
    }),
    { href: "/about", context: "site" },
  );
  assert.deepEqual(resolveLegalDocumentReturn({ returnTo: "/faq" }), {
    href: "/faq",
    context: "site",
  });
  assert.equal(inferLegalReturnContext("/"), "site");
});

test("external URL is rejected", () => {
  assert.equal(sanitizeLegalDocumentReturnUrl("https://evil.example"), null);
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "https://evil.example",
      returnContext: "site",
    }),
    { href: "/", context: "site" },
  );
});

test("protocol-relative URL is rejected", () => {
  assert.equal(sanitizeLegalDocumentReturnUrl("//evil.example"), null);
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnTo: "//evil.example" }),
    { href: "/", context: "home" },
  );
});

test("/join/SECRET is rejected as returnTo", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const raw = `/join/${joinToken}`;
  assert.equal(isCredentialBearingReturnUrl(raw), true);
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const href = buildLegalDocumentHref("/privacy", {
    returnTo: raw,
    returnContext: "app",
  });
  assert.equal(href.includes(joinToken), false);
  assert.equal(href.includes("/join/"), false);
  assert.deepEqual(
    resolveLegalDocumentReturn({ returnTo: raw, returnContext: "app" }),
    { href: "/dashboard", context: "app" },
  );
});

test("joinToken query is rejected", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const raw = `/room/session-1?joinToken=${joinToken}`;
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const href = buildLegalDocumentHref("/terms", {
    returnTo: raw,
    returnContext: "app",
  });
  assert.equal(href.includes(joinToken), false);
  assert.equal(href.includes("joinToken"), false);
});

test("participantToken is rejected", () => {
  const participantToken = "RAW_PARTICIPANT_TOKEN_SECRET";
  const raw = `/events/event-1/lobby?participantToken=${participantToken}`;
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const href = buildLegalDocumentHref("/privacy", { returnTo: raw });
  assert.equal(href.includes(participantToken), false);
});

test("hostToken is rejected", () => {
  const hostToken = "RAW_HOST_TOKEN_SECRET";
  const raw = `/events/event-1/lobby?hostToken=${hostToken}`;
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const href = buildLegalDocumentHref("/privacy", { returnTo: raw });
  assert.equal(href.includes(hostToken), false);
});

test("publicJoinCode path is rejected", () => {
  const publicJoinCode = "RAW_PUBLIC_JOIN_CODE";
  const raw = `/events/join/${publicJoinCode}`;
  assert.equal(isCredentialBearingReturnUrl(raw), true);
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const href = buildLegalDocumentHref("/privacy", {
    returnTo: raw,
    returnContext: "app",
  });
  assert.equal(href.includes(publicJoinCode), false);
});

test("nested credential returnUrl is rejected", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const raw = `/login?returnUrl=${encodeURIComponent(`/join/${joinToken}`)}`;
  assert.equal(isCredentialBearingReturnUrl(raw), true);
  assert.equal(sanitizeLegalDocumentReturnUrl(raw), null);
  const fromLogin = legalReturnFromLocation("/login", `?returnUrl=/join/${joinToken}`);
  assert.equal(fromLogin.returnTo.includes(joinToken), false);
  assert.equal(fromLogin.returnTo.includes("/join/"), false);
});

test("legal page recursively returning to another legal page is rejected", () => {
  assert.equal(sanitizeLegalDocumentReturnUrl("/privacy"), null);
  assert.equal(sanitizeLegalDocumentReturnUrl("/terms?returnTo=/about"), null);
  assert.equal(
    sanitizeLegalDocumentReturnUrl("/data-processing-consent"),
    null,
  );
  assert.deepEqual(
    resolveLegalDocumentReturn({
      returnTo: "/privacy",
      returnContext: "site",
    }),
    { href: "/", context: "site" },
  );
  const preserved = legalReturnFromLocation(
    "/privacy",
    "?returnTo=%2Flegal-update&returnContext=legal-update",
  );
  assert.deepEqual(preserved, {
    returnTo: "/legal-update",
    returnContext: "legal-update",
  });
  const looped = legalReturnFromLocation("/terms", "?returnTo=%2Fprivacy");
  assert.deepEqual(looped, { returnTo: "/", returnContext: "home" });
});

test("legalReturnFromLocation classifies public, app, and gated sources", () => {
  assert.deepEqual(legalReturnFromLocation("/about"), {
    returnTo: "/about",
    returnContext: "site",
  });
  assert.deepEqual(legalReturnFromLocation("/"), {
    returnTo: "/",
    returnContext: "site",
  });
  assert.deepEqual(legalReturnFromLocation("/dashboard"), {
    returnTo: "/dashboard",
    returnContext: "app",
  });
  assert.deepEqual(legalReturnFromLocation("/legal-update"), {
    returnTo: "/legal-update",
    returnContext: "legal-update",
  });
  assert.deepEqual(legalReturnFromLocation("/register"), {
    returnTo: "/register",
    returnContext: "register",
  });
  assert.deepEqual(legalReturnFromLocation("/join/RAW_JOIN_TOKEN_SECRET"), {
    returnTo: "/dashboard",
    returnContext: "app",
  });
});

test("query and hash are stripped from legal-document return destinations", () => {
  assert.equal(
    sanitizeLegalDocumentReturnUrl("/about?utm=1#section"),
    "/about",
  );
  assert.equal(
    sanitizeLegalDocumentReturnUrl("/dashboard?tab=sessions"),
    "/dashboard",
  );
});
