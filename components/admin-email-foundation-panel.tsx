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

const LOCAL_PREVIEW_TYPES = [
  "PASSWORD_RESET",
  "ACCOUNT_RECOVERY_DENIED",
  "PASSWORD_CHANGED",
  "ADMIN_PENDING_APPROVAL",
] as const;

type LocalPreviewType = (typeof LOCAL_PREVIEW_TYPES)[number];
type LocalPreviewItem = {
  id: string;
  type: LocalPreviewType;
  status: string;
  recipient: string;
  createdAt: string;
};
type RevealedPreview = {
  subject: string | null;
  text: string | null;
  html: string | null;
};

function LocalEmailPreviewPanel() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [type, setType] = useState<LocalPreviewType | "">("");
  const [items, setItems] = useState<LocalPreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    id: string;
    content: RevealedPreview;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      setRevealed(null);
      const params = new URLSearchParams({ limit: "20" });
      if (type) params.set("type", type);
      try {
        const response = await fetch(`/api/admin/email-preview?${params}`);
        if (response.status === 404) {
          if (!cancelled) setAvailable(false);
          return;
        }
        const payload = (await response.json()) as {
          items?: LocalPreviewItem[];
          error?: string;
        };
        if (!response.ok || !payload.items) {
          throw new Error(payload.error ?? "Unable to load local email previews.");
        }
        if (!cancelled) {
          setAvailable(true);
          setItems(payload.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setAvailable(true);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load local email previews.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type]);

  async function reveal(id: string) {
    setRevealingId(id);
    setError(null);
    setRevealed(null);
    try {
      const response = await fetch("/api/admin/email-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as RevealedPreview & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reveal local email preview.");
      }
      setRevealed({ id, content: payload });
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : "Unable to reveal local email preview.",
      );
    } finally {
      setRevealingId(null);
    }
  }

  if (available !== true) return null;

  return (
    <section
      className="space-y-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-950/10 p-4"
      data-testid="local-email-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fuchsia-100">
            LOCAL TEST ONLY — fake email preview
          </h3>
          <p className="text-xs text-slate-400">
            Recent allowlisted messages from this local database. Content requires an explicit reveal.
          </p>
        </div>
        <label className="text-xs text-slate-300">
          Type
          <select
            className="ml-2 rounded border border-slate-600 bg-slate-950 px-2 py-1"
            value={type}
            onChange={(event) =>
              setType(event.target.value as LocalPreviewType | "")
            }
            data-testid="local-email-preview-type"
          >
            <option value="">All allowed types</option>
            {LOCAL_PREVIEW_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No matching fake messages.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                <span>{item.type}</span>
                <span>{item.recipient}</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <span>{item.status}</span>
                <SecondaryButton
                  disabled={revealingId !== null}
                  onClick={() => void reveal(item.id)}
                  data-testid={`local-email-preview-reveal-${item.id}`}
                >
                  {revealingId === item.id ? "Revealing..." : "Reveal"}
                </SecondaryButton>
              </div>
              {revealed?.id === item.id ? (
                <div className="mt-3 space-y-2" data-testid="local-email-preview-body">
                  <p className="text-sm font-medium text-slate-100">
                    {revealed.content.subject ?? "(subject unavailable)"}
                  </p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                    {revealed.content.text ?? "(text unavailable)"}
                  </pre>
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-400">
                      Escaped HTML source
                    </summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                      {revealed.content.html ?? "(HTML unavailable)"}
                    </pre>
                  </details>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
        <LocalEmailPreviewPanel />
      </CardContent>
    </Card>
  );
}
