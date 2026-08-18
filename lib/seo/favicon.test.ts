import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ROBOTS_DISALLOW_PATHS } from "@/lib/seo/indexing";

function readIcoSizes(filePath: string): number[] {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.readUInt16LE(0), 0, `${filePath} reserved`);
  assert.equal(buffer.readUInt16LE(2), 1, `${filePath} type`);
  const count = buffer.readUInt16LE(4);
  assert.ok(count >= 1, `${filePath} image count`);
  const sizes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = buffer.readUInt8(entry);
    const height = buffer.readUInt8(entry + 1);
    sizes.push(width === 0 ? 256 : width);
    assert.equal(height === 0 ? 256 : height, sizes.at(-1));
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    assert.ok(bytes > 0);
    assert.ok(offset >= 6 + 16 * count);
    assert.ok(offset + bytes <= buffer.length);
  }
  return sizes;
}

test("canonical root favicon.ico is a valid multi-size ICO including 32x32", () => {
  const appIco = path.join(process.cwd(), "app", "favicon.ico");
  const publicIco = path.join(process.cwd(), "public", "favicon.ico");
  const appBuffer = readFileSync(appIco);
  const publicBuffer = readFileSync(publicIco);
  assert.deepEqual(appBuffer, publicBuffer);
  const sizes = readIcoSizes(appIco);
  assert.ok(sizes.includes(16), "16x16");
  assert.ok(sizes.includes(32), "32x32");
  assert.doesNotMatch(appBuffer.toString("utf8"), /joinToken|hostToken|participantToken/i);
});

test("robots disallow list does not block anonymous /favicon.ico", () => {
  for (const blocked of ROBOTS_DISALLOW_PATHS) {
    assert.notEqual(blocked, "/favicon.ico");
    assert.equal(
      "/favicon.ico" === blocked || "/favicon.ico".startsWith(`${blocked}/`),
      false,
      blocked,
    );
  }
});
