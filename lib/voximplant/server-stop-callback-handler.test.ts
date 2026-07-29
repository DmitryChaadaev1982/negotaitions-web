import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type SessionRow = {
  id: string;
  deletedAt: Date | null;
};

type CallbackTx = {
  session: {
    findUnique(args: { where: { id: string } }): Promise<SessionRow | null>;
  };
  sessionVoximplantControlChannel: {
    findUnique(args: {
      where: { providerSessionId?: string; sessionId?: string };
      select?: Record<string, unknown>;
    }): Promise<{
      id: string;
      sessionId: string;
      providerSessionId: string;
      conferenceName: string;
      controlUrl: string;
      registeredAt: Date;
    } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  sessionRecordingStopOperation: {
    count(args: unknown): Promise<number>;
  };
};

let serverOnlyShimInstalled = false;

async function loadCallbackHandlerDependencies() {
  if (!serverOnlyShimInstalled) {
    const moduleWithLoad = Module as typeof Module & {
      _load: (
        request: string,
        parent: NodeJS.Module | null,
        isMain: boolean,
      ) => unknown;
    };
    const originalLoad = moduleWithLoad._load;
    moduleWithLoad._load = (
      request: string,
      parent: NodeJS.Module | null,
      isMain: boolean,
    ) => {
      if (request === "server-only") {
        return {};
      }
      return originalLoad(request, parent, isMain);
    };
    serverOnlyShimInstalled = true;
  }

  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:pass@127.0.0.1:5432/negotiations_test";

  const [{ prisma }, callbackHandlerModule] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/voximplant/server-stop-callback-handler"),
  ]);

  return {
    prisma,
    handleServerStopCallbackEvent:
      callbackHandlerModule.handleServerStopCallbackEvent,
    ServerStopCallbackHandlerError:
      callbackHandlerModule.ServerStopCallbackHandlerError,
  };
}

const sessionId = "session-ack-1";
const conferenceName = `negotiation-${sessionId}`;
const callbackPayload = {
  eventType: "provider_session_registered" as const,
  sessionId,
  conferenceName,
  providerSessionId: "vox-provider-ack-1",
  accessSecureUrl: "https://provider.example/control/secure",
  controlUrl: "https://provider.example/control/secure",
  scenarioBuild: "main-room-server-stop-2026-07-21-rc5",
  scenarioSource: "neg-conf-main-room",
  ruleIdentity: "neg-conf-server-stop-poc-rule",
};

