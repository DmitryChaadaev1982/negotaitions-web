import assert from "node:assert/strict";
import test from "node:test";

import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  flattenAllLegalText,
  getLegalDocument,
  LEGAL_DOCUMENT_ROUTES,
} from "@/lib/legal/documents";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_DOCUMENT_UPDATED_ON,
  LEGAL_DOCUMENT_VERSION,
  LEGAL_OPERATOR_EN,
  LEGAL_OPERATOR_EN_LEGAL,
  LEGAL_OPERATOR_RU,
  LEGAL_PRODUCT_EN,
  LEGAL_PRODUCT_RU,
  formatLegalUpdatedOn,
} from "@/lib/legal/meta";
import { flattenLegalText } from "@/lib/legal/types";
import { CURRENT_LEGAL_RELEASE } from "@/lib/legal/release";

const ruLegal = flattenAllLegalText("ru");
const enLegal = flattenAllLegalText("en");
const ruRegister = JSON.stringify({
  consent: getDictionary("ru").legal,
  support: getDictionary("ru").publicSupport,
  banner: getDictionary("ru").legal.cookieBannerText,
});
const enRegister = JSON.stringify({
  consent: getDictionary("en").legal,
  support: getDictionary("en").publicSupport,
  banner: getDictionary("en").legal.cookieBannerText,
});

const publicLegalAndRegistrationRu = `${ruLegal}\n${ruRegister}`;
const publicLegalAndRegistrationEn = `${enLegal}\n${enRegister}`;

test("legal documents identify the operator, product, contact, and version 2", () => {
  assert.match(ruLegal, new RegExp(LEGAL_OPERATOR_RU));
  assert.match(ruLegal, new RegExp(LEGAL_PRODUCT_RU.replace("(", "\\(").replace(")", "\\)")));
  assert.match(ruLegal, new RegExp(LEGAL_CONTACT_EMAIL));
  assert.equal(LEGAL_DOCUMENT_VERSION, "2");

  assert.match(enLegal, new RegExp(LEGAL_OPERATOR_EN));
  assert.match(enLegal, new RegExp(LEGAL_OPERATOR_EN_LEGAL.replace("(", "\\(").replace(")", "\\)")));
  assert.match(enLegal, new RegExp(LEGAL_PRODUCT_EN));
  assert.match(enLegal, new RegExp(LEGAL_CONTACT_EMAIL));
  assert.doesNotMatch(enLegal, /ПереговорИИ/);
});

test("public legal copy names current production providers and not stale ones", () => {
  for (const text of [ruLegal, enLegal]) {
    assert.match(text, /Voximplant/);
    assert.match(text, /Yandex SpeechKit/);
    assert.match(text, /Yandex Object Storage/);
    assert.match(text, /Yandex Cloud Postbox/);
    assert.match(text, /Yandex Data Streams/);
    assert.match(text, /Yandex Managed PostgreSQL/);
    assert.doesNotMatch(text, /LiveKit/);
    assert.doesNotMatch(text, /Whisper/);
    assert.doesNotMatch(text, /OpenAI/);
    assert.doesNotMatch(text, /\bYDB\b/);
  }
});

test("public legal and registration copy does not claim RF-only processing", () => {
  const staleClaims = [
    "данные хранятся и обрабатываются на инфраструктуре, размещённой в Российской Федерации",
    "Data is stored and processed on infrastructure located in the Russian Federation",
    "Я понимаю, что данные хранятся и обрабатываются на инфраструктуре, размещённой в Российской Федерации",
    "I understand that data is stored and processed on infrastructure located in the Russian Federation",
  ];
  for (const claim of staleClaims) {
    assert.equal(publicLegalAndRegistrationRu.includes(claim), false, claim);
    assert.equal(publicLegalAndRegistrationEn.includes(claim), false, claim);
  }
  assert.match(
    ruLegal,
    /не утверждает, что все персональные данные обрабатываются исключительно на территории Российской Федерации/,
  );
  assert.match(
    enLegal,
    /does not state that all personal data is processed only in the Russian Federation/,
  );
});

