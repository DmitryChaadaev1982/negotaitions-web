"use client";

import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { GradientButtonLink, SecondaryButton } from "@/components/ui/buttons";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableElement,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/badge";
import { getEventLobbyUrl, getEventPublicJoinUrl } from "@/lib/config";
import { useI18n } from "@/lib/i18n/useI18n";
import { cancelTrainingEvent } from "@/app/actions/events";

type EventRow = {
  id: string;
  title: string;
  status: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED";
  scheduledAt: string | null;
  participantCount: number;
  sessionCount: number;
  hostToken: string;
  hostParticipantToken: string | null;
  publicJoinCode: string;
};

type EventsListViewProps = {
  events: EventRow[];
};

export function EventsListView({ events }: EventsListViewProps) {
  const { t, locale } = useI18n();
  const [copyId, setCopyId] = useState<string | null>(null);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  };

  const copyLink = async (event: EventRow) => {
    await navigator.clipboard.writeText(getEventPublicJoinUrl(event.publicJoinCode));
    setCopyId(event.id);
    window.setTimeout(() => setCopyId(null), 2000);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("events.title")}
        description={t("events.description")}
        action={
          <GradientButtonLink href="/events/new">
            {t("events.createEvent")}
          </GradientButtonLink>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          message={t("events.noEvents")}
          action={
            <GradientButtonLink href="/events/new">
              {t("events.createEvent")}
            </GradientButtonLink>
          }
        />
      ) : (
        <DataTable>
          <DataTableElement>
            <DataTableHead>
              <DataTableHeaderCell>{t("common.title")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.status")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("events.scheduledAt")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("events.participantsInLobby")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("events.sessions")}</DataTableHeaderCell>
              <DataTableHeaderCell align="right">{t("common.actions")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {events.map((event) => (
                <DataTableRow key={event.id}>
                  <DataTableCell>
                    <span className="font-medium text-slate-50">{event.title}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <Badge variant="info">
                      {t(`events.status.${event.status}`)}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell>{formatDate(event.scheduledAt)}</DataTableCell>
                  <DataTableCell>{event.participantCount}</DataTableCell>
                  <DataTableCell>{event.sessionCount}</DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={getEventLobbyUrl(event.id, {
                          hostToken: event.hostToken,
                          participantToken: event.hostParticipantToken ?? undefined,
                        })}
                        className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        {t("events.openLobby")}
                      </Link>
                      <SecondaryButton
                        type="button"
                        className="px-2 py-1 text-xs"
                        onClick={() => void copyLink(event)}
                      >
                        {copyId === event.id
                          ? t("events.linkCopied")
                          : t("events.copyEventJoinLink")}
                      </SecondaryButton>
                      {event.status !== "CANCELLED" && event.status !== "COMPLETED" ? (
                        <form action={cancelTrainingEvent}>
                          <input type="hidden" name="eventId" value={event.id} />
                          <SecondaryButton type="submit" className="px-2 py-1 text-xs">
                            {t("common.cancel")}
                          </SecondaryButton>
                        </form>
                      ) : null}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableElement>
        </DataTable>
      )}
    </div>
  );
}