test("provider_session_registered returns durable ACK only after persistence and reread", async () => {
  const {
    prisma,
    handleServerStopCallbackEvent,
  } = await loadCallbackHandlerDependencies();
  const callOrder: string[] = [];
  const callbackTimestamp = new Date("2026-07-22T00:00:00.000Z");

  const prismaClient = prisma as unknown as {
    $transaction: <T>(callback: (tx: CallbackTx) => Promise<T>) => Promise<T>;
  };
  const sessionDelegate = prisma.session as unknown as {
    findUnique: (args: unknown) => Promise<SessionRow | null>;
  };
  const controlChannelDelegate = prisma.sessionVoximplantControlChannel as unknown as {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  const originalConsoleLog = console.log;
  const originalSessionFindUnique = sessionDelegate.findUnique;
  const originalTransaction = prismaClient.$transaction;
  const originalControlChannelFindUnique = controlChannelDelegate.findUnique;

  console.log = () => {};
  sessionDelegate.findUnique = async () => ({
    id: sessionId,
    deletedAt: null,
  });
  prismaClient.$transaction = async <T>(callback: (tx: CallbackTx) => Promise<T>) => {
    const tx: CallbackTx = {
      session: {
        findUnique: async () => {
          callOrder.push("tx:session_find");
          return { id: sessionId, deletedAt: null };
        },
      },
      sessionVoximplantControlChannel: {
        findUnique: async (args) => {
          if (args.where.providerSessionId) {
            callOrder.push("tx:provider_conflict_lookup");
            return null;
          }
          callOrder.push("tx:existing_session_lookup");
          return null;
        },
        update: async () => {
          callOrder.push("tx:update");
          return {};
        },
        create: async () => {
          callOrder.push("tx:create");
          return {};
        },
      },
      sessionRecordingStopOperation: {
        count: async () => {
          callOrder.push("tx:terminal_stop_count");
          return 0;
        },
      },
    };
    return callback(tx);
  };
  controlChannelDelegate.findUnique = async () => {
    callOrder.push("post_tx:reread");
    return {
      id: "channel-1",
      sessionId,
      providerSessionId: callbackPayload.providerSessionId,
      conferenceName,
      controlUrlFingerprint: "f".repeat(64),
      registeredAt: callbackTimestamp,
      lastSeenAt: callbackTimestamp,
    };
  };

  try {
    const result = await handleServerStopCallbackEvent({
      routeSessionId: sessionId,
      payload: callbackPayload,
      callbackTimestamp,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      eventType: "provider_session_registered",
      accepted: true,
      persisted: true,
      stateScope: "SESSION_SCOPED",
    });
    assert.equal(callOrder.includes("tx:create"), true);
    assert.equal(callOrder.includes("post_tx:reread"), true);
    assert.ok(callOrder.indexOf("tx:create") < callOrder.indexOf("post_tx:reread"));
  } finally {
    console.log = originalConsoleLog;
    sessionDelegate.findUnique = originalSessionFindUnique;
    prismaClient.$transaction = originalTransaction;
    controlChannelDelegate.findUnique = originalControlChannelFindUnique;
  }
});

test("provider_session_registered does not return durable ACK when persistence verification fails", async () => {
  const {
    prisma,
    handleServerStopCallbackEvent,
    ServerStopCallbackHandlerError,
  } = await loadCallbackHandlerDependencies();
  const callbackTimestamp = new Date("2026-07-22T00:00:00.000Z");

  const prismaClient = prisma as unknown as {
    $transaction: <T>(callback: (tx: CallbackTx) => Promise<T>) => Promise<T>;
  };
  const sessionDelegate = prisma.session as unknown as {
    findUnique: (args: unknown) => Promise<SessionRow | null>;
  };
  const controlChannelDelegate = prisma.sessionVoximplantControlChannel as unknown as {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  const originalConsoleLog = console.log;
  const originalSessionFindUnique = sessionDelegate.findUnique;
  const originalTransaction = prismaClient.$transaction;
  const originalControlChannelFindUnique = controlChannelDelegate.findUnique;

  console.log = () => {};
  sessionDelegate.findUnique = async () => ({
    id: sessionId,
    deletedAt: null,
  });
  prismaClient.$transaction = async <T>(callback: (tx: CallbackTx) => Promise<T>) => {
    const tx: CallbackTx = {
      session: {
        findUnique: async () => ({ id: sessionId, deletedAt: null }),
      },
      sessionVoximplantControlChannel: {
        findUnique: async () => null,
        update: async () => ({}),
        create: async () => ({}),
      },
      sessionRecordingStopOperation: {
        count: async () => 0,
      },
    };
    return callback(tx);
  };
  controlChannelDelegate.findUnique = async () => null;

  try {
    await assert.rejects(
      handleServerStopCallbackEvent({
        routeSessionId: sessionId,
        payload: callbackPayload,
        callbackTimestamp,
      }),
      (error: unknown) => {
        assert.equal(error instanceof ServerStopCallbackHandlerError, true);
        if (error instanceof ServerStopCallbackHandlerError) {
          assert.equal(error.status, 409);
        }
        return true;
      },
    );
  } finally {
    console.log = originalConsoleLog;
    sessionDelegate.findUnique = originalSessionFindUnique;
    prismaClient.$transaction = originalTransaction;
    controlChannelDelegate.findUnique = originalControlChannelFindUnique;
  }
});
