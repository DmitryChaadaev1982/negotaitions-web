"use client";

import { useEffect, useMemo, useState } from "react";

import { inputClassName } from "@/components/ui/form-styles";
import { normalizeInviteEmail } from "@/lib/invite-email";
import { useI18n } from "@/lib/i18n/useI18n";

type UserSuggestion = {
  id: string;
  name: string | null;
  email: string;
};

type InviteChip =
  | { kind: "user"; user: UserSuggestion }
  | { kind: "email"; email: string };

type PeoplePickerProps = {
  excludeUserIds?: string[];
  userFieldName: string;
  emailFieldName: string;
};

function userLabel(user: UserSuggestion): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

export function PeoplePicker({
  excludeUserIds = [],
  userFieldName,
  emailFieldName,
}: PeoplePickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<InviteChip[]>([]);
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedUserIds = useMemo(
    () => new Set(chips.filter((chip) => chip.kind === "user").map((chip) => chip.user.id)),
    [chips],
  );
  const selectedEmails = useMemo(
    () =>
      new Set(
        chips
          .map((chip) => (chip.kind === "user" ? chip.user.email : chip.email))
          .map((email) => email.toLowerCase()),
      ),
    [chips],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: trimmed });
        const response = await fetch(`/api/users/search?${params.toString()}`);
        if (!response.ok) {
          if (!cancelled) {
            setSuggestions([]);
          }
          return;
        }
        const data = (await response.json()) as { users?: UserSuggestion[] };
        if (cancelled) {
          return;
        }
        const filtered = (data.users ?? []).filter(
          (user) =>
            !excludeUserIds.includes(user.id) &&
            !selectedUserIds.has(user.id) &&
            !selectedEmails.has(user.email.toLowerCase()),
        );
        setSuggestions(filtered);
        setActiveIndex(0);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [excludeUserIds, query, selectedEmails, selectedUserIds]);

  const addSuggestion = (user: UserSuggestion) => {
    if (selectedUserIds.has(user.id) || selectedEmails.has(user.email.toLowerCase())) {
      return;
    }
    setChips((prev) => [...prev, { kind: "user", user }]);
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
  };

  const tryAddEmail = (value: string): boolean => {
    const normalizedEmail = normalizeInviteEmail(value);
    if (!normalizedEmail) {
      return false;
    }
    if (selectedEmails.has(normalizedEmail)) {
      setQuery("");
      return true;
    }
    setChips((prev) => [...prev, { kind: "email", email: normalizedEmail }]);
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
    return true;
  };

  const removeChip = (index: number) => {
    setChips((prev) => prev.filter((_, chipIndex) => chipIndex !== index));
  };

  return (
    <div className="space-y-2">
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-700/70 bg-slate-950/50 p-2">
          {chips.map((chip, index) => {
            const label = chip.kind === "user" ? userLabel(chip.user) : chip.email;
            return (
              <span
                key={`${chip.kind}-${label}`}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100"
              >
                <span className="truncate">{label}</span>
                {chip.kind === "email" ? (
                  <span className="text-[10px] uppercase tracking-wide text-cyan-300/80">
                    {t("visibility.externalEmail")}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="text-cyan-100/90 transition hover:text-rose-300"
                  aria-label={t("visibility.removeInvitee")}
                  onClick={() => removeChip(index)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (value.trim().length < 2) {
              setSuggestions([]);
              setLoading(false);
              setActiveIndex(0);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((idx) => Math.min(idx + 1, suggestions.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((idx) => Math.max(idx - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const activeSuggestion = suggestions[activeIndex];
              if (activeSuggestion) {
                addSuggestion(activeSuggestion);
                return;
              }
              tryAddEmail(query);
              return;
            }
            if (event.key === "Backspace" && !query.trim() && chips.length > 0) {
              removeChip(chips.length - 1);
            }
          }}
          placeholder={t("visibility.searchByNameOrEmail")}
          className={inputClassName(false)}
        />

        <p className="text-xs text-slate-400">
          {t("visibility.addPersonOrEmail")} · {t("visibility.invitedUsersHint")}
        </p>
      </div>

      {query.trim().length > 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-950/60">
          {query.trim().length < 2 ? (
            <p className="px-3 py-2 text-xs text-slate-400">
              {t("visibility.typeAtLeastTwoChars")}
            </p>
          ) : loading ? (
            <p className="px-3 py-2 text-xs text-slate-400">{t("common.loading")}</p>
          ) : suggestions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">{t("visibility.noUsersFound")}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto py-1">
              {suggestions.map((user, index) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => addSuggestion(user)}
                    className={`flex w-full items-start justify-between gap-4 px-3 py-2 text-left transition ${
                      index === activeIndex
                        ? "bg-cyan-500/10 text-cyan-100"
                        : "text-slate-200 hover:bg-slate-800/80"
                    }`}
                  >
                    <span className="truncate text-sm">{user.name ?? t("common.notApplicable")}</span>
                    <span className="truncate text-xs text-slate-400">{user.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {chips.map((chip) =>
        chip.kind === "user" ? (
          <input key={`user-${chip.user.id}`} type="hidden" name={userFieldName} value={chip.user.id} />
        ) : (
          <input key={`email-${chip.email}`} type="hidden" name={emailFieldName} value={chip.email} />
        ),
      )}
    </div>
  );
}
