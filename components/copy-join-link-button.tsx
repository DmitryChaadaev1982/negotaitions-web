"use client";

import { useState } from "react";

import { CopyLinkFallbackDialog } from "@/components/copy-link-fallback-dialog";
import { useI18n } from "@/lib/i18n/useI18n";

type CopyJoinLinkButtonProps = {
  joinUrl: string;
};

export function CopyJoinLinkButton({ joinUrl }: CopyJoinLinkButtonProps) {
  const { t } = useI18n();
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      setFallbackUrl(joinUrl);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="text-sm font-medium text-blue-400 hover:text-blue-300"
      >
        {t("common.copyLink")}
      </button>
      <CopyLinkFallbackDialog
        open={fallbackUrl !== null}
        title={t("common.copyJoinLinkPrompt")}
        description={t("common.copyLinkFallbackBody")}
        url={fallbackUrl ?? joinUrl}
        closeLabel={t("common.close")}
        onClose={() => setFallbackUrl(null)}
      />
    </>
  );
}
