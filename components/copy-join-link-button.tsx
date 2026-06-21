"use client";

type CopyJoinLinkButtonProps = {
  joinUrl: string;
};

export function CopyJoinLinkButton({ joinUrl }: CopyJoinLinkButtonProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      // Fallback for older browsers.
      window.prompt("Copy join link:", joinUrl);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-sm font-medium text-slate-700 hover:text-slate-900"
    >
      Copy link
    </button>
  );
}
