export type RoomAudioCue =
  | "START"
  | "PAUSE"
  | "RESUME"
  | "ONE_MINUTE"
  | "TEN_SECONDS"
  | "END";

type OscillatorTypeSoft = "sine" | "triangle";

type ToneStep = {
  frequencyHz: number;
  durationMs: number;
  gain: number;
  type?: OscillatorTypeSoft;
};

type CueDefinition = {
  steps: ToneStep[];
  stepGapMs?: number;
};

export const ROOM_AUDIO_MASTER_GAIN = 0.12;

type AudioContextConstructor = typeof AudioContext;
type AudioContextRunningListener = (isRunning: boolean) => void;

let sharedRoomAudioContext: AudioContext | null = null;
const audioContextRunningListeners = new Set<AudioContextRunningListener>();

export const ROOM_AUDIO_CUE_DEFINITIONS: Record<RoomAudioCue, CueDefinition> = {
  START: {
    steps: [
      { frequencyHz: 520, durationMs: 90, gain: 0.95, type: "triangle" },
      { frequencyHz: 660, durationMs: 130, gain: 1.0, type: "triangle" },
    ],
    stepGapMs: 20,
  },
  PAUSE: {
    steps: [
      { frequencyHz: 620, durationMs: 90, gain: 0.85, type: "triangle" },
      { frequencyHz: 430, durationMs: 140, gain: 1.0, type: "triangle" },
    ],
    stepGapMs: 18,
  },
  RESUME: {
    steps: [
      { frequencyHz: 540, durationMs: 75, gain: 0.72, type: "triangle" },
      { frequencyHz: 630, durationMs: 105, gain: 0.8, type: "triangle" },
    ],
    stepGapMs: 16,
  },
  ONE_MINUTE: {
    steps: [{ frequencyHz: 560, durationMs: 180, gain: 0.9, type: "sine" }],
  },
  TEN_SECONDS: {
    steps: [
      { frequencyHz: 760, durationMs: 95, gain: 1.0, type: "triangle" },
      { frequencyHz: 620, durationMs: 130, gain: 1.0, type: "triangle" },
    ],
    stepGapMs: 24,
  },
  END: {
    steps: [
      { frequencyHz: 540, durationMs: 90, gain: 1.0, type: "sine" },
      { frequencyHz: 430, durationMs: 125, gain: 0.95, type: "sine" },
      { frequencyHz: 320, durationMs: 160, gain: 0.9, type: "sine" },
    ],
    stepGapMs: 24,
  },
};

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  const typedGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return typedGlobal.AudioContext ?? typedGlobal.webkitAudioContext ?? null;
}

function notifyAudioContextRunningListeners() {
  const isRunning = sharedRoomAudioContext?.state === "running";
  for (const listener of audioContextRunningListeners) {
    listener(isRunning);
  }
}

function primeSemanticRoomAudioGraph(context: AudioContext) {
  try {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const startAtSeconds = context.currentTime;
    gainNode.gain.setValueAtTime(0.0001, startAtSeconds);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
    oscillator.start(startAtSeconds);
    oscillator.stop(startAtSeconds + 0.02);
  } catch {
    // Priming is best-effort; resume below remains authoritative.
  }
}

export function getSemanticRoomAudioContext() {
  return sharedRoomAudioContext;
}

export function isSemanticRoomAudioContextRunning() {
  return sharedRoomAudioContext?.state === "running";
}

export function subscribeSemanticRoomAudioContextRunning(
  listener: AudioContextRunningListener,
) {
  audioContextRunningListeners.add(listener);
  listener(isSemanticRoomAudioContextRunning());
  return () => {
    audioContextRunningListeners.delete(listener);
  };
}

export async function ensureSemanticRoomAudioContextRunning() {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    notifyAudioContextRunningListeners();
    return false;
  }

  if (!sharedRoomAudioContext) {
    try {
      sharedRoomAudioContext = new AudioContextConstructor();
      sharedRoomAudioContext.onstatechange = notifyAudioContextRunningListeners;
    } catch {
      notifyAudioContextRunningListeners();
      return false;
    }
  }

  primeSemanticRoomAudioGraph(sharedRoomAudioContext);

  if (sharedRoomAudioContext.state !== "running") {
    try {
      await sharedRoomAudioContext.resume();
    } catch {
      notifyAudioContextRunningListeners();
      return false;
    }
  }

  notifyAudioContextRunningListeners();
  return sharedRoomAudioContext.state === "running";
}

type AudioContextLike = {
  currentTime: number;
  destination: AudioNode;
  createOscillator: () => OscillatorNode;
  createGain: () => GainNode;
};

function scheduleTone(params: {
  context: AudioContextLike;
  startAtSeconds: number;
  step: ToneStep;
}) {
  const { context, startAtSeconds, step } = params;
  const durationSeconds = step.durationMs / 1000;
  const attackSeconds = Math.min(0.012, durationSeconds / 3);
  const releaseSeconds = Math.min(0.08, durationSeconds / 2);
  const sustainSeconds = Math.max(durationSeconds - attackSeconds - releaseSeconds, 0);
  const endAtSeconds = startAtSeconds + attackSeconds + sustainSeconds + releaseSeconds;

  const oscillator = context.createOscillator();
  oscillator.type = step.type ?? "sine";
  oscillator.frequency.setValueAtTime(step.frequencyHz, startAtSeconds);

  const gainNode = context.createGain();
  const targetGain = ROOM_AUDIO_MASTER_GAIN * step.gain;

  gainNode.gain.setValueAtTime(0.0001, startAtSeconds);
  gainNode.gain.linearRampToValueAtTime(
    targetGain,
    startAtSeconds + attackSeconds,
  );
  gainNode.gain.setValueAtTime(
    targetGain,
    startAtSeconds + attackSeconds + sustainSeconds,
  );
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAtSeconds);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAtSeconds);
  oscillator.stop(endAtSeconds);
}

export function playSemanticRoomAudioCue(context: AudioContextLike, cue: RoomAudioCue) {
  const definition = ROOM_AUDIO_CUE_DEFINITIONS[cue];
  if (!definition) {
    return;
  }
  const stepGapSeconds = (definition.stepGapMs ?? 18) / 1000;
  let offsetSeconds = 0;
  const baseTime = context.currentTime;

  for (const step of definition.steps) {
    scheduleTone({
      context,
      startAtSeconds: baseTime + offsetSeconds,
      step,
    });
    offsetSeconds += step.durationMs / 1000 + stepGapSeconds;
  }
}
