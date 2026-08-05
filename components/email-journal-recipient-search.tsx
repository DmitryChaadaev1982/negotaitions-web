"use client";

import { useState, useTransition } from "react";

import type { EmailJournalListItem } from "@/lib/email/admin-journal";

type SearchResult = {
  items: EmailJournalListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function EmailJournalRecipientSearch(props: {
  labels: {
    search: string;
    submit: string;
    empty: string;
    error: string;
  };
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/email-journal/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Same-origin fetch includes Origin; browser sets it automatically.
          },
          body: JSON.stringify({
            recipientEmail,
            page: 1,
            pageSize: 20,
          }),
          credentials: "same-origin",
        });
        const payload = (await response.json()) as SearchResult & { error?: string };
        if (!response.ok) {
          setResult(null);
          setError(payload.error ?? props.labels.error);
          return;
        }
        setResult(payload);
      } catch {
        setResult(null);
        setError(props.labels.error);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1 text-sm text-slate-300">
          <span className="mb-1 block">{props.labels.search}</span>
          <input
            type="email"
            autoComplete="off"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            maxLength={320}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            data-testid="email-journal-recipient-search"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !recipientEmail.trim()}
          className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
        >
          {props.labels.submit}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        result.items.length === 0 ? (
          <p className="text-sm text-slate-400">{props.labels.empty}</p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-200" data-testid="email-journal-recipient-results">
            {result.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`/admin/email/${item.id}`}
                  className="text-cyan-300 hover:underline"
                >
                  {item.createdAt} · {item.messageType} · {item.recipientMasked} ·{" "}
                  {item.status}
                </a>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
