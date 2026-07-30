function normalizeHeaderToken(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function formatRoomHeaderTitle(input: {
  roomLabel: string | null | undefined;
  sessionTitle: string | null | undefined;
}) {
  const sessionTitle = (input.sessionTitle ?? "").trim();
  const roomLabel = (input.roomLabel ?? "").trim();

  if (!roomLabel) {
    return sessionTitle;
  }

  if (!sessionTitle) {
    return roomLabel;
  }

  const normalizedRoomLabel = normalizeHeaderToken(roomLabel);
  const normalizedSessionTitle = normalizeHeaderToken(sessionTitle);
  if (
    normalizedRoomLabel === normalizedSessionTitle ||
    normalizedSessionTitle.includes(normalizedRoomLabel)
  ) {
    return sessionTitle;
  }

  return `${roomLabel} — ${sessionTitle}`;
}
