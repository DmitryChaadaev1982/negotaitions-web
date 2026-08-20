import { expect, test, type Dialog, type Page } from "@playwright/test";

import { formatLabBriefing } from "./helpers/post-transcription-lab-briefing";
import { LAB_ENHANCED_LEXICAL_MARKER } from "./helpers/post-transcription-lab-transcript";
import {
  isPipelineLabScenario,
  parseLabScenarioIds,
} from "./helpers/post-transcription-lab-catalog";
import {
  loadLabDomainSnapshot,
  loadLabReadinessSnapshot,
} from "./helpers/post-transcription-lab-inspect";
import {
  formatPipelineCheckpointRow,
  runPipelineLabScenario,
} from "./helpers/post-transcription-lab-pipeline";
import { assertPostTranscriptionLabSafety } from "./helpers/post-transcription-lab-safety";
import { createUserSessionCookie, query, updateParticipantNotes } from "./helpers/db";
import { seedPostTranscriptionLabScenario } from "./helpers/post-transcription-lab-seed";

test.describe.configure({ mode: "serial" });

const pauseEnabled = process.env.LAB_PAUSE !== "0";
const headedCheckpointDScenarios = new Set(["I01", "I03", "N03", "N04", "N05"]);
const headedCheckpointEScenarios = new Set(["S03"]);
const scenarioIds = parseLabScenarioIds(process.env.LAB_SCENARIOS);
const pipelineRows: string[] = [
  ["SCENARIO", "EXPECTED STATUS", "ACTUAL STATUS", "EXPECTED ASSIGNMENT", "ACTUAL ASSIGNMENT", "TELEMETRY SOURCE", "SAFETY DECISION", "PASS/FAIL"].join("\t"),
];

async function setMaterialsNotesDraft(page: Page, value: string) {
  const notes = page.getByTestId("materials-notes-textarea");
  await notes.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, nextValue);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await expect(notes).toHaveValue(value);
}

