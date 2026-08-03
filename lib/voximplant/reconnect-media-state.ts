export type SessionMediaStatusRecord = {
  connectionId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  updatedAt: string;
};

export function isMediaStatusCurrentForConnection(
  mediaStatus: SessionMediaStatusRecord | null | undefined,
  activeConnectionId: string | null,
): mediaStatus is SessionMediaStatusRecord {
  if (!mediaStatus) return false;
  return activeConnectionId === null
    ? mediaStatus.connectionId === null
    : mediaStatus.connectionId === activeConnectionId;
}
