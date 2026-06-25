"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { SecondaryButton, SecondaryButtonLink } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import type { TranslationKey } from "@/lib/i18n/translate";
import {
  buildSessionMaterialsProcessingSnapshot,
  getTranscriptDisplayText,
  type ProcessingAiAnalysisStatus,
  type ProcessingRecordingStatus,
  type ProcessingTranscriptionStatus,
  type SessionMaterialsProcessingSnapshot,
  type SessionMaterialsRecordingSnapshot,
  type SessionMaterialsTranscriptSnapshot,
} from "@/lib/session-materials-processing";
import {
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

// ── Types ──────────────────────────────────────────────────────────────────

type MaterialsStatusRecording = {
  id: string;
  status: string;
  fileKey: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
  downloadUrl: string | null;
  streamUrl: string | null;
  canRefreshStatus: boolean;
  processingStage: string;
} | null;

type MaterialsStatusTranscription = {
  id: string | null;
  status: string | null;
  text: string | null;
  language: string | null;
  model: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  canStart: boolean;
  canRetry: boolean;
  canRerun?: boolean;
  processingStage: string;
  diarizationStatus?: string | null;
  retranscribeCount?: number | null;
};

type MaterialsStatusAiAnalysis = {
  id: string | null;
  status: string;
  model: string | null;
  executiveSummary: string | null;
  overallScore: number | null;
  analysisFromOlderTranscript?: boolean;
  analysisJson: NegotiationAnalysisOutput | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  processingStage: string;
  canStart: boolean;
  canRetry: boolean;
  canView: boolean;
  canShare: boolean;
  participantPlaceholder: boolean;
  visibility: string | null;
  isSharedWithSession: boolean;
  sharedAt: string | null;
  sharedBy: string | null;
  notSharedMessage: string | null;
};

type MaterialsStatusResponse = {
  recording: MaterialsStatusRecording;
  transcription: MaterialsStatusTranscription;
  aiAnalysis: MaterialsStatusAiAnalysis;
  processing: {
    shouldPoll: boolean;
    nextPollMs: number | null;
    currentStage: string;
    message: string | null;
    autoTranscribeEnabled: boolean;
  };
};

// ── Props ──────────────────────────────────────────────────────────────────

type SessionMaterialsDashboardProps = {
  sessionId?: string;
  joinToken?: string;
  recording: SessionMaterialsRecordingSnapshot;
  transcript: SessionMaterialsTranscriptSnapshot;
  processing?: SessionMaterialsProcessingSnapshot;
};

// ── Translation maps ───────────────────────────────────────────────────────

const recordingStatusKeys: Record<ProcessingRecordingStatus, TranslationKey> = {
  not_available: "sessionMaterials.recordingNotAvailable",
  in_progress: "sessionMaterials.recordingInProgress",
  finalizing: "sessionMaterials.recordingFinalizing",
  processing: "sessionMaterials.recordingProcessing",
  ready: "sessionMaterials.recordingReady",
  failed: "sessionMaterials.recordingFailed",
};

const transcriptionStatusKeys: Record<
  ProcessingTranscriptionStatus,
  TranslationKey
> = {
  waiting_for_recording: "sessionMaterials.waitingForRecording",
  not_started: "sessionMaterials.transcriptNotAvailableYet",
  queued: "sessionMaterials.transcriptionQueued",
  downloading: "sessionMaterials.transcriptionDownloading",
  compressing: "sessionMaterials.transcriptionCompressing",
  transcribing: "sessionMaterials.transcriptionInProgress",
  ready: "sessionMaterials.transcriptReady",
  failed: "sessionMaterials.transcriptionFailed",
};

const aiAnalysisStatusKeys: Record<ProcessingAiAnalysisStatus, TranslationKey> = {
  waiting_for_transcript: "sessionMaterials.waitingForTranscript",
  not_started: "sessionMaterials.transcriptReadyForAnalysis",
  queued: "sessionMaterials.aiAnalysisQueued",
  analyzing: "sessionMaterials.aiAnalysisAnalyzing",
  ready: "sessionMaterials.aiAnalysisReady",
  failed: "sessionMaterials.aiAnalysisFailed",
};

const recordingStatusTone: Record<ProcessingRecordingStatus, string> = {
  not_available: "border-slate-700/50 bg-slate-900/40 text-slate-400",
  in_progress: "border-amber-500/30 bg-amber-950/20 text-amber-200",
  finalizing: "border-amber-500/30 bg-amber-950/20 text-amber-200",
  processing: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  ready: "border-emerald-500/30 bg-emerald-950/20 text-emerald-200",
  failed: "border-rose-500/30 bg-rose-950/20 text-rose-200",
};

const transcriptionStatusTone: Record<ProcessingTranscriptionStatus, string> = {
  waiting_for_recording: "border-slate-700/50 bg-slate-900/40 text-slate-400",
  not_started: "border-slate-700/50 bg-slate-900/40 text-slate-400",
  queued: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  downloading: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  compressing: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  transcribing: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  ready: "border-emerald-500/30 bg-emerald-950/20 text-emerald-200",
  failed: "border-rose-500/30 bg-rose-950/20 text-rose-200",
};

const aiAnalysisStatusTone: Record<ProcessingAiAnalysisStatus, string> = {
  waiting_for_transcript: "border-slate-700/50 bg-slate-900/40 text-slate-400",
  not_started: "border-slate-700/50 bg-slate-900/40 text-slate-400",
  queued: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  analyzing: "border-cyan-500/30 bg-cyan-950/20 text-cyan-200",
  ready: "border-emerald-500/30 bg-emerald-950/20 text-emerald-200",
  failed: "border-rose-500/30 bg-rose-950/20 text-rose-200",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUpdatedAt(value: string | null, locale: string) {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function mapApiTranscriptionStage(stage: string): ProcessingTranscriptionStatus {
  const map: Record<string, ProcessingTranscriptionStatus> = {
    waiting_for_recording: "waiting_for_recording",
    not_started: "not_started",
    queued: "queued",
    downloading: "downloading",
    compressing: "compressing",
    transcribing: "transcribing",
    ready: "ready",
    failed: "failed",
  };
  return map[stage] ?? "not_started";
}

function mapApiRecordingStage(stage: string): ProcessingRecordingStatus {
  const map: Record<string, ProcessingRecordingStatus> = {
    not_available: "not_available",
    in_progress: "in_progress",
    finalizing: "finalizing",
    processing: "processing",
    ready: "ready",
    failed: "failed",
  };
  return map[stage] ?? "not_available";
}

function mapApiAiAnalysisStage(stage: string): ProcessingAiAnalysisStatus {
  const map: Record<string, ProcessingAiAnalysisStatus> = {
    waiting_for_transcript: "waiting_for_transcript",
    not_started: "not_started",
    queued: "queued",
    analyzing: "analyzing",
    ready: "ready",
    failed: "failed",
  };
  return map[stage] ?? "waiting_for_transcript";
}

function scoreBar(score: number) {
  const color =
    score >= 75
      ? "bg-emerald-500"
      : score >= 50
        ? "bg-cyan-500"
        : score >= 30
          ? "bg-amber-500"
          : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-slate-700">
        <div
          className={`h-2 rounded-full ${color} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-slate-300">
        {score}
      </span>
    </div>
  );
}

function buildReportMarkdown(
  analysis: NegotiationAnalysisOutput,
  t: (key: TranslationKey) => string,
): string {
  const lines: string[] = [];
  lines.push(`# ${t("sessionMaterials.aiReport")}\n`);
  lines.push(`## ${t("sessionMaterials.executiveSummary")}\n`);
  lines.push(`${analysis.executiveSummary}\n`);
  lines.push(`**${t("sessionMaterials.overallScore")}**: ${analysis.overallScore}/100\n`);
  lines.push(`**${t("sessionMaterials.confidenceLevel")}**: ${analysis.confidenceLevel}\n`);

  lines.push(`## ${t("sessionMaterials.scoreBreakdown")}\n`);
  for (const [key, val] of Object.entries(analysis.scores)) {
    lines.push(`- **${key}**: ${val}/100`);
  }
  lines.push("");

  if (analysis.strengths.length > 0) {
    lines.push(`## ${t("sessionMaterials.strengths")}\n`);
    for (const s of analysis.strengths) {
      lines.push(`### ${s.title}`);
      lines.push(`${s.evidence}`);
      lines.push(`*${s.recommendation}*\n`);
    }
  }

  if (analysis.improvementAreas.length > 0) {
    lines.push(`## ${t("sessionMaterials.improvementAreas")}\n`);
    for (const a of analysis.improvementAreas) {
      lines.push(`### ${a.title}`);
      lines.push(`${a.evidence}`);
      lines.push(`*${a.recommendation}*\n`);
    }
  }

  lines.push(`## ${t("sessionMaterials.oneMinuteFeedback")}\n`);
  lines.push(`**${t("sessionMaterials.whatWorked")}**: ${analysis.oneMinuteFeedback.whatWorked}`);
  lines.push(`**${t("sessionMaterials.whatToImprove")}**: ${analysis.oneMinuteFeedback.whatToImprove}`);
  lines.push(`**${t("sessionMaterials.nextStep")}**: ${analysis.oneMinuteFeedback.nextStep}\n`);

  if (analysis.facilitatorDebriefQuestions.length > 0) {
    lines.push(`## ${t("sessionMaterials.facilitatorDebriefQuestions")}\n`);
    for (const q of analysis.facilitatorDebriefQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ProcessingStatusCard({
  title,
  statusLabel,
  toneClassName,
  updatedAt,
  errorMessage,
  testId,
}: {
  title: string;
  statusLabel: string;
  toneClassName: string;
  updatedAt: string | null;
  errorMessage?: string | null;
  testId: string;
}) {
  const { t, locale: cardLocale } = useI18n();
  const formattedDate = formatUpdatedAt(updatedAt, cardLocale);

  return (
    <div
      className={`min-w-0 rounded-lg border px-3 py-3 ${toneClassName}`}
      data-testid={testId}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-1 break-words text-sm leading-5">{statusLabel}</p>
      {formattedDate ? (
        <p className="mt-2 text-xs text-slate-500">
          {t("sessionMaterials.lastUpdated")}: {formattedDate}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-2 break-words text-xs text-rose-300">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      {scoreBar(score)}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: string }) {
  const color =
    level === "HIGH"
      ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/50"
      : level === "MEDIUM"
        ? "bg-amber-900/50 text-amber-300 border-amber-700/50"
        : "bg-rose-900/50 text-rose-300 border-rose-700/50";
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-200">{title}</h3>
      {children}
    </div>
  );
}

export function AiAnalysisReport({
  analysis,
  isFacilitator = false,
}: {
  analysis: NegotiationAnalysisOutput;
  isFacilitator?: boolean;
}) {
  const { t } = useI18n();
  const [reportCopied, setReportCopied] = useState(false);
  const [debriefCopied, setDebriefCopied] = useState(false);

  const handleCopyReport = useCallback(async () => {
    const md = buildReportMarkdown(analysis, t);
    try {
      await navigator.clipboard.writeText(md);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }, [analysis, t]);

  const handleCopyDebrief = useCallback(async () => {
    const text = analysis.facilitatorDebriefQuestions.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setDebriefCopied(true);
      setTimeout(() => setDebriefCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }, [analysis]);

  const scoreEntries: [string, TranslationKey][] = [
    ["preparation", "sessionMaterials.preparation"],
    ["structure", "sessionMaterials.structure"],
    ["questionQuality", "sessionMaterials.questionQuality"],
    ["activeListening", "sessionMaterials.activeListening"],
    ["argumentation", "sessionMaterials.argumentation"],
    ["objectionHandling", "sessionMaterials.objectionHandling"],
    ["emotionalControl", "sessionMaterials.emotionalControl"],
    ["valueCreation", "sessionMaterials.valueCreation"],
    ["closing", "sessionMaterials.closing"],
  ];

  return (
    <div className="space-y-4" data-testid="ai-report">
      {/* Copy actions */}
      <div className="flex flex-wrap gap-2">
        <SecondaryButton
          onClick={() => void handleCopyReport()}
          data-testid="copy-report-button"
        >
          {reportCopied ? t("sessionMaterials.reportCopied") : t("sessionMaterials.copyReport")}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => void handleCopyDebrief()}
          data-testid="copy-debrief-button"
        >
          {debriefCopied ? t("sessionMaterials.debriefCopied") : t("sessionMaterials.copyDebriefQuestions")}
        </SecondaryButton>
      </div>

      {/* 1. Executive summary */}
      <SectionCard title={t("sessionMaterials.executiveSummary")}>
        <p className="text-sm leading-6 text-slate-300" data-testid="executive-summary">
          {analysis.executiveSummary}
        </p>
      </SectionCard>

      {/* 2. Overall score + confidence */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SectionCard title={t("sessionMaterials.overallScore")}>
          <div className="flex items-center gap-3">
            <span
              className="text-4xl font-bold text-emerald-400"
              data-testid="overall-score"
            >
              {analysis.overallScore}
            </span>
            <span className="text-sm text-slate-400">/100</span>
          </div>
        </SectionCard>
        <SectionCard title={t("sessionMaterials.confidenceLevel")}>
          <div className="flex flex-col gap-2">
            <ConfidenceBadge level={analysis.confidenceLevel} />
            <div className="grid grid-cols-1 gap-1 text-xs text-slate-400">
              <span>
                {t("sessionMaterials.transcriptQuality")}:{" "}
                <ConfidenceBadge level={analysis.evidenceQuality.transcriptQuality} />
              </span>
              <span>
                {t("sessionMaterials.speakerAttributionQuality")}:{" "}
                <ConfidenceBadge level={analysis.evidenceQuality.speakerAttributionQuality} />
              </span>
              <span>
                {t("sessionMaterials.notesQuality")}:{" "}
                <ConfidenceBadge level={analysis.evidenceQuality.notesQuality} />
              </span>
            </div>
            {analysis.evidenceQuality.comment ? (
              <p className="text-xs text-slate-500">
                {analysis.evidenceQuality.comment}
              </p>
            ) : null}
          </div>
        </SectionCard>
      </div>

      {/* 3. Score breakdown */}
      <SectionCard title={t("sessionMaterials.scoreBreakdown")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {scoreEntries.map(([key, labelKey]) => (
            <ScoreBar
              key={key}
              label={t(labelKey)}
              score={analysis.scores[key as keyof typeof analysis.scores]}
            />
          ))}
        </div>
      </SectionCard>

      {/* 4. Role objectives analysis */}
      {analysis.roleObjectivesAnalysis.length > 0 && (
        <SectionCard title={t("sessionMaterials.roleObjectivesAnalysis")}>
          <div className="space-y-3">
            {analysis.roleObjectivesAnalysis.map((roa, i) => (
              <div key={i} className="rounded border border-slate-700/40 bg-slate-900/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-slate-200">
                      {roa.participantName}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {roa.roleName}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-cyan-400">
                    {roa.score}/100
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{roa.objectiveProgress}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("sessionMaterials.evidence")}: {roa.evidence}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 5. Strengths */}
      {analysis.strengths.length > 0 && (
        <SectionCard title={t("sessionMaterials.strengths")}>
          <div className="space-y-3">
            {analysis.strengths.map((s, i) => (
              <div key={i} className="rounded border border-emerald-700/30 bg-emerald-950/20 p-3">
                <p className="text-sm font-medium text-emerald-300">{s.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sessionMaterials.evidence")}: {s.evidence}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sessionMaterials.whyItMatters")}: {s.whyItMatters}
                </p>
                <p className="mt-1 text-xs text-emerald-400">
                  → {s.recommendation}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 6. Improvement areas */}
      {analysis.improvementAreas.length > 0 && (
        <SectionCard title={t("sessionMaterials.improvementAreas")}>
          <div className="space-y-3">
            {analysis.improvementAreas.map((a, i) => (
              <div key={i} className="rounded border border-amber-700/30 bg-amber-950/20 p-3">
                <p className="text-sm font-medium text-amber-300">{a.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sessionMaterials.evidence")}: {a.evidence}
                </p>
                <p className="mt-1 text-xs text-rose-400">
                  {t("sessionMaterials.risk")}: {a.risk}
                </p>
                <p className="mt-1 text-xs text-amber-400">
                  → {a.recommendation}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("sessionMaterials.practiceExercise")}: {a.practiceExercise}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 7. Detected tactics */}
      {analysis.detectedTactics.length > 0 && (
        <SectionCard title={t("sessionMaterials.detectedTactics")}>
          <div className="space-y-3">
            {analysis.detectedTactics.map((tactic, i) => (
              <div key={i} className="rounded border border-violet-700/30 bg-violet-950/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-violet-300">{tactic.name}</p>
                  <span className="text-xs text-slate-500">
                    {t("sessionMaterials.usedBy")}: {tactic.usedBy}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{tactic.evidence}</p>
                <p className="mt-1 text-xs text-violet-400">
                  {t("sessionMaterials.effectiveness")}: {tactic.effectiveness}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("sessionMaterials.counterMove")}: {tactic.counterMove}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 8. Questions analysis */}
      <SectionCard title={t("sessionMaterials.questionsAnalysis")}>
        <div className="space-y-3">
          {analysis.questionsAnalysis.goodQuestions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-emerald-400">
                {t("sessionMaterials.goodQuestions")}
              </p>
              <div className="space-y-2">
                {analysis.questionsAnalysis.goodQuestions.map((q, i) => (
                  <div key={i} className="rounded bg-slate-900/50 px-3 py-2">
                    <p className="text-xs text-slate-200">&ldquo;{q.question}&rdquo;</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {q.usedBy} — {q.whyGood}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analysis.questionsAnalysis.missedQuestions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-amber-400">
                {t("sessionMaterials.missedQuestions")}
              </p>
              <div className="space-y-2">
                {analysis.questionsAnalysis.missedQuestions.map((q, i) => (
                  <div key={i} className="rounded bg-slate-900/50 px-3 py-2">
                    <p className="text-xs text-slate-200">&ldquo;{q.suggestedQuestion}&rdquo;</p>
                    <p className="mt-0.5 text-xs text-slate-500">{q.whyItMattered}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analysis.questionsAnalysis.diagnosticQualityComment && (
            <p className="text-xs text-slate-400">
              {analysis.questionsAnalysis.diagnosticQualityComment}
            </p>
          )}
        </div>
      </SectionCard>

      {/* 9. Listening and reframing */}
      <SectionCard title={t("sessionMaterials.listeningAndReframing")}>
        <div className="space-y-2">
          {analysis.listeningAndReframing.goodExamples.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-emerald-400">
                {t("sessionMaterials.goodExamples")}
              </p>
              <ul className="space-y-1">
                {analysis.listeningAndReframing.goodExamples.map((ex, i) => (
                  <li key={i} className="text-xs text-slate-300">
                    • {ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.listeningAndReframing.missedOpportunities.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-amber-400">
                {t("sessionMaterials.missedOpportunities")}
              </p>
              <ul className="space-y-1">
                {analysis.listeningAndReframing.missedOpportunities.map(
                  (op, i) => (
                    <li key={i} className="text-xs text-slate-300">
                      • {op}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
          {analysis.listeningAndReframing.comment && (
            <p className="text-xs text-slate-400">
              {analysis.listeningAndReframing.comment}
            </p>
          )}
        </div>
      </SectionCard>

      {/* 10. Value creation analysis */}
      <SectionCard title={t("sessionMaterials.valueCreationAnalysis")}>
        <div className="space-y-2">
          {analysis.valueCreationAnalysis.createdOptions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-emerald-400">
                {t("sessionMaterials.createdOptions")}
              </p>
              <ul className="space-y-1">
                {analysis.valueCreationAnalysis.createdOptions.map((o, i) => (
                  <li key={i} className="text-xs text-slate-300">
                    • {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.valueCreationAnalysis.missedOptions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-amber-400">
                {t("sessionMaterials.missedOptions")}
              </p>
              <ul className="space-y-1">
                {analysis.valueCreationAnalysis.missedOptions.map((o, i) => (
                  <li key={i} className="text-xs text-slate-300">
                    • {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.valueCreationAnalysis.comment && (
            <p className="text-xs text-slate-400">
              {analysis.valueCreationAnalysis.comment}
            </p>
          )}
        </div>
      </SectionCard>

      {/* 11. Next training focus */}
      {analysis.nextTrainingFocus.length > 0 && (
        <SectionCard title={t("sessionMaterials.nextTrainingFocus")}>
          <div className="space-y-3">
            {analysis.nextTrainingFocus.map((f, i) => (
              <div key={i} className="rounded border border-cyan-700/30 bg-cyan-950/20 p-3">
                <p className="text-sm font-medium text-cyan-300">{f.focusArea}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sessionMaterials.why")}: {f.why}
                </p>
                <p className="mt-1 text-xs text-cyan-400">
                  {t("sessionMaterials.exercise")}: {f.exercise}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 12. Facilitator debrief questions */}
      {analysis.facilitatorDebriefQuestions.length > 0 && (
        <SectionCard title={t("sessionMaterials.facilitatorDebriefQuestions")}>
          <ol className="space-y-2">
            {analysis.facilitatorDebriefQuestions.map((q, i) => (
              <li key={i} className="text-sm text-slate-300">
                <span className="mr-2 font-mono text-xs text-slate-500">
                  {i + 1}.
                </span>
                {q}
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {/* 13. One-minute feedback */}
      <SectionCard title={t("sessionMaterials.oneMinuteFeedback")}>
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            {analysis.oneMinuteFeedback.summary}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded bg-emerald-950/30 p-2">
              <p className="text-xs font-medium text-emerald-400">
                ✓ {t("sessionMaterials.whatWorked")}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {analysis.oneMinuteFeedback.whatWorked}
              </p>
            </div>
            <div className="rounded bg-amber-950/30 p-2">
              <p className="text-xs font-medium text-amber-400">
                ↑ {t("sessionMaterials.whatToImprove")}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {analysis.oneMinuteFeedback.whatToImprove}
              </p>
            </div>
          </div>
          <div className="rounded bg-cyan-950/20 p-2">
            <p className="text-xs font-medium text-cyan-400">
              → {t("sessionMaterials.nextStep")}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {analysis.oneMinuteFeedback.nextStep}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* 14. Personal feedback per participant */}
      {analysis.participantPersonalFeedback &&
        analysis.participantPersonalFeedback.length > 0 && (
          <div
            className={
              isFacilitator
                ? "space-y-3"
                : "rounded-lg border border-violet-600/40 bg-violet-950/20 p-1"
            }
          >
            {!isFacilitator && (
              <div className="px-3 pt-3">
                <p className="text-sm font-semibold text-violet-300">
                  ★ {t("sessionMaterials.yourPersonalFeedback")}
                </p>
              </div>
            )}
            {isFacilitator && (
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {t("sessionMaterials.participantPersonalFeedback")}
              </p>
            )}
            {analysis.participantPersonalFeedback.map((pf, idx) => (
              <div
                key={idx}
                className={
                  isFacilitator
                    ? "rounded border border-violet-700/30 bg-violet-950/20 p-3"
                    : "p-3"
                }
              >
                {isFacilitator && (
                  <p className="mb-2 text-sm font-semibold text-violet-300">
                    {pf.participantName}
                  </p>
                )}

                {pf.achievements.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-emerald-400">
                      ✓ {t("sessionMaterials.achievements")}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {pf.achievements.map((item, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="mt-0.5 shrink-0 text-emerald-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pf.couldHaveDoneBetter.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-amber-400">
                      ↑ {t("sessionMaterials.couldHaveDoneBetter")}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {pf.couldHaveDoneBetter.map((item, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pf.keyMoments.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-cyan-400">
                      ◆ {t("sessionMaterials.keyMoments")}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {pf.keyMoments.map((item, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="mt-0.5 shrink-0 text-cyan-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pf.nextSteps.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-violet-400">
                      → {t("sessionMaterials.personalNextSteps")}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {pf.nextSteps.map((item, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="mt-0.5 shrink-0 text-violet-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3500;

export function SessionMaterialsDashboard({
  sessionId,
  joinToken,
  recording: initialRecording,
  transcript: initialTranscript,
  processing: initialProcessing,
}: SessionMaterialsDashboardProps) {
  const { t } = useI18n();

  const [liveData, setLiveData] = useState<MaterialsStatusResponse | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [aiAnalysisBusy, setAiAnalysisBusy] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [unsharingBusy, setUnsharingBusy] = useState(false);

  const isMountedRef = useRef(true);
  const autoTranscribeStartedRef = useRef(false);

  const canPoll = Boolean(sessionId && joinToken);

  const liveSnapshot = liveData
    ? buildLiveSnapshot(liveData)
    : initialProcessing ??
      buildSessionMaterialsProcessingSnapshot(initialRecording, initialTranscript);

  const liveRecordingStage: ProcessingRecordingStatus =
    liveData?.recording?.processingStage
      ? mapApiRecordingStage(liveData.recording.processingStage)
      : liveSnapshot.recording;

  const liveTranscriptionStage: ProcessingTranscriptionStatus =
    liveData?.transcription?.processingStage
      ? mapApiTranscriptionStage(liveData.transcription.processingStage)
      : liveSnapshot.transcription;

  const liveAiAnalysisStage: ProcessingAiAnalysisStatus =
    liveData?.aiAnalysis?.processingStage
      ? mapApiAiAnalysisStage(liveData.aiAnalysis.processingStage)
      : liveSnapshot.aiAnalysis;

  const shouldCurrentlyPoll = liveData
    ? liveData.processing.shouldPoll
    : shouldPollFromSnapshot(liveSnapshot);

  const isPolling = canPoll && shouldCurrentlyPoll;

  const autoTranscribeEnabled = liveData?.processing?.autoTranscribeEnabled ?? false;
  const canStartTranscription = liveData?.transcription?.canStart ?? false;
  const canRetryTranscription = liveData?.transcription?.canRetry ?? false;
  const canRerunTranscription = liveData?.transcription?.canRerun ?? false;
  const diarizationStatus = liveData?.transcription?.diarizationStatus ?? null;
  const analysisFromOlderTranscript = liveData?.aiAnalysis?.analysisFromOlderTranscript ?? false;

  const canStartAiAnalysis = liveData?.aiAnalysis?.canStart ?? false;
  const canRetryAiAnalysis = liveData?.aiAnalysis?.canRetry ?? false;
  const canViewAiAnalysis = liveData?.aiAnalysis?.canView ?? false;
  const canShareAiAnalysis = liveData?.aiAnalysis?.canShare ?? false;
  const participantPlaceholder = liveData?.aiAnalysis?.participantPlaceholder ?? false;
  const aiVisibility = liveData?.aiAnalysis?.visibility ?? null;
  const aiIsShared = liveData?.aiAnalysis?.isSharedWithSession ?? false;
  const aiNotSharedMessage = liveData?.aiAnalysis?.notSharedMessage ?? null;
  const isFacilitatorView = aiVisibility !== null; // facilitators get visibility field

  const downloadUrl = liveData?.recording?.downloadUrl ?? null;

  const transcriptText =
    liveData?.transcription?.text?.trim() ||
    getTranscriptDisplayText(initialTranscript) ||
    null;

  const recordingReady = liveRecordingStage === "ready";
  const recordingAvailable =
    liveRecordingStage !== "not_available" && liveRecordingStage !== "ready";
  const transcriptReady = liveTranscriptionStage === "ready";

  const analysisData = liveData?.aiAnalysis ?? null;
  const parsedAnalysis = canViewAiAnalysis
    ? NegotiationAnalysisOutputSchema.safeParse(analysisData?.analysisJson)
    : null;
  const analysisJson: NegotiationAnalysisOutput | null = parsedAnalysis?.success
    ? parsedAnalysis.data
    : null;
  const aiRenderValidationError =
    parsedAnalysis && !parsedAnalysis.success
      ? "AI analysis result is invalid. Please rerun analysis."
      : null;

  const fetchStatus = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/status?joinToken=${encodeURIComponent(joinToken)}`,
        { cache: "no-store" },
      );
      if (!isMountedRef.current) return;
      if (!res.ok) return;
      const data = (await res.json()) as MaterialsStatusResponse;
      if (isMountedRef.current) {
        setLiveData(data);
      }
    } catch {
      // Ignore transient polling errors silently
    }
  }, [sessionId, joinToken]);

  useEffect(() => {
    isMountedRef.current = true;
    autoTranscribeStartedRef.current = false;
    return () => {
      isMountedRef.current = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (canPoll) {
      queueMicrotask(() => {
        void fetchStatus();
      });
    }
  }, [canPoll, fetchStatus]);

  useEffect(() => {
    if (!canPoll || !shouldCurrentlyPoll) return;
    const intervalId = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [canPoll, shouldCurrentlyPoll, fetchStatus]);

  useEffect(() => {
    if (!canPoll) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [canPoll, fetchStatus]);

  const handleStartTranscription = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setTranscriptionBusy(true);
    setTranscriptionError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/materials/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      if (!isMountedRef.current) return;
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Transcription failed.");
      }
      await fetchStatus();
    } catch (err) {
      autoTranscribeStartedRef.current = false;
      if (isMountedRef.current) {
        setTranscriptionError(
          err instanceof Error ? err.message : "Transcription failed.",
        );
      }
    } finally {
      if (isMountedRef.current) {
        setTranscriptionBusy(false);
      }
    }
  }, [sessionId, joinToken, fetchStatus]);

  const handleRerunTranscription = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setRerunConfirmOpen(false);
    setRerunBusy(true);
    setRerunError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/materials/retranscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, reason: "manual_rerun" }),
      });
      if (!isMountedRef.current) return;
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Re-transcription failed.");
      }
      await fetchStatus();
    } catch (err) {
      if (isMountedRef.current) {
        setRerunError(err instanceof Error ? err.message : "Re-transcription failed.");
      }
    } finally {
      if (isMountedRef.current) {
        setRerunBusy(false);
      }
    }
  }, [sessionId, joinToken, fetchStatus]);

  useEffect(() => {
    if (!autoTranscribeEnabled) {
      return;
    }
    if (!canStartTranscription || transcriptionBusy) {
      return;
    }

    if (autoTranscribeStartedRef.current) {
      return;
    }

    autoTranscribeStartedRef.current = true;
    void handleStartTranscription();
  }, [autoTranscribeEnabled, canStartTranscription, handleStartTranscription, transcriptionBusy]);

  const handleRefreshRecording = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setRefreshBusy(true);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/recording/refresh-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinToken }),
        },
      );
      if (!isMountedRef.current) return;
      if (res.ok) {
        await fetchStatus();
      }
    } catch {
      // Ignore
    } finally {
      if (isMountedRef.current) {
        setRefreshBusy(false);
      }
    }
  }, [sessionId, joinToken, fetchStatus]);

  const handleRunAiAnalysis = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setAiAnalysisBusy(true);
    setAiAnalysisError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      if (!isMountedRef.current) return;
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "AI analysis failed.");
      }
      await fetchStatus();
    } catch (err) {
      if (isMountedRef.current) {
        setAiAnalysisError(
          err instanceof Error ? err.message : "AI analysis failed.",
        );
      }
    } finally {
      if (isMountedRef.current) {
        setAiAnalysisBusy(false);
      }
    }
  }, [sessionId, joinToken, fetchStatus]);

  const handleShareAiAnalysis = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setSharingBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      if (isMountedRef.current) await fetchStatus();
    } finally {
      if (isMountedRef.current) setSharingBusy(false);
    }
  }, [sessionId, joinToken, fetchStatus]);

  const handleUnshareAiAnalysis = useCallback(async () => {
    if (!sessionId || !joinToken) return;
    setUnsharingBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/unshare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      if (isMountedRef.current) await fetchStatus();
    } finally {
      if (isMountedRef.current) setUnsharingBusy(false);
    }
  }, [sessionId, joinToken, fetchStatus]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-50">
                {t("sessionMaterials.processingStatus")}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {t("sessionMaterials.processingMayTakeTime")}
              </p>
            </div>
            {isPolling && (
              <p className="text-xs text-slate-500" data-testid="polling-indicator">
                {t("sessionMaterials.updatingStatus")}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3"
            data-testid="processing-dashboard"
          >
            <ProcessingStatusCard
              testId="recording-status-card"
              title={t("sessionMaterials.recording")}
              statusLabel={t(recordingStatusKeys[liveRecordingStage])}
              toneClassName={recordingStatusTone[liveRecordingStage]}
              updatedAt={liveSnapshot.recordingUpdatedAt}
              errorMessage={liveSnapshot.recordingError}
            />
            <ProcessingStatusCard
              testId="transcription-status-card"
              title={t("sessionMaterials.transcription")}
              statusLabel={t(transcriptionStatusKeys[liveTranscriptionStage])}
              toneClassName={transcriptionStatusTone[liveTranscriptionStage]}
              updatedAt={liveSnapshot.transcriptionUpdatedAt}
            />
            <ProcessingStatusCard
              testId="ai-analysis-status-card"
              title={t("sessionMaterials.aiAnalysis")}
              statusLabel={t(aiAnalysisStatusKeys[liveAiAnalysisStage])}
              toneClassName={aiAnalysisStatusTone[liveAiAnalysisStage]}
              updatedAt={
                analysisData?.completedAt ?? analysisData?.startedAt ?? null
              }
              errorMessage={
                liveAiAnalysisStage === "failed"
                  ? (analysisData?.errorMessage ?? null)
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Recording card */}
      <Card data-testid="recording-section">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessionMaterials.recording")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {recordingReady && downloadUrl ? (
            <div className="flex flex-wrap gap-2">
              <SecondaryButtonLink
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-recording-link"
              >
                {t("sessionMaterials.openRecording")}
              </SecondaryButtonLink>
              <SecondaryButtonLink
                href={downloadUrl}
                download
                data-testid="download-recording-link"
              >
                {t("sessionMaterials.downloadRecording")}
              </SecondaryButtonLink>
            </div>
          ) : recordingReady ? (
            <p className="text-sm text-emerald-300" data-testid="recording-ready-message">
              {t("sessionMaterials.recordingReady")}
            </p>
          ) : recordingAvailable ? (
            <p className="text-sm text-slate-400" data-testid="recording-status-message">
              {t(recordingStatusKeys[liveRecordingStage])}
            </p>
          ) : (
            <p className="text-sm text-slate-400" data-testid="recording-not-available-message">
              {t("sessionMaterials.recordingNotAvailable")}
            </p>
          )}

          {liveData?.recording?.canRefreshStatus &&
          (liveRecordingStage === "processing" ||
            liveRecordingStage === "finalizing" ||
            liveRecordingStage === "failed") ? (
            <SecondaryButton
              disabled={refreshBusy || isPolling}
              onClick={() => void handleRefreshRecording()}
              data-testid="refresh-recording-button"
            >
              {refreshBusy ? t("common.loading") : t("sessionMaterials.refreshStatus")}
            </SecondaryButton>
          ) : null}

          {liveRecordingStage === "failed" && (
            <p className="text-xs text-slate-500">
              <Link href="/admin" className="text-cyan-400 hover:text-cyan-300">
                {t("recording.openDiagnostics")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Transcription card */}
      <Card data-testid="transcript-section">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("recording.transcript")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {transcriptReady && transcriptText ? (
            <p
              className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300"
              data-testid="transcript-text"
            >
              {transcriptText}
            </p>
          ) : (
            <p className="text-sm text-slate-400" data-testid="transcription-status-message">
              {t(transcriptionStatusKeys[liveTranscriptionStage])}
            </p>
          )}

          {transcriptionError ? (
            <p className="text-sm text-amber-400" data-testid="transcription-error">
              {transcriptionError}
            </p>
          ) : null}

          {canStartTranscription || canRetryTranscription ? (
            <div className="flex flex-wrap gap-2">
              {canStartTranscription ? (
                <SecondaryButton
                  disabled={transcriptionBusy}
                  onClick={() => void handleStartTranscription()}
                  data-testid="start-transcription-button"
                >
                  {transcriptionBusy
                    ? t("common.loading")
                    : t("sessionMaterials.startTranscription")}
                </SecondaryButton>
              ) : null}
              {canRetryTranscription ? (
                <SecondaryButton
                  disabled={transcriptionBusy}
                  onClick={() => void handleStartTranscription()}
                  data-testid="retry-transcription-button"
                >
                  {transcriptionBusy
                    ? t("common.loading")
                    : t("sessionMaterials.retryTranscription")}
                </SecondaryButton>
              ) : null}
              {canRerunTranscription ? (
                <SecondaryButton
                  disabled={rerunBusy || transcriptionBusy}
                  onClick={() => setRerunConfirmOpen(true)}
                  data-testid="rerun-transcription-button"
                >
                  {rerunBusy
                    ? t("common.loading")
                    : t("sessionMaterials.rerunTranscription")}
                </SecondaryButton>
              ) : null}
            </div>
          ) : null}

          {/* Re-run confirmation dialog */}
          {rerunConfirmOpen ? (
            <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
              <p className="text-sm text-amber-100">
                {t("sessionMaterials.rerunTranscriptionConfirmBody")}
              </p>
              <div className="flex gap-2">
                <SecondaryButton
                  disabled={rerunBusy}
                  onClick={() => void handleRerunTranscription()}
                  data-testid="confirm-rerun-transcription-button"
                >
                  {t("recording.rerunTranscriptionConfirm")}
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => setRerunConfirmOpen(false)}
                >
                  {t("recording.rerunTranscriptionCancel")}
                </SecondaryButton>
              </div>
            </div>
          ) : null}

          {rerunError ? (
            <p className="text-sm text-amber-400">{rerunError}</p>
          ) : null}

          {/* Diarization failure warning with re-run hint */}
          {(diarizationStatus === "FAILED" || diarizationStatus === "SINGLE_SPEAKER_ONLY" || diarizationStatus === "NO_SPEAKERS_DETECTED") && isFacilitatorView ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {diarizationStatus === "SINGLE_SPEAKER_ONLY"
                ? t("recording.singleSpeakerOnlyWarning")
                : t("recording.diarizationDidNotSeparate")}
            </div>
          ) : null}

          {liveTranscriptionStage === "failed" ? (
            <p className="text-xs text-slate-500">
              <Link href="/admin" className="text-cyan-400 hover:text-cyan-300">
                {t("recording.openDiagnostics")}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* AI Analysis card */}
      <Card data-testid="ai-analysis-section">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              {t("sessionMaterials.aiAnalysis")}
            </h2>
            {/* Report mode badge */}
            {canViewAiAnalysis && analysisJson ? (
              isFacilitatorView ? (
                <span
                  className="rounded border border-amber-500/40 bg-amber-900/20 px-2 py-0.5 text-xs text-amber-300"
                  data-testid="ai-report-facilitator-badge"
                >
                  {t("sessionMaterials.aiAnalysisFacilitatorBadge")}
                </span>
              ) : (
                <span
                  className="rounded border border-cyan-500/40 bg-cyan-900/20 px-2 py-0.5 text-xs text-cyan-300"
                  data-testid="ai-report-shared-badge"
                >
                  {t("sessionMaterials.aiAnalysisSharedBadge")}
                </span>
              )
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Analysis version warning */}
          {analysisFromOlderTranscript && isFacilitatorView ? (
            <div
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              data-testid="analysis-from-older-transcript-warning"
            >
              {t("sessionMaterials.analysisFromOlderTranscript")}
            </div>
          ) : null}

          {/* Participant placeholder: analysis not shared yet */}
          {participantPlaceholder && aiNotSharedMessage ? (
            <p
              className="text-sm text-slate-400"
              data-testid="ai-analysis-not-shared-message"
            >
              {t("sessionMaterials.aiAnalysisNotSharedYet")}
            </p>
          ) : participantPlaceholder ? (
            <p
              className="text-sm text-slate-400"
              data-testid="ai-analysis-participant-placeholder"
            >
              {t("sessionMaterials.aiAnalysisParticipantPlaceholder")}
            </p>
          ) : null}

          {/* Status message */}
          {!participantPlaceholder && liveAiAnalysisStage !== "ready" ? (
            <p className="text-sm text-slate-400" data-testid="ai-analysis-status-message">
              {t(aiAnalysisStatusKeys[liveAiAnalysisStage])}
            </p>
          ) : null}

          {/* Error */}
          {aiAnalysisError || aiRenderValidationError ? (
            <p className="text-sm text-amber-400" data-testid="ai-analysis-error">
              {aiAnalysisError ?? aiRenderValidationError}
            </p>
          ) : null}

          {/* Facilitator: run / retry analysis */}
          {canStartAiAnalysis || canRetryAiAnalysis ? (
            <div className="flex flex-wrap gap-2">
              {canStartAiAnalysis ? (
                <SecondaryButton
                  disabled={aiAnalysisBusy}
                  onClick={() => void handleRunAiAnalysis()}
                  data-testid="run-ai-analysis-button"
                >
                  {aiAnalysisBusy
                    ? t("common.loading")
                    : t("sessionMaterials.runAiAnalysis")}
                </SecondaryButton>
              ) : null}
              {canRetryAiAnalysis ? (
                <SecondaryButton
                  disabled={aiAnalysisBusy}
                  onClick={() => void handleRunAiAnalysis()}
                  data-testid="retry-ai-analysis-button"
                >
                  {aiAnalysisBusy
                    ? t("common.loading")
                    : t("sessionMaterials.retryAiAnalysis")}
                </SecondaryButton>
              ) : null}
            </div>
          ) : null}

          {/* Facilitator: share / unshare controls */}
          {isFacilitatorView && canShareAiAnalysis ? (
            <div className="flex flex-wrap items-center gap-2">
              {!aiIsShared ? (
                <>
                  <SecondaryButton
                    disabled={sharingBusy}
                    onClick={() => void handleShareAiAnalysis()}
                    data-testid="share-ai-analysis-button"
                  >
                    {sharingBusy
                      ? t("sessionMaterials.sharing")
                      : t("sessionMaterials.shareAiAnalysis")}
                  </SecondaryButton>
                  <p className="text-xs text-slate-500">
                    {t("sessionMaterials.canShareHint")}
                  </p>
                </>
              ) : (
                <>
                  <span
                    className="rounded border border-emerald-500/40 bg-emerald-950/20 px-2 py-0.5 text-xs text-emerald-300"
                    data-testid="analysis-shared-indicator"
                  >
                    {t("sessionMaterials.aiAnalysisSharedBadge")}
                  </span>
                  <SecondaryButton
                    disabled={unsharingBusy}
                    onClick={() => void handleUnshareAiAnalysis()}
                    data-testid="unshare-ai-analysis-button"
                  >
                    {unsharingBusy
                      ? t("common.loading")
                      : t("sessionMaterials.unshareAiAnalysis")}
                  </SecondaryButton>
                </>
              )}
            </div>
          ) : null}

          {/* Facilitator: visibility hint */}
          {isFacilitatorView && analysisJson ? (
            <p className="text-xs text-slate-500">
              {aiIsShared
                ? t("sessionMaterials.sharedReportVisible")
                : t("sessionMaterials.facilitatorReportVisible")}
            </p>
          ) : null}

          {liveAiAnalysisStage === "failed" ? (
            <p className="text-xs text-slate-500">
              <Link href="/admin" className="text-cyan-400 hover:text-cyan-300">
                {t("recording.openDiagnostics")}
              </Link>
            </p>
          ) : null}

          {/* Report */}
          {canViewAiAnalysis && analysisJson ? (
            <AiAnalysisReport analysis={analysisJson} isFacilitator={isFacilitatorView} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Helper functions ───────────────────────────────────────────────────────

function buildLiveSnapshot(
  data: MaterialsStatusResponse,
): SessionMaterialsProcessingSnapshot {
  const rec = data.recording?.processingStage
    ? mapApiRecordingStage(data.recording.processingStage)
    : ("not_available" as ProcessingRecordingStatus);

  const trans = data.transcription?.processingStage
    ? mapApiTranscriptionStage(data.transcription.processingStage)
    : ("waiting_for_recording" as ProcessingTranscriptionStatus);

  const ai = data.aiAnalysis?.processingStage
    ? mapApiAiAnalysisStage(data.aiAnalysis.processingStage)
    : trans === "ready"
      ? ("not_started" as ProcessingAiAnalysisStatus)
      : ("waiting_for_transcript" as ProcessingAiAnalysisStatus);

  return {
    recording: rec,
    transcription: trans,
    aiAnalysis: ai,
    recordingUpdatedAt:
      data.recording?.endedAt ?? data.recording?.startedAt ?? null,
    transcriptionUpdatedAt:
      data.transcription?.completedAt ?? data.transcription?.startedAt ?? null,
    recordingError: data.recording?.errorMessage ?? null,
  };
}

function shouldPollFromSnapshot(
  snapshot: SessionMaterialsProcessingSnapshot,
): boolean {
  const activeRecording = new Set<ProcessingRecordingStatus>([
    "in_progress",
    "finalizing",
    "processing",
  ]);
  const activeTranscription = new Set<ProcessingTranscriptionStatus>([
    "queued",
    "downloading",
    "compressing",
    "transcribing",
  ]);
  const activeAi = new Set<ProcessingAiAnalysisStatus>(["queued", "analyzing"]);
  return (
    activeRecording.has(snapshot.recording) ||
    activeTranscription.has(snapshot.transcription) ||
    activeAi.has(snapshot.aiAnalysis) ||
    (snapshot.recording === "ready" && snapshot.transcription === "not_started")
  );
}
