import type { Locale } from "@/lib/i18n/config";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_EN_LEGAL,
  LEGAL_OPERATOR_RU,
  LEGAL_PRODUCT_EN,
  LEGAL_PRODUCT_RU,
} from "@/lib/legal/meta";
import type { LegalDocument } from "@/lib/legal/types";

export function getConsentDocument(locale: Locale): LegalDocument {
  return locale === "ru" ? ruConsent : enConsent;
}

const ruConsent: LegalDocument = {
  route: "/data-processing-consent",
  title: "Согласие на обработку персональных данных",
  sections: [
    {
      heading: "1. Кто даёт согласие",
      blocks: [
        {
          type: "p",
          text: `Субъект персональных данных даёт согласие ${LEGAL_OPERATOR_RU} как оператору на обработку персональных данных при регистрации в сервисе ${LEGAL_PRODUCT_RU} либо при подтверждении текущего правового релиза в приложении.`,
        },
        {
          type: "p",
          text: "Это согласие оформляется отдельно от Пользовательского соглашения. Принятие Пользовательского соглашения и ознакомление с Политикой обработки персональных данных не заменяет настоящее согласие.",
        },
      ],
    },
    {
      heading: "2. Цели",
      blocks: [
        {
          type: "p",
          text: "Согласие даётся на обработку персональных данных, необходимых для предоставления сервиса, включая:",
        },
        {
          type: "ul",
          items: [
            "создание и ведение аккаунта, аутентификацию и администрирование доступа;",
            "организацию и проведение учебных переговорных сессий;",
            "аудиозапись, транскрибацию, улучшение транскрипта и ИИ-анализ в учебных целях;",
            "отображение разрешённых материалов сессии;",
            "сервисную электронную почту, связанную с аккаунтом и безопасностью;",
            "техническую эксплуатацию, безопасность и диагностику.",
          ],
        },
      ],
    },
    {
      heading: "3. Перечень данных",
      blocks: [
        {
          type: "p",
          text: "Обрабатываться могут адрес электронной почты, отображаемое имя, хеш пароля, статус аккаунта, временные метки, технические идентификаторы, заголовок User-Agent, IP-адрес в технических журналах веб-сервера и безопасности, хеш или иное преобразованное значение, полученное из IP-адреса, сведения об участии в сессиях и ролях, заметки, аудиозапись, транскрипт, сопоставление говорящих, результаты ИИ-анализа, а также служебные сведения о доставке электронной почты, если они поступают от почтового провайдера. Подробный перечень приведён в Политике обработки персональных данных.",
        },
      ],
    },
    {
      heading: "4. Действия и способы",
      blocks: [
        {
          type: "p",
          text: "Оператор может осуществлять сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, передачу (предоставление, доступ) привлечённым внешним сервисам в объёме, необходимом для указанных целей, блокирование, удаление, уничтожение и обезличивание.",
        },
        {
          type: "p",
          text: "Обработка выполняется с использованием средств автоматизации. Для работы сервиса привлекаются Voximplant, Yandex Object Storage, Yandex Cloud, Yandex Managed PostgreSQL, Yandex SpeechKit, ИИ-сервисы в инфраструктуре Yandex Cloud, Yandex Cloud Postbox и Yandex Data Streams / инфраструктура событий Yandex Cloud, как описано в Политике обработки персональных данных.",
        },
      ],
    },
    {
      heading: "5. Срок действия и отзыв",
      blocks: [
        {
          type: "p",
          text: `Согласие действует до его отзыва либо до удаления или обезличивания данных по достижении целей обработки. Согласие можно отозвать, направив обращение на ${LEGAL_CONTACT_EMAIL}.`,
        },
        {
          type: "p",
          text: "После отзыва оператор прекращает обработку, которая требовала согласия, если не имеется иного законного основания. Самостоятельная кнопка удаления аккаунта не предоставляется. Запрос об удалении аккаунта рассматривается оператором в соответствии с Политикой обработки персональных данных и применимым законом.",
        },
      ],
    },
    {
      heading: "6. Учебные сессии",
      blocks: [
        {
          type: "p",
          text: "Отдельным информационным подтверждением пользователь удостоверяет, что ознакомлен с тем, что учебные сессии могут включать аудиозапись, транскрибацию, улучшение транскрипта и ИИ-анализ с использованием внешних сервисов, как описано в Уведомлении об ИИ и внешних сервисах. Это подтверждение не является повторным согласием на обработку персональных данных: согласие на обработку даётся отдельно в настоящем документе. Это не сохранённая отдельная отметка согласия каждого участника непосредственно в момент начала записи.",
        },
        {
          type: "p",
          text: "Не следует размещать в сервисе ненужные чувствительные, секретные или иным образом ограниченные сведения.",
        },
      ],
    },
  ],
};

