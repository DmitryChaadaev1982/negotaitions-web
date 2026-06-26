"use client";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DifficultyBadge, Badge, StatusBadge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { DeleteCaseButton } from "@/components/delete-case-button";
import { PageHeader } from "@/components/page-header";
import { VisibilityBadge } from "@/components/visibility-badge";
import {
  GradientButtonLink,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

type CaseRole = {
  id: string;
  name: string;
  privateInstructions: string | null;
};

type CaseDetailViewProps = {
  negotiationCase: {
    id: string;
    title: string;
    businessContext: string;
    publicInstructions: string;
    targetSkills: string | null;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    caseLanguage: "RU" | "EN";
    visibility: "PUBLIC" | "PRIVATE";
    createdByLabel: string | null;
    defaultDurationMinutes: number;
    defaultPreparationDurationMinutes: number;
    createdAt: string;
    isDeleted: boolean;
    mode: "full" | "safe-preview";
    isOwner: boolean;
    isAdminViewer: boolean;
    showAdminWarning: boolean;
    roles: CaseRole[];
  };
};

export function CaseDetailView({ negotiationCase }: CaseDetailViewProps) {
  const { t, locale } = useI18n();
  const canManageCase = negotiationCase.isAdminViewer || negotiationCase.isOwner;

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <div className="space-y-8">
      <PageHeader
        title={negotiationCase.title}
        description={
          negotiationCase.mode === "safe-preview"
            ? t("cases.safePreview")
            : t("cases.fullCaseView")
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!negotiationCase.isDeleted ? (
              <>
                <GradientButtonLink
                  href={`/sessions/new?caseId=${negotiationCase.id}`}
                >
                  {t("cases.createSession")}
                </GradientButtonLink>
                {canManageCase ? (
                  <>
                    <SecondaryButtonLink href={`/cases/${negotiationCase.id}/edit`}>
                      {t("common.edit")}
                    </SecondaryButtonLink>
                    <DeleteCaseButton caseId={negotiationCase.id} variant="button" />
                  </>
                ) : null}
              </>
            ) : null}
            <SecondaryButtonLink href="/cases">
              {t("cases.backToCases")}
            </SecondaryButtonLink>
          </div>
        }
      />

      {negotiationCase.isDeleted ? (
        <div className="space-y-3">
          <StatusBadge variant="danger">{t("cases.deletedBadge")}</StatusBadge>
          <p className="text-sm text-slate-400">{t("cases.deletedCaseReadOnly")}</p>
        </div>
      ) : null}

      {negotiationCase.showAdminWarning ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t("legal.privateRoleDataWarning")}
        </div>
      ) : null}

      {negotiationCase.mode === "safe-preview" ? (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
          {t("cases.publicPreviewNoRoleInstructions")}
        </div>
      ) : null}

      {!canManageCase ? (
        <p className="text-xs text-slate-400">
          {t("cases.ownerOrAdminEditDeleteOnly")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <DifficultyBadge difficulty={negotiationCase.difficulty} />
        <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
        <VisibilityBadge visibility={negotiationCase.visibility} />
        <Badge>
          {negotiationCase.mode === "safe-preview"
            ? t("cases.safePreview")
            : t("cases.fullCaseView")}
        </Badge>
        <Badge>
          {t("common.rolesCount", { count: negotiationCase.roles.length })}
        </Badge>
        <Badge>
          {t("common.preparationDurationValue", {
            minutes: negotiationCase.defaultPreparationDurationMinutes,
          })}
        </Badge>
        <Badge>
          {t("common.negotiationDurationValue", {
            minutes: negotiationCase.defaultDurationMinutes,
          })}
        </Badge>
        <span className="text-sm text-slate-400">
          {t("common.created")} {formatDate(negotiationCase.createdAt)}
        </span>
        <span className="text-sm text-slate-400">
          {t("cases.createdBy")}:{" "}
          {negotiationCase.isOwner
            ? t("cases.myCase")
            : negotiationCase.createdByLabel ?? t("cases.legacyCase")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("cases.businessContext")}
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {negotiationCase.businessContext}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("cases.publicInstructions")}
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {negotiationCase.publicInstructions}
            </p>
          </CardContent>
        </Card>
      </div>

      {negotiationCase.targetSkills ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("cases.targetSkills")}
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {negotiationCase.targetSkills}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-50">{t("cases.roles")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {negotiationCase.roles.map((role, index) => (
            <GlassCard key={role.id} elevated className="border-violet-500/10">
              <GlassCardHeader>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-sm font-semibold text-violet-300 ring-1 ring-violet-500/25">
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-50">{role.name}</h3>
                </div>
              </GlassCardHeader>
              <GlassCardContent>
                {negotiationCase.mode === "full" ? (
                  <>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                      {t("cases.privateInstructions")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                      {role.privateInstructions}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    {t("cases.safePreview")}
                  </p>
                )}
              </GlassCardContent>
            </GlassCard>
          ))}
        </div>
      </section>
    </div>
  );
}
