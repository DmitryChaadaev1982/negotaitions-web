"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { SecondaryButton } from "@/components/ui/buttons";

type Preview = {
  locale: "ru" | "en";
  subject: string;
  textBody: string;
  htmlBody: string;
  templateVersion: string;
};

type EmailFoundationState = {
  adminTestEnabled: boolean;
  deliveryEnabled: boolean;
  provider: string;
  recipient: string;
  previews: Preview[];
};

export function AdminEmailFoundationPanel() {
  const [state, setState] = useState<EmailFoundationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyLocale, setBusyLocale] = useState<"ru" | "en" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/email-foundation");
        const payload = (await response.json()) as EmailFoundationState | { error?: string };
        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Unable to load email diagnostics.");
        }
        if (!cancelled) {
          setState(payload as EmailFoundationState);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load email diagnostics.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enqueue(locale: "ru" | "en") {
    setBusyLocale(locale);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/email-foundation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        messageId?: string;
        status?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to enqueue test email.");
      }
      setMessage(`Queued ${locale.toUpperCase()} message ${payload.messageId} (${payload.status}).`);
    } catch (enqueueError) {
      setError(
        enqueueError instanceof Error
          ? enqueueError.message
          : "Unable to enqueue test email.",
      );
    } finally {
      setBusyLocale(null);
    }
  }

  return (
    <Card id="admin-email-foundation">
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          Email foundation self-test
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Stage 3.13B preview and durable outbox enqueue for the current active admin only.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}
        {!state ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              <div>Recipient: current admin login email only</div>
              <div>Provider: {state.provider}</div>
              <div>Delivery enabled: {state.deliveryEnabled ? "true" : "false"}</div>
              <div>Admin test enabled: {state.adminTestEnabled ? "true" : "false"}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {state.previews.map((preview) => (
                <div
                  key={preview.locale}
                  className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-100">
                      {preview.locale.toUpperCase()} preview
                    </h3>
                    <span className="text-xs text-slate-500">
                      v{preview.templateVersion}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-200">{preview.subject}</p>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950/80 p-3 text-xs text-slate-300">
                    {preview.textBody}
                  </pre>
                  <SecondaryButton
                    disabled={!state.adminTestEnabled || busyLocale !== null}
                    onClick={() => void enqueue(preview.locale)}
                  >
                    {busyLocale === preview.locale ? "Queueing..." : `Enqueue ${preview.locale.toUpperCase()} test`}
                  </SecondaryButton>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
