"use client";

import { useSyncExternalStore } from "react";

import {
  getValidRecoveryContext,
  RECOVERY_STORAGE_KEY,
} from "@/lib/rejoin/recovery-storage";

const RECOVERY_UPDATED_EVENT = "negotaitions:recovery-updated";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleChange = () => onStoreChange();

  window.addEventListener("storage", handleChange);
  window.addEventListener(RECOVERY_UPDATED_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(RECOVERY_UPDATED_EVENT, handleChange);
  };
}

function getRecoveryAvailableSnapshot() {
  return Boolean(getValidRecoveryContext());
}

function getServerRecoveryAvailableSnapshot() {
  return false;
}

export function useRecoveryAvailable() {
  return useSyncExternalStore(
    subscribe,
    getRecoveryAvailableSnapshot,
    getServerRecoveryAvailableSnapshot,
  );
}

export { RECOVERY_STORAGE_KEY, RECOVERY_UPDATED_EVENT };
