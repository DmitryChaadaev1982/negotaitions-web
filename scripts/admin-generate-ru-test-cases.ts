import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CaseLanguage,
  Difficulty,
  PrismaClient,
  VisibilityLevel,
} from "../app/generated/prisma/client";

loadEnvConfig(process.cwd());

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is missing.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const prisma = createPrismaClient();
const { values } = parseArgs({
  options: {
    "owner-email": { type: "string", default: "dvchaadaev@gmail.com" },
    "dry-run": { type: "boolean", default: false },
    "confirm-local": { type: "boolean", default: false },
    "confirm-production": { type: "boolean", default: false },
    visibility: { type: "string", default: "PUBLIC" },
  },
});

const ownerEmail = values["owner-email"];
const dryRun = Boolean(values["dry-run"]);
const confirmLocal = Boolean(values["confirm-local"]);
const confirmProduction = Boolean(values["confirm-production"]);
const visibilityArg = String(values.visibility || "PUBLIC").toUpperCase();

const databaseUrl = process.env.DATABASE_URL || "";
const nodeEnv = process.env.NODE_ENV || "development";
const isProductionDb = databaseUrl.includes("negotaitions_prod");
const isProductionEnv = nodeEnv === "production";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing.");
}

if (visibilityArg !== "PUBLIC" && visibilityArg !== "PRIVATE") {
  throw new Error("visibility must be PUBLIC or PRIVATE.");
}

if (!dryRun) {
  if (isProductionDb || isProductionEnv) {
    if (!confirmProduction) {
      throw new Error(
        "Refusing to write to production. Use --confirm-production after dry-run.",
      );
    }
  } else if (!confirmLocal) {
    throw new Error(
      "Refusing to write to local/dev DB without --confirm-local. Run --dry-run first.",
    );
  }
}

type RoleSeed = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
  sortOrder: number;
};

type CaseSeed = {
  title: string;
  description: string;
  businessContext: string;
  publicInstructions: string;
  targetSkills: string;
  difficulty: Difficulty;
  defaultPreparationDurationSeconds: number;
  defaultDurationSeconds: number;
  roles: RoleSeed[];
};

