"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { createCase, type CreateCaseState } from "@/app/actions/cases";

const initialState: CreateCaseState = {};

type RoleField = {
  name: string;
  privateInstructions: string;
};

const emptyRole = (): RoleField => ({
  name: "",
  privateInstructions: "",
});

export function NewCaseForm() {
  const [state, formAction, isPending] = useActionState(
    createCase,
    initialState,
  );
  const [roles, setRoles] = useState<RoleField[]>([emptyRole(), emptyRole()]);

  const addRole = () => {
    if (roles.length < 4) {
      setRoles([...roles, emptyRole()]);
    }
  };

  const removeRole = (index: number) => {
    if (roles.length > 2) {
      setRoles(roles.filter((_, roleIndex) => roleIndex !== index));
    }
  };

  const updateRole = (
    index: number,
    field: keyof RoleField,
    value: string,
  ) => {
    setRoles(
      roles.map((role, roleIndex) =>
        roleIndex === index ? { ...role, [field]: value } : role,
      ),
    );
  };

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="roleCount" value={roles.length} />

      {state.errors?.form ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.errors.form.join(", ")}
        </div>
      ) : null}

      <CardSection title="Case details">
        <div className="space-y-4">
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
              placeholder="e.g. Vendor contract renewal negotiation"
            />
          </Field>

          <Field
            label="Business context"
            name="businessContext"
            error={state.errors?.businessContext?.[0]}
            required
          >
            <textarea
              id="businessContext"
              name="businessContext"
              required
              rows={4}
              className={inputClassName(!!state.errors?.businessContext)}
              placeholder="Describe the business situation participants will negotiate."
            />
          </Field>

          <Field
            label="Public instructions"
            name="publicInstructions"
            error={state.errors?.publicInstructions?.[0]}
            required
          >
            <textarea
              id="publicInstructions"
              name="publicInstructions"
              required
              rows={4}
              className={inputClassName(!!state.errors?.publicInstructions)}
              placeholder="Instructions visible to all participants before the session."
            />
          </Field>
        </div>
      </CardSection>

      <CardSection
        title="Roles"
        description="Add 2–4 roles. Each role needs a name and private briefing instructions."
      >
        {state.errors?.roles ? (
          <p className="mb-4 text-sm text-rose-600">
            {state.errors.roles.join(", ")}
          </p>
        ) : null}

        <div className="space-y-6">
          {roles.map((role, index) => (
            <div
              key={index}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-900">
                  Role {index + 1}
                </h3>
                {roles.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => removeRole(index)}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="space-y-4">
                <Field
                  label="Role name"
                  name={`roles.${index}.name`}
                  error={state.errors?.[`roles.${index}.name`]?.[0]}
                  required
                >
                  <input
                    id={`roles.${index}.name`}
                    name={`roles.${index}.name`}
                    type="text"
                    required
                    value={role.name}
                    onChange={(event) =>
                      updateRole(index, "name", event.target.value)
                    }
                    className={inputClassName(
                      !!state.errors?.[`roles.${index}.name`],
                    )}
                    placeholder="e.g. Client CFO"
                  />
                </Field>

                <Field
                  label="Private instructions"
                  name={`roles.${index}.privateInstructions`}
                  error={
                    state.errors?.[`roles.${index}.privateInstructions`]?.[0]
                  }
                  required
                >
                  <textarea
                    id={`roles.${index}.privateInstructions`}
                    name={`roles.${index}.privateInstructions`}
                    required
                    rows={4}
                    value={role.privateInstructions}
                    onChange={(event) =>
                      updateRole(
                        index,
                        "privateInstructions",
                        event.target.value,
                      )
                    }
                    className={inputClassName(
                      !!state.errors?.[`roles.${index}.privateInstructions`],
                    )}
                    placeholder="Confidential briefing visible only to this role."
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>

        {roles.length < 4 ? (
          <button
            type="button"
            onClick={addRole}
            className="mt-4 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            + Add role
          </button>
        ) : null}
      </CardSection>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creating..." : "Create case"}
        </button>
        <Link
          href="/cases"
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function CardSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
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
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-slate-700">
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
