export type LabVisualTranscriptTurn = {
  speakerLabel: "speaker_0" | "speaker_1";
  startSeconds: number;
  endSeconds: number;
  text: string;
};

/**
 * Realistic STATE_FIXTURE dialogue for facilitator visual inspection.
 * Speaker mapping must not depend on lexical meaning.
 */
export const LAB_VISUAL_TWO_PARTY_TRANSCRIPT: LabVisualTranscriptTurn[] = [
  {
    speakerLabel: "speaker_0",
    startSeconds: 0,
    endSeconds: 7.2,
    text: "Добрый день. Мы готовы обсуждать условия поставки комплектующих на следующий квартал.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 7.6,
    endSeconds: 15.1,
    text: "Здравствуйте. Для нас главным вопросом остаются сроки и стабильность объёма.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 15.5,
    endSeconds: 23.4,
    text: "Мы можем начать с графика: первая партия в течение четырёх недель после подписания.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 23.8,
    endSeconds: 31.6,
    text: "Четыре недели для нас поздновато. Производство уже заложено на более ранний запуск.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 32,
    endSeconds: 40.2,
    text: "Если сдвинуть первую партию на три недели, нам нужна ясность по цене и минимальному объёму.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 40.6,
    endSeconds: 49,
    text: "По объёму готовы взять двенадцать тысяч единиц, если цена останется в районе ста двадцати.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 49.4,
    endSeconds: 57.8,
    text: "Сто двадцать возможно только при предоплате тридцати процентов и фиксированном графике.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 58.2,
    endSeconds: 66.5,
    text: "Предоплату можем дать, но не больше двадцати процентов. Остальное — по факту приёмки.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 66.9,
    endSeconds: 74.4,
    text: "Тогда давайте разделим риск: двадцать процентов сейчас и ещё десять после подтверждения спецификации.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 74.8,
    endSeconds: 83.1,
    text: "Это ближе. Но нам также нужен резерв на брак и понятная процедура замены.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 83.5,
    endSeconds: 91.8,
    text: "Замену брака закроем в течение десяти рабочих дней. Резерв — два процента от партии.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 92.2,
    endSeconds: 99.6,
    text: "Два процента мало. На прошлом контракте фактический брак был ближе к четырём.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 100,
    endSeconds: 108.4,
    text: "Можем поднять резерв до трёх процентов, если вы подтверждаете выборку двенадцати тысяч без отмены.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 108.8,
    endSeconds: 116.9,
    text: "Выборку подтверждаем, но хотим опцию плюс десять процентов объёма по той же цене.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 117.3,
    endSeconds: 125.5,
    text: "Опцию дадим на первую партию. Дальше цена пересматривается, если сырьё уйдёт больше чем на пять процентов.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 125.9,
    endSeconds: 133.7,
    text: "Индексацию принимаем, если предупреждение будет за две недели и с расчётом.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 134.1,
    endSeconds: 141.8,
    text: "Согласны. Тогда фиксируем: три недели, двенадцать тысяч, сто двадцать, оплата двадцать плюс десять.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 142.2,
    endSeconds: 149.6,
    text: "И резерв три процента, замена за десять дней, опция плюс десять на первую партию.",
  },
  {
    speakerLabel: "speaker_0",
    startSeconds: 150,
    endSeconds: 157.4,
    text: "Да. Я подготовлю протокол с этими пунктами и пришлю до конца дня.",
  },
  {
    speakerLabel: "speaker_1",
    startSeconds: 157.8,
    endSeconds: 164.5,
    text: "Хорошо. Мы сверим его с юридической службой и вернёмся завтра утром.",
  },
];

/** Visible completed-enhancement marker for Checkpoint B E05. */
export const LAB_ENHANCED_LEXICAL_MARKER = "[ИИ-уточнение]";

export function applyLabCompletedEnhancementToTurns(
  turns: LabVisualTranscriptTurn[],
): LabVisualTranscriptTurn[] {
  return turns.map((turn) => ({
    ...turn,
    text: `${turn.text} ${LAB_ENHANCED_LEXICAL_MARKER}`,
  }));
}

export function formatLabVisualTranscriptText(
  turns: LabVisualTranscriptTurn[] = LAB_VISUAL_TWO_PARTY_TRANSCRIPT,
): string {
  return turns.map((turn) => turn.text).join(" ");
}

export function formatLabVisualDiarizedText(
  turns: LabVisualTranscriptTurn[],
  speakerNameByLabel: Record<string, string | null | undefined>,
): string {
  return turns
    .map((turn) => {
      const label = speakerNameByLabel[turn.speakerLabel] ?? turn.speakerLabel;
      const start = turn.startSeconds.toFixed(1);
      const end = turn.endSeconds.toFixed(1);
      return `[${start}-${end}] ${label}: ${turn.text}`;
    })
    .join("\n");
}