const cases: CaseSeed[] = [
  {
    title: "Тест: Овощной рынок",
    description:
      "Короткий кейс про торг между покупателем и продавцом на рынке.",
    businessContext:
      "На обычном рынке в большом городе покупатель выбирает овощи. Продавец активно зазывает покупателей к своему овощному магазину и утверждает, что у него самые свежие овощи на рынке.",
    publicInstructions:
      "Потенциальный покупатель и продавец должны договориться о том, что покупать, в каком количестве и по какой цене.",
    targetSkills:
      "Выяснение интересов, торг, работа с качеством товара, уступки, фиксация договорённости.",
    difficulty: Difficulty.EASY,
    defaultPreparationDurationSeconds: 60,
    defaultDurationSeconds: 120,
    roles: [
      {
        name: "Покупатель",
        privateInstructions:
          "В принципе у вас нет цели купить что-то конкретное из овощей, но вы готовы взять, если будет хорошее качество и дешево. Вы не любите, когда на вас давят.",
        objectives:
          "Купить 2–3 позиции овощей по выгодной цене или уйти без покупки, если продавец не уступает.",
        constraints:
          "Бюджет ограничен. Вы не хотите платить цену выше средней по рынку.",
        hiddenInfo:
          "Вы видели похожие овощи у соседнего продавца немного дешевле, но там была очередь.",
        fallbackPosition:
          "Сказать, что посмотрите ещё у соседей, и уйти без покупки.",
        sortOrder: 1,
      },
      {
        name: "Продавец",
        privateInstructions:
          "Овощи на самом деле не самого хорошего качества и скоро уже испортятся. Поэтому их нужно продать побыстрее, но совсем дешево продавать не хочется.",
        objectives:
          "Продать как можно больше овощей и сохранить приемлемую цену.",
        constraints:
          "Вы можете дать скидку, но только если покупатель берёт несколько позиций или больший объём.",
        hiddenInfo:
          "К вечеру часть овощей придётся списать, если их не продать сейчас.",
        fallbackPosition:
          "Предложить небольшую скидку или добавить немного зелени бесплатно.",
        sortOrder: 2,
      },
    ],
  },
  {
    title: "Тест: Срочная доставка оборудования",
    description:
      "Короткий кейс про переговоры между заказчиком и поставщиком по срокам доставки.",
    businessContext:
      "Компания заказала небольшую партию оборудования для офиса. Поставка задерживается, а оборудование нужно уже завтра утром для важной встречи.",
    publicInstructions:
      "Заказчик и поставщик должны договориться о возможном сроке доставки, компенсации или альтернативном решении.",
    targetSkills:
      "Управление сроками, поиск альтернатив, компенсации, формулирование условий соглашения.",
    difficulty: Difficulty.EASY,
    defaultPreparationDurationSeconds: 60,
    defaultDurationSeconds: 180,
    roles: [
      {
        name: "Заказчик",
        privateInstructions:
          "Вам нужно оборудование завтра утром. Если его не будет, встречу придётся переносить, и это будет выглядеть плохо для вашей команды.",
        objectives:
          "Добиться доставки завтра утром или получить рабочую замену и компенсацию.",
        constraints:
          "Вы не готовы платить больше согласованной цены.",
        hiddenInfo:
          "У вас есть альтернативный поставщик, но он дороже на 20%.",
        fallbackPosition:
          "Потребовать временную замену и скидку на текущий заказ.",
        sortOrder: 1,
      },
      {
        name: "Поставщик",
        privateInstructions:
          "Поставка задержалась из-за логистики. Полностью доставить заказ завтра утром почти невозможно, но можно привезти часть оборудования.",
        objectives:
          "Сохранить клиента и избежать серьёзной финансовой компенсации.",
        constraints:
          "Полная доставка возможна только через два дня. Завтра можно доставить только половину.",
        hiddenInfo:
          "Есть демонстрационный комплект на складе, который можно дать временно, но вы не хотите предлагать его сразу.",
        fallbackPosition:
          "Предложить частичную доставку завтра и скидку на следующий заказ.",
        sortOrder: 2,
      },
    ],
  },
  {
    title: "Тест: Скидка на обучение",
    description:
      "Короткий кейс про переговоры клиента и менеджера образовательной программы.",
    businessContext:
      "Клиент хочет записаться на короткий курс, но считает цену слишком высокой. Менеджер школы заинтересован закрыть продажу до конца дня.",
    publicInstructions:
      "Клиент и менеджер должны договориться о цене, условиях оплаты или дополнительных бонусах.",
    targetSkills:
      "Работа с ценой, аргументация ценности, пакетирование уступок, закрытие сделки.",
    difficulty: Difficulty.EASY,
    defaultPreparationDurationSeconds: 120,
    defaultDurationSeconds: 240,
    roles: [
      {
        name: "Клиент",
        privateInstructions:
          "Курс вам интересен, но цена кажется завышенной. Вы готовы купить, если получите скидку или рассрочку.",
        objectives:
          "Получить скидку не менее 15% или рассрочку без переплаты.",
        constraints:
          "Полную сумму сразу платить не готовы.",
        hiddenInfo:
          "У конкурента есть похожий курс дешевле, но программа там слабее.",
        fallbackPosition:
          "Попросить время подумать и уйти к конкуренту.",
        sortOrder: 1,
      },
      {
        name: "Менеджер школы",
        privateInstructions:
          "Вам нужно закрыть продажу сегодня. Большую скидку давать нельзя, но можно добавить бонусы или рассрочку.",
        objectives:
          "Продать курс по максимально близкой к полной цене.",
        constraints:
          "Максимальная скидка без согласования — 10%. Можно добавить консультацию или доступ к материалам.",
        hiddenInfo:
          "Сегодня последний день плана продаж, поэтому сделка для вас важна.",
        fallbackPosition:
          "Предложить рассрочку и бонус вместо большой скидки.",
        sortOrder: 2,
      },
    ],
  },
  {
    title: "Тест: Комната переговоров",
    description:
      "Короткий офисный кейс про конфликт за переговорную комнату.",
    businessContext:
      "В офисе осталась одна свободная переговорная на завтра утром. На неё претендуют проектная команда и внутренний администратор для встречи с подрядчиком.",
    publicInstructions:
      "Стороны должны договориться, кто и на каких условиях использует переговорную.",
    targetSkills:
      "Приоритизация интересов, поиск компромисса, обмен уступками, работа с ресурсным конфликтом.",
    difficulty: Difficulty.EASY,
    defaultPreparationDurationSeconds: 60,
    defaultDurationSeconds: 120,
    roles: [
      {
        name: "Руководитель проекта",
        privateInstructions:
          "У вас завтра важная встреча с клиентом. Нужна именно эта переговорная, потому что там большой экран и достаточно мест.",
        objectives:
          "Получить переговорную минимум на первый час утром.",
        constraints:
          "Перенести встречу сложно, клиент уже подтвердил время.",
        hiddenInfo:
          "Вам на самом деле нужна комната только на 45 минут, но вы забронировали бы её на 2 часа.",
        fallbackPosition:
          "Предложить разделить время или провести часть встречи онлайн.",
        sortOrder: 1,
      },
      {
        name: "Администратор офиса",
        privateInstructions:
          "У вас запланирована встреча с подрядчиком по ремонту, и подрядчик может приехать только завтра утром.",
        objectives:
          "Сохранить переговорную хотя бы на часть времени и не сорвать встречу.",
        constraints:
          "Подрядчик не может приехать позже 11:00.",
        hiddenInfo:
          "Для вашей встречи большой экран не нужен, но нужна тихая комната.",
        fallbackPosition:
          "Согласиться на другую комнату, если проектная команда поможет быстро её подготовить.",
        sortOrder: 2,
      },
    ],
  },
  {
    title: "Тест: Срочная правка сайта",
    description:
      "Короткий кейс про переговоры заказчика и фрилансера по срочной доработке.",
    businessContext:
      "Заказчику нужно срочно поправить страницу сайта перед запуском рекламы. Фрилансер уже занят другим проектом, но потенциально может взять задачу за доплату.",
    publicInstructions:
      "Заказчик и фрилансер должны договориться о сроках, цене и объёме срочной правки.",
    targetSkills:
      "Переговоры о срочности, объём работ, цена за приоритет, фиксация минимального результата.",
    difficulty: Difficulty.EASY,
    defaultPreparationDurationSeconds: 120,
    defaultDurationSeconds: 300,
    roles: [
      {
        name: "Заказчик",
        privateInstructions:
          "Рекламная кампания стартует завтра. Если страницу не поправить сегодня, часть бюджета может быть потрачена впустую.",
        objectives:
          "Добиться выполнения правки сегодня вечером без сильного увеличения бюджета.",
        constraints:
          "Бюджет ограничен. Вы готовы доплатить максимум 30%.",
        hiddenInfo:
          "Есть другой исполнитель, но он не знает проект и может ошибиться.",
        fallbackPosition:
          "Сократить объём задачи до самых критичных правок.",
        sortOrder: 1,
      },
      {
        name: "Фрилансер",
        privateInstructions:
          "Вы заняты другим проектом. Взять срочную правку можно, но это нарушит ваш вечерний график.",
        objectives:
          "Если брать задачу, получить доплату и чётко ограничить объём.",
        constraints:
          "Вы можете сделать только минимальный набор правок сегодня. Полную доработку — завтра.",
        hiddenInfo:
          "На самом деле критичную правку можно сделать за 40 минут, но вы не хотите создавать ожидание, что срочность бесплатна.",
        fallbackPosition:
          "Предложить минимальный срочный пакет сегодня и основную доработку завтра.",
        sortOrder: 2,
      },
    ],
  },
];

