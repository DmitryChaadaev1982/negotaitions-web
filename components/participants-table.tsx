"use client";

import { useEffect, useMemo, useState } from "react";

import { removeParticipant } from "@/app/actions/sessions";
import { CopyJoinLinkButton } from "@/components/copy-join-link-button";
import { formatDateFromIso } from "@/lib/format-date";
import {
  isParticipantOnline,
  type ParticipantPresenceSnapshot,
} from "@/lib/presence";

type ParticipantRow = {
  id: string;
  displayName: string;
  type: string;
  caseRoleName: string | null;
  joinUrl: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
};

type ParticipantsTableProps = {
  sessionId: string;
  participants: ParticipantRow[];
};

function OnlineStatus({ isOnline }: { isOnline: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          isOnline ? "bg-emerald-500" : "bg-slate-300"
        }`}
      />
      <span className={isOnline ? "text-emerald-700" : "text-slate-500"}>
        {isOnline ? "Online" : "Offline"}
      </span>
    </span>
  );
}

type ParticipantsPresenceTableProps = {
  sessionId: string;
  participants: ParticipantRow[];
  initialPresence: Map<string, ParticipantPresenceSnapshot>;
};

function ParticipantsPresenceTable({
  sessionId,
  participants,
  initialPresence,
}: ParticipantsPresenceTableProps) {
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
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Assigned role
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Join link
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              First joined
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Last seen
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              Online now
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {participants.map((participant) => {
            const presence = presenceById.get(participant.id);

            return (
              <tr key={participant.id}>
                <td className="px-6 py-4 text-sm font-medium text-slate-900">
                  {participant.displayName}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {participant.type}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {participant.caseRoleName ?? "—"}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <a
                      href={participant.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-xs truncate text-sm text-slate-700 hover:text-slate-900"
                    >
                      {participant.joinUrl}
                    </a>
                    <CopyJoinLinkButton joinUrl={participant.joinUrl} />
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {formatDateFromIso(presence?.joinedAt ?? participant.joinedAt)}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {formatDateFromIso(
                    presence?.lastSeenAt ?? participant.lastSeenAt,
                  )}
                </td>
                <td className="px-6 py-4">
                  <OnlineStatus isOnline={presence?.isOnline ?? false} />
                </td>
                <td className="px-6 py-4 text-right">
                  <form action={removeParticipant}>
                    <input
                      type="hidden"
                      name="participantId"
                      value={participant.id}
                    />
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <button
                      type="submit"
                      className="text-sm font-medium text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  </form>
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
    />
  );
}
