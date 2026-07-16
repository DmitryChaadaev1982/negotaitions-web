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
          emitWarn(`[Voximplant SDK benign race suppressed] ${signature}`);
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
