"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/useI18n";

export function ServiceWarningBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/service-warnings")
      .then((response) => response.json())
      .then((payload: { hasRecentServiceErrors?: boolean }) => {
        setVisible(Boolean(payload.hasRecentServiceErrors));
      })
      .catch(() => setVisible(false));
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      {t("dashboard.recentErrorsBanner")}{" "}
      <Link href="/admin" className="font-medium text-cyan-300 hover:text-cyan-200">
        {t("dashboard.openAdminDiagnostics")}
      </Link>
    </div>
  );
}
