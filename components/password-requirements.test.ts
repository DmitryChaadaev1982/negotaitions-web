import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PasswordRequirements } from "@/components/password-requirements";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { I18nProvider } from "@/lib/i18n/useI18n";
import {
  evaluatePasswordChecklist,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordCodePointLength,
  projectPasswordServerChecks,
} from "@/lib/auth/password-policy-constants";
import { passwordPolicyMessageKey } from "@/lib/auth/password-policy";

const ROOT = process.cwd();
const EMOJI = "😀";

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function renderChecklist(
  password: string,
  confirmation: string,
  server?: {
    locale?: "ru" | "en";
    submittedPassword?: string | null;
    serverSuccess?: boolean;
    serverError?: string | null;
  },
) {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { initialLocale: server?.locale ?? "ru" },
      createElement(PasswordRequirements, {
        password,
        confirmation,
        submittedPassword: server?.submittedPassword,
        serverSuccess: server?.serverSuccess,
        serverError: server?.serverError,
      }),
    ),
  );
}

function stateOf(markup: string, requirementId: string) {
  const match = markup.match(
    new RegExp(
      `data-testid="password-requirement-${requirementId}"[^>]*data-state="(neutral|met|unmet)"`,
    ),
  );
  assert.ok(match, `missing ${requirementId} state`);
  return match[1];
}

test("C01 9 code points leave the minimum unsatisfied", () => {
  const password = "a".repeat(9);
  assert.equal(passwordCodePointLength(password), 9);
  assert.equal(evaluatePasswordChecklist({ password, confirmation: "" }).minLength, "unmet");
  assert.equal(stateOf(renderChecklist(password, ""), "minLength"), "unmet");
});

test("C02 10 code points satisfy the minimum", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  assert.equal(evaluatePasswordChecklist({ password, confirmation: "" }).minLength, "met");
  assert.equal(stateOf(renderChecklist(password, ""), "minLength"), "met");
});

test("C03 128 code points satisfy the maximum", () => {
  const password = "a".repeat(PASSWORD_MAX_LENGTH);
  assert.equal(evaluatePasswordChecklist({ password, confirmation: "" }).maxLength, "met");
  assert.equal(stateOf(renderChecklist(password, ""), "maxLength"), "met");
});

test("C04 129 code points leave the maximum unsatisfied", () => {
  const password = "a".repeat(PASSWORD_MAX_LENGTH + 1);
  assert.equal(evaluatePasswordChecklist({ password, confirmation: "" }).maxLength, "unmet");
  const markup = renderChecklist(password, "");
  assert.equal(stateOf(markup, "maxLength"), "unmet");
  assert.doesNotMatch(markup, /text-red-|text-rose-/);
});

test("C05 non-BMP characters follow Unicode code-point length", () => {
  const nine = EMOJI.repeat(9);
  const ten = EMOJI.repeat(10);
  assert.equal(nine.length, 18);
  assert.equal(passwordCodePointLength(nine), 9);
  assert.equal(passwordCodePointLength(ten), 10);
  assert.equal(evaluatePasswordChecklist({ password: nine, confirmation: "" }).minLength, "unmet");
  assert.equal(evaluatePasswordChecklist({ password: ten, confirmation: "" }).minLength, "met");

  const max = EMOJI.repeat(PASSWORD_MAX_LENGTH);
  const over = EMOJI.repeat(PASSWORD_MAX_LENGTH + 1);
  assert.equal(max.length, PASSWORD_MAX_LENGTH * 2);
  assert.equal(evaluatePasswordChecklist({ password: max, confirmation: "" }).maxLength, "met");
  assert.equal(evaluatePasswordChecklist({ password: over, confirmation: "" }).maxLength, "unmet");
  assert.equal(stateOf(renderChecklist(nine, ""), "minLength"), "unmet");
  assert.equal(stateOf(renderChecklist(ten, ""), "minLength"), "met");
});

test("C06 confirmation match transitions without failing an empty field", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  assert.deepEqual(
    evaluatePasswordChecklist({ password: "", confirmation: "" }).match,
    "neutral",
  );
  assert.equal(
    evaluatePasswordChecklist({ password, confirmation: "" }).match,
    "neutral",
  );
  assert.equal(
    evaluatePasswordChecklist({ password, confirmation: password }).match,
    "met",
  );
  assert.equal(
    evaluatePasswordChecklist({ password, confirmation: `${password}x` }).match,
    "unmet",
  );
  assert.equal(
    evaluatePasswordChecklist({ password, confirmation: "" }).match,
    "neutral",
  );

  const empty = renderChecklist("", "");
  assert.equal(stateOf(empty, "minLength"), "neutral");
  assert.equal(stateOf(empty, "maxLength"), "neutral");
  assert.equal(stateOf(empty, "match"), "neutral");
  assert.doesNotMatch(empty, /text-red-|text-rose-/);
  assert.equal(stateOf(renderChecklist(password, password), "match"), "met");
  assert.equal(stateOf(renderChecklist(password, `${password}x`), "match"), "unmet");
});

test("C07 common_password maps to a safe localized message", () => {
  assert.equal(passwordPolicyMessageKey("common_password"), "auth.passwordCommon");
  assert.equal(ru.auth.passwordCommon, "Этот пароль слишком распространён. Выберите другой.");
  assert.equal(en.auth.passwordCommon, "This password is too common. Choose a different password.");
  assert.doesNotMatch(`${ru.auth.passwordCommon} ${en.auth.passwordCommon}`, /blocklist|слот|bcrypt|argon|hash/i);
});

