import assert from "node:assert/strict";
import test from "node:test";

import { getDictionary } from "@/lib/i18n/dictionaries";

test("public homepage dictionaries use locale-specific product and author names", () => {
  const ru = getDictionary("ru");
  const en = getDictionary("en");
  assert.equal(ru.publicHome.productName, "ПереговорИИ (NegotAItions)");
  assert.equal(en.publicHome.productName, "NegotAItions");
  assert.match(ru.publicHome.heroBody1, /ПереговорИИ \(NegotAItions\)/);
  assert.match(en.publicHome.heroBody1, /^NegotAItions /);
  assert.doesNotMatch(en.publicHome.heroBody1, /ПереговорИИ/);
  assert.doesNotMatch(en.publicHome.aiBody1, /ПереговорИИ/);
  assert.equal(
    ru.footer.copyright,
    "© 2026 Чаадаев Дмитрий Владимирович · ПереговорИИ (NegotAItions)",
  );
  assert.equal(en.footer.copyright, "© 2026 Dmitry Chaadaev · NegotAItions");
  assert.doesNotMatch(en.footer.copyright, /Чаадаев|ПереговорИИ/);
  assert.match(ru.brand.alt, /ПереговорИИ \(NegotAItions\)/);
  assert.doesNotMatch(en.brand.alt, /ПереговорИИ|Чаадаев/);
  assert.equal(ru.publicHome.heroHeadline1, "Тренируйте переговоры.");
  assert.equal(ru.publicHome.heroHeadline2, "Используйте возможности ИИ.");
  assert.equal(ru.publicHome.heroHeadline3, "Становитесь сильнее в переговорах.");
  assert.equal(en.publicHome.ctaLogin, "Enter the platform");
  assert.equal(
    ru.publicHome.audienceTitle,
    "Переговоры — навык, который можно тренировать",
  );
  assert.equal(en.publicHome.audienceTitle, "Negotiation is a skill you can train");
  assert.equal(ru.publicHome.audience1Title, "Развивать переговорные навыки");
  assert.equal(en.publicHome.audience4Title, "Train with others");
  assert.equal(
    ru.publicHome.heroVisualAlt,
    "Учебные переговоры с фасилитацией, наблюдателями и AI-поддержкой",
  );
  assert.equal(
    en.publicHome.heroVisualAlt,
    "Training negotiation session with facilitation, observers, and AI support",
  );
  assert.equal(
    ru.publicHome.howItWorksVisualAlt,
    "Путь учебной переговорной сессии: лобби и подготовка, переговоры, дебриф и материалы",
  );
  assert.equal(
    en.publicHome.howItWorksVisualAlt,
    "Training negotiation journey: lobby and preparation, negotiation, debrief and materials",
  );
  assert.equal("audienceNote" in ru.publicHome, false);
  assert.equal("audience5" in en.publicHome, false);
});
