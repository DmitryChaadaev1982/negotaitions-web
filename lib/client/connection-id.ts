"use client";

import { useState } from "react";

function fallbackUuidLikeValue() {
  const nowPart = Date.now().toString(36);
  const perfPart =
    typeof performance !== "undefined" ? Math.round(performance.now()).toString(36) : "0";
  const randomPart = Math.random().toString(36).slice(2, 14);
  return `${nowPart}-${perfPart}-${randomPart}`;
}

function generateEntropy() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return fallbackUuidLikeValue();
}

export function generateClientConnectionId(prefix: string) {
  const safePrefix = prefix.trim().replace(/\s+/g, "-");
  return `${safePrefix}-${generateEntropy()}`;
}

export function useClientConnectionId(prefix: string) {
  const [connectionId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : generateClientConnectionId(prefix),
  );

  return connectionId;
}
