"use client";

import { useState, useTransition } from "react";

import { deleteCase } from "@/app/actions/cases";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/useI18n";

type DeleteCaseButtonProps = {
  caseId: string;
  variant?: "link" | "button";
  className?: string;
};

export function DeleteCaseButton({
  caseId,
  variant = "link",
  className,
}: DeleteCaseButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteCase(caseId);
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
        title={t("cases.deleteConfirmTitle")}
        description={t("cases.deleteConfirmBody")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("cases.deleteConfirmButton")}
        onCancel={() => setOpen(false)}
        onConfirm={handleConfirm}
        confirming={isPending}
      />
    </>
  );
}
