"use client";

import { useState, useTransition } from "react";

import {
  approveUserAction,
  rejectUserAction,
  blockUserAction,
  unblockUserAction,
  makeAdminAction,
  removeAdminAction,
} from "@/app/actions/admin-users";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  buildAdminActionFormData,
  shouldConfirmAdminAction,
  wantsAdminActionComment,
  type ManagedAdminAction,
} from "@/lib/admin-user-action-dialog";

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

function getAdminActionServerAction(action: ManagedAdminAction) {
  switch (action) {
    case "approve": return approveUserAction;
    case "reject": return rejectUserAction;
    case "block": return blockUserAction;
    case "unblock": return unblockUserAction;
    case "makeAdmin": return makeAdminAction;
    case "removeAdmin": return removeAdminAction;
  }
}

function actionLabel(action: ManagedAdminAction, labels: Labels): string {
  switch (action) {
    case "approve": return labels.approve;
    case "reject": return labels.reject;
    case "block": return labels.block;
    case "unblock": return labels.unblock;
    case "makeAdmin": return labels.makeAdmin;
    case "removeAdmin": return labels.removeAdmin;
  }
}

function ActionButton({
  action,
  label,
  variant = "default",
  disabled,
  onRequest,
  testId,
}: {
  action: ManagedAdminAction;
  label: string;
  variant?: "default" | "danger" | "success";
  disabled?: boolean;
  onRequest: (action: ManagedAdminAction) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={() => onRequest(action)}
      className={
        variant === "danger"
          ? "rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
          : variant === "success"
            ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            : "rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {label}
    </button>
  );
}

function AdminUserActionDialog({
  userId,
  action,
  labels,
  comment,
  confirming,
  onCommentChange,
  onCancel,
  onConfirm,
}: {
  userId: string;
  action: ManagedAdminAction | null;
  labels: Labels;
  comment: string;
  confirming: boolean;
  onCommentChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const showComment = action ? wantsAdminActionComment(action) : false;
  const destructive = action ? shouldConfirmAdminAction(action) : false;

  return (
    <ConfirmDialog
      open={action !== null}
      title={action ? actionLabel(action, labels) : labels.confirmAction}
      description={destructive ? labels.confirmUndoWarning : labels.confirmAction}
      cancelLabel={t("common.cancel")}
      confirmLabel={action ? actionLabel(action, labels) : labels.confirmAction}
      confirming={confirming}
      confirmTone={destructive ? "danger" : "primary"}
      testId="admin-user-action-dialog"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {showComment ? (
        <label className="mt-4 block">
          <span className="text-xs font-medium text-slate-300">{labels.approvalComment}</span>
          <textarea
            data-testid="admin-user-action-comment"
            value={comment}
            disabled={confirming}
            onChange={(event) => onCommentChange(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            name={`admin-comment-${userId}`}
          />
        </label>
      ) : null}
    </ConfirmDialog>
  );
}

function useAdminUserActionDialog(userId: string) {
  const [pendingAction, setPendingAction] = useState<ManagedAdminAction | null>(null);
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();

  const requestAction = (action: ManagedAdminAction) => {
    if (isPending) {
      return;
    }
    setComment("");
    setPendingAction(action);
  };

  const cancelAction = () => {
    if (isPending) {
      return;
    }
    setPendingAction(null);
    setComment("");
  };

  const confirmAction = () => {
    if (!pendingAction || isPending) {
      return;
    }
    const action = pendingAction;
    const formData = buildAdminActionFormData(userId, comment);
    startTransition(async () => {
      await getAdminActionServerAction(action)(formData);
      setPendingAction(null);
      setComment("");
    });
  };

  return {
    pendingAction,
    comment,
    isPending,
    requestAction,
    cancelAction,
    confirmAction,
    setComment,
  };
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
  const dialog = useAdminUserActionDialog(userId);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {userStatus === "PENDING_APPROVAL" && (
        <div className="flex items-center gap-1 rounded-lg border border-slate-700/40 bg-slate-800/30 p-1">
          <ActionButton
            action="approve"
            label={labels.approve}
            variant="success"
            disabled={dialog.isPending}
            onRequest={dialog.requestAction}
            testId="action-approve"
          />
          {canReject && (
            <ActionButton
              action="reject"
              label={labels.reject}
              variant="danger"
              disabled={dialog.isPending}
              onRequest={dialog.requestAction}
              testId="action-reject"
            />
          )}
        </div>
      )}

      {userStatus === "ACTIVE" && canBlock && (
        <ActionButton
          action="block"
          label={labels.block}
          variant="danger"
          disabled={dialog.isPending}
          onRequest={dialog.requestAction}
          testId="action-block"
        />
      )}

      {userStatus === "REJECTED" && (
        <ActionButton
          action="approve"
          label={labels.approve}
          variant="success"
          disabled={dialog.isPending}
          onRequest={dialog.requestAction}
          testId="action-approve-rejected"
        />
      )}

      {userStatus === "BLOCKED" && (
        <ActionButton
          action="unblock"
          label={labels.unblock}
          disabled={dialog.isPending}
          onRequest={dialog.requestAction}
          testId="action-unblock"
        />
      )}

      <div className="flex items-center">
        <button
          type="button"
          disabled={adminToggleDisabled || dialog.isPending}
          onClick={() =>
            dialog.requestAction(isCurrentAdmin ? "removeAdmin" : "makeAdmin")
          }
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
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
          aria-label={isCurrentAdmin ? labels.removeAdmin : labels.makeAdmin}
        >
          <input
            type="checkbox"
            checked={isCurrentAdmin}
            readOnly
            disabled={adminToggleDisabled}
            data-testid={`admin-toggle-${userId}`}
            className="sr-only"
            tabIndex={-1}
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
        </button>
      </div>

      <AdminUserActionDialog
        userId={userId}
        action={dialog.pendingAction}
        labels={labels}
        comment={dialog.comment}
        confirming={dialog.isPending}
        onCommentChange={dialog.setComment}
        onCancel={dialog.cancelAction}
        onConfirm={dialog.confirmAction}
      />
    </div>
  );
}

// ─── Legacy export kept for backwards compatibility ───────────────────────────

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
  const dialog = useAdminUserActionDialog(userId);

  return (
    <div className="flex flex-wrap gap-1.5">
      {props.canApprove && (
        <ActionButton action="approve" label={labels.approve} variant="success" disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      {props.canReject && (
        <ActionButton action="reject" label={labels.reject} variant="danger" disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      {props.canBlock && (
        <ActionButton action="block" label={labels.block} variant="danger" disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      {props.canUnblock && (
        <ActionButton action="unblock" label={labels.unblock} disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      {props.canMakeAdmin && (
        <ActionButton action="makeAdmin" label={labels.makeAdmin} disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      {props.canRemoveAdmin && (
        <ActionButton action="removeAdmin" label={labels.removeAdmin} variant="danger" disabled={dialog.isPending} onRequest={dialog.requestAction} />
      )}
      <AdminUserActionDialog
        userId={userId}
        action={dialog.pendingAction}
        labels={labels}
        comment={dialog.comment}
        confirming={dialog.isPending}
        onCommentChange={dialog.setComment}
        onCancel={dialog.cancelAction}
        onConfirm={dialog.confirmAction}
      />
    </div>
  );
}