const enConsent: LegalDocument = {
  route: "/data-processing-consent",
  title: "Personal Data Processing Consent",
  sections: [
    {
      heading: "1. Who gives consent",
      blocks: [
        {
          type: "p",
          text: `The data subject consents to ${LEGAL_OPERATOR_EN_LEGAL}, as operator, processing personal data upon registration in ${LEGAL_PRODUCT_EN} or upon confirming the current legal release in the application.`,
        },
        {
          type: "p",
          text: "This consent is given separately from the Terms of Use. Accepting the Terms of Use and reviewing the Privacy Policy does not replace this consent.",
        },
      ],
    },
    {
      heading: "2. Purposes",
      blocks: [
        {
          type: "p",
          text: "Consent is given to process personal data necessary to provide the service, including:",
        },
        {
          type: "ul",
          items: [
            "creating and maintaining an account, authentication, and access administration;",
            "organising and conducting training negotiation sessions;",
            "audio recording, transcription, transcript enhancement, and AI analysis for training purposes;",
            "displaying permitted session materials;",
            "service email related to the account and security;",
            "technical operation, security, and diagnostics.",
          ],
        },
      ],
    },
    {
      heading: "3. Data covered",
      blocks: [
        {
          type: "p",
          text: "Processing may include email address, display name, password hash, account status, timestamps, technical identifiers, User-Agent, IP address in web-server and security technical logs, a hash or other transformed IP-derived value, session participation and roles, notes, audio recording, transcript, speaker mapping, AI analysis results, and email-delivery metadata if received from the mail provider. The fuller list is in the Privacy Policy.",
        },
      ],
    },
    {
      heading: "4. Actions and methods",
      blocks: [
        {
          type: "p",
          text: "The operator may collect, record, organise, accumulate, store, update, extract, use, disclose (provide, grant access) to engaged external services to the extent needed for the stated purposes, block, delete, destroy, and anonymize.",
        },
        {
          type: "p",
          text: "Processing is automated. The service uses Voximplant, Yandex Object Storage, Yandex Cloud, Yandex Managed PostgreSQL, Yandex SpeechKit, AI services in Yandex Cloud infrastructure, Yandex Cloud Postbox, and Yandex Data Streams / Yandex Cloud event infrastructure, as described in the Privacy Policy.",
        },
      ],
    },
    {
      heading: "5. Duration and withdrawal",
      blocks: [
        {
          type: "p",
          text: `Consent remains in effect until it is withdrawn or until data is deleted or anonymized after the processing purposes have been achieved. Consent may be withdrawn by writing to ${LEGAL_CONTACT_EMAIL}.`,
        },
        {
          type: "p",
          text: "After withdrawal, the operator stops processing that required consent unless another lawful ground applies. There is no self-service Delete Account button. An account-deletion request is handled by the operator under the Privacy Policy and applicable law.",
        },
      ],
    },
    {
      heading: "6. Training sessions",
      blocks: [
        {
          type: "p",
          text: "By a separate informational acknowledgement the user confirms that they understand that training sessions may include audio recording, transcription, transcript enhancement, and AI analysis using external services, as described in the AI & External Services Notice. That acknowledgement is not a second personal-data consent: consent to processing is given separately in this document. This is not a persisted per-participant recording-consent record created at the moment recording starts.",
        },
        {
          type: "p",
          text: "Users should not place unnecessary sensitive, secret, or otherwise restricted information in the service.",
        },
      ],
    },
  ],
};
