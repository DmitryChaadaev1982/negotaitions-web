import type { TranslationKey } from "@/lib/i18n/translate";

export const PUBLIC_FAQ_ITEMS = [
  {
    id: "1",
    questionKey: "publicFaq.q1",
    answerKeys: ["publicFaq.a1p1", "publicFaq.a1p2"],
  },
  {
    id: "2",
    questionKey: "publicFaq.q2",
    answerKeys: ["publicFaq.a2p1", "publicFaq.a2p2"],
  },
  {
    id: "3",
    questionKey: "publicFaq.q3",
    answerKeys: ["publicFaq.a3p1", "publicFaq.a3p2", "publicFaq.a3p3"],
  },
  {
    id: "4",
    questionKey: "publicFaq.q4",
    answerKeys: ["publicFaq.a4p1", "publicFaq.a4p2"],
  },
  {
    id: "5",
    questionKey: "publicFaq.q5",
    answerKeys: ["publicFaq.a5p1", "publicFaq.a5p2"],
  },
  {
    id: "6",
    questionKey: "publicFaq.q6",
    answerKeys: ["publicFaq.a6p1", "publicFaq.a6p2", "publicFaq.a6p3"],
  },
  {
    id: "7",
    questionKey: "publicFaq.q7",
    answerKeys: ["publicFaq.a7p1", "publicFaq.a7p2", "publicFaq.a7p3"],
  },
  {
    id: "8",
    questionKey: "publicFaq.q8",
    answerKeys: ["publicFaq.a8p1", "publicFaq.a8p2"],
  },
  {
    id: "9",
    questionKey: "publicFaq.q9",
    answerKeys: ["publicFaq.a9p1", "publicFaq.a9p2"],
  },
  {
    id: "10",
    questionKey: "publicFaq.q10",
    answerKeys: ["publicFaq.a10p1", "publicFaq.a10p2"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  questionKey: TranslationKey;
  answerKeys: readonly TranslationKey[];
}>;