async function loginWithCookie(page: Page, cookieHeader: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function pauseCheckpoint(
  page: Page,
  input: {
    label: string;
    scenario: string;
    substep: string;
    changedSincePrevious: string;
    verify: string;
    resumeWill: string;
    operatorPrompt: string;
  },
) {
  console.log(
    [
      "",
      input.label,
      `CURRENT SCENARIO: ${input.scenario}`,
      `CURRENT SUBSTEP: ${input.substep}`,
      `WHAT CHANGED SINCE PREVIOUS PAUSE: ${input.changedSincePrevious}`,
      `WHAT THE OPERATOR SHOULD VERIFY: ${input.verify}`,
      `WHAT PRESSING RESUME WILL DO: ${input.resumeWill}`,
      input.operatorPrompt,
      "Resume in the Playwright Inspector, not in this chat.",
      "",
    ].join("\n"),
  );
  if (pauseEnabled) {
    await page.pause();
  }
}

async function collectMaterialEditDiagnostics(
  page: Page,
  input: {
    scenario: string;
    enhancementState: string;
    aiState: string;
    mappingState: string;
  },
) {
  const section = page.locator("#transcription-section");
  const sectionPresent = (await section.count()) > 0;
  const toggle = section.getByTestId("toggle-transcript-section");
  const toggleCount = sectionPresent ? await toggle.count() : 0;
  const sectionState =
    toggleCount > 0
      ? ((await toggle.getAttribute("data-state")) ??
        ((await toggle.getAttribute("aria-expanded")) === "false"
          ? "collapsed"
          : "expanded"))
      : "unknown";
  return [
    `SCENARIO=${input.scenario}`,
    `current URL=${page.url()}`,
    `transcription section present = ${sectionPresent ? "YES" : "NO"}`,
    `section expanded/collapsed state=${sectionState}`,
    `edit action count=${await page.getByTestId("edit-diarized-transcript-button").count()}`,
    `expand action count=${toggleCount > 0 && sectionState === "collapsed" ? 1 : 0}`,
    `collapse action count=${toggleCount > 0 && sectionState === "expanded" ? 1 : 0}`,
    `enhancement state=${input.enhancementState}`,
    `AI state=${input.aiState}`,
    `mapping state=${input.mappingState}`,
  ].join("\n");
}

async function prepareDiarizedMaterialEdit(
  page: Page,
  suffix: string,
  input: {
    scenario: string;
    enhancementState: string;
    aiState: string;
    mappingState: string;
  },
) {
  const section = page.locator("#transcription-section");
  const dump = async () => collectMaterialEditDiagnostics(page, input);

  if ((await section.count()) === 0) {
    throw new Error(
      `PRODUCT STATE CONTRADICTION: #transcription-section is missing.\n${await dump()}`,
    );
  }

  const toggle = section.getByTestId("toggle-transcript-section");
  await expect(toggle, await dump()).toHaveCount(1, { timeout: 5_000 });
  const sectionState = await toggle.getAttribute("data-state");
  if (sectionState === "collapsed") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-state", "expanded", { timeout: 5_000 });
  } else if (sectionState !== "expanded") {
    throw new Error(
      `PRODUCT STATE CONTRADICTION: transcript toggle state is not expanded or collapsed.\n${await dump()}`,
    );
  }

  const editButton = page.getByTestId("edit-diarized-transcript-button");
  try {
    await expect(editButton).toBeVisible({ timeout: 8_000 });
  } catch (error) {
    throw new Error(
      `Transcript edit action unreachable after state-aware expand.\n${await dump()}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  await editButton.scrollIntoViewIfNeeded();
  await editButton.click();
  const turnText = page.getByTestId("manual-speaker-turn-text").first();
  try {
    await expect(turnText).toBeVisible({ timeout: 8_000 });
  } catch (error) {
    throw new Error(
      `Manual speaker turn editor unreachable after Edit transcript.\n${await dump()}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const current = await turnText.inputValue();
  await turnText.fill(`${current}\n${suffix}`);
}

async function reloadFacilitatorMaterials(page: Page, sessionId: string) {
  await page.reload();
  await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/materials`));
}

test.beforeAll(() => {
  assertPostTranscriptionLabSafety();
});

test.afterAll(() => {
  if (pipelineRows.length > 1) {
    console.log(
      ["", "PIPELINE CHECKPOINT TABLE", ...pipelineRows, ""].join("\n"),
    );
  }
  if (scenarioIds.some((id) => headedCheckpointDScenarios.has(id))) {
    console.log(
      [
        "",
        "HEADED CHECKPOINT D LAB PROCESS ENDED",
        "CHECKPOINT_D_ACCEPTED = YES",
        "",
      ].join("\n"),
    );
  }
  if (scenarioIds.some((id) => headedCheckpointEScenarios.has(id))) {
    console.log(
      [
        "",
        "HEADED CHECKPOINT E LAB PROCESS ENDED",
        "CHECKPOINT_E_ACCEPTED = YES",
        "Manual Checkpoint E is accepted. Phase F is a separate checkpoint.",
        "",
      ].join("\n"),
    );
  }
});

for (const scenarioId of scenarioIds) {
  test(`@post-transcription-lab headed ${scenarioId}`, async ({ page, request, context }) => {
    test.setTimeout(pauseEnabled ? 0 : 120_000);

    const seeded = isPipelineLabScenario(scenarioId)
      ? await (async () => {
          const result = await runPipelineLabScenario(scenarioId);
          pipelineRows.push(formatPipelineCheckpointRow(result));
          expect(result.pass, result.failures.join("; ")).toBe(true);
          if (scenarioId === "AM07E") {
            const review = await request.get(
              `/api/sessions/${result.seeded.sessionId}/speaker-mapping?joinToken=${result.seeded.facilitator.joinToken}`,
              { headers: { Cookie: result.seeded.facilitatorAuthCookie } },
            );
            expect(review.ok()).toBeTruthy();
            const reviewBody = (await review.json()) as {
              participants?: Array<{ sessionParticipantId: string }>;
            };
            const reviewIds = (reviewBody.participants ?? [])
              .map((participant) => participant.sessionParticipantId)
              .sort();
            const autoIds = [...result.actual.candidateParticipantIds].sort();
            expect(reviewIds, "AM07E auto/review candidate parity").toEqual(autoIds);
          }
          return result.seeded;
        })()
      : await seedPostTranscriptionLabScenario(scenarioId);

    await loginWithCookie(page, seeded.facilitatorAuthCookie);
    const sessionsPage = await context.newPage();
    await loginWithCookie(sessionsPage, seeded.facilitatorAuthCookie);

    await page.goto(`/sessions/${seeded.sessionId}/materials`);
    await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("post-processing-status-strip")).toBeVisible();

    await sessionsPage.goto("/sessions");
    const sessionRow = sessionsPage.getByTestId("session-row").filter({
      hasText: seeded.sessionTitle,
    });
    await expect(sessionRow).toBeVisible({ timeout: 20_000 });

    const materialsStatus = await request.get(
      `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.facilitator.joinToken}`,
      { headers: { Cookie: seeded.facilitatorAuthCookie } },
    );
    expect(materialsStatus.ok()).toBeTruthy();
    const materialsStatusBody = (await materialsStatus.json()) as {
      transcription: {
        processingStage: string;
        text?: string | null;
        canRerun?: boolean;
        speakerMappingRequired?: boolean;
        speakerMappingStatus?: string | null;
        enhancement?: {
          status: string;
          inProgress?: boolean;
          canRetry?: boolean;
          canContinueWithCurrentTranscript?: boolean;
        } | null;
      };
      aiAnalysis: {
        processingStage: string;
        canStart: boolean;
        canShare?: boolean;
        canView?: boolean;
        status?: string;
        analysisCurrent?: boolean;
        historicalAnalysisExists?: boolean;
        analysisFromOlderTranscript?: boolean;
        isSharedWithSession?: boolean;
      };
      postProcessing?: {
        stages: {
          TRANSCRIPT_ENHANCEMENT: { semantic: string };
          SPEAKER_MAPPING: { semantic: string };
          AI_ANALYSIS: { semantic: string };
        };
      };
    };

    const domain = await loadLabDomainSnapshot(seeded.sessionId);
    const readiness = await loadLabReadinessSnapshot(seeded.sessionId);
    const briefing = formatLabBriefing({
      definition: seeded.definition,
      seeded,
      domain,
      readiness,
      presentation: {
        materialsStatus: {
          transcription: materialsStatusBody.transcription,
          aiAnalysis: materialsStatusBody.aiAnalysis,
        },
        note: isPipelineLabScenario(scenarioId)
          ? "PIPELINE_FIXTURE: mapping result came from autoTriggerSpeakerMappingAfterTranscription, not a seeded finished status."
          : "STATE_FIXTURE: rail, materials, /sessions, and dashboard consume the canonical post-processing projection.",
      },
    });
    console.log(briefing);

    if (scenarioId === "S02") {
      expect(materialsStatusBody.postProcessing?.stages.SPEAKER_MAPPING.semantic).toBe(
        "action_required",
      );
      expect(materialsStatusBody.transcription.speakerMappingRequired).toBe(true);
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(false);
      expect(readiness.sessionsListMappingStage).toBe("required");
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-required-badge")).toBeVisible();
      await expect(page.getByTestId("post-processing-mapping-status")).toHaveAttribute(
        "data-stage",
        "action_required",
      );
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toHaveCount(0);
    }

    if (scenarioId === "S03") {
      expect(materialsStatusBody.postProcessing?.stages.SPEAKER_MAPPING.semantic).toBe(
        "informational",
      );
      expect(materialsStatusBody.transcription.speakerMappingRequired).toBe(false);
      expect(materialsStatusBody.transcription.speakerMappingStatus).toBe("AUTO_SUGGESTED");
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(true);
      expect(readiness.sessionsListMappingStage).toBe("informational");
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-required-badge")).toHaveCount(0);
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-advisory-badge")).toBeVisible();
      await expect(page.getByTestId("post-processing-mapping-status")).toHaveAttribute(
        "data-stage",
        "informational",
      );
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toBeVisible();
      const transcriptToggle = page.getByTestId("toggle-transcript-section");
      if ((await transcriptToggle.getAttribute("aria-expanded")) === "false") {
        await transcriptToggle.click();
      }
      await expect(transcriptToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("auto-applied-mapping-note")).toBeVisible();
      await expect(page.getByTestId("recording-status")).toBeVisible();
      const materialsLanguage = page.getByTestId("transcript-language-select");
      await expect(materialsLanguage).toBeVisible();
      await expect(materialsLanguage).toBeEnabled();
      await expect(materialsLanguage).toHaveValue("auto");
      await materialsLanguage.selectOption("ru");
      await expect(materialsLanguage).toHaveValue("ru");
      await materialsLanguage.selectOption("auto");
      await expect(materialsLanguage).toHaveValue("auto");
      console.log(
        [
          "MATERIALS_RECORDING_STATUS_VISIBLE=YES",
          "MATERIALS_LANGUAGE_SELECTOR_VISIBLE=YES",
        ].join("\n"),
      );

      const roomPage = await context.newPage();
      await loginWithCookie(roomPage, seeded.facilitatorAuthCookie);
      await roomPage.setViewportSize({ width: 1536, height: 960 });
      await roomPage.goto(`/room/${seeded.sessionId}?media=off`);
      const roomPanel = roomPage
        .getByTestId("room-desktop-sidebar")
        .getByTestId("debrief-panel");
      await expect(roomPanel).toBeVisible({
        timeout: 20_000,
      });
      const roomToggle = roomPanel.getByTestId("toggle-transcript-section");
      if ((await roomToggle.getAttribute("aria-expanded")) === "false") {
        await roomToggle.click();
      }
      await expect(roomToggle).toHaveAttribute("aria-expanded", "true");
      await expect(roomPanel.getByTestId("recording-status")).toHaveCount(0);
      await expect(roomPanel.getByTestId("transcript-language-select")).toHaveCount(0);
      await expect(roomPanel.getByTestId("diarized-transcript-turn").first()).toBeVisible();
      await expect(roomPanel.getByTestId("copy-diarized-transcript-button")).toBeVisible();
      await expect(roomPanel.getByTestId("edit-diarized-transcript-button")).toBeVisible();
      const roomRerun = roomPanel.getByTestId("post-processing-rerun-transcription-button");
      if (materialsStatusBody.transcription.canRerun) {
        await expect(roomRerun).toBeVisible();
      } else {
        await expect(roomRerun).toHaveCount(0);
      }
      console.log(
        [
          "ROOM_RECORDING_STATUS_DETAIL_VISIBLE=NO",
          "ROOM_LANGUAGE_SELECTOR_VISIBLE=NO",
          "ROOM_TRANSCRIPT_CONTROLS_PRESERVED=YES",
        ].join("\n"),
      );
      await pauseCheckpoint(roomPage, {
        label: "CHECKPOINT E / S03-A / ROOM DEBRIEF QUICK PANEL",
        scenario: "S03",
        substep: "S03-A",
        changedSincePrevious:
          "Room Debrief quick panel hides recording-status detail and language selector. Materials page still has both.",
        verify:
          "In the room panel Recording & transcription section: no recording status row, no language selector. Transcript, copy, Edit transcript, and rerun (if permitted) remain. Do not continue to S03-B until this room panel is inspected.",
        resumeWill: "The Lab will start AI through the real consent modal and persist CONFIRMED.",
        operatorPrompt:
          "Inspect the simplified room Debrief facilitator panel. Give UI instructions in chat or press Resume to start AI (S03-B).",
      });
      await roomPanel.getByTestId("post-processing-run-ai-analysis-button").click();
      await roomPage.locator('[data-testid="ai-analysis-consent-checkbox"]:visible').check();
      await roomPage.locator('[data-testid="ai-analysis-confirm"]:visible').click();
      await expect
        .poll(async () => {
          const afterStart = await loadLabDomainSnapshot(seeded.sessionId);
          return afterStart.speakerMappingStatus;
        })
        .toBe("CONFIRMED");
      const confirmed = await loadLabDomainSnapshot(seeded.sessionId);
      expect(confirmed.speakerMappingConfirmedAt).toBeTruthy();
      expect(confirmed.speakerMappingConfirmedBy).toBeTruthy();
      console.log("S03_START_AI_PERSISTED_CONFIRMED=YES");
      await pauseCheckpoint(page, {
        label: "CHECKPOINT E / S03-B / MAPPING CONFIRMED",
        scenario: "S03",
        substep: "S03-B",
        changedSincePrevious: "Successful Start AI admission persisted CONFIRMED.",
        verify: "Mapping is CONFIRMED. Auto-applied confirm-later banner is gone.",
        resumeWill: "The Lab will leave S03. Checkpoint E is not accepted until the operator says UI ACCEPTED — CONTINUE E.",
        operatorPrompt: "Inspect CONFIRMED mapping after Start AI. Press Resume when finished with S03.",
      });
    }

    if (scenarioId === "S10") {
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-required-badge")).toHaveCount(0);
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-advisory-badge")).toBeVisible();
      expect(materialsStatusBody.transcription.speakerMappingRequired).toBe(false);
      expect(materialsStatusBody.transcription.speakerMappingStatus).toBe("AUTO_SUGGESTED");
      expect(materialsStatusBody.postProcessing?.stages.SPEAKER_MAPPING.semantic).toBe(
        "informational",
      );
      expect(materialsStatusBody.postProcessing?.stages.AI_ANALYSIS.semantic).toBe("ready");
      expect(domain.speakerMappingConfirmedAt).toBeNull();
      expect(domain.speakerMappingConfirmedBy).toBeNull();
      expect(materialsStatusBody.aiAnalysis.processingStage).toBe("ready");
      expect(materialsStatusBody.aiAnalysis.status).toBe("COMPLETED");
      expect(materialsStatusBody.aiAnalysis.analysisFromOlderTranscript).toBe(false);
      await expect(page.getByTestId("post-processing-mapping-status")).toHaveAttribute(
        "data-stage",
        "informational",
      );
      await expect(page.getByTestId("ai-analysis-invalid-result")).toHaveCount(0);
      await expect(page.getByTestId("ai-report")).toBeVisible();
      const s10Toggle = page.getByTestId("toggle-transcript-section");
      if ((await s10Toggle.getAttribute("aria-expanded")) === "false") {
        await s10Toggle.click();
      }
      await expect(page.getByTestId("auto-applied-mapping-note")).toHaveCount(0);
      await expect(page.getByText("Проверьте и подтвердите")).toHaveCount(0);
      await expect(page.getByText("можно изменить позже")).toHaveCount(0);
      console.log(
        [
          "S10_AI_ARTIFACT_VALID=YES",
          `S10_AI_STATUS=${materialsStatusBody.aiAnalysis.status}`,
          "S10_AI_CURRENT=YES",
          "S10_INVALID_AI_WARNING_PRESENT=NO",
          "S10_MAPPING_CONTRADICTION_STILL_REPRODUCED=NO",
          "S10_CONFIRM_LATER_BANNER_HIDDEN=YES",
        ].join("\n"),
      );
    }

    if (scenarioId === "S11") {
      expect(materialsStatusBody.transcription.speakerMappingStatus).toBe("CONFIRMED");
      expect(domain.speakerMappingConfirmedAt).toBeTruthy();
      expect(domain.speakerMappingConfirmedBy).toBeTruthy();
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(true);
      await expect(sessionRow.getByTestId("sessions-speaker-mapping-required-badge")).toHaveCount(0);
      await expect(page.getByTestId("auto-applied-mapping-note")).toHaveCount(0);
      console.log("S11_CONFIRMED_NOT_REVERTED=YES");
    }

    if (scenarioId === "E03") {
      expect(materialsStatusBody.transcription.enhancement?.status).toBe("FAILED");
      expect(materialsStatusBody.transcription.enhancement?.canContinueWithCurrentTranscript).toBe(
        true,
      );
      expect(materialsStatusBody.postProcessing?.stages.TRANSCRIPT_ENHANCEMENT.semantic).toBe(
        "failed",
      );
      expect(materialsStatusBody.postProcessing?.stages.SPEAKER_MAPPING.semantic).toBe(
        "informational",
      );
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(true);
      await expect(page.getByTestId("enhancement-continue-current-transcript")).toBeVisible();
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toBeVisible();
      await expect(page.getByTestId("post-processing-run-transcript-enhancement-button")).toBeVisible();
    }

    if (scenarioId === "E02") {
      expect(materialsStatusBody.transcription.enhancement?.status).toBe("IN_PROGRESS");
      expect(readiness.enhancementTerminal).toBe(false);
      expect(readiness.speakerMappingReadyForAnalysis).toBe(true);
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(false);
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toHaveCount(0);
      await expect(page.getByTestId("transcript-enhancement-running-lock")).toBeVisible();
    }

    if (scenarioId === "E05") {
      const recordingRes = await request.get(
        `/api/sessions/${seeded.sessionId}/recording?joinToken=${seeded.facilitator.joinToken}`,
        { headers: { Cookie: seeded.facilitatorAuthCookie } },
      );
      expect(recordingRes.ok()).toBeTruthy();
      const recordingBody = (await recordingRes.json()) as {
        transcript?: { text?: string | null; diarizedText?: string | null };
      };
      const lexicalText = recordingBody.transcript?.text ?? materialsStatusBody.transcription.text ?? "";
      const diarizedText = recordingBody.transcript?.diarizedText ?? "";

      expect(materialsStatusBody.transcription.enhancement?.status).toBe("COMPLETED");
      expect(materialsStatusBody.transcription.enhancement?.inProgress).not.toBe(true);
      expect(readiness.enhancementTerminal).toBe(true);
      expect(domain.enhancementStatus).toBe("COMPLETED");
      expect(lexicalText).toContain(LAB_ENHANCED_LEXICAL_MARKER);
      expect(diarizedText).toContain(LAB_ENHANCED_LEXICAL_MARKER);
      expect(diarizedText).toContain("Lab Buyer");
      expect(diarizedText).toContain("Lab Seller");
      await expect(page.getByTestId("transcript-enhancement-running-lock")).toHaveCount(0);
      await expect(page.getByText(LAB_ENHANCED_LEXICAL_MARKER).first()).toBeVisible();
      await expect(page.getByText("Lab Buyer").first()).toBeVisible();
      await expect(page.getByText("Lab Seller").first()).toBeVisible();

      const saveAttempt = await request.post(`/api/sessions/${seeded.sessionId}/transcript`, {
        headers: { Cookie: seeded.facilitatorAuthCookie },
        data: {
          joinToken: seeded.facilitator.joinToken,
          text: lexicalText,
        },
      });
      expect(saveAttempt.status()).not.toBe(409);
      expect(saveAttempt.ok()).toBeTruthy();

      expect(materialsStatusBody.aiAnalysis.canStart).toBe(true);
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toBeVisible();
      await expect(page.getByTestId("materials-notes-textarea")).toBeVisible();
      await expect(page.getByTestId("materials-notes-textarea")).toBeEnabled();
      await expect(page.getByTestId("materials-notes-save-button")).toBeVisible();

      console.log(
        [
          "TERMINAL_ENHANCEMENT_VISUAL_SCENARIO=E05",
          "ENHANCEMENT_STATUS=COMPLETED",
          "LEXICAL_TEXT_PRESERVED=YES",
          "MAPPED_NAMES_PRESERVED=YES",
          "EDITOR_UNLOCKED_AFTER_TERMINAL=YES",
          "CANONICAL_DIARIZED_TEXT_COHERENT=YES",
        ].join("\n"),
      );
    }

    async function loadFacilitatorStatus() {
      const response = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.facilitator.joinToken}`,
        { headers: { Cookie: seeded.facilitatorAuthCookie } },
      );
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as typeof materialsStatusBody;
    }

    if (scenarioId === "I01") {
      const before = await query<{ id: string; inputFingerprint: string | null }>(
        `SELECT "id","inputFingerprint" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(before[0]?.inputFingerprint).toBeTruthy();
      expect(materialsStatusBody.aiAnalysis.status).toBe("COMPLETED");
      expect(materialsStatusBody.aiAnalysis.analysisCurrent).toBe(true);
      expect(materialsStatusBody.aiAnalysis.processingStage).toBe("ready");
      await expect(page.getByTestId("post-processing-status-strip")).toBeVisible();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / I01-A / BEFORE MATERIAL CHANGE",
        scenario: "I01",
        substep: "I01-A",
        changedSincePrevious: "Seeded current completed AI. No material edit yet.",
        verify: "AI is COMPLETED/current. Old report is the active current report. No rewind yet.",
        resumeWill: "The Lab will expand the transcript if collapsed, save a real diarized edit, then pause at I01-B.",
        operatorPrompt: "Inspect current AI before the material edit. Press Resume when ready.",
      });
      await prepareDiarizedMaterialEdit(page, "I01 material edit", {
        scenario: "I01",
        enhancementState: String(materialsStatusBody.transcription.enhancement?.status ?? "none"),
        aiState: `${materialsStatusBody.aiAnalysis.status}/${materialsStatusBody.aiAnalysis.processingStage}`,
        mappingState: String(materialsStatusBody.transcription.speakerMappingStatus ?? "none"),
      });
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/manual-speaker-attribution") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("save-manual-speaker-attribution-button").click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.ok(), `I01 material save HTTP ${saveResponse.status()}`).toBeTruthy();
      await expect
        .poll(async () => (await loadFacilitatorStatus()).aiAnalysis.status)
        .toBe("NOT_STARTED");
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.processingStage).toBe("not_started");
      expect(after.aiAnalysis.canShare).toBe(false);
      expect(after.aiAnalysis.analysisCurrent).not.toBe(true);
      expect(after.aiAnalysis.historicalAnalysisExists).toBe(true);
      expect(after.postProcessing?.stages.AI_ANALYSIS.semantic).not.toBe("ready");
      const remaining = await query<{ id: string; inputFingerprint: string | null }>(
        `SELECT "id","inputFingerprint" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(remaining[0]?.id).toBe(before[0]?.id);
      expect(remaining[0]?.inputFingerprint).toBe(before[0]?.inputFingerprint);
      const materialMarker = await query<{ matched: number }>(
        `SELECT COUNT(*)::int AS matched FROM "Transcript"
         WHERE "sessionId" = $1
           AND ("text" LIKE $2 OR "diarizedText" LIKE $2)`,
        [seeded.sessionId, "%I01 material edit%"],
      );
      expect(materialMarker[0]?.matched).toBeGreaterThan(0);
      const publish = await request.post(`/api/sessions/${seeded.sessionId}/ai-analysis/share`, {
        headers: { Cookie: seeded.facilitatorAuthCookie },
        data: {
          joinToken: seeded.facilitator.joinToken,
          shareDebriefConfirmed: true,
        },
      });
      expect(publish.status()).toBe(409);
      await reloadFacilitatorMaterials(page, seeded.sessionId);
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toBeVisible();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / I01-B / AFTER MATERIAL SAVE",
        scenario: "I01",
        substep: "I01-B",
        changedSincePrevious: "A real diarized transcript save completed. Material fingerprint no longer matches. AI is no longer current.",
        verify: "AI presentation is NOT_STARTED / rerun required. Old report is not the active current report.",
        resumeWill: scenarioIds.includes("I03")
          ? "The Lab will leave I01 and seed I03-A."
          : "The focused I01 diagnostic ends. Full Checkpoint D is not auto-started from this pause.",
        operatorPrompt: "Inspect rewind after the material save. Press Resume when finished.",
      });
    }

    if (scenarioId === "I02") {
      const save = await request.post(`/api/sessions/${seeded.sessionId}/transcript`, {
        headers: { Cookie: seeded.facilitatorAuthCookie },
        data: {
          joinToken: seeded.facilitator.joinToken,
          text: `${materialsStatusBody.transcription.text ?? ""}\nI02 pre-AI edit`,
        },
      });
      expect(save.ok()).toBeTruthy();
      const aiRows = await query<{ id: string }>(
        `SELECT "id" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(aiRows).toHaveLength(0);
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.status).toBe("NOT_STARTED");
    }

    if (scenarioId === "I03") {
      const historical = await query<{ id: string }>(
        `SELECT "id" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(historical[0]?.id).toBeTruthy();
      expect(domain.publicationActive).toBe(true);
      expect(materialsStatusBody.aiAnalysis.status).toBe("COMPLETED");
      expect(materialsStatusBody.aiAnalysis.analysisCurrent).toBe(true);
      expect(materialsStatusBody.aiAnalysis.isSharedWithSession).toBe(true);
      await expect(page.getByTestId("post-processing-unshare-analysis-button")).toBeVisible();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / I03-A / BEFORE PUBLISHED MATERIAL CHANGE",
        scenario: "I03",
        substep: "I03-A",
        changedSincePrevious: "Seeded published current AI. No material edit has happened yet.",
        verify: "AI analysis ready. Shared with participants. Stop sharing is present.",
        resumeWill: "The Lab will start a real diarized material edit and pause when the warning is visible. It will not confirm yet.",
        operatorPrompt: "Inspect initial published/current AI state. Press Resume when ready.",
      });

      await prepareDiarizedMaterialEdit(page, "I03 material edit", {
        scenario: "I03",
        enhancementState: String(materialsStatusBody.transcription.enhancement?.status ?? "none"),
        aiState: `${materialsStatusBody.aiAnalysis.status}/${materialsStatusBody.aiAnalysis.processingStage}`,
        mappingState: String(materialsStatusBody.transcription.speakerMappingStatus ?? "none"),
      });
      const dialogPromise = page.waitForEvent("dialog");
      const saveClick = page.getByTestId("save-manual-speaker-attribution-button").click();
      const warningDialog: Dialog = await dialogPromise;
      console.log(`I03_WARNING_DIALOG_MESSAGE=${warningDialog.message()}`);
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / I03-B / MATERIAL CHANGE WARNING",
        scenario: "I03",
        substep: "I03-B",
        changedSincePrevious: "A real facilitator material save was initiated. The warning is visible. Nothing has been confirmed or revoked yet.",
        verify: "Warning says confirming will invalidate current AI, require rerun, and revoke/hide the active publication.",
        resumeWill: "The Lab will confirm the warning. If the native dialog closed during Inspector pause, it will re-open the same save and confirm it, then pause at I03-C.",
        operatorPrompt:
          "Inspect the warning. Do not click OK or Cancel on the dialog, and do not manually stop sharing or rerun AI. Press Resume when ready to let the Lab confirm.",
      });
      try {
        await warningDialog.accept();
        await saveClick;
      } catch (error) {
        console.log(
          `I03_WARNING_DIALOG_GONE_AFTER_PAUSE=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        const alreadyRewound = (await loadFacilitatorStatus()).aiAnalysis.status === "NOT_STARTED";
        if (!alreadyRewound) {
          const retryDialogPromise = page.waitForEvent("dialog");
          const retrySave = page.getByTestId("save-manual-speaker-attribution-button").click();
          const retryDialog = await retryDialogPromise;
          console.log(`I03_WARNING_DIALOG_REPLAY_MESSAGE=${retryDialog.message()}`);
          await retryDialog.accept();
          await retrySave;
        }
      }
      await expect
        .poll(async () => (await loadFacilitatorStatus()).aiAnalysis.status)
        .toBe("NOT_STARTED");
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.canShare).toBe(false);
      expect(after.aiAnalysis.analysisCurrent).not.toBe(true);
      expect(after.aiAnalysis.isSharedWithSession).not.toBe(true);
      expect(after.aiAnalysis.processingStage).toBe("not_started");
      expect(after.postProcessing?.stages.AI_ANALYSIS.semantic).not.toBe("ready");
      const remaining = await query<{ id: string }>(
        `SELECT "id" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(remaining[0]?.id).toBe(historical[0]?.id);
      const publications = await query<{ id: string }>(
        `SELECT "id" FROM "AiAnalysisPublication" WHERE "revokedAt" IS NULL AND "aiAnalysisId" IN (SELECT "id" FROM "AiAnalysis" WHERE "sessionId" = $1)`,
        [seeded.sessionId],
      );
      expect(publications).toHaveLength(0);
      const buyerCookie = await createUserSessionCookie(seeded.buyer.userId);
      const buyerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.buyer.joinToken}`,
        { headers: { Cookie: buyerCookie } },
      );
      expect(buyerStatus.ok()).toBeTruthy();
      const buyerBody = (await buyerStatus.json()) as { aiAnalysis: { canView: boolean } };
      expect(buyerBody.aiAnalysis.canView).toBe(false);
      await reloadFacilitatorMaterials(page, seeded.sessionId);
      await expect(page.getByTestId("post-processing-unshare-analysis-button")).toHaveCount(0);
      await expect(page.getByTestId("post-processing-run-ai-analysis-button")).toBeVisible();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / I03-C / AFTER REVOKE AND AI REWIND",
        scenario: "I03",
        substep: "I03-C",
        changedSincePrevious: "The Lab confirmed the warning. The material save finished. Publication was revoked and AI was rewound.",
        verify: "Publication inactive. Old AI not current. Presentation is NOT_STARTED / rerun required. Shared with participants and Stop sharing are gone. Historical AiAnalysis row remains. Recipient access fails closed.",
        resumeWill: "The Lab will leave I03 and seed N03.",
        operatorPrompt: "Inspect post-change state. Publication must be revoked and AI must require rerun. Press Resume when finished.",
      });
    }

    if (scenarioId === "I04") {
      expect(domain.publicationActive).toBe(true);
      expect(domain.aiInputFingerprint).toBeTruthy();
      expect(materialsStatusBody.aiAnalysis.status).toBe("NOT_STARTED");
      const buyerCookie = await createUserSessionCookie(seeded.buyer.userId);
      const observerCookie = await createUserSessionCookie(seeded.observer.userId);
      const buyerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.buyer.joinToken}`,
        { headers: { Cookie: buyerCookie } },
      );
      const observerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.observer.joinToken}`,
        { headers: { Cookie: observerCookie } },
      );
      expect(((await buyerStatus.json()) as { aiAnalysis: { canView: boolean } }).aiAnalysis.canView).toBe(false);
      expect(((await observerStatus.json()) as { aiAnalysis: { canView: boolean } }).aiAnalysis.canView).toBe(false);
    }

    if (scenarioId === "I05") {
      expect(domain.aiInputFingerprint).toBeNull();
      expect(materialsStatusBody.aiAnalysis.status).toBe("COMPLETED");
      expect(materialsStatusBody.aiAnalysis.analysisCurrent).toBe(true);
      expect(materialsStatusBody.postProcessing?.stages.AI_ANALYSIS.semantic).toBe("ready");
    }

    if (scenarioId === "N01") {
      await updateParticipantNotes(seeded.buyer.participantId, "Buyer preparation: target 999");
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.status).toBe("NOT_STARTED");
      expect(after.aiAnalysis.historicalAnalysisExists).toBe(true);
    }

    if (scenarioId === "N02") {
      await updateParticipantNotes(seeded.buyer.participantId, "Buyer preparation: target 999");
      const { spawn } = await import("node:child_process");
      const path = await import("node:path");
      const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
      expect(e2eUrl).toBeTruthy();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            path.join(process.cwd(), "scripts/lab-apply-material-invalidation.ts"),
            seeded.sessionId,
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: e2eUrl, E2E_DATABASE_URL: e2eUrl },
            windowsHide: true,
          },
        );
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`lab-apply-material-invalidation exited ${code}`));
        });
      });
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.status).toBe("NOT_STARTED");
      const buyerCookie = await createUserSessionCookie(seeded.buyer.userId);
      const buyerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.buyer.joinToken}`,
        { headers: { Cookie: buyerCookie } },
      );
      expect(((await buyerStatus.json()) as { aiAnalysis: { canView: boolean } }).aiAnalysis.canView).toBe(false);
    }

    if (scenarioId === "N03") {
      await expect(page.getByTestId("materials-notes-textarea")).toBeVisible();
      await page.getByTestId("materials-notes-textarea").fill("Facilitator debrief note B");
      await page.getByTestId("materials-notes-save-button").click();
      await expect(page.getByText(/notes saved/i)).toBeVisible();
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.status).toBe("COMPLETED");
      expect(after.aiAnalysis.analysisCurrent).toBe(true);
      expect(after.aiAnalysis.isSharedWithSession).toBe(true);
      await expect(page.getByTestId("post-processing-unshare-analysis-button")).toBeVisible();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / N03 / AFTER FACILITATOR NOTE SAVE",
        scenario: "N03",
        substep: "N03",
        changedSincePrevious: "Facilitator notes were saved through the real materials UI.",
        verify: "AI remains current. Publication remains active.",
        resumeWill: "The Lab will leave N03 and seed N04.",
        operatorPrompt: "Inspect facilitator-note result. AI current and publication active. Press Resume when finished.",
      });
    }

    if (scenarioId === "N04") {
      const observerCookie = await createUserSessionCookie(seeded.observer.userId);
      const observerPage = await context.newPage();
      await loginWithCookie(observerPage, observerCookie);
      await observerPage.goto(`/sessions/${seeded.sessionId}/materials`);
      await expect(observerPage.getByTestId("materials-notes-textarea")).toBeVisible();
      await observerPage.getByTestId("materials-notes-textarea").fill("Observer note B");
      await observerPage.getByTestId("materials-notes-save-button").click();
      await expect(observerPage.getByText(/notes saved/i)).toBeVisible();
      const after = await loadFacilitatorStatus();
      expect(after.aiAnalysis.status).toBe("COMPLETED");
      expect(after.aiAnalysis.analysisCurrent).toBe(true);
      expect(after.aiAnalysis.isSharedWithSession).toBe(true);
      const observerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${seeded.observer.joinToken}`,
        { headers: { Cookie: observerCookie } },
      );
      expect(((await observerStatus.json()) as { aiAnalysis: { canView: boolean } }).aiAnalysis.canView).toBe(true);
      await page.bringToFront();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / N04 / AFTER OBSERVER NOTE SAVE",
        scenario: "N04",
        substep: "N04",
        changedSincePrevious: "Observer notes were saved on the observer materials page. Facilitator materials remain open.",
        verify: "AI remains current. Publication remains active. Observer save used the real observer path.",
        resumeWill: "The Lab will leave N04 and seed N05.",
        operatorPrompt: "Inspect observer-note result. AI current and publication active. Press Resume when finished.",
      });
    }

    if (scenarioId === "N05") {
      const buyerPrep = "Buyer preparation: target 120";
      const sellerPrep = "Seller preparation: floor 140";
      const seededBuyerNotes = await query<{ notes: string | null }>(
        `SELECT "notes" FROM "SessionParticipant" WHERE "id" = $1`,
        [seeded.buyer.participantId],
      );
      expect(seededBuyerNotes[0]?.notes).toBe(buyerPrep);
      const beforeDomain = await loadLabDomainSnapshot(seeded.sessionId);
      expect(domain.publicationActive).toBe(false);

      type NotesProjection = {
        postNegotiationNotes?: {
          participantPreparation?: Array<{ participantId: string; notes: string }>;
        };
      };
      async function loadNotesProjection(joinToken: string, cookie: string) {
        const response = await request.get(
          `/api/sessions/${seeded.sessionId}/materials/status?joinToken=${joinToken}`,
          { headers: { Cookie: cookie } },
        );
        expect(response.ok()).toBeTruthy();
        return (await response.json()) as NotesProjection;
      }

      await page.reload();
      await expect(page.getByTestId("session-post-processing-panel")).toBeVisible({
        timeout: 20_000,
      });
      const facilitatorOwn = page.getByTestId("materials-notes-textarea");
      await expect(facilitatorOwn).toBeEditable();
      await expect(facilitatorOwn).toHaveValue("Facilitator debrief note A");
      await setMaterialsNotesDraft(page, "Facilitator N05 permission note");
      await page.getByTestId("materials-notes-save-button").click();
      await expect
        .poll(async () => {
          const rows = await query<{ notes: string | null }>(
            `SELECT "notes" FROM "SessionParticipant" WHERE "id" = $1`,
            [seeded.facilitator.participantId],
          );
          return rows[0]?.notes ?? "";
        })
        .toBe("Facilitator N05 permission note");
      await expect(page.getByTestId("post-meeting-participant-notes")).toBeVisible();
      await expect(page.getByTestId("post-meeting-participant-note-text")).toHaveText([
        buyerPrep,
        sellerPrep,
      ]);
      console.log("FACILITATOR_NOTE_EDIT_AFTER_FINISHED=ALLOWED");
      console.log("FACILITATOR_POST_MEETING_ALL_PARTICIPANT_NOTES_VISIBLE=YES");
      console.log("FACILITATOR_PARTICIPANT_NOTES_READ_ONLY=YES");
      console.log("FACILITATOR_OWN_NOTES_EDITABLE=YES");

      const buyerCookie = await createUserSessionCookie(seeded.buyer.userId);
      const sellerCookie = await createUserSessionCookie(seeded.seller.userId);
      const buyerPage = await context.newPage();
      await loginWithCookie(buyerPage, buyerCookie);
      await buyerPage.goto(`/sessions/${seeded.sessionId}/materials`);
      const buyerNotes = buyerPage.getByTestId("materials-notes-textarea");
      await expect(buyerNotes).toBeVisible();
      await expect(buyerNotes).toHaveValue(buyerPrep);
      await expect(buyerNotes).not.toBeEditable();
      await expect(buyerPage.getByTestId("materials-notes-save-button")).toHaveCount(0);
      await expect(buyerPage.getByTestId("post-meeting-participant-notes")).toHaveCount(0);
      await expect(buyerPage.getByText(sellerPrep)).toHaveCount(0);
      const buyerProjection = await loadNotesProjection(
        seeded.buyer.joinToken,
        buyerCookie,
      );
      const buyerVisible = buyerProjection.postNegotiationNotes?.participantPreparation ?? [];
      expect(buyerVisible.map((note) => note.notes)).toEqual([buyerPrep]);
      expect(buyerVisible.some((note) => note.notes === sellerPrep)).toBe(false);
      const sellerNotesResp = await request.get(
        `/api/sessions/${seeded.sessionId}/participants/${seeded.seller.participantId}/notes?joinToken=${seeded.buyer.joinToken}`,
        { headers: { Cookie: buyerCookie } },
      );
      expect(sellerNotesResp.status()).toBe(403);
      console.log("PARTICIPANT_POST_MEETING_OWN_NOTES_VISIBLE=YES");
      console.log("PARTICIPANT_POST_MEETING_OTHER_PARTICIPANT_NOTES_VISIBLE=NO");
      console.log("PARTICIPANT_POST_MEETING_OWN_NOTES_EDITABLE=NO");
      await pauseCheckpoint(buyerPage, {
        label: "CHECKPOINT D / N05-PARTICIPANT / OWN NOTES READ-ONLY",
        scenario: "N05",
        substep: "N05-PARTICIPANT",
        changedSincePrevious: "Buyer materials show own preparation notes only. Seller notes are absent.",
        verify: "Own notes visible and read-only. No Save. Other participant notes not visible.",
        resumeWill: "The Lab will continue to Participant B privacy and then facilitator inspection.",
        operatorPrompt: "Inspect Participant A materials. Press Resume when ready.",
      });

      const sellerProjection = await loadNotesProjection(
        seeded.seller.joinToken,
        sellerCookie,
      );
      const sellerVisible = sellerProjection.postNegotiationNotes?.participantPreparation ?? [];
      expect(sellerVisible.map((note) => note.notes)).toEqual([sellerPrep]);
      expect(sellerVisible.some((note) => note.notes === buyerPrep)).toBe(false);
      console.log("PARTICIPANT_B_POST_MEETING_OWN_NOTES_ONLY=YES");

      const { spawn } = await import("node:child_process");
      const path = await import("node:path");
      const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
      expect(e2eUrl).toBeTruthy();
      const attempt = await new Promise<{ code: number | null; stdout: string }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              path.join(process.cwd(), "scripts/lab-attempt-participant-notes-write.ts"),
              seeded.buyer.participantId,
              "Buyer N05 direct API write after FINISHED",
            ],
            {
              cwd: process.cwd(),
              env: { ...process.env, DATABASE_URL: e2eUrl, E2E_DATABASE_URL: e2eUrl },
              windowsHide: true,
            },
          );
          let stdout = "";
          child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
          });
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout }));
        },
      );
      expect(attempt.code).toBe(2);
      expect(attempt.stdout).toContain("PREPARATION_LOCKED_AFTER_NEGOTIATION");
      const afterBuyerNotes = await query<{ notes: string | null }>(
        `SELECT "notes" FROM "SessionParticipant" WHERE "id" = $1`,
        [seeded.buyer.participantId],
      );
      expect(afterBuyerNotes[0]?.notes).toBe(buyerPrep);
      console.log("PARTICIPANT_DIRECT_API_WRITE_AFTER_FINISHED=DENIED");
      console.log("PARTICIPANT_NOTE_CONTENT_SURVIVES_LOCK=YES");

      await page.bringToFront();
      await pauseCheckpoint(page, {
        label: "CHECKPOINT D / N05-FACILITATOR / ALL PARTICIPANT NOTES",
        scenario: "N05",
        substep: "N05-FACILITATOR",
        changedSincePrevious: "Facilitator own notes were saved. Participant A/B preparation notes are listed read-only.",
        verify: "Both participant preparation notes visible and read-only. Facilitator own notes still editable.",
        resumeWill: "The Lab will open the authorized observer materials path.",
        operatorPrompt: "Inspect facilitator materials. Press Resume when ready.",
      });

      const observerCookie = await createUserSessionCookie(seeded.observer.userId);
      const observerPage = await context.newPage();
      await loginWithCookie(observerPage, observerCookie);
      await observerPage.goto(`/sessions/${seeded.sessionId}/materials`);
      await expect(observerPage.getByTestId("session-post-processing-panel")).toBeVisible({
        timeout: 20_000,
      });
      await expect(observerPage.getByTestId("post-meeting-participant-notes")).toBeVisible();
      await expect(observerPage.getByTestId("post-meeting-participant-note-text")).toHaveText([
        buyerPrep,
        sellerPrep,
      ]);
      const observerOwn = observerPage.getByTestId("materials-notes-textarea");
      await expect(observerOwn).toBeEditable();
      await expect(observerOwn).toHaveValue("Observer note A");
      await setMaterialsNotesDraft(observerPage, "Observer N05 permission note");
      await observerPage.getByTestId("materials-notes-save-button").click();
      await expect
        .poll(async () => {
          const rows = await query<{ notes: string | null }>(
            `SELECT "notes" FROM "SessionParticipant" WHERE "id" = $1`,
            [seeded.observer.participantId],
          );
          return rows[0]?.notes ?? "";
        })
        .toBe("Observer N05 permission note");
      const observerProjection = await loadNotesProjection(
        seeded.observer.joinToken,
        observerCookie,
      );
      expect(
        (observerProjection.postNegotiationNotes?.participantPreparation ?? []).map(
          (note) => note.notes,
        ),
      ).toEqual([buyerPrep, sellerPrep]);
      const strangerStatus = await request.get(
        `/api/sessions/${seeded.sessionId}/materials/status?joinToken=not-a-session-member`,
      );
      expect(strangerStatus.status()).toBe(403);
      console.log("OBSERVER_NOTE_EDIT_AFTER_FINISHED=ALLOWED");
      console.log("OBSERVER_POST_MEETING_ALL_PARTICIPANT_NOTES_VISIBLE=YES");
      console.log("OBSERVER_PARTICIPANT_NOTES_READ_ONLY=YES");
      console.log("OBSERVER_OWN_NOTES_EDITABLE=YES");
      console.log("UNAUTHORIZED_OBSERVER_PARTICIPANT_NOTES_ACCESS=DENIED");

      const after = await loadFacilitatorStatus();
      const afterDomain = await loadLabDomainSnapshot(seeded.sessionId);
      expect(after.aiAnalysis.status).toBe("COMPLETED");
      expect(after.aiAnalysis.analysisCurrent).toBe(true);
      expect(after.aiAnalysis.isSharedWithSession).not.toBe(true);
      expect(afterDomain.aiInputFingerprint).toBe(beforeDomain.aiInputFingerprint);
      expect(afterDomain.publicationActive).toBe(false);
      console.log("PARTICIPANT_NOTES_VISIBILITY_REQUIRES_AI_PUBLICATION=NO");
      console.log("PARTICIPANT_NOTES_REVEAL_CHANGES_AI_FINGERPRINT=NO");
      console.log(
        "PARTICIPANT_NOTES_POST_MEETING_VISIBILITY_MECHANISM=resolveDebriefVisibleNotes + materials/status.postNegotiationNotes + account materials RSC projection",
      );

      await observerPage.bringToFront();
      console.log("N05=PASS");
      await pauseCheckpoint(observerPage, {
        label: "CHECKPOINT D / N05-OBSERVER / ALL PARTICIPANT NOTES",
        scenario: "N05",
        substep: "N05-OBSERVER",
        changedSincePrevious: "Authorized observer can see both participant preparation notes. Observer own notes were saved. AI publication is not required.",
        verify: "Participant A/B notes visible and read-only. Observer own notes editable. No AI publish requirement.",
        resumeWill: "The Lab will end this headed N05 recheck. It will not mark Checkpoint D accepted.",
        operatorPrompt: "Inspect observer materials. Press Resume when finished.",
      });
    }

    if (scenarioId === "NM01") {
      const before = domain.aiInputFingerprint;
      expect(before).toBeTruthy();
      await query(
        `UPDATE "SessionRole" SET "privateInstructions" = $2 WHERE "sessionId" = $1`,
        [seeded.sessionId, "NM01 unused private instructions"],
      );
      const after = await loadFacilitatorStatus();
      const stamped = await query<{ inputFingerprint: string | null }>(
        `SELECT "inputFingerprint" FROM "AiAnalysis" WHERE "sessionId" = $1`,
        [seeded.sessionId],
      );
      expect(stamped[0]?.inputFingerprint).toBe(before);
      expect(after.aiAnalysis.status).toBe("COMPLETED");
      expect(after.aiAnalysis.analysisCurrent).toBe(true);
      expect(after.aiAnalysis.isSharedWithSession).toBe(true);
    }

    if (scenarioId === "E06" || scenarioId === "E07") {
      expect(materialsStatusBody.transcription.enhancement?.status).toBe("IN_PROGRESS");
      expect(materialsStatusBody.aiAnalysis.canStart).toBe(false);
      const saveAttempt = await request.post(`/api/sessions/${seeded.sessionId}/transcript`, {
        headers: { Cookie: seeded.facilitatorAuthCookie },
        data: {
          joinToken: seeded.facilitator.joinToken,
          text: "This colliding edit must be rejected while enhancement is RUNNING.",
        },
      });
      expect(saveAttempt.status()).toBe(409);
      await expect(page.getByTestId("save-transcript-button")).toHaveCount(0);
    }

    const usefulPipelinePause = ["AM01", "AM03", "AM05", "AM07", "AM11"].includes(
      scenarioId,
    );
    if (
      pauseEnabled &&
      !headedCheckpointDScenarios.has(scenarioId) &&
      !headedCheckpointEScenarios.has(scenarioId) &&
      (!isPipelineLabScenario(scenarioId) || usefulPipelinePause)
    ) {
      console.log(
        [
          "",
          "LAB PAUSED — headed Chromium is waiting.",
          `FIXTURE_CLASS=${isPipelineLabScenario(scenarioId) ? "PIPELINE_FIXTURE" : "STATE_FIXTURE"}`,
          "Materials: this tab.",
          "Sessions list: the second tab.",
          "Resume the Playwright inspector to continue.",
          "Re-run: npm run lab:post-transcription -- " + scenarioId,
          "",
        ].join("\n"),
      );
      await page.pause();
    }
  });
}
