import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hash as argon2Hash, type Options } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

import {
  ARGON2ID_MEMORY_KIB,
  ARGON2ID_PARALLELISM,
  ARGON2ID_TAG_BYTES,
  ARGON2ID_TIME_COST,
  BCRYPT_REHASH_ELIGIBILITY_MAX_UTF8_BYTES,
  PASSWORD_HASH_ALGORITHM,
  classifyPasswordVerifier,
  hashPassword,
  isLegacyBcryptRehashEligible,
  needsPasswordRehash,
  verifyPassword,
} from "@/lib/auth/crypto";

const SAMPLE = "foundation-sample-pass";
const CURRENT_ARGON2ID =
  /^\$argon2id\$v=19\$m=19456,t=4,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

function bcryptCost(hash: string): string | undefined {
  return hash.split("$")[2];
}

test("FOUND-15 A2A-05 A2A-07 bcrypt cost 10 verification still works", async () => {
  const hash = await bcrypt.hash(SAMPLE, 10);
  assert.equal(bcryptCost(hash), "10");
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("FOUND-16 A2A-06 bcrypt cost 12 verification works", async () => {
  const hash = await bcrypt.hash(SAMPLE, 12);
  assert.equal(bcryptCost(hash), "12");
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("A2A-01 A2A-02 A2A-03 A2A-04 A2A-11 new hashes are the locked Argon2id profile", async () => {
  assert.equal(PASSWORD_HASH_ALGORITHM, "argon2id");
  assert.equal(ARGON2ID_MEMORY_KIB, 19456);
  assert.equal(ARGON2ID_TIME_COST, 4);
  assert.equal(ARGON2ID_PARALLELISM, 1);
  assert.equal(ARGON2ID_TAG_BYTES, 32);
  const hash = await hashPassword(SAMPLE);
  assert.match(hash, CURRENT_ARGON2ID);
  assert.equal(classifyPasswordVerifier(hash), "argon2id-current");
  assert.equal(needsPasswordRehash(hash), false);
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
  assert.equal(isLegacyBcryptRehashEligible(SAMPLE, hash), false);
});

test("A2A-08 unknown and empty verifiers fail closed", async () => {
  for (const verifier of ["", "hash", "unused", "$2b$12$not-a-verifier"]) {
    assert.equal(classifyPasswordVerifier(verifier), "unknown");
    assert.equal(needsPasswordRehash(verifier), false);
    assert.equal(await verifyPassword(SAMPLE, verifier), false);
  }
});

test("A2A-09 malformed Argon2id fails closed", async () => {
  const malformed = [
    "$argon2id$",
    "$argon2id$v=19$m=19456,t=4,p=1$",
    "$argon2id$v=19$m=19456,t=4,p=1$!!!!$????",
    "$argon2id$v=16$m=19456,t=4,p=1$c2FsdHNhbHRzYWx0c2FsdA$dGFn",
  ];
  for (const verifier of malformed) {
    assert.equal(classifyPasswordVerifier(verifier), "unknown");
    assert.equal(needsPasswordRehash(verifier), false);
    assert.equal(await verifyPassword(SAMPLE, verifier), false);
  }
});

test("A2A-10 argon2i and argon2d are not accepted credential formats", async () => {
  const options = {
    memoryCost: 19456,
    timeCost: 1,
    parallelism: 1,
    outputLen: 32,
  };
  const argon2i = await argon2Hash(SAMPLE, {
    ...options,
    algorithm: 1,
  } satisfies Options);
  const argon2d = await argon2Hash(SAMPLE, {
    ...options,
    algorithm: 0,
  } satisfies Options);
  assert.match(argon2i, /^\$argon2i\$/);
  assert.match(argon2d, /^\$argon2d\$/);
  assert.equal(classifyPasswordVerifier(argon2i), "unknown");
  assert.equal(classifyPasswordVerifier(argon2d), "unknown");
  assert.equal(needsPasswordRehash(argon2i), false);
  assert.equal(needsPasswordRehash(argon2d), false);
  assert.equal(await verifyPassword(SAMPLE, argon2i), false);
  assert.equal(await verifyPassword(SAMPLE, argon2d), false);
});

test("accepted Argon2id with a non-target profile is rehash-classified and still verifies", async () => {
  const hash = await argon2Hash(SAMPLE, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  } satisfies Options);
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(classifyPasswordVerifier(hash), "argon2id-rehash");
  assert.equal(needsPasswordRehash(hash), true);
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("A2A-12 accepted bcrypt is legacy and rehash-classified", async () => {
  for (const cost of [10, 12]) {
    const hash = await bcrypt.hash(SAMPLE, cost);
    assert.equal(classifyPasswordVerifier(hash), "bcrypt-legacy");
    assert.equal(needsPasswordRehash(hash), true);
    assert.equal(await verifyPassword(SAMPLE, hash), true);
  }
});

test("bcrypt $2y$ verifies when the library accepts that prefix", async () => {
  const hash = (await bcrypt.hash(SAMPLE, 10)).replace(/^\$2[ab]\$/u, "$2y$");
  assert.match(hash, /^\$2y\$/);
  assert.equal(await bcrypt.compare(SAMPLE, hash), true);
  assert.equal(classifyPasswordVerifier(hash), "bcrypt-legacy");
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("A2A-13 login does not opportunistically rehash or write a password hash", () => {
  const source = readFileSync("app/actions/auth.ts", "utf8");
  const start = source.indexOf("export async function loginUser");
  const next = source.indexOf("export async function", start + 1);
  const login = source.slice(start, next === -1 ? undefined : next);
  assert.ok(login.includes("verifyPassword"));
  assert.equal(login.includes("hashPassword"), false);
  assert.equal(login.includes("needsPasswordRehash"), false);
  assert.equal(login.includes("isLegacyBcryptRehashEligible"), false);
  assert.doesNotMatch(login, /data:\s*\{[^}]*passwordHash/u);
});

test("A2A-14 a bcrypt candidate of at most 72 UTF-8 bytes is eligible", async () => {
  assert.equal(BCRYPT_REHASH_ELIGIBILITY_MAX_UTF8_BYTES, 72);
  const candidate = "a".repeat(72);
  assert.equal(Buffer.byteLength(candidate, "utf8"), 72);
  const hash = await bcrypt.hash(candidate, 10);
  assert.equal(isLegacyBcryptRehashEligible(candidate, hash), true);
  assert.equal(needsPasswordRehash(hash), true);
  assert.equal(await verifyPassword(candidate, hash), true);
});

test("A2A-15 a bcrypt candidate over 72 UTF-8 bytes is not eligible", async () => {
  const candidate = "a".repeat(73);
  assert.equal(Buffer.byteLength(candidate, "utf8"), 73);
  const hash = await bcrypt.hash(candidate, 10);
  assert.equal(await verifyPassword(candidate, hash), true);
  assert.equal(isLegacyBcryptRehashEligible(candidate, hash), false);

  const cyrillic = "я".repeat(40);
  assert.ok(cyrillic.length <= 72);
  assert.ok(Buffer.byteLength(cyrillic, "utf8") > 72);
  const cyrillicHash = await bcrypt.hash(cyrillic, 10);
  assert.equal(await verifyPassword(cyrillic, cyrillicHash), true);
  assert.equal(isLegacyBcryptRehashEligible(cyrillic, cyrillicHash), false);
});

test("A2A-16 over-72-byte bcrypt suffixes stay legacy-equivalent and ineligible", async () => {
  const prefix = "b".repeat(72);
  const first = `${prefix}SUFFIX-A`;
  const second = `${prefix}SUFFIX-B-DIFFERENT`;
  assert.ok(Buffer.byteLength(first, "utf8") > 72);
  assert.ok(Buffer.byteLength(second, "utf8") > 72);
  assert.equal(first.slice(0, 72), second.slice(0, 72));
  const hash = await bcrypt.hash(first, 10);
  assert.equal(await verifyPassword(first, hash), true);
  assert.equal(await verifyPassword(second, hash), true);
  assert.equal(isLegacyBcryptRehashEligible(first, hash), false);
  assert.equal(isLegacyBcryptRehashEligible(second, hash), false);
  assert.equal(await hashPassword(first) === hash, false);
});
