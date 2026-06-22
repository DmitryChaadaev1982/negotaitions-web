"use client";

import { useEffect, useId } from "react";

import { DangerButton, SecondaryButton } from "@/components/ui/buttons";
import { cn } from "@/lib/cn";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  className?: string;
};

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirming = false,
  className,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
        aria-label={cancelLabel}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          "relative w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30",
          className,
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-50">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-400">
          {description}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <SecondaryButton type="button" onClick={onCancel}>
            {cancelLabel}
          </SecondaryButton>
          <DangerButton
            type="button"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </DangerButton>
        </div>
      </div>
    </div>
  );
}
