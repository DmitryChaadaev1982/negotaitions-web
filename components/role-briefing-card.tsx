"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type RoleBriefing = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

type RoleBriefingCardProps = {
  title: string;
  subtitle?: string;
  warning?: string;
  role: RoleBriefing;
};

export function RoleBriefingCard({
  title,
  subtitle,
  warning,
  role,
}: RoleBriefingCardProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-violet-500/30 glass-panel-elevated p-5 shadow-[0_0_30px_rgba(139,92,246,0.08)]">
      <h3 className="text-sm font-semibold text-slate-50">{title}</h3>
      {subtitle ? (
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      ) : null}
      {warning ? (
        <p className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {warning}
        </p>
      ) : null}
      <div className="mt-4 space-y-4">
        <RoleSection
          title={t("cases.privateInstructions")}
          content={role.privateInstructions}
        />
        {role.objectives ? (
          <RoleSection title={t("cases.objectives")} content={role.objectives} />
        ) : null}
        {role.constraints ? (
          <RoleSection title={t("cases.constraints")} content={role.constraints} />
        ) : null}
        {role.hiddenInfo ? (
          <RoleSection title={t("cases.hiddenInfo")} content={role.hiddenInfo} />
        ) : null}
        {role.fallbackPosition ? (
          <RoleSection
            title={t("cases.fallbackPosition")}
            content={role.fallbackPosition}
          />
        ) : null}
      </div>
    </div>
  );
}

function RoleSection({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-slate-300">{title}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">
        {content}
      </p>
    </div>
  );
}

export type { RoleBriefing };
