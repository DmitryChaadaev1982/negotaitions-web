import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { hashPassword, verifyPassword } from "@/lib/auth/crypto";
import {
  commonPasswordBlocklistSize,
  isCommonPassword,
} from "@/lib/auth/common-password-blocklist";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordCodePointLength,
  validateNewPassword,
} from "@/lib/auth/password-policy";

const STRONG = "stage2b-policy-ok";

test("P01 P02 canonical policy rejects 9 code points and accepts 10", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.equal(passwordCodePointLength("uniq-shrt"), 9);
  assert.equal("uniq-shrt".length, 9);
  assert.deepEqual(validateNewPassword({ password: "uniq-shrt" }), {
    ok: false,
    codes: ["too_short"],
  });
  assert.equal(passwordCodePointLength(STRONG), 17);
  assert.deepEqual(
    validateNewPassword({ password: STRONG, confirmation: STRONG }),
    { ok: true },
  );
});

test("P03 P04 128 code points are eligible and 129 are rejected", () => {
  assert.equal(PASSWORD_MAX_LENGTH, 128);
  const max = `A1-${"x".repeat(125)}`;
  assert.equal(passwordCodePointLength(max), 128);
  assert.deepEqual(validateNewPassword({ password: max }), { ok: true });
  const over = `${max}y`;
  assert.equal(passwordCodePointLength(over), 129);
  assert.deepEqual(validateNewPassword({ password: over }), {
    ok: false,
    codes: ["too_long"],
  });
});

test("P05 Cyrillic length is counted in Unicode code points", () => {
  const nine = "абвгдежзи";
  const ten = "абвгдежзий";
  assert.equal(passwordCodePointLength(nine), 9);
  assert.equal(passwordCodePointLength(ten), 10);
  assert.ok(nine.length === 9);
  assert.deepEqual(validateNewPassword({ password: nine }), {
    ok: false,
    codes: ["too_short"],
  });
  assert.deepEqual(validateNewPassword({ password: ten }), { ok: true });
});

test("P06 a non-BMP code point counts as one", () => {
  const nine = "😀".repeat(9);
  const ten = `${"😀".repeat(9)}A`;
  assert.equal(nine.length, 18);
  assert.equal(passwordCodePointLength(nine), 9);
  assert.equal(passwordCodePointLength(ten), 10);
  assert.deepEqual(validateNewPassword({ password: nine }), {
    ok: false,
    codes: ["too_short"],
  });
  assert.deepEqual(validateNewPassword({ password: ten }), { ok: true });
  assert.equal(passwordCodePointLength("😀".repeat(128)), 128);
  assert.deepEqual(validateNewPassword({ password: "😀".repeat(128) }), {
    ok: true,
  });
  assert.deepEqual(validateNewPassword({ password: "😀".repeat(129) }), {
    ok: false,
    codes: ["too_long"],
  });
});

test("P07 P08 P09 P10 spaces are allowed and composition is not required", () => {
  assert.deepEqual(validateNewPassword({ password: "space ok!!" }), {
    ok: true,
  });
  assert.deepEqual(validateNewPassword({ password: "lowercase10" }), {
    ok: true,
  });
  assert.deepEqual(validateNewPassword({ password: "NoDigitsHere" }), {
    ok: true,
  });
  assert.deepEqual(validateNewPassword({ password: "lettersnum1" }), {
    ok: true,
  });
  assert.deepEqual(
    validateNewPassword({ password: STRONG, confirmation: "other-value" }),
    { ok: false, codes: ["mismatch"] },
  );
});

test("P11 P12 P13 whole-password common entries are rejected after normalization", () => {
  assert.ok(commonPasswordBlocklistSize() >= 10000);
  assert.equal(isCommonPassword("password123"), true);
  assert.deepEqual(validateNewPassword({ password: "password123" }), {
    ok: false,
    codes: ["common_password"],
  });
  assert.equal(passwordCodePointLength("йцукенгшщз"), 10);
  assert.deepEqual(validateNewPassword({ password: "йцукенгшщз" }), {
    ok: false,
    codes: ["common_password"],
  });
  assert.equal(isCommonPassword("  PASSWORD123  "), true);
  assert.deepEqual(validateNewPassword({ password: "PASSWORD123" }), {
    ok: false,
    codes: ["common_password"],
  });
  const fullwidth = "ｐａｓｓｗｏｒｄ１２３";
  assert.equal(fullwidth.normalize("NFKC").toLowerCase(), "password123");
  assert.notEqual(fullwidth, "password123");
  assert.deepEqual(validateNewPassword({ password: fullwidth }), {
    ok: false,
    codes: ["common_password"],
  });
  assert.equal(isCommonPassword("qx7-stage2b-common-sentinel"), true);
});

test("P14 a long passphrase is not rejected because it contains a common word", () => {
  const passphrase = "correct horse battery password staple extra";
  assert.ok(passphrase.includes("password"));
  assert.equal(isCommonPassword(passphrase), false);
  assert.deepEqual(validateNewPassword({ password: passphrase }), { ok: true });
});

test("P15 hashing keeps the raw password and does not apply blocklist normalization", async () => {
  const raw = "ﬃStage2b!!";
  const normalized = raw.normalize("NFKC");
  assert.notEqual(raw, normalized);
  assert.equal(isCommonPassword(raw), false);
  const hash = await hashPassword(raw);
  assert.equal(await verifyPassword(raw, hash), true);
  assert.equal(await verifyPassword(normalized, hash), false);
  assert.equal(await verifyPassword(raw.toLowerCase(), hash), false);
  assert.equal(await verifyPassword(` ${raw}`, hash), false);
});

test("P16 registration, self-change, and reset import the canonical policy owner", async () => {
  const root = process.cwd();
  const files = [
    "app/actions/auth.ts",
    "app/actions/password-reset.ts",
    "app/actions/account.ts",
  ];
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.match(source, /validateNewPassword/);
    assert.doesNotMatch(source, /length\s*<\s*8/);
    assert.doesNotMatch(source, /length\s*<\s*10/);
    assert.doesNotMatch(source, /\.length\s*>\s*128/);
  }
});

test("client components do not import the server password blocklist", async () => {
  const constants = await readFile(
    "lib/auth/password-policy-constants.ts",
    "utf8",
  );
  assert.doesNotMatch(constants, /common-password-blocklist|readFileSync|fs/);

  async function filesUnder(directory: string): Promise<string[]> {
    const output: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        output.push(...(await filesUnder(absolute)));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        output.push(absolute);
      }
    }
    return output;
  }

  const files = [
    ...(await filesUnder("app")),
    ...(await filesUnder("components")),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!source.includes('"use client"') && !source.includes("'use client'")) {
      continue;
    }
    assert.doesNotMatch(
      source,
      /common-password-blocklist|common-passwords|password-policy(?!-constants)/,
      file,
    );
  }
});
