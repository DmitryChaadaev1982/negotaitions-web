import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import {
  PASSWORD_BCRYPT_COST,
  PASSWORD_HASH_ALGORITHM,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/crypto";

const SAMPLE = "foundation-sample-pass";

function bcryptCost(hash: string): string | undefined {
  return hash.split("$")[2];
}

test("FOUND-15 bcrypt cost 10 verification still works", async () => {
  const hash = await bcrypt.hash(SAMPLE, 10);
  assert.equal(bcryptCost(hash), "10");
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("FOUND-16 bcrypt cost 12 verification works", async () => {
  const hash = await bcrypt.hash(SAMPLE, 12);
  assert.equal(bcryptCost(hash), "12");
  assert.equal(await verifyPassword(SAMPLE, hash), true);
  assert.equal(await verifyPassword(`${SAMPLE}-no`, hash), false);
});

test("FOUND-17 new hashes remain bcrypt cost 12", async () => {
  assert.equal(PASSWORD_HASH_ALGORITHM, "bcrypt");
  assert.equal(PASSWORD_BCRYPT_COST, 12);
  const hash = await hashPassword(SAMPLE);
  assert.equal(bcryptCost(hash), "12");
  assert.match(hash, /^\$2[ab]\$12\$/);
  assert.equal(await verifyPassword(SAMPLE, hash), true);
});