test("cookie policy describes actual browser storage and not guest tokens", () => {
  const ruCookies = flattenAllLegalText("ru");
  assert.match(ruCookies, /auth_session/);
  assert.match(ruCookies, /negotaitions_locale/);
  assert.match(ruCookies, /negotaitions\.cookieConsent\.v1/);
  assert.match(ruCookies, /negotaitions\.recovery\.v1/);
  assert.match(ruCookies, /negotiations\.session-left:/);
  assert.match(ruCookies, /localStorage/);
  assert.match(ruCookies, /sessionStorage/);
  assert.match(ruCookies, /Гостевые токены доступа в этом хранилище не сохраняются/);
  assert.doesNotMatch(ruCookies, /Хранит токены доступа к текущей сессии для гостевого переподключения/);

  const enCookies = flattenAllLegalText("en");
  assert.match(enCookies, /Guest access tokens are not stored in this key/);
  assert.doesNotMatch(enCookies, /Stores access tokens for the current session to allow guest reconnection/);
});

test("privacy policy describes request-based deletion and grant-based AI access", () => {
  assert.match(ruLegal, /Самостоятельная кнопка удаления аккаунта в сервисе не предоставляется/);
  assert.match(enLegal, /There is no self-service Delete Account button/);
  assert.match(ruLegal, /Наблюдатели не получают персональную обратную связь других участников/);
  assert.match(enLegal, /Observers do not receive other participants. personal feedback/);
  assert.doesNotMatch(ruLegal, /Доступ к записям имеет только фасилитатор/);
  assert.doesNotMatch(enLegal, /Only the session facilitator can access recordings/);
});

test("legal-update copy is present and EN UI branding stays Latin", () => {
  const ru = getDictionary("ru").legalUpdate;
  const en = getDictionary("en").legalUpdate;
  assert.equal(ru.title, "Обновлены условия использования и обработки данных");
  assert.match(ru.body, /ПереговорИИ \(NegotAItions\)/);
  assert.equal(ru.confirm, "Подтвердить и продолжить");
  assert.equal(en.title, "Updated terms of use and data processing");
  assert.equal(en.confirm, "Confirm and continue");
  assert.doesNotMatch(en.body, /ПереговорИИ|Чаадаев/);
});

test("registration v2 checkbox text is specific and does not claim RF-only processing", () => {
  const ru = getDictionary("ru").legal;
  const en = getDictionary("en").legal;
  assert.equal(
    ru.consentTermsPrivacy,
    "Я принимаю Пользовательское соглашение и подтверждаю, что ознакомился с Политикой обработки персональных данных.",
  );
  assert.equal(
    en.consentTermsPrivacy,
    "I accept the Terms of Use and confirm that I have reviewed the Privacy Policy.",
  );
  assert.equal(
    ru.consentPersonalDataProcessing,
    "Я даю согласие на обработку моих персональных данных на условиях документа «Согласие на обработку персональных данных».",
  );
  assert.equal(
    `${ru.consentPersonalDataStart}${ru.dataProcessingConsent}${ru.consentPersonalDataEnd}`,
    ru.consentPersonalDataProcessing,
  );
  assert.equal(
    en.consentPersonalDataProcessing,
    "I consent to the processing of my personal data on the terms of the Personal Data Processing Consent.",
  );
  assert.equal(
    `${en.consentPersonalDataStart}${en.dataProcessingConsent}${en.consentPersonalDataEnd}`,
    en.consentPersonalDataProcessing,
  );
  assert.doesNotMatch(ru.consentPersonalDataStart, /на условиях Согласие на обработку/);
  assert.doesNotMatch(
    ru.consentPersonalDataProcessing,
    /на условиях Согласие на обработку/,
  );
  assert.doesNotMatch(
    `${ru.consentPersonalDataStart}${ru.dataProcessingConsent}`,
    /на условиях Согласие на обработку/,
  );
  assert.equal(
    ru.consentTrainingSessionNotice,
    "Я подтверждаю, что ознакомлен с тем, что участие в учебных переговорах может включать аудиозапись, транскрибацию, улучшение транскрипта и ИИ-анализ с использованием внешних сервисов, как описано в Уведомлении об ИИ и внешних сервисах.",
  );
  assert.equal(
    en.consentTrainingSessionNotice,
    "I confirm that I understand that participation in training negotiations may include audio recording, transcription, transcript enhancement, and AI analysis using external services, as described in the AI & External Services Notice.",
  );
  assert.doesNotMatch(ru.consentTrainingSessionNotice, /чувствительн|секретн/);
  assert.doesNotMatch(en.consentTrainingSessionNotice, /sensitive|secret/);
  assert.doesNotMatch(ru.consentTrainingSessionNotice, /Российской Федерации/);
  assert.doesNotMatch(en.consentTrainingSessionNotice, /Russian Federation/);
  assert.equal(
    `${ru.consentTermsPrivacyStart}${ru.termsOfUse}${ru.consentTermsPrivacyMiddle}${ru.consentPrivacyPolicyLink}${ru.consentTermsPrivacyEnd}`,
    ru.consentTermsPrivacy,
  );
});

