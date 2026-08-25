import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildAdminActionFormData,
  shouldConfirmAdminAction,
  wantsAdminActionComment,
} from "@/lib/admin-user-action-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyLinkFallbackDialog } from "@/components/copy-link-fallback-dialog";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { checkNativeDialogs } from "../scripts/check-native-dialogs-lib.mjs";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const labels = {
  approve: en.admin.approve,
  reject: en.admin.reject,
  block: en.admin.block,
  unblock: en.admin.unblock,
  makeAdmin: en.admin.makeAdmin,
  removeAdmin: en.admin.removeAdmin,
  approvalComment: en.admin.approvalComment,
  confirmAction: en.admin.confirmAction,
  confirmUndoWarning: en.admin.actionCannotBeUndone,
  administrator: en.admin.administrator,
};

test("C01 admin destructive action opens app dialog, not native confirm", () => {
  const source = read("components/admin-user-row-actions.tsx");
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /window\.prompt/);
  assert.match(source, /ConfirmDialog/);
  assert.match(source, /admin-user-action-dialog/);
  assert.equal(shouldConfirmAdminAction("reject"), true);
  assert.equal(shouldConfirmAdminAction("block"), true);

  const markup = renderToStaticMarkup(
    createElement(ConfirmDialog, {
      open: true,
      title: labels.reject,
      description: labels.confirmUndoWarning,
      cancelLabel: en.common.cancel,
      confirmLabel: labels.reject,
      testId: "admin-user-action-dialog",
      onCancel() {},
      onConfirm() {},
    }),
  );
  assert.match(markup, /role="alertdialog"/);
  assert.match(markup, /data-testid="admin-user-action-dialog"/);
  assert.match(markup, /This action cannot be undone/);
  assert.doesNotMatch(markup, /window\.confirm/);
});

test("C02 optional admin comment is passed correctly", () => {
  assert.equal(wantsAdminActionComment("approve"), true);
  assert.equal(wantsAdminActionComment("makeAdmin"), false);

  const formData = buildAdminActionFormData("user-1", "  please review  ");
  assert.equal(formData.get("userId"), "user-1");
  assert.equal(formData.get("comment"), "please review");

  const empty = buildAdminActionFormData("user-1", "   ");
  assert.equal(empty.get("comment"), "");
});

test("C03 Cancel does not submit", () => {
  const source = read("components/admin-user-row-actions.tsx");
  const cancelBlock = source.slice(
    source.indexOf("const cancelAction"),
    source.indexOf("const confirmAction"),
  );
  const confirmBlock = source.slice(source.indexOf("const confirmAction"));
  assert.doesNotMatch(cancelBlock, /getAdminActionServerAction/);
  assert.match(confirmBlock, /getAdminActionServerAction\(action\)\(formData\)/);
  assert.match(source, /onCancel=\{dialog.cancelAction\}/);
  assert.match(source, /onConfirm=\{dialog.confirmAction\}/);
});

test("C04 Event list complete uses app dialog", () => {
  const source = read("components/events-list-view.tsx");
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /ConfirmDialog/);
  assert.match(source, /event-complete-list-confirm-dialog/);
  assert.match(source, /events\.completeEventTitle/);
  assert.match(source, /events\.completeEventWarning/);
  assert.match(source, /completeTrainingEventFromList/);
});

test("C05 clipboard failure opens application fallback with selectable URL", () => {
  const joinSource = read("components/copy-join-link-button.tsx");
  const sessionSource = read("components/session-detail-view.tsx");
  assert.doesNotMatch(joinSource, /window\.prompt/);
  assert.doesNotMatch(sessionSource, /window\.prompt/);
  assert.match(joinSource, /CopyLinkFallbackDialog/);
  assert.match(sessionSource, /CopyLinkFallbackDialog/);

  const markup = renderToStaticMarkup(
    createElement(CopyLinkFallbackDialog, {
      open: true,
      title: en.common.copyJoinLinkPrompt,
      description: en.common.copyLinkFallbackBody,
      url: "https://example.test/join",
      closeLabel: en.common.close,
      onClose() {},
    }),
  );
  assert.match(markup, /data-testid="copy-link-fallback-dialog"/);
  assert.match(markup, /data-testid="copy-link-fallback-url"/);
  assert.match(markup, /value="https:\/\/example.test\/join"/);
  assert.match(markup, /readOnly/);
});

test("C06 native-dialog scanner has no production exceptions", () => {
  const result = checkNativeDialogs({ repositoryRoot: ROOT });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.occurrences.length, 0);
  const allowlist = JSON.parse(read("scripts/native-dialog-allowlist.json")) as {
    exceptions: unknown[];
  };
  assert.deepEqual(allowlist.exceptions, []);
});

test("CU-C copy and role strings exist in RU/EN", () => {
  assert.equal(en.room.assignRolesBeforePreparation, "Assign participants to roles first.");
  assert.equal(ru.room.assignRolesBeforePreparation, "Сначала распределите участников по ролям.");
  assert.equal(en.recording.insertManualSpeakerTurnAfter, "Insert after");
  assert.equal(ru.recording.insertManualSpeakerTurnAfter, "Вставить после");
});
