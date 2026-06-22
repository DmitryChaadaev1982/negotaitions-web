"use client";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DifficultyBadge, Badge, StatusBadge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { DeleteCaseButton } from "@/components/delete-case-button";
import { PageHeader } from "@/components/page-header";
import {
  GradientButtonLink,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

type CaseRole = {
  id: string;
  name: string;
  privateInstructions: string;
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
    defaultDurationMinutes: number;
    createdAt: string;
    isDeleted: boolean;
    roles: CaseRole[];
  };
};

export function CaseDetailView({ negotiationCase }: CaseDetailViewProps) {
  const { t, locale } = useI18n();

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
        description={t("cases.caseDetailsDescription")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!negotiationCase.isDeleted ? (
              <>
                <GradientButtonLink
                  href={`/sessions/new?caseId=${negotiationCase.id}`}
                >
                  {t("cases.createSession")}
                </GradientButtonLink>
                <SecondaryButtonLink href={`/cases/${negotiationCase.id}/edit`}>
                  {t("common.edit")}
                </SecondaryButtonLink>
                <DeleteCaseButton caseId={negotiationCase.id} variant="button" />
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

      <div className="flex flex-wrap items-center gap-2">
        <DifficultyBadge difficulty={negotiationCase.difficulty} />
        <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
        <Badge>
          {t("common.rolesCount", { count: negotiationCase.roles.length })}
        </Badge>
        <Badge>
          {t("common.defaultDuration", {
            minutes: negotiationCase.defaultDurationMinutes,
          })}
        </Badge>
        <span className="text-sm text-slate-400">
          {t("common.created")} {formatDate(negotiationCase.createdAt)}
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
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t("cases.privateInstructions")}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {role.privateInstructions}
                </p>
              </GlassCardContent>
            </GlassCard>
          ))}
        </div>
      </section>
    </div>
  );
}
