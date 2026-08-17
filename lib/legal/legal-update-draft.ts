import {
  CURRENT_CONSENT_TYPES,
  type CurrentConsentType,
} from "@/lib/consent/user-consent";
import { CURRENT_LEGAL_RELEASE } from "@/lib/legal/release";

export type LegalUpdateDraft = Record<CurrentConsentType, boolean>;

const EMPTY_DRAFT: LegalUpdateDraft = Object.freeze({
  [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]: false,
  [CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2]: false,
  [CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]: false,
});

const draftListeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedDraft: LegalUpdateDraft = EMPTY_DRAFT;

export function legalUpdateDraftStorageKey(
  releaseId = CURRENT_LEGAL_RELEASE.id,
): string {
  return `negotaitions.legalUpdateDraft.${releaseId}`;
}

export function emptyLegalUpdateDraft(): LegalUpdateDraft {
  return EMPTY_DRAFT;
}

function isBooleanRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a UI-only checkbox draft. Tokens, emails, and user identifiers are
 * ignored; only the three current-release booleans survive. This is never
 * evidence of consent.
 */
export function parseLegalUpdateDraft(raw: string | null | undefined): LegalUpdateDraft {
  if (typeof raw !== "string" || raw.trim() === "") return EMPTY_DRAFT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return EMPTY_DRAFT;
  }
  if (!isBooleanRecord(parsed)) return EMPTY_DRAFT;

  const draft: LegalUpdateDraft = {
    [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]:
      parsed[CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2] === true,
    [CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2]:
      parsed[CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2] === true,
    [CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]:
      parsed[CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2] === true,
  };
  if (
    !draft[CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2] &&
    !draft[CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2] &&
    !draft[CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]
  ) {
    return EMPTY_DRAFT;
  }
  return draft;
}

export function serializeLegalUpdateDraft(draft: LegalUpdateDraft): string {
  return JSON.stringify({
    [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]:
      draft[CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2] === true,
    [CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2]:
      draft[CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2] === true,
    [CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]:
      draft[CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2] === true,
  });
}

function emitLegalUpdateDraftChange() {
  for (const listener of draftListeners) {
    listener();
  }
}

export function subscribeLegalUpdateDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function readLegalUpdateDraft(): LegalUpdateDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(legalUpdateDraftStorageKey());
    if (raw === cachedRaw) return cachedDraft;
    cachedRaw = raw;
    cachedDraft = parseLegalUpdateDraft(raw);
    return cachedDraft;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function writeLegalUpdateDraft(draft: LegalUpdateDraft): void {
  if (typeof window === "undefined") return;
  const serialized = serializeLegalUpdateDraft(draft);
  try {
    window.sessionStorage.setItem(legalUpdateDraftStorageKey(), serialized);
  } catch {
    // sessionStorage may be unavailable; UI convenience only.
  }
  cachedRaw = serialized;
  cachedDraft = parseLegalUpdateDraft(serialized);
  emitLegalUpdateDraftChange();
}

export function clearLegalUpdateDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(legalUpdateDraftStorageKey());
  } catch {
    // Ignore storage failures.
  }
  cachedRaw = null;
  cachedDraft = EMPTY_DRAFT;
  emitLegalUpdateDraftChange();
}