function assertSafeRuntime() {
  console.log("Runtime check:");
  console.log(`- NODE_ENV: ${nodeEnv}`);
  console.log(`- DATABASE_URL target: ${isProductionDb ? "production" : "non-production"}`);
  console.log(`- owner email: ${ownerEmail}`);
  console.log(`- dry-run: ${dryRun}`);
  console.log(`- visibility: ${visibilityArg}`);
}

async function main() {
  assertSafeRuntime();

  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: {
      id: true,
      email: true,
      name: true,
      globalRole: true,
      status: true,
    },
  });

  if (!owner) {
    throw new Error(`Owner user not found by email: ${ownerEmail}`);
  }

  console.log("Owner:");
  console.log({
    email: owner.email,
    name: owner.name,
    globalRole: owner.globalRole,
    status: owner.status,
  });

  const visibility =
    visibilityArg === "PRIVATE" ? VisibilityLevel.PRIVATE : VisibilityLevel.PUBLIC;

  const existing = await prisma.negotiationCase.findMany({
    where: {
      title: { in: cases.map((item) => item.title) },
      createdByUserId: owner.id,
    },
    select: {
      id: true,
      title: true,
      createdByUserId: true,
    },
  });

  const existingTitles = new Set(existing.map((item) => item.title));
  const toCreate = cases.filter((item) => !existingTitles.has(item.title));
  const toSkip = cases.filter((item) => existingTitles.has(item.title));

  console.log("Plan:");
  console.log({
    totalSeedCases: cases.length,
    toCreate: toCreate.length,
    toSkip: toSkip.length,
    rolesToCreate: toCreate.reduce((sum, item) => sum + item.roles.length, 0),
  });

  if (toSkip.length > 0) {
    console.log("Skipping existing cases:");
    for (const item of toSkip) {
      console.log(`- ${item.title}`);
    }
  }

  if (dryRun) {
    console.log("Dry-run only. No DB writes performed.");
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const result: Array<{ id: string; title: string; roles: number }> = [];

    for (const item of toCreate) {
      const createdCase = await tx.negotiationCase.create({
        data: {
          title: item.title,
          description: item.description,
          businessContext: item.businessContext,
          publicInstructions: item.publicInstructions,
          targetSkills: item.targetSkills,
          difficulty: item.difficulty,
          caseLanguage: CaseLanguage.RU,
          defaultPreparationDurationSeconds:
            item.defaultPreparationDurationSeconds,
          defaultDurationSeconds: item.defaultDurationSeconds,
          visibility,
          facilitatorId: owner.id,
          createdByUserId: owner.id,
          roles: {
            create: item.roles.map((role) => ({
              name: role.name,
              privateInstructions: role.privateInstructions,
              objectives: role.objectives,
              constraints: role.constraints,
              hiddenInfo: role.hiddenInfo,
              fallbackPosition: role.fallbackPosition,
              sortOrder: role.sortOrder,
            })),
          },
        },
        include: {
          roles: true,
        },
      });

      result.push({
        id: createdCase.id,
        title: createdCase.title,
        roles: createdCase.roles.length,
      });
    }

    return result;
  });

  console.log("Created cases:");
  for (const item of created) {
    console.log(`- ${item.title} (${item.roles} roles)`);
  }

  const finalCount = await prisma.negotiationCase.count({
    where: {
      createdByUserId: owner.id,
      title: { in: cases.map((item) => item.title) },
    },
  });

  console.log("Final verification:");
  console.log({
    seededCasesForOwner: finalCount,
  });
}

main()
  .catch((error) => {
    console.error("Script failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });