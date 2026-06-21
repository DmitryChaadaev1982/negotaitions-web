"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import {
  createSession,
  type CreateSessionState,
} from "@/app/actions/sessions";
import { DEFAULT_NEGOTIATION_DURATION_SECONDS, secondsToDisplayMinutes } from "@/lib/negotiation-duration";

const initialState: CreateSessionState = {};

type CaseOption = {
  id: string;
  title: string;
  defaultDurationSeconds: number;
};

type NewSessionFormProps = {
  cases: CaseOption[];
  defaultCaseId?: string;
};

export function NewSessionForm({ cases, defaultCaseId }: NewSessionFormProps) {
  const [state, formAction, isPending] = useActionState(
    createSession,
    initialState,
  );
  const initialCaseId = defaultCaseId ?? cases[0]?.id ?? "";
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);

  const selectedCase = useMemo(
    () => cases.find((negotiationCase) => negotiationCase.id === selectedCaseId),
    [cases, selectedCaseId],
  );

  const [durationMinutes, setDurationMinutes] = useState(
    selectedCase
      ? secondsToDisplayMinutes(selectedCase.defaultDurationSeconds)
      : secondsToDisplayMinutes(DEFAULT_NEGOTIATION_DURATION_SECONDS),
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.errors?.form ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.errors.form.join(", ")}
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Session details
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a session from an existing case. You can add participants
            after the session is created.
          </p>
        </div>
        <div className="space-y-4 px-6 py-4">
          <Field
            label="Title"
            name="title"
            error={state.errors?.title?.[0]}
            required
          >
            <input
              id="title"
              name="title"
              type="text"
              required
              className={inputClassName(!!state.errors?.title)}
              placeholder="e.g. Team A practice session — March 2026"
            />
          </Field>

          <Field
            label="Case"
            name="caseId"
            error={state.errors?.caseId?.[0]}
            required
          >
            <select
              id="caseId"
              name="caseId"
              required
              value={selectedCaseId}
              onChange={(event) => {
                const caseId = event.target.value;
                setSelectedCaseId(caseId);
                const negotiationCase = cases.find(
                  (negotiationCaseOption) => negotiationCaseOption.id === caseId,
                );
                if (negotiationCase) {
                  setDurationMinutes(
                    secondsToDisplayMinutes(
                      negotiationCase.defaultDurationSeconds,
                    ),
                  );
                }
              }}
              className={inputClassName(!!state.errors?.caseId)}
            >
              <option value="" disabled>
                Select a case
              </option>
              {cases.map((negotiationCase) => (
                <option key={negotiationCase.id} value={negotiationCase.id}>
                  {negotiationCase.title}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Negotiation duration (minutes)"
            name="negotiationDurationMinutes"
            error={state.errors?.negotiationDurationMinutes?.[0]}
            required
          >
            <input
              id="negotiationDurationMinutes"
              name="negotiationDurationMinutes"
              type="number"
              min={1}
              max={180}
              required
              value={durationMinutes}
              onChange={(event) =>
                setDurationMinutes(Number(event.target.value))
              }
              className={inputClassName(
                !!state.errors?.negotiationDurationMinutes,
              )}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Default from the selected case is{" "}
              {selectedCase
                ? secondsToDisplayMinutes(selectedCase.defaultDurationSeconds)
                : secondsToDisplayMinutes(DEFAULT_NEGOTIATION_DURATION_SECONDS)}{" "}
              minutes. You can adjust it for this session.
            </p>
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || cases.length === 0}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creating..." : "Create session"}
        </button>
        <Link
          href="/sessions"
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-slate-700"
      >
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return `block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
    hasError
      ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
      : "border-slate-300 focus:border-slate-500 focus:ring-slate-500/20"
  }`;
}
