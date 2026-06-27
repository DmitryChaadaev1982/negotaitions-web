"use client";

import { useEffect, useMemo, useState } from "react";

import { removeParticipant } from "@/app/actions/sessions";
import { formatDateFromIso } from "@/lib/format-date";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ParticipantNoteEntry } from "@/lib/participant-notes-types";
import {
  isParticipantOnline,
  resolveConnectionStatus,
  type ParticipantConnectionStatus,
  type ParticipantPresenceSnapshot,
} from "@/lib/presence";

type ParticipantRow = {
  id: string;
  displayName: string;
  type: string;
  caseRoleName: string | null;
  joinedAt: string | null;
  lastSeenAt: string | null;
  notesCount: number;
  notes: ParticipantNoteEntry[];
};

type ParticipantsTableProps = {
  sessionId: string;
  participants: ParticipantRow[];
  readOnly?: boolean;
  onViewNotes: (participant: ParticipantRow) => void;
};

function ConnectionStatus({
  connectionStatus,
}: {
  connectionStatus: ParticipantConnectionStatus;
}) {
  const { t } = useI18n();

  const colorClass =
    connectionStatus === "ONLINE"
      ? "bg-emerald-500"
      : connectionStatus === "RECENTLY_DISCONNECTED"
        ? "bg-amber-500"
        : "bg-rose-500";

  const textClass =
    connectionStatus === "ONLINE"
      ? "text-emerald-300"
      : connectionStatus === "RECENTLY_DISCONNECTED"
        ? "text-amber-300"
        : "text-rose-300";

  const labelKey =
    connectionStatus === "ONLINE"
      ? "rejoin.online"
      : connectionStatus === "RECENTLY_DISCONNECTED"
        ? "rejoin.recentlyDisconnected"
        : "rejoin.offline";

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${colorClass}`} />
      <span className={textClass}>{t(labelKey)}</span>
    </span>
  );
}

type ParticipantsPresenceTableProps = {
  sessionId: string;
  participants: ParticipantRow[];
  initialPresence: Map<string, ParticipantPresenceSnapshot>;
  readOnly?: boolean;
  onViewNotes: (participant: ParticipantRow) => void;
};

function formatNotesCountLabel(
  count: number,
  t: (key: "sessions.notesCountZero" | "sessions.notesCountOne" | "sessions.notesCountMany", params?: Record<string, string | number>) => string,
) {
  if (count === 0) {
    return t("sessions.notesCountZero");
  }

  if (count === 1) {
    return t("sessions.notesCountOne");
  }

  return t("sessions.notesCountMany", { count });
}

function ParticipantsPresenceTable({
  sessionId,
  participants,
  initialPresence,
  readOnly = false,
  onViewNotes,
}: ParticipantsPresenceTableProps) {
  const { t, locale } = useI18n();
  const [presenceById, setPresenceById] =
    useState<Map<string, ParticipantPresenceSnapshot>>(initialPresence);

  useEffect(() => {
    const source = new EventSource(
      `/api/sessions/${sessionId}/presence/stream`,
    );

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          participants: ParticipantPresenceSnapshot[];
        };

        setPresenceById((current) => {
          const next = new Map(current);

          for (const snapshot of payload.participants) {
            next.set(snapshot.id, snapshot);
          }

          return next;
        });
      } catch {
        // Ignore malformed stream payloads.
      }
    };

    return () => {
      source.close();
    };
  }, [sessionId]);

  return (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-700/40">
          <thead className="bg-slate-900/80">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.name")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.type")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.assignedRole")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.firstJoined")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.lastSeen")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.onlineNow")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("sessions.notes")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("common.actions")}
              </th>
            </tr>
          </thead>
        <tbody className="divide-y divide-slate-700/40">
          {participants.map((participant) => {
            const presence = presenceById.get(participant.id);
            const typeLabel = t(
              `participantType.${participant.type}` as `participantType.PARTICIPANT`,
            );

            return (
              <tr key={participant.id} className="hover:bg-slate-800/50">
                <td className="px-6 py-4 text-sm font-medium text-slate-50">
                  {participant.displayName}
                </td>
                <td className="px-6 py-4 text-sm text-slate-300">
                  {typeLabel}
                </td>
                <td className="px-6 py-4 text-sm text-slate-300">
                  {participant.caseRoleName ?? "—"}
                </td>
                <td className="px-6 py-4 text-sm text-slate-300">
                  {formatDateFromIso(
                    presence?.joinedAt ?? participant.joinedAt,
                    t("common.notYet"),
                    locale,
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-slate-300">
                  {formatDateFromIso(
                    presence?.lastSeenAt ?? participant.lastSeenAt,
                    t("common.notYet"),
                    locale,
                  )}
                </td>
                <td className="px-6 py-4">
                  <ConnectionStatus
                    connectionStatus={
                      presence?.connectionStatus ??
                      resolveConnectionStatus(
                        presence?.lastSeenAt
                          ? new Date(presence.lastSeenAt)
                          : participant.lastSeenAt
                            ? new Date(participant.lastSeenAt)
                            : null,
                      )
                    }
                  />
                </td>
                <td className="px-6 py-4 text-sm text-slate-300">
                  {formatNotesCountLabel(participant.notesCount, t)}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => onViewNotes(participant)}
                      className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      {t("sessions.viewNotes")}
                    </button>
                    {!readOnly ? (
                      <form action={removeParticipant}>
                        <input
                          type="hidden"
                          name="participantId"
                          value={participant.id}
                        />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={sessionId}
                        />
                        <button
                          type="submit"
                          className="text-sm font-medium text-rose-400 hover:text-rose-300"
                        >
                          {t("common.remove")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ParticipantsTable({
  sessionId,
  participants,
  readOnly = false,
  onViewNotes,
}: ParticipantsTableProps) {
  const initialPresence = useMemo(() => {
    const map = new Map<string, ParticipantPresenceSnapshot>();

    for (const participant of participants) {
      map.set(participant.id, {
        id: participant.id,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
        isOnline: isParticipantOnline(
          participant.lastSeenAt ? new Date(participant.lastSeenAt) : null,
        ),
        connectionStatus: resolveConnectionStatus(
          participant.lastSeenAt ? new Date(participant.lastSeenAt) : null,
        ),
      });
    }

    return map;
  }, [participants]);

  const participantsKey = useMemo(
    () =>
      participants
        .map(
          (participant) =>
            `${participant.id}:${participant.joinedAt}:${participant.lastSeenAt}`,
        )
        .join("|"),
    [participants],
  );

  return (
    <ParticipantsPresenceTable
      key={participantsKey}
      sessionId={sessionId}
      participants={participants}
      initialPresence={initialPresence}
      readOnly={readOnly}
      onViewNotes={onViewNotes}
    />
  );
}
