"use client";

import type { FormEvent } from "react";

import {
  approveUserAction,
  rejectUserAction,
  blockUserAction,
  unblockUserAction,
  makeAdminAction,
  removeAdminAction,
} from "@/app/actions/admin-users";

type AdminUserRowActionsProps = {
  userId: string;
  canApprove: boolean;
  canReject: boolean;
  canBlock: boolean;
  canUnblock: boolean;
  canMakeAdmin: boolean;
  canRemoveAdmin: boolean;
  labels: {
    approve: string;
    reject: string;
    block: string;
    unblock: string;
    makeAdmin: string;
    removeAdmin: string;
    approvalComment: string;
    confirmAction: string;
    confirmUndoWarning: string;
  };
};

type ManagedAction =
  | "approve"
  | "reject"
  | "block"
  | "unblock"
  | "makeAdmin"
  | "removeAdmin";

function shouldConfirm(action: ManagedAction): boolean {
  return action === "reject" || action === "block" || action === "makeAdmin" || action === "removeAdmin";
}

function wantsComment(action: ManagedAction): boolean {
  return action === "approve" || action === "reject" || action === "block" || action === "unblock";
}

function handleSubmitFactory(
  action: ManagedAction,
  labels: AdminUserRowActionsProps["labels"],
) {
  return (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;

    if (shouldConfirm(action)) {
      const ok = window.confirm(`${labels.confirmAction}\n\n${labels.confirmUndoWarning}`);
      if (!ok) {
        event.preventDefault();
        return;
      }
    }

    if (wantsComment(action)) {
      const value = window.prompt(labels.approvalComment, "") ?? "";
      const commentInput = form.elements.namedItem("comment");
      if (commentInput instanceof HTMLInputElement) {
        commentInput.value = value.trim();
      }
    }
  };
}

function ActionForm({
  action,
  userId,
  enabled,
  label,
  variant = "default",
  labels,
}: {
  action: ManagedAction;
  userId: string;
  enabled: boolean;
  label: string;
  variant?: "default" | "danger";
  labels: AdminUserRowActionsProps["labels"];
}) {
  const serverAction =
    action === "approve"
      ? approveUserAction
      : action === "reject"
        ? rejectUserAction
        : action === "block"
          ? blockUserAction
          : action === "unblock"
            ? unblockUserAction
            : action === "makeAdmin"
              ? makeAdminAction
              : removeAdminAction;

  return (
    <form action={serverAction} onSubmit={handleSubmitFactory(action, labels)}>
      <input type="hidden" name="userId" value={userId} />
      {wantsComment(action) ? <input type="hidden" name="comment" value="" /> : null}
      <button
        type="submit"
        disabled={!enabled}
        className={
          variant === "danger"
            ? "rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
            : "rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {label}
      </button>
    </form>
  );
}

export function AdminUserRowActions(props: AdminUserRowActionsProps) {
  const { userId, labels } = props;

  return (
    <div className="flex flex-wrap gap-1.5">
      <ActionForm
        action="approve"
        userId={userId}
        enabled={props.canApprove}
        label={labels.approve}
        labels={labels}
      />
      <ActionForm
        action="reject"
        userId={userId}
        enabled={props.canReject}
        label={labels.reject}
        variant="danger"
        labels={labels}
      />
      <ActionForm
        action="block"
        userId={userId}
        enabled={props.canBlock}
        label={labels.block}
        variant="danger"
        labels={labels}
      />
      <ActionForm
        action="unblock"
        userId={userId}
        enabled={props.canUnblock}
        label={labels.unblock}
        labels={labels}
      />
      <ActionForm
        action="makeAdmin"
        userId={userId}
        enabled={props.canMakeAdmin}
        label={labels.makeAdmin}
        labels={labels}
      />
      <ActionForm
        action="removeAdmin"
        userId={userId}
        enabled={props.canRemoveAdmin}
        label={labels.removeAdmin}
        variant="danger"
        labels={labels}
      />
    </div>
  );
}
