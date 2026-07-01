export function toVoxErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown Voximplant error.";
}

export function isRecoverableVoxMediaError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = toVoxErrorMessage(error).toLowerCase();
  return (
    name === "NotReadableError" ||
    name === "NotAllowedError" ||
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    message.includes("notreadableerror") ||
    message.includes("notallowederror") ||
    message.includes("notfounderror") ||
    message.includes("device in use") ||
    message.includes("permission denied") ||
    message.includes("could not start video source") ||
    message.includes("could not start audio source") ||
    message.includes("overconstrained")
  );
}

export function isAlreadyExistsStreamError(error: unknown): boolean {
  const message = toVoxErrorMessage(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("streamupdatefailed") ||
    message.includes("stream with type")
  );
}

function shouldSuppressKnownVoxDevError(lowerMessage: string): boolean {
  const isCameraDeviceBusy =
    (lowerMessage.includes("[streammanager]") &&
      lowerMessage.includes("notreadableerror")) ||
    lowerMessage.includes("notreadableerror: device in use") ||
    (lowerMessage.includes("device in use") &&
      lowerMessage.includes("[streammanager]"));
  const isReinviteQueueNoise =
    lowerMessage.includes("[websdk]") &&
    lowerMessage.includes("reinvitequeue") &&
    lowerMessage.includes("reinvite rejected");
  return isCameraDeviceBusy || isReinviteQueueNoise;
}

function installVoxDevConsoleSuppressor(): () => void {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") {
    return () => {};
  }
  const original = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    const combined = args
      .map((a) =>
        typeof a === "string"
          ? a
          : a instanceof Error
            ? `${a.name}: ${a.message}`
            : String(a),
      )
      .join(" ");
    if (!shouldSuppressKnownVoxDevError(combined.toLowerCase())) {
      original.apply(console, args);
    }
  };
  return () => {
    console.error = original;
  };
}

/**
 * DEV ONLY: suppresses expected camera-busy StreamManager errors that would
 * otherwise dominate the dev overlay. Use only around camera acquisition calls.
 */
export function installVoxCameraErrorSuppressor(): () => void {
  return installVoxDevConsoleSuppressor();
}

/**
 * DEV ONLY: suppresses known noisy Vox WebSDK console.error logs that are
 * already handled by UI/system status and should not trigger Next.js overlay.
 */
export function installVoxRuntimeErrorSuppressor(): () => void {
  return installVoxDevConsoleSuppressor();
}
