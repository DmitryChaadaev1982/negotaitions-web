import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

test("materials destination actions use generic RU and EN labels", () => {
  assert.equal(ru.room.viewMaterials, "Просмотреть материалы");
  assert.equal(en.room.viewMaterials, "View materials");
  assert.equal(ru.sessionMaterials.viewMaterials, "Просмотреть материалы");
  assert.equal(en.sessionMaterials.viewMaterials, "View materials");
});

test("AI publication and administrative action labels remain specific", () => {
  assert.equal(ru.room.runAiAnalysis, "Запустить ИИ-разбор");
  assert.equal(en.room.runAiAnalysis, "Run AI analysis");
  assert.equal(ru.room.shareWithParticipants, "Опубликовать для участников");
  assert.equal(en.room.shareWithParticipants, "Share with participants");
  assert.equal(ru.room.aiAnalysisNotShared, "ИИ-разбор пока не опубликован фасилитатором.");
  assert.equal(en.room.aiAnalysisNotShared, "AI analysis has not been shared yet.");
});

test("UX-03 skip copy distinguishes first skip from skip that keeps prior enhanced publication", () => {
  assert.equal(ru.sessionMaterials.enhancementStatusSkipped, "ИИ-улучшение пропущено");
  assert.equal(en.sessionMaterials.enhancementStatusSkipped, "AI enhancement was skipped");
  assert.equal(
    ru.sessionMaterials.enhancementStatusSkippedRetainingPrior,
    "Новая попытка ИИ-улучшения пропущена. Используется ранее улучшенный текст.",
  );
  assert.equal(
    en.sessionMaterials.enhancementStatusSkippedRetainingPrior,
    "The new AI improvement attempt was skipped. The previously improved text is still in use.",
  );
});

test("AI enhancement start vs retry labels follow history, not availability", () => {
  assert.equal(ru.sessionMaterials.runTranscriptEnhancement, "Запустить ИИ-улучшение");
  assert.equal(en.sessionMaterials.runTranscriptEnhancement, "Start AI enhancement");
  assert.equal(ru.sessionMaterials.retryTranscriptEnhancement, "Повторить ИИ-улучшение");
  assert.equal(en.sessionMaterials.retryTranscriptEnhancement, "Retry AI enhancement");
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(panel, /enhancementStartActionCopyKey/);
  assert.doesNotMatch(
    panel,
    /canRetryTranscriptEnhancement\s*\?\s*t\("sessionMaterials\.retryTranscriptEnhancement"\)/,
  );
});

test("participant and facilitator debrief materials action uses its generic dictionary key", () => {
  const source = readFileSync(
    "components/session-post-processing-panel.tsx",
    "utf8",
  );

  assert.match(source, /t\("room\.viewMaterials"\)/);
  assert.doesNotMatch(source, /isFacilitator[\s\S]{0,120}room\.openSessionMaterials/);
  assert.doesNotMatch(source, /viewSharedAiAnalysis|viewSharedReport/);
  assert.doesNotMatch(source, /View shared AI analysis|Посмотреть общий AI-разбор/);
});
