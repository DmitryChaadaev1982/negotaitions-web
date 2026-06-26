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

type Labels = {
  approve: string;
  reject: string;
  block: string;
  unblock: string;
  makeAdmin: string;
  removeAdmin: string;
  approvalComment: string;
  confirmAction: string;
  confirmUndoWarning: string;
  administrator: string;
};

type CompactAdminUserRowActionsProps = {
  userId: string;
  userStatus: string;
  isCurrentAdmin: boolean;
  isBootstrapAdmin: boolean;
  isSelf: boolean;
  canReject: boolean;
  canBlock: boolean;
  wouldLeaveNoAdmin: boolean;
  labels: Labels;
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

function getServerAction(action: ManagedAction) {
  switch (action) {
    case "approve": return approveUserAction;
    case "reject": return rejectUserAction;
    case "block": return blockUserAction;
    case "unblock": return unblockUserAction;
    case "makeAdmin": return makeAdminAction;
    case "removeAdmin": return removeAdminAction;
  }
}

function handleSubmitFactory(action: ManagedAction, labels: Labels) {
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

function ActionButton({
  action,
  userId,
  label,
  variant = "default",
  labels,
  testId,
}: {
  action: ManagedAction;
  userId: string;
  label: string;
  variant?: "default" | "danger" | "success";
  labels: Labels;
  testId?: string;
}) {
  return (
    <form action={getServerAction(action)} onSubmit={handleSubmitFactory(action, labels)}>
      <input type="hidden" name="userId" value={userId} />
      {wantsComment(action) && <input type="hidden" name="comment" value="" />}
      <button
        type="submit"
        data-testid={testId}
        className={
          variant === "danger"
            ? "rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200"
            : variant === "success"
              ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-emerald-200"
              : "rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700/70 hover:text-slate-100"
        }
      >
        {label}
      </button>
    </form>
  );
}

/**
 * Context-aware admin action group:
 *
 * Status actions:
 *   PENDING_APPROVAL → Approve + Reject (grouped)
 *   ACTIVE           → Block (no Reject as primary action)
 *   REJECTED         → Approve
 *   BLOCKED          → Unblock
 *
 * Admin role:
 *   Compact toggle checkbox — checked if admin, disabled for self/bootstrap/would-leave-no-admin.
 */
export function CompactAdminUserRowActions({
  userId,
  userStatus,
  isCurrentAdmin,
  isBootstrapAdmin,
  isSelf,
  canReject,
  canBlock,
  wouldLeaveNoAdmin,
  labels,
}: CompactAdminUserRowActionsProps) {
  const adminToggleDisabled = isSelf || isBootstrapAdmin || wouldLeaveNoAdmin;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Status action group — context-aware */}
      {userStatus === "PENDING_APPROVAL" && (
        <div className="flex items-center gap-1 rounded-lg border border-slate-700/40 bg-slate-800/30 p-1">
          <ActionButton
            action="approve"
            userId={userId}
            label={labels.approve}
            variant="success"
            labels={labels}
            testId="action-approve"
          />
          {canReject && (
            <ActionButton
              action="reject"
              userId={userId}
              label={labels.reject}
              variant="danger"
              labels={labels}
              testId="action-reject"
            />
          )}
        </div>
      )}

      {userStatus === "ACTIVE" && canBlock && (
        <ActionButton
          action="block"
          userId={userId}
          label={labels.block}
          variant="danger"
          labels={labels}
          testId="action-block"
        />
      )}

      {userStatus === "REJECTED" && (
        <ActionButton
          action="approve"
          userId={userId}
          label={labels.approve}
          variant="success"
          labels={labels}
          testId="action-approve-rejected"
        />
      )}

      {userStatus === "BLOCKED" && (
        <ActionButton
          action="unblock"
          userId={userId}
          label={labels.unblock}
          labels={labels}
          testId="action-unblock"
        />
      )}

      {/* Admin role toggle */}
      <form
        action={isCurrentAdmin ? removeAdminAction : makeAdminAction}
        onSubmit={handleSubmitFactory(isCurrentAdmin ? "removeAdmin" : "makeAdmin", labels)}
        className="flex items-center"
      >
        <input type="hidden" name="userId" value={userId} />
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
            adminToggleDisabled
              ? "cursor-not-allowed border-slate-700/30 opacity-40"
              : isCurrentAdmin
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                : "border-slate-700 bg-slate-800/70 text-slate-400 hover:border-slate-600 hover:text-slate-200"
          }`}
          title={
            adminToggleDisabled
              ? isSelf
                ? "Cannot change own role"
                : isBootstrapAdmin
                  ? "Bootstrap admin — managed via env"
                  : "Last admin — cannot remove"
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={isCurrentAdmin}
            readOnly
            disabled={adminToggleDisabled}
            data-testid={`admin-toggle-${userId}`}
            className="sr-only"
          />
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
              isCurrentAdmin
                ? "border-cyan-400 bg-cyan-500/30"
                : "border-slate-600 bg-transparent"
            }`}
          >
            {isCurrentAdmin && (
              <svg className="h-2 w-2 text-cyan-300" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4l2.5 2.5 4-5" />
              </svg>
            )}
          </span>
          <span>{labels.administrator}</span>
          {!adminToggleDisabled && (
            <button
              type="submit"
              aria-label={isCurrentAdmin ? labels.removeAdmin : labels.makeAdmin}
              className="sr-only"
            />
          )}
        </label>
      </form>
    </div>
  );
}

// ─── Legacy export kept for backwards compatibility ───────────────────────────
// (Old AdminUserRowActions props shape; redirect to CompactAdminUserRowActions)

type AdminUserRowActionsProps = {
  userId: string;
  canApprove: boolean;
  canReject: boolean;
  canBlock: boolean;
  canUnblock: boolean;
  canMakeAdmin: boolean;
  canRemoveAdmin: boolean;
  labels: Labels;
};

export function AdminUserRowActions(props: AdminUserRowActionsProps) {
  const { userId, labels } = props;

  return (
    <div className="flex flex-wrap gap-1.5">
      {props.canApprove && (
        <ActionButton action="approve" userId={userId} label={labels.approve} variant="success" labels={labels} />
      )}
      {props.canReject && (
        <ActionButton action="reject" userId={userId} label={labels.reject} variant="danger" labels={labels} />
      )}
      {props.canBlock && (
        <ActionButton action="block" userId={userId} label={labels.block} variant="danger" labels={labels} />
      )}
      {props.canUnblock && (
        <ActionButton action="unblock" userId={userId} label={labels.unblock} labels={labels} />
      )}
      {props.canMakeAdmin && (
        <ActionButton action="makeAdmin" userId={userId} label={labels.makeAdmin} labels={labels} />
      )}
      {props.canRemoveAdmin && (
        <ActionButton action="removeAdmin" userId={userId} label={labels.removeAdmin} variant="danger" labels={labels} />
      )}
    </div>
  );
}
