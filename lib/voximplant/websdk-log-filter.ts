type WebSdkLogProps = {
  fullMessage: string;
  message: unknown[];
  extraData?: {
    level?: string;
    scope?: string;
  };
};

type BenignSignature =
  | "reinvite_mids_race"
  | "transport_not_ready_mute"
  | "endpoint_vad_missing_endpoint";

type WebSdkLoggerAdapterOptions = {
  emitWarn?: (message: string) => void;
  emitError?: (...args: unknown[]) => void;
};

function toCombinedMessage(props: WebSdkLogProps): string {
  const fallback = props.message.map((entry) => String(entry)).join(" ");
  return props.fullMessage || fallback;
}

function classifyBenignSignature(message: string): BenignSignature | null {
  const lower = message.toLowerCase();

  // Not actually a race: the SDK dereferences scheme.endpoints[cause.id] for a
  // cause id the same message never defines, which abandons the whole ReInvite.
  // lib/voximplant/reinvite-scheme-sanitizer.ts removes those causes before the
  // SDK sees them, so this signature must not appear at runtime any more. It is
  // still classified here only to keep a single deduplicated console line if the
  // sanitizer is ever bypassed.
  const hasMidsError =
    lower.includes("cannot read properties of undefined") &&
    lower.includes("reading 'mids'");
  const hasMidsContext =
    lower.includes("handlereinvite") ||
    lower.includes("conferencemanager") ||
    /conference_[a-z0-9_-]+/i.test(message) ||
    lower.includes("message subscriber handlereinvite");
  if (hasMidsError && hasMidsContext) {
    return "reinvite_mids_race";
  }

  const isTransientMuteSignal =
    lower.includes(
      "transport is not ready. message sending will be delayed until signalling ready.",
    ) &&
    (lower.includes('"name":"mute"') ||
      lower.includes("name=mute") ||
      lower.includes("name = mute"));
  if (isTransientMuteSignal) {
    return "transport_not_ready_mute";
  }

  const hasMissingEndpoint = lower.includes("can't find endpoint");
  const hasVadMutation =
    lower.includes("to change vad value") ||
    lower.includes("endpointmanagerimpl.setendpointvad");
  if (hasMissingEndpoint && hasVadMutation) {
    return "endpoint_vad_missing_endpoint";
  }

  return null;
}

export function isBenignWebSdkRaceLog(props: WebSdkLogProps): boolean {
  return classifyBenignSignature(toCombinedMessage(props)) != null;
}

export function createWebSdkLogFilterAdapter(
  options: WebSdkLoggerAdapterOptions = {},
) {
  const seenSignatures = new Set<BenignSignature>();
  const emitWarn = options.emitWarn ?? ((message: string) => console.warn(message));
  const emitError = options.emitError ?? ((...args: unknown[]) => console.error(...args));

  return {
    onLog(props: WebSdkLogProps) {
      const signature = classifyBenignSignature(toCombinedMessage(props));
      if (signature) {
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          emitWarn(`[Voximplant SDK log downgraded once] ${signature}`);
        }
        return;
      }
      emitError(props.fullMessage);
    },
    reset() {
      seenSignatures.clear();
    },
  };
}
