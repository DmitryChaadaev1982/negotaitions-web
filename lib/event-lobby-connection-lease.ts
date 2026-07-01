import "server-only";

type LeaseRecord = {
  connectionId: string;
  version: number;
  updatedAtMs: number;
};

type ClaimResult = {
  activeConnectionId: string;
  version: number;
  replacedConnectionId: string | null;
  isCurrentConnectionActive: boolean;
};

const LEASES_SYMBOL = Symbol.for("negotaitions.eventLobbyConnectionLeases");

function getLeaseStore(): Map<string, LeaseRecord> {
  const globalScope = globalThis as typeof globalThis & {
    [LEASES_SYMBOL]?: Map<string, LeaseRecord>;
  };
  if (!globalScope[LEASES_SYMBOL]) {
    globalScope[LEASES_SYMBOL] = new Map<string, LeaseRecord>();
  }
  return globalScope[LEASES_SYMBOL]!;
}

function leaseKey(eventId: string, userId: string) {
  return `${eventId}:${userId}`;
}

export function claimEventLobbyConnectionLease(params: {
  eventId: string;
  userId: string;
  connectionId: string;
}): ClaimResult {
  const store = getLeaseStore();
  const key = leaseKey(params.eventId, params.userId);
  const now = Date.now();
  const current = store.get(key);

  if (!current) {
    store.set(key, {
      connectionId: params.connectionId,
      version: 1,
      updatedAtMs: now,
    });
    return {
      activeConnectionId: params.connectionId,
      version: 1,
      replacedConnectionId: null,
      isCurrentConnectionActive: true,
    };
  }

  if (current.connectionId === params.connectionId) {
    current.updatedAtMs = now;
    store.set(key, current);
    return {
      activeConnectionId: current.connectionId,
      version: current.version,
      replacedConnectionId: null,
      isCurrentConnectionActive: true,
    };
  }

  const nextVersion = current.version + 1;
  store.set(key, {
    connectionId: params.connectionId,
    version: nextVersion,
    updatedAtMs: now,
  });

  return {
    activeConnectionId: params.connectionId,
    version: nextVersion,
    replacedConnectionId: current.connectionId,
    isCurrentConnectionActive: true,
  };
}

export function validateEventLobbyConnectionLease(params: {
  eventId: string;
  userId: string;
  connectionId: string;
}) {
  const store = getLeaseStore();
  const current = store.get(leaseKey(params.eventId, params.userId));
  if (!current) {
    return {
      isCurrentConnectionActive: true,
      activeConnectionId: params.connectionId,
      version: 0,
    };
  }
  return {
    isCurrentConnectionActive: current.connectionId === params.connectionId,
    activeConnectionId: current.connectionId,
    version: current.version,
  };
}
