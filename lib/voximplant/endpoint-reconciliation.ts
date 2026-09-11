/**
 * Conservative Vox endpoint snapshot reconciliation.
 *
 * The 1s local SDK map can be transiently empty while the current call is
 * still connected. That must not wipe React remotes. Safe removal requires
 * EndpointRemoved, an actual provider disconnect, or a non-empty authoritative
 * snapshot that no longer lists a previously known id.
 */

export type ReconcileRemoteIdentity = {
  id: string;
};

export type EndpointSnapshotReconcileInput<T extends ReconcileRemoteIdentity> = {
  current: readonly T[];
  snapshotIds: ReadonlySet<string>;
  conferenceConnected: boolean;
};

export type EndpointSnapshotReconcileResult<T extends ReconcileRemoteIdentity> = {
  next: T[];
  removedIds: string[];
  keptDespiteEmptySnapshot: boolean;
};

export function reconcileRemoteParticipantsFromSnapshot<
  T extends ReconcileRemoteIdentity,
>(input: EndpointSnapshotReconcileInput<T>): EndpointSnapshotReconcileResult<T> {
  if (!input.conferenceConnected) {
    const removedIds = input.current.map((remote) => remote.id);
    return {
      next: [],
      removedIds,
      keptDespiteEmptySnapshot: false,
    };
  }

  if (input.snapshotIds.size === 0) {
    return {
      next: [...input.current],
      removedIds: [],
      keptDespiteEmptySnapshot: input.current.length > 0,
    };
  }

  const next = input.current.filter((remote) => input.snapshotIds.has(remote.id));
  const removedIds = input.current
    .filter((remote) => !input.snapshotIds.has(remote.id))
    .map((remote) => remote.id);

  return {
    next,
    removedIds,
    keptDespiteEmptySnapshot: false,
  };
}

export function remotesAfterProviderDisconnect<T>(): T[] {
  return [];
}

export function remotesAfterEndpointRemoved<T extends ReconcileRemoteIdentity>(
  current: readonly T[],
  endpointId: string,
): T[] {
  return current.filter((remote) => remote.id !== endpointId);
}

export function normalizeLobbyProviderUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? (normalized.split("@")[0] ?? null) : normalized;
}

export function isCurrentLobbySelfEndpoint(input: {
  localSdkUsername: string | null | undefined;
  endpointUserName: string | null | undefined;
}): boolean {
  const localId = normalizeLobbyProviderUsername(input.localSdkUsername);
  const endpointId = normalizeLobbyProviderUsername(input.endpointUserName);
  if (!localId || !endpointId) return false;
  return localId === endpointId;
}

export function excludeCurrentLobbySelfRemotes<T extends { endpointUsername?: string | null }>(
  remotes: readonly T[],
  localSdkUsername: string | null | undefined,
): T[] {
  return remotes.filter(
    (remote) =>
      !isCurrentLobbySelfEndpoint({
        localSdkUsername,
        endpointUserName: remote.endpointUsername,
      }),
  );
}