test("privacy distinguishes technical-log IP from hashed application records", () => {
  assert.match(ruLegal, /IP-адрес в технических журналах веб-сервера и безопасности/);
  assert.match(
    ruLegal,
    /хеш, отпечаток или иное преобразованное значение, полученное из IP-адреса/,
  );
  assert.match(enLegal, /IP address in web-server and security technical logs/);
  assert.match(
    enLegal,
    /hash, fingerprint, or other transformed IP-derived value/,
  );
  assert.doesNotMatch(ruLegal, /исходный IP-адрес в таком виде не хранится/);
  assert.doesNotMatch(ruLegal, /исходный IP-адрес никогда не хранится/);
  assert.doesNotMatch(enLegal, /the raw IP address is not stored/);
  assert.doesNotMatch(enLegal, /raw IP address is never stored/);
});

test("public legal copy does not assign the database an unconfirmed precise region", () => {
  assert.match(ruLegal, /зона виртуальной машины ru-central1-b/);
  assert.match(ruLegal, /Yandex Object Storage, регион ru-central1/);
  assert.match(ruLegal, /Yandex Managed PostgreSQL/);
  assert.match(enLegal, /virtual-machine zone ru-central1-b/);
  assert.match(enLegal, /Yandex Object Storage, region ru-central1/);
  assert.match(enLegal, /Yandex Managed PostgreSQL/);
  assert.doesNotMatch(ruLegal, /база данных[^\n]*ru-central1/);
  assert.doesNotMatch(ruLegal, /PostgreSQL[^\n]*ru-central1/);
  assert.doesNotMatch(enLegal, /database[^\n]*ru-central1/i);
  assert.doesNotMatch(enLegal, /PostgreSQL[^\n]*ru-central1/);
});

test("public legal copy does not use internal audit or fallback-code wording", () => {
  assert.doesNotMatch(ruLegal, /неиспользуемых альтернативных реализаций/);
  assert.doesNotMatch(ruLegal, /Неиспользуемые альтернативные реализации в исходном коде/);
  assert.doesNotMatch(enLegal, /Unused alternative implementations/);
  assert.doesNotMatch(ruLegal, /Исторические записи версии 1 не переписываются/);
  assert.doesNotMatch(enLegal, /Historical version 1 rows are not rewritten/);
  assert.doesNotMatch(
    ruLegal,
    /Отдельное уведомление уполномоченного органа о трансграничной передаче/,
  );
  assert.doesNotMatch(
    enLegal,
    /notification to the competent authority about cross-border transfer is not described/,
  );
  assert.doesNotMatch(ruLegal, /ИНН/);
  assert.doesNotMatch(ruLegal, /ОГРН/);
  assert.match(ruLegal, /География обработки на стороне Voximplant уточняется/);
  assert.match(
    ruLegal,
    /требования законодательства Российской Федерации о трансграничной передаче персональных данных/,
  );
  assert.match(enLegal, /Voximplant processing geography is being clarified/);
  assert.match(
    enLegal,
    /legislation on cross-border transfer of personal data/,
  );
});

test("standalone consent lists destruction and does not treat Privacy as acceptance", () => {
  assert.match(ruLegal, /блокирование, удаление, уничтожение и обезличивание/);
  assert.match(enLegal, /block, delete, destroy, and anonymize/);
  assert.match(
    ruLegal,
    /Принятие Пользовательского соглашения и ознакомление с Политикой обработки персональных данных не заменяет настоящее согласие/,
  );
  assert.doesNotMatch(
    ruLegal,
    /Принятие Пользовательского соглашения и Политики обработки персональных данных не заменяет/,
  );
  assert.match(
    enLegal,
    /Accepting the Terms of Use and reviewing the Privacy Policy does not replace this consent/,
  );
});

