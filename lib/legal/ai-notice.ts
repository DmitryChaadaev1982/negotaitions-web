import type { Locale } from "@/lib/i18n/config";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_EN_LEGAL,
  LEGAL_OPERATOR_RU,
  LEGAL_PRODUCT_EN,
  LEGAL_PRODUCT_RU,
} from "@/lib/legal/meta";
import type { LegalDocument } from "@/lib/legal/types";

export function getAiNoticeDocument(locale: Locale): LegalDocument {
  return locale === "ru" ? ruNotice : enNotice;
}

const ruNotice: LegalDocument = {
  route: "/ai-processing-notice",
  title: "Уведомление об ИИ и внешних сервисах",
  sections: [
    {
      heading: "1. Зачем это уведомление",
      blocks: [
        {
          type: "p",
          text: `Сервис ${LEGAL_PRODUCT_RU}, предоставляемый ${LEGAL_OPERATOR_RU}, использует внешние сервисы для живых коммуникаций, записи, транскрибации и ИИ-анализа учебных переговоров.`,
        },
        {
          type: "p",
          text: "Это уведомление объясняет, какие внешние сервисы задействованы в текущем производстве и какие сведения могут обрабатываться при анализе. Оно не заменяет Политику обработки персональных данных.",
        },
      ],
    },
    {
      heading: "2. Внешние сервисы в текущем производстве",
      blocks: [
        {
          type: "ul",
          items: [
            "Voximplant обеспечивает живые коммуникации и инфраструктуру записи. География обработки на стороне этого провайдера уточняется.",
            "Yandex SpeechKit выполняет преобразование аудиозаписи в текст.",
            "ИИ-сервисы, предоставляемые в инфраструктуре Yandex Cloud, используются для улучшения транскрипта и ИИ-анализа учебной сессии. Имя конкретной модели может меняться без изменения цели обработки.",
            "Yandex Object Storage хранит объекты записи приложения.",
            "Yandex Cloud Postbox доставляет сервисную электронную почту.",
            "Yandex Data Streams / инфраструктура событий Yandex Cloud используется для обработки или передачи служебных сведений о доставке, отказе или жалобе.",
          ],
        },
      ],
    },
    {
      heading: "3. Что может попасть в ИИ-анализ",
      blocks: [
        {
          type: "p",
          text: "Для анализа учебной сессии могут обрабатываться транскрипт, открытый контекст кейса и сессии, цели, ограничения и вводные роли, если они нужны для анализа, отображаемые имена участников, идентификаторы участников сессии, заметки участников и иной контекст сессии, необходимый для анализа.",
        },
        {
          type: "p",
          text: "Адреса электронной почты в ИИ-анализ не передаются. Автоматическая очистка персональных данных перед отправкой в ИИ-сервис не применяется.",
        },
      ],
    },
    {
      heading: "4. Чего не следует размещать",
      blocks: [
        {
          type: "p",
          text: "Не размещайте в учебных кейсах и сессиях ненужные реальные чувствительные, секретные, чужие, платёжные, учётные, государственные, коммерческие или иным образом ограниченные сведения. Учебная тренировка не требует таких данных.",
        },
      ],
    },
    {
      heading: "5. Характер результата ИИ",
      blocks: [
        {
          type: "p",
          text: "Результат ИИ может содержать ошибки, быть неполным или не соответствовать фактическому ходу переговоров. Он является дополнительным учебным материалом для разбора, а не объективной истиной, не оценкой личности и не профессиональной консультацией.",
        },
        {
          type: "p",
          text: "ИИ не ведёт переговоры вместо пользователя и не принимает решений, порождающих юридические последствия для пользователя. Пользователь должен критически оценивать выводы, сформированные ИИ.",
        },
      ],
    },
    {
      heading: "6. Кто видит ИИ-разбор",
      blocks: [
        {
          type: "p",
          text: "Фасилитатор может получать полный анализ, доступный фасилитатору. Участники могут получать разрешённую персональную или общую проекцию после явной публикации и предоставления доступа. Наблюдатели могут получать наблюдательскую проекцию после публикации и предоставления доступа и не получают персональную обратную связь других участников.",
        },
      ],
    },
    {
      heading: "7. Вопросы",
      blocks: [
        {
          type: "p",
          text: `Вопросы об обработке персональных данных, включая запрос на удаление аккаунта, можно направить на ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
  ],
};

const enNotice: LegalDocument = {
  route: "/ai-processing-notice",
  title: "AI & External Services Notice",
  sections: [
    {
      heading: "1. Why this notice exists",
      blocks: [
        {
          type: "p",
          text: `${LEGAL_PRODUCT_EN}, provided by ${LEGAL_OPERATOR_EN_LEGAL}, uses external services for live communications, recording, transcription, and AI analysis of training negotiations.`,
        },
        {
          type: "p",
          text: "This notice explains which external services are used in current production and what information may be processed during analysis. It does not replace the Privacy Policy.",
        },
      ],
    },
    {
      heading: "2. External services in current production",
      blocks: [
        {
          type: "ul",
          items: [
            "Voximplant provides live communications and recording infrastructure. That provider’s processing geography is being clarified.",
            "Yandex SpeechKit converts the audio recording into text.",
            "AI services provided through Yandex Cloud infrastructure are used for transcript enhancement and AI analysis of a training session. The specific model name may change without changing the purpose of processing.",
            "Yandex Object Storage stores application recording objects.",
            "Yandex Cloud Postbox delivers service email.",
            "Yandex Data Streams / Yandex Cloud event infrastructure is used to process or transport technical delivery, bounce, or complaint events.",
          ],
        },
      ],
    },
    {
      heading: "3. What may be processed in AI analysis",
      blocks: [
        {
          type: "p",
          text: "Session analysis may process the transcript, open case and session context, role objectives, constraints, and briefing information where required for analysis, participant display names, session participant identifiers, participant notes, and other session context required for the analysis.",
        },
        {
          type: "p",
          text: "Email addresses are not sent to AI analysis. Automatic personal-data scrubbing before submission to the AI service is not applied.",
        },
      ],
    },
    {
      heading: "4. What not to place in the service",
      blocks: [
        {
          type: "p",
          text: "Do not place unnecessary real-world sensitive, secret, third-party, payment, credential, state-secret, commercial-secret, or otherwise restricted information in training cases or sessions. Training practice does not require that information.",
        },
      ],
    },
    {
      heading: "5. Nature of AI output",
      blocks: [
        {
          type: "p",
          text: "AI output may contain errors, be incomplete, or fail to reflect the actual negotiation. It is supplementary training-review material, not objective truth, not a personal appraisal, and not professional advice.",
        },
        {
          type: "p",
          text: "AI does not negotiate instead of the user and does not make decisions that create legal consequences for the user. Users should critically evaluate AI-generated conclusions.",
        },
      ],
    },
    {
      heading: "6. Who can see AI analysis",
      blocks: [
        {
          type: "p",
          text: "The facilitator may access the full analysis available to the facilitator. Participants may receive a permitted participant-specific or shared projection after explicit publication and grant. Observers may receive the observer-safe projection after publication and grant and do not receive other participants’ personal feedback.",
        },
      ],
    },
    {
      heading: "7. Questions",
      blocks: [
        {
          type: "p",
          text: `Questions about personal-data processing, including a request to delete an account, can be sent to ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
  ],
};
