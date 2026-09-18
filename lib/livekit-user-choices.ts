export const LIVEKIT_USER_CHOICES_STORAGE_KEY = "lk-user-choices";

/**
 * Same defaults LiveKit `loadUserChoices` uses when the key is absent.
 * Absence is a normal first-visit state; the SDK still warns if we let it
 * read a missing key.
 */
export const DEFAULT_LIVEKIT_USER_CHOICES = {
  videoEnabled: true,
  audioEnabled: true,
  videoDeviceId: "default",
  audioDeviceId: "default",
  username: "",
};

export function ensureDefaultLiveKitUserChoices(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof window ===
  "undefined"
    ? null
    : window.localStorage,
): boolean {
  if (!storage) {
    return false;
  }

  try {
    if (storage.getItem(LIVEKIT_USER_CHOICES_STORAGE_KEY) != null) {
      return false;
    }
    storage.setItem(
      LIVEKIT_USER_CHOICES_STORAGE_KEY,
      JSON.stringify(DEFAULT_LIVEKIT_USER_CHOICES),
    );
    return true;
  } catch {
    return false;
  }
}