test("C08 password_reused maps to a safe localized message", () => {
  assert.equal(passwordPolicyMessageKey("password_reused"), "auth.passwordReused");
  assert.equal(ru.auth.passwordReused, "Этот пароль использовался ранее. Выберите новый.");
  assert.equal(en.auth.passwordReused, "This password was used previously. Choose a new password.");
  assert.doesNotMatch(
    `${ru.auth.passwordReused} ${en.auth.passwordReused}`,
    /third|slot|слот|bcrypt|argon|generation|history index/i,
  );
});

test("C09 C10 C11 password forms share the client-safe checklist projection", () => {
  const forms = [
    "app/(auth)/register/page.tsx",
    "components/account-settings-view.tsx",
    "components/reset-password-form.tsx",
  ];
  for (const form of forms) {
    const source = read(form);
    assert.match(source, /PasswordRequirements/);
    assert.doesNotMatch(source, /minLength=/);
    assert.doesNotMatch(source, /maxLength=\{(?:PASSWORD_MAX_LENGTH|128)\}/);
    assert.doesNotMatch(source, /PASSWORD_MIN_LENGTH|PASSWORD_MAX_LENGTH/);
    assert.doesNotMatch(source, /Array\.from\(/);
  }

  const checklist = read("components/password-requirements.tsx");
  assert.match(checklist, /password-policy-constants/);
  assert.match(checklist, /PASSWORD_MIN_LENGTH/);
  assert.match(checklist, /PASSWORD_MAX_LENGTH/);
  assert.match(checklist, /evaluatePasswordChecklist/);
});

test("C12 the checklist boundary does not import the server blocklist", () => {
  const files = [
    "components/password-requirements.tsx",
    "lib/auth/password-policy-constants.ts",
    "app/(auth)/register/page.tsx",
    "components/account-settings-view.tsx",
    "components/reset-password-form.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /common-password-blocklist|common-passwords|password-history|readFileSync|from "@\/lib\/auth\/password-policy"/,
      file,
    );
  }
});

test("C13 server-only checklist items stay unconfirmed before server validation", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  const markup = renderChecklist(password, password);
  assert.equal(stateOf(markup, "minLength"), "met");
  assert.equal(stateOf(markup, "maxLength"), "met");
  assert.equal(stateOf(markup, "match"), "met");
  assert.equal(stateOf(markup, "common"), "neutral");
  assert.equal(stateOf(markup, "reused"), "neutral");
  assert.match(markup, /Пароль не является распространённым/);
  assert.match(markup, /Пароль не использовался ранее/);
  assert.doesNotMatch(markup, /password-server-only-note/);
  assert.doesNotMatch(markup, /Пароль также не должен быть распространённым/);
  assert.equal(
    projectPasswordServerChecks({
      password,
      submittedPassword: null,
      success: true,
    }).common,
    "neutral",
  );

  const english = renderChecklist(password, password, { locale: "en" });
  assert.match(english, /Password is not a common password/);
  assert.match(english, /Password has not been used before/);
  assert.doesNotMatch(english, /Пароль не является распространённым/);
  assert.equal(ru.auth.passwordRequirementCommon, "Пароль не является распространённым");
  assert.equal(ru.auth.passwordRequirementReused, "Пароль не использовался ранее");
  assert.equal(en.auth.passwordRequirementCommon, "Password is not a common password");
  assert.equal(en.auth.passwordRequirementReused, "Password has not been used before");
});

test("C14 common_password marks only the common-password checklist item", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  const projected = projectPasswordServerChecks({
    password,
    submittedPassword: password,
    error: "auth.passwordCommon",
  });
  assert.deepEqual(projected, { common: "unmet", reused: "neutral" });
  const markup = renderChecklist(password, password, {
    submittedPassword: password,
    serverError: "auth.passwordCommon",
  });
  assert.equal(stateOf(markup, "common"), "unmet");
  assert.equal(stateOf(markup, "reused"), "neutral");
  assert.equal(stateOf(markup, "match"), "met");
  assert.doesNotMatch(markup, /text-red-|text-rose-/);
});

test("C15 password_reused marks the previous-password item and not the match item", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  const projected = projectPasswordServerChecks({
    password,
    submittedPassword: password,
    error: "auth.passwordReused",
  });
  assert.deepEqual(projected, { common: "met", reused: "unmet" });
  const markup = renderChecklist(password, password, {
    submittedPassword: password,
    serverError: "auth.passwordReused",
  });
  assert.equal(stateOf(markup, "reused"), "unmet");
  assert.equal(stateOf(markup, "common"), "met");
  assert.equal(stateOf(markup, "match"), "met");

  const edited = projectPasswordServerChecks({
    password: `${password}x`,
    submittedPassword: password,
    error: "auth.passwordReused",
  });
  assert.deepEqual(edited, { common: "neutral", reused: "neutral" });
});

test("C16 a successful server result confirms both server-only items for that password", () => {
  const password = "a".repeat(PASSWORD_MIN_LENGTH);
  const projected = projectPasswordServerChecks({
    password,
    submittedPassword: password,
    success: true,
  });
  assert.deepEqual(projected, { common: "met", reused: "met" });
  const markup = renderChecklist(password, password, {
    submittedPassword: password,
    serverSuccess: true,
  });
  assert.equal(stateOf(markup, "common"), "met");
  assert.equal(stateOf(markup, "reused"), "met");
});
