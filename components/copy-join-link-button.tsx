"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type CopyJoinLinkButtonProps = {
  joinUrl: string;
};

export function CopyJoinLinkButton({ joinUrl }: CopyJoinLinkButtonProps) {
  const { t } = useI18n();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      window.prompt(t("common.copyJoinLinkPrompt"), joinUrl);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-sm font-medium text-blue-400 hover:text-blue-300"
    >
      {t("common.copyLink")}
    </button>
  );
}