test("each public legal document has non-empty RU and EN bodies with structural parity", () => {
  assert.equal(LEGAL_DOCUMENT_VERSION, "2");
  assert.equal(LEGAL_DOCUMENT_UPDATED_ON, "2026-08-17");
  assert.equal(formatLegalUpdatedOn("ru"), "17 августа 2026 г.");
  assert.equal(formatLegalUpdatedOn("en"), "17 August 2026");
  assert.equal(CURRENT_LEGAL_RELEASE.id, "2026-08-v2");
  assert.equal(CURRENT_LEGAL_RELEASE.legalVersion, "2");

  for (const route of LEGAL_DOCUMENT_ROUTES) {
    const ru = getLegalDocument(route, "ru");
    const en = getLegalDocument(route, "en");
    assert.equal(ru.route, route);
    assert.equal(en.route, route);
    assert.ok(ru.title.length > 0, `${route} RU title`);
    assert.ok(en.title.length > 0, `${route} EN title`);
    assert.notEqual(ru.title, en.title, `${route} titles differ by locale`);
    assert.ok(flattenLegalText(ru).length > 200, `${route} RU body`);
    assert.ok(flattenLegalText(en).length > 200, `${route} EN body`);
    assert.equal(en.sections.length, ru.sections.length, `${route} section count`);
    assert.ok(ru.sections.length > 0, `${route} has sections`);

    ru.sections.forEach((section, index) => {
      const enSection = en.sections[index];
      assert.ok(enSection, `${route} EN section ${index}`);
      assert.equal(
        enSection.blocks.length,
        section.blocks.length,
        `${route} section ${index} block count`,
      );
      section.blocks.forEach((block, blockIndex) => {
        const enBlock = enSection.blocks[blockIndex];
        assert.equal(
          enBlock?.type,
          block.type,
          `${route} section ${index} block ${blockIndex} type`,
        );
        if (block.type === "ul" && enBlock?.type === "ul") {
          assert.equal(
            enBlock.items.length,
            block.items.length,
            `${route} section ${index} list length`,
          );
        }
      });
    });
  }
});

test("dictionary legal titles match canonical document titles", () => {
  const ru = getDictionary("ru").legal;
  const en = getDictionary("en").legal;
  assert.equal(ru.privacyPolicy, getLegalDocument("/privacy", "ru").title);
  assert.equal(en.privacyPolicy, getLegalDocument("/privacy", "en").title);
  assert.equal(ru.termsOfUse, getLegalDocument("/terms", "ru").title);
  assert.equal(en.termsOfUse, getLegalDocument("/terms", "en").title);
  assert.equal(ru.cookiePolicy, getLegalDocument("/cookie-policy", "ru").title);
  assert.equal(en.cookiePolicy, getLegalDocument("/cookie-policy", "en").title);
  assert.equal(
    ru.dataProcessingConsent,
    getLegalDocument("/data-processing-consent", "ru").title,
  );
  assert.equal(
    en.dataProcessingConsent,
    getLegalDocument("/data-processing-consent", "en").title,
  );
  assert.equal(
    ru.aiProcessingNotice,
    getLegalDocument("/ai-processing-notice", "ru").title,
  );
  assert.equal(
    en.aiProcessingNotice,
    getLegalDocument("/ai-processing-notice", "en").title,
  );
});

test("EN legal text does not use ordinary RU branding or unsupported claims", () => {
  assert.doesNotMatch(enLegal, /ПереговорИИ \(NegotAItions\)/);
  assert.doesNotMatch(enLegal, /exclusively (in|on the territory of) the Russian Federation/i);
  assert.doesNotMatch(
    enLegal,
    /Data is stored and processed on infrastructure located in the Russian Federation/,
  );
  assert.doesNotMatch(enLegal, /\bOpenAI\b/);
  assert.doesNotMatch(enLegal, /\bWhisper\b/);
  assert.doesNotMatch(enLegal, /\bLiveKit\b/);
  assert.doesNotMatch(enLegal, /self-service deletion is available/i);
  assert.doesNotMatch(enLegal, /Delete Account button is (available|provided)/i);
  assert.doesNotMatch(enLegal, /notify( you)? by email when (the )?(legal|terms|privacy)/i);
  assert.doesNotMatch(enLegal, /legal-update email/i);
  assert.doesNotMatch(enLegal, /email notification of (a )?material (legal )?release/i);
  assert.match(enLegal, /There is no self-service Delete Account button/);
});
