import type { ControlAction } from "@/lib/negotiation-control";

export function shouldRunLivekitRecordingLifecycle(action: ControlAction) {
  return action === "START" || action === "FINISH";
}
