"use client";

import { useState } from "react";

import { SecondaryButton } from "@/components/ui/buttons";

type RevealPayload =
  | {
      available: true;
      subject: string | null;
      text: string | null;
      html: string | null;
      redacted: boolean;
    }
  | {
      available: false;
      reason: "cleared" | "missing";
    };

type Props = {
  messageId: string;
  revealLabel: string;
  revealedLabel: string;
  unavailableLabel: string;
  clearedLabel: string;
  redactedNotice: string;
};

export function EmailJournalRevealPanel({
  messageId,
  revealLabel,
  revealedLabel,
  unavailableLabel,
  clearedLabel,
  redactedNotice,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RevealPayload | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/email-journal/${messageId}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as RevealPayload | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Unable to reveal email content.",
        );
      }
      setPayload(body as RevealPayload);
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : "Unable to reveal email content.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" data-testid="email-journal-reveal">
      <SecondaryButton disabled={busy} onClick={() => void reveal()}>
        {busy ? "..." : revealLabel}
      </SecondaryButton>
      {error ? (
        <p className="text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
      {payload && !payload.available ? (
        <p className="text-sm text-slate-400">
          {payload.reason === "cleared" ? clearedLabel : unavailableLabel}
        </p>
      ) : null}
      {payload && payload.available ? (
        <div className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-950/50 p-4">
          <h3 className="text-sm font-semibold text-slate-100">{revealedLabel}</h3>
          {payload.redacted ? (
            <p className="text-xs text-amber-200">{redactedNotice}</p>
          ) : null}
          <p className="text-sm font-medium text-slate-200">
            {payload.subject ?? "(subject unavailable)"}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
            {payload.text ?? "(text unavailable)"}
          </pre>
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300"
            data-testid="email-journal-reveal-html"
          >
            {payload.html ?? "(html unavailable)"}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
