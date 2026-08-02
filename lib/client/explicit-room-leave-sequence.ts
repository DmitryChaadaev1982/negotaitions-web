"use client";

import type {
  ExplicitLeaveFailure,
  ExplicitLeaveResult,
} from "@/lib/client/explicit-room-leave";

export type ExplicitLeaveSequenceParams = {
  persistLeave: () => Promise<ExplicitLeaveResult>;
  markLocalInactive: () => void;
  disconnectProvider: () => Promise<void>;
  navigate: () => void;
};

export type ExplicitLeaveSequenceOutcome =
  | {
      ok: true;
      leave: ExplicitLeaveResult & { ok: true };
      providerDisconnectError: string | null;
    }
  | {
      ok: false;
      leave: ExplicitLeaveFailure;
    };

export async function runExplicitLeaveSequence({
  persistLeave,
  markLocalInactive,
  disconnectProvider,
  navigate,
}: ExplicitLeaveSequenceParams): Promise<ExplicitLeaveSequenceOutcome> {
  const leaveResult = await persistLeave();
  if (!leaveResult.ok) {
    return { ok: false, leave: leaveResult };
  }

  markLocalInactive();
  navigate();

  let providerDisconnectError: string | null = null;
  try {
    await disconnectProvider();
  } catch (error) {
    providerDisconnectError =
      error instanceof Error ? error.message : String(error);
  }

  return {
    ok: true,
    leave: leaveResult,
    providerDisconnectError,
  };
}
