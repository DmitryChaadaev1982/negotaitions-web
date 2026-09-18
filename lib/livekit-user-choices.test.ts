import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIVEKIT_USER_CHOICES,
  LIVEKIT_USER_CHOICES_STORAGE_KEY,
  ensureDefaultLiveKitUserChoices,
} from "@/lib/livekit-user-choices";

function memoryStorage(initial?: Record<string, string>): Storage {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

test("ensureDefaultLiveKitUserChoices seeds LiveKit defaults when the key is absent", () => {
  const storage = memoryStorage();
  assert.equal(ensureDefaultLiveKitUserChoices(storage), true);
  assert.equal(
    storage.getItem(LIVEKIT_USER_CHOICES_STORAGE_KEY),
    JSON.stringify(DEFAULT_LIVEKIT_USER_CHOICES),
  );
});

test("ensureDefaultLiveKitUserChoices does not overwrite an existing value", () => {
  const storage = memoryStorage({
    [LIVEKIT_USER_CHOICES_STORAGE_KEY]: JSON.stringify({
      videoEnabled: false,
      audioEnabled: false,
      videoDeviceId: "cam-1",
      audioDeviceId: "mic-1",
      username: "Ada",
    }),
  });
  assert.equal(ensureDefaultLiveKitUserChoices(storage), false);
  const stored = JSON.parse(
    storage.getItem(LIVEKIT_USER_CHOICES_STORAGE_KEY) ?? "{}",
  ) as { username?: string };
  assert.equal(stored.username, "Ada");
});
