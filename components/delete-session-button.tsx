"use client";

import { useState, useTransition } from "react";

import { deleteSession } from "@/app/actions/sessions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/useI18n";

type DeleteSessionButtonProps = {
  sessionId: string;
  variant?: "link" | "button";
  className?: string;
};

export function DeleteSessionButton({
  sessionId,
  variant = "link",
  className,
}: DeleteSessionButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteSession(sessionId);
    });
  };

  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            className ??
            "text-sm font-medium text-rose-400 hover:text-rose-300"
          }
        >
          {t("common.delete")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            className ??
            "inline-flex items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition-all duration-200 hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200"
          }
        >
          {t("common.delete")}
        </button>
      )}

      <ConfirmDialog
        open={open}
        title={t("sessions.deleteConfirmTitle")}
        description={t("sessions.deleteConfirmBody")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("sessions.deleteConfirmButton")}
        onCancel={() => setOpen(false)}
        onConfirm={handleConfirm}
        confirming={isPending}
      />
    </>
  );
}
