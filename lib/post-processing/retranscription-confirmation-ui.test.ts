import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

const ROOT = process.cwd();

function readPanel() {
  return readFileSync(join(ROOT, "components/session-post-processing-panel.tsx"), "utf8");
}

test("RERUN source: facilitator rerun uses site ConfirmDialog instead of inline amber confirm", () => {
  const panel = readPanel();
  assert.match(panel, /import \{ ConfirmDialog \} from "@\/components\/confirm-dialog"/);
  assert.match(panel, /testId="retranscribe-confirm-dialog"/);
  assert.match(panel, /recording\.rerunTranscriptionConfirmTitle/);
  assert.match(panel, /sessionMaterials\.rerunTranscriptionConfirmBody/);
  assert.match(panel, /onClick=\{\(\) => setRerunConfirmOpen\(true\)\}/);
  assert.doesNotMatch(panel, /post-processing-confirm-rerun-button/);
  assert.doesNotMatch(
    panel,
    /rerunConfirmOpen \? \([\s\S]*?bg-amber-950\/20/,
  );
  assert.doesNotMatch(panel, /canRerunTranscription && !rerunConfirmOpen/);
});

test("RERUN source: original button stays on the steps card and POST waits for confirm", () => {
  const panel = readPanel();
  assert.match(panel, /data-testid="post-processing-rerun-transcription-button"/);
  assert.match(panel, /materialsRetranscribePath\(sessionId\)/);
  assert.match(panel, /reason: "manual_rerun"/);
  assert.match(panel, /if \(rerunBusy\) \{\s*return;/);
  assert.match(panel, /getTranscriptionSectionRefreshKey\(/);
});

test("RERUN copy reuses existing RU/EN confirmation wording", () => {
  assert.equal(ru.recording.rerunTranscriptionConfirmTitle, "Повторить транскрибацию?");
  assert.equal(en.recording.rerunTranscriptionConfirmTitle, "Re-run transcription?");
  assert.equal(ru.recording.rerunTranscriptionConfirm, "Повторить транскрибацию");
  assert.equal(en.recording.rerunTranscriptionConfirm, "Re-run transcription");
  assert.equal(ru.recording.rerunTranscriptionCancel, "Отмена");
  assert.equal(en.recording.rerunTranscriptionCancel, "Cancel");
  assert.match(ru.sessionMaterials.rerunTranscriptionConfirmBody, /Будет создана новая версия транскрипта/);
  assert.match(en.sessionMaterials.rerunTranscriptionConfirmBody, /A new transcript version will be created/);
});

test("ConfirmDialog is recognizable when open and absent when closed", () => {
  const closed = renderToStaticMarkup(
    createElement(ConfirmDialog, {
      open: false,
      title: en.recording.rerunTranscriptionConfirmTitle,
      description: en.sessionMaterials.rerunTranscriptionConfirmBody,
      cancelLabel: en.recording.rerunTranscriptionCancel,
      confirmLabel: en.recording.rerunTranscriptionConfirm,
      testId: "retranscribe-confirm-dialog",
      onCancel() {},
      onConfirm() {},
    }),
  );
  assert.equal(closed, "");

  const open = renderToStaticMarkup(
    createElement(ConfirmDialog, {
      open: true,
      title: en.recording.rerunTranscriptionConfirmTitle,
      description: en.sessionMaterials.rerunTranscriptionConfirmBody,
      cancelLabel: en.recording.rerunTranscriptionCancel,
      confirmLabel: en.recording.rerunTranscriptionConfirm,
      testId: "retranscribe-confirm-dialog",
      onCancel() {},
      onConfirm() {},
    }),
  );
  assert.match(open, /role="alertdialog"/);
  assert.match(open, /data-testid="retranscribe-confirm-dialog"/);
  assert.match(open, /Re-run transcription\?/);
  assert.match(open, /Cancel/);
  assert.match(
    open,
    /<button[^>]*>Cancel<\/button>[\s\S]*<button[^>]*>Re-run transcription<\/button>/,
  );
});
