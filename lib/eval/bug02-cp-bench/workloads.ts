import type { BenchSegment, BenchWorkload, Bug02WorkloadId } from "./types";

const SPEAKERS = ["speaker_1", "speaker_2", "speaker_3"] as const;

const SHORT_TURNS = [
  "Мы можем начать с объёма поставки на первый квартал.",
  "Какая у вас целевая цена за единицу?",
  "Давайте уточним срок поставки: 14 или 21 день?",
  "Нам нужен резерв по качеству, иначе риск слишком высок.",
  "Это условие для нас принципиально.",
  "Можем ли мы разделить платёж на два транша?",
  "Подождите, я сверюсь с калькуляцией.",
  "Согласны, если зафиксируем штраф за просрочку.",
  "Нет, скидка 12% сразу невозможна.",
  "Тогда предложите встречный вариант.",
];

const MEDIUM_TURNS = [
  "Если мы берём 8 400 единиц в Q1 и опцион ещё на 3 200 в Q2, то логистика должна остаться на вашей стороне, включая страхование до склада в Подольске.",
  "Мы готовы обсудить цену 1 150 рублей, но только при предоплате 30% и аккредитиве на остаток; иначе кассовый разрыв не закрывается.",
  "Посмотрите на претензии прошлого года: 17 рекламаций, из них 4 по упаковке. Нам нужна письменная процедура замены в течение 5 рабочих дней.",
  "Ваш график слишком плотный. Если отгрузка сдвигается хотя бы на неделю, наш ритейл-канал теряет полку, и тогда весь контракт теряет смысл.",
  "Давайте отделим сервис от товара. Сам товар можем закрыть сегодня, а SLA по внедрению вынесем в приложение с отдельной ответственностью.",
];

const LONG_TURNS = [
  "Я хочу зафиксировать пакет целиком: цена 1 090, отсрочка 21 день, минимальный заказ 6 000, право на пересмотр объёма один раз в квартал, и отдельный бонус 2% за выполнение годового плана выше 28 000 единиц. Если какой-то пункт выпадает, мы возвращаемся к базовой цене 1 180 без бонуса.",
  "С нашей стороны риск не в цене, а в предсказуемости. В прошлом цикле вы дважды меняли спецификацию после подписания спецификации №14, и нам пришлось переделывать этикетку. Поэтому любое изменение состава или артикула должно идти через письменный change request с оценкой за 3 дня.",
  "Хорошо, тогда я проговариваю компромисс: мы принимаем ваш Incoterms DAP, вы принимаете наш лимит ответственности 15% от партии, исключая умышленное нарушение. Форс-мажор — стандартный, но кибератака на WMS не считается основанием сдвигать штрафной график больше чем на 48 часов.",
];

const QUESTION_TURNS = [
  "Сколько дней вам реально нужно на пилотную партию в 400 единиц?",
  "Вы подтверждаете, что сертификат ГОСТ будет готов до 12-го?",
  "Можем ли мы оставить цену открытой только по металлу, а сборку зафиксировать?",
];

const FILLER_WITH_PUNCTUATION = [
  "Итак... давайте не смешивать скидку и отсрочку.",
  "Секунду: 2,4 миллиона — это с НДС или без?",
  "Понял. Тогда пункт 4.2 переписываем полностью.",
  "Нет-нет, это не «почти согласовано»; это развилка.",
];

const ALL_TURNS = [
  ...SHORT_TURNS,
  ...MEDIUM_TURNS,
  ...LONG_TURNS,
  ...QUESTION_TURNS,
  ...FILLER_WITH_PUNCTUATION,
];

export const WORKLOAD_TARGETS: Record<
  Bug02WorkloadId,
  { segments: number; chars: number; speakers: number; label: string }
> = {
  S: { segments: 12, chars: 1500, speakers: 2, label: "small control" },
  M: { segments: 36, chars: 4800, speakers: 2, label: "medium envelope" },
  L: {
    segments: 74,
    chars: 9592,
    speakers: 2,
    label: "BUG02-class large (~74 / ~9592)",
  },
  XL: {
    segments: 220,
    chars: 28000,
    speakers: 3,
    label: "hour-scale negotiation",
  },
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTurn(rand: () => number, index: number): string {
  const bucket = index % 11;
  const pool =
    bucket === 0
      ? LONG_TURNS
      : bucket <= 2
        ? QUESTION_TURNS
        : bucket <= 5
          ? MEDIUM_TURNS
          : bucket <= 8
            ? SHORT_TURNS
            : FILLER_WITH_PUNCTUATION;
  const base = pool[Math.floor(rand() * pool.length)] ?? ALL_TURNS[0];
  if (index % 17 === 0) {
    return `${base} Это затрагивает спецификацию №${12 + (index % 9)}.`;
  }
  if (index % 13 === 0) {
    return `${base} По сроку: не позже ${(index % 27) + 1}-го.`;
  }
  return base;
}

function speakerFor(index: number, speakerCount: number, rand: () => number): string {
  if (index > 0 && rand() < 0.18) {
    return SPEAKERS[(index - 1) % speakerCount];
  }
  return SPEAKERS[index % speakerCount];
}

function buildSegments(
  id: Bug02WorkloadId,
  seed: number,
): BenchSegment[] {
  const target = WORKLOAD_TARGETS[id];
  const rand = mulberry32(seed);
  const segments: BenchSegment[] = [];
  let chars = 0;
  let index = 0;
  while (segments.length < target.segments || chars < target.chars) {
    let text = pickTurn(rand, index);
    if (segments.length >= target.segments && chars < target.chars) {
      text = `${text} ${MEDIUM_TURNS[index % MEDIUM_TURNS.length]}`;
    }
    if (chars + text.length > target.chars + 180 && segments.length >= target.segments) {
      const remaining = Math.max(40, target.chars - chars);
      text = text.slice(0, remaining).trim();
      if (!/[.?!]$/.test(text)) {
        text = `${text}.`;
      }
    }
    const startMs = index * 14000 + Math.floor(rand() * 800);
    const durationMs = 3500 + Math.min(22000, text.length * 45);
    segments.push({
      index,
      speakerLabel: speakerFor(index, target.speakers, rand),
      startMs,
      endMs: startMs + durationMs,
      originalText: text,
      segmentId: `${id.toLowerCase()}-seg-${index}`,
    });
    chars += text.length;
    index += 1;
    if (segments.length > target.segments + 12 && chars >= target.chars) {
      break;
    }
  }
  return segments;
}

export function createBenchWorkload(id: Bug02WorkloadId): BenchWorkload {
  const seed =
    id === "S" ? 32501 : id === "M" ? 32502 : id === "L" ? 32503 : 32504;
  const segments = buildSegments(id, seed);
  return {
    id,
    label: WORKLOAD_TARGETS[id].label,
    segmentCount: segments.length,
    charCount: segments.reduce((sum, segment) => sum + segment.originalText.length, 0),
    speakerCount: WORKLOAD_TARGETS[id].speakers,
    segments,
  };
}

export function createAllBenchWorkloads(): Record<Bug02WorkloadId, BenchWorkload> {
  return {
    S: createBenchWorkload("S"),
    M: createBenchWorkload("M"),
    L: createBenchWorkload("L"),
    XL: createBenchWorkload("XL"),
  };
}

export function toEnhancementInput(workload: BenchWorkload) {
  return workload.segments.map((segment) => ({
    index: segment.index,
    speakerLabel: segment.speakerLabel,
    startMs: segment.startMs,
    endMs: segment.endMs,
    originalText: segment.originalText,
    segmentId: segment.segmentId,
  }));
}
