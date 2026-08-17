import assert from "node:assert/strict";
import test from "node:test";

import { getDictionary } from "@/lib/i18n/dictionaries";
import { getCurrentLegalAcknowledgementUi } from "@/lib/legal/acknowledgements";
import { getCurrentLegalRelease } from "@/lib/legal/release";

test("acknowledgement UI exists for every current required consent type", () => {
  const release = getCurrentLegalRelease();
  const ui = getCurrentLegalAcknowledgementUi();
  assert.deepEqual(
    ui.map((item) => item.consentType),
    [...release.requiredConsentTypes],
  );
  assert.equal(
    ui.filter((item) => item.consentType === "PERSONAL_DATA_PROCESSING_V2")
      .length,
    1,
  );
});

test("rendered RU personal-data checkbox matches composed dictionary text", () => {
  const ru = getDictionary("ru").legal;
  const rendered = `${ru.consentPersonalDataStart}${ru.dataProcessingConsent}${ru.consentPersonalDataEnd}`;
  assert.equal(rendered, ru.consentPersonalDataProcessing);
  assert.equal(
    rendered,
    "Я даю согласие на обработку моих персональных данных на условиях документа «Согласие на обработку персональных данных».",
  );
  assert.doesNotMatch(rendered, /на условиях Согласие на обработку/);
});
