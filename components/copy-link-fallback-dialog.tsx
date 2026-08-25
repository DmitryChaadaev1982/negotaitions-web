"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";

type CopyLinkFallbackDialogProps = {
  open: boolean;
  title: string;
  description: string;
  url: string;
  closeLabel: string;
  onClose: () => void;
};

export function CopyLinkFallbackDialog({
  open,
  title,
  description,
  url,
  closeLabel,
  onClose,
}: CopyLinkFallbackDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      cancelLabel={closeLabel}
      confirmLabel={closeLabel}
      hideCancel
      confirmTone="neutral"
      testId="copy-link-fallback-dialog"
      onCancel={onClose}
      onConfirm={onClose}
    >
      <input
        type="text"
        readOnly
        value={url}
        data-testid="copy-link-fallback-url"
        className="mt-4 w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        onFocus={(event) => event.currentTarget.select()}
      />
    </ConfirmDialog>
  );
}
