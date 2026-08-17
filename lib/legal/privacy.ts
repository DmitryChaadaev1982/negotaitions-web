import type { Locale } from "@/lib/i18n/config";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_EN_LEGAL,
  LEGAL_OPERATOR_RU,
  LEGAL_PRODUCT_EN,
  LEGAL_PRODUCT_RU,
} from "@/lib/legal/meta";
import type { LegalDocument } from "@/lib/legal/types";

export function getPrivacyDocument(locale: Locale): LegalDocument {
  return locale === "ru" ? ruPrivacy : enPrivacy;
}

const ruPrivacy: LegalDocument = {
  route: "/privacy",
  title: "Политика обработки персональных данных",
  sections: [
    {
      heading: "1. Оператор и сервис",
      blocks: [
        {
          type: "p",
          text: `Оператором персональных данных является ${LEGAL_OPERATOR_RU}. Оператор действует как физическое лицо. Сервис — учебная платформа ${LEGAL_PRODUCT_RU}.`,
        },
        {
          type: "p",
          text: `Контактный адрес электронной почты: ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
    {
      heading: "2. О документе",
      blocks: [
        {
          type: "p",
          text: "Настоящая Политика описывает, какие персональные данные обрабатываются при использовании сервиса, для каких целей, с привлечением каких внешних сервисов и какие права есть у субъекта персональных данных.",
        },
        {
          type: "p",
          text: `Документ применяется вместе с [[Пользовательским соглашением|/terms]], [[Согласием на обработку персональных данных|/data-processing-consent]], [[Политикой использования cookie и хранения данных в браузере|/cookie-policy]] и [[Уведомлением об ИИ и внешних сервисах|/ai-processing-notice]].`,
        },
        {
          type: "p",
          text: "Обработка персональных данных осуществляется в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».",
        },
      ],
    },
    {
      heading: "3. Правовые основания",
      blocks: [
        {
          type: "p",
          text: "Обработка осуществляется на основании согласия субъекта персональных данных и в объёме, необходимом для предоставления запрошенного сервиса, включая создание и ведение аккаунта, проведение учебных сессий и связанные технические операции.",
        },
        {
          type: "p",
          text: "Оператор может продолжить обработку без согласия, если это допускается законом, в том числе для исполнения требований законодательства, защиты прав и законных интересов либо исполнения судебного акта.",
        },
      ],
    },
    {
      heading: "4. Цели обработки",
      blocks: [
        {
          type: "p",
          text: "Персональные данные обрабатываются для следующих целей:",
        },
        {
          type: "ul",
          items: [
            "создание аккаунта и аутентификация;",
            "администрирование аккаунтов, включая рассмотрение регистрации и изменение статуса;",
            "организация и проведение учебных переговорных сессий;",
            "управление участием, ролями и доступом к сессии;",
            "аудиозапись учебной сессии;",
            "транскрибация записи;",
            "улучшение транскрипта;",
            "ИИ-анализ учебной сессии и подготовка учебной обратной связи;",
            "отображение разрешённых материалов сессии и учебной обратной связи;",
            "обеспечение безопасности, предотвращение злоупотреблений и защита работоспособности сервиса;",
            "отправка сервисных и транзакционных сообщений электронной почты, которые сервис направляет;",
            "техническая эксплуатация, диагностика и устранение сбоев.",
          ],
        },
        {
          type: "p",
          text: "Маркетинговая рассылка не ведётся. Оператор не обрабатывает данные для продвижения товаров или услуг путём прямых контактов в маркетинговых целях.",
        },
      ],
    },
    {
      heading: "5. Категории персональных данных",
      blocks: [
        {
          type: "p",
          text: "В зависимости от использования сервиса могут обрабатываться:",
        },
        {
          type: "ul",
          items: [
            "адрес электронной почты;",
            "отображаемое имя;",
            "хеш пароля (сервис не хранит пароль в открытом виде);",
            "статус аккаунта и сведения о рассмотрении регистрации;",
            "временные метки аккаунта и сессий;",
            "заголовок User-Agent, если он собирается;",
            "IP-адрес в технических журналах веб-сервера и безопасности;",
            "хеш, отпечаток или иное преобразованное значение, полученное из IP-адреса, для отдельных записей аккаунта, сессии, согласия или безопасности;",
            "сведения об участии в мероприятиях и сессиях, включая роли;",
            "заметки, которые пользователь вводит в сервисе;",
            "аудиозапись учебной сессии;",
            "транскрипт, сегменты транскрипта и сопоставление говорящих;",
            "результаты ИИ-анализа и учебной обратной связи;",
            "технические идентификаторы, необходимые для работы сервиса;",
            "служебные сведения о доставке электронной почты, включая сведения о доставке, отказе или жалобе, если такие события поступают от почтового провайдера.",
          ],
        },
        {
          type: "p",
          text: "Аудиозапись голоса используется для учебной записи, транскрибации и анализа. Она не используется сервисом как биометрические персональные данные для установления личности.",
        },
        {
          type: "p",
          text: "Сервис не предназначен для обработки специальных категорий персональных данных, государственной тайны, коммерческой тайны, платёжных реквизитов, учётных данных и иных сведений, которые нельзя передавать для учебной тренировки.",
        },
      ],
    },
    {
      heading: "6. Учебные сессии, запись, транскрипт и ИИ",
      blocks: [
        {
          type: "p",
          text: "Сервис предназначен для учебных переговорных сессий. Запись в текущей производственной конфигурации ведётся только в звуке. Запись запускается в рамках жизненного цикла учебной сессии, которым управляет фасилитатор. В интерфейсе отображается признак записи.",
        },
        {
          type: "p",
          text: "Отдельная отметка согласия каждого участника непосредственно в момент начала записи не создаётся. Согласие на соответствующую обработку фиксируется отдельной записью текущего правового релиза, как описано в Согласии на обработку персональных данных.",
        },
        {
          type: "p",
          text: "Запись используется как учебный материал сессии, для автоматической транскрибации после завершения записи и для последующего анализа. Объекты записи приложения хранятся в Yandex Object Storage.",
        },
        {
          type: "p",
          text: "Живые коммуникации и инфраструктура записи обеспечиваются Voximplant. Оператор не утверждает, что Voximplant не сохраняет собственную копию записи, и не указывает срок хранения на стороне этого провайдера: такие сведения оператором не подтверждены.",
        },
        {
          type: "p",
          text: "Транскрибация выполняется через Yandex SpeechKit. Улучшение транскрипта и ИИ-анализ учебной сессии выполняются через ИИ-сервисы, предоставляемые в инфраструктуре Yandex Cloud. Конкретное имя модели может меняться без изменения цели обработки.",
        },
        {
          type: "p",
          text: "Для анализа могут обрабатываться транскрипт, открытый контекст учебного кейса и сессии, сведения о целях, ограничениях и вводных роли, если они нужны для анализа, отображаемые имена участников, идентификаторы участников сессии, заметки участников и иной контекст сессии, необходимый для анализа. Адреса электронной почты в ИИ-анализ не передаются. Автоматическая очистка персональных данных перед отправкой в ИИ-сервис не применяется.",
        },
        {
          type: "p",
          text: "Результат ИИ-анализа может содержать ошибки, быть неполным или не соответствовать фактическому ходу переговоров. Он является дополнительным учебным материалом, а не объективной истиной и не профессиональной консультацией. ИИ не ведёт переговоры вместо пользователя. Пользователь должен критически оценивать выводы, сформированные ИИ.",
        },
      ],
    },
    {
      heading: "7. Доступ к материалам сессии",
      blocks: [
        {
          type: "p",
          text: "Доступ к материалам сессии зависит от роли и от того, какие материалы были явно предоставлены.",
        },
        {
          type: "ul",
          items: [
            "Фасилитатор может получать доступ к записи, транскрипту и полному ИИ-анализу, доступному фасилитатору.",
            "Участники переговоров могут получать доступ к записи и транскрипту через материалы сессии. Персональная и общая учебная проекция ИИ-анализа предоставляется участнику после явной публикации и предоставления доступа.",
            "Наблюдатели могут получать доступ к наблюдательской проекции опубликованных материалов после явной публикации и предоставления доступа. Наблюдатели не получают персональную обратную связь других участников.",
          ],
        },
        {
          type: "p",
          text: "Материалы сессии не являются общедоступными страницами сайта. Доступ имеют лица, допущенные к соответствующей сессии в рамках сервиса.",
        },
      ],
    },
    {
      heading: "8. Внешние сервисы",
      blocks: [
        {
          type: "p",
          text: "Для работы сервиса привлекаются внешние сервисы. В текущей производственной конфигурации это:",
        },
        {
          type: "ul",
          items: [
            "Voximplant — живые коммуникации и инфраструктура записи;",
            "Yandex Object Storage — хранение объектов записи приложения; регион объектного хранилища ru-central1;",
            "Yandex Cloud — размещение приложения (зона виртуальной машины ru-central1-b);",
            "Yandex Managed PostgreSQL — основная база данных;",
            "Yandex SpeechKit — транскрибация;",
            "ИИ-сервисы, предоставляемые в инфраструктуре Yandex Cloud, — улучшение транскрипта и ИИ-анализ;",
            "Yandex Cloud Postbox — доставка сервисной электронной почты;",
            "Yandex Data Streams / инфраструктура событий Yandex Cloud — обработка или передача служебных сведений о доставке, отказе или жалобе.",
          ],
        },
        {
          type: "p",
          text: "Оператор не утверждает, что внешние сервисы не сохраняют переданные сведения, не используют их для обучения собственных моделей и не обрабатывают их за пределами Российской Федерации, если это не подтверждено отдельно.",
        },
      ],
    },
    {
      heading: "9. Электронная почта",
      blocks: [
        {
          type: "p",
          text: "Сервис может направлять сообщения, связанные с безопасностью и работой аккаунта, в том числе о сбросе пароля и иные операционные уведомления, которые сервис направляет. Доставка выполняется через Yandex Cloud Postbox. Служебные сведения о доставке, отказе или жалобе могут обрабатываться или передаваться через Yandex Data Streams / инфраструктуру событий Yandex Cloud.",
        },
        {
          type: "p",
          text: "Маркетинговые рассылки не отправляются. Приглашения на мероприятия по электронной почте в настоящее время не отправляются.",
        },
      ],
    },
    {
      heading: "10. Cookie и хранение данных в браузере",
      blocks: [
        {
          type: "p",
          text: `Состав cookie, localStorage и sessionStorage описан в [[Политике использования cookie и хранения данных в браузере|/cookie-policy]]. Аналитические и маркетинговые средства сбора статистики в настоящее время не подключены.`,
        },
      ],
    },
    {
      heading: "11. Место обработки и трансграничная передача",
      blocks: [
        {
          type: "p",
          text: "Приложение размещается в Yandex Cloud, зона виртуальной машины ru-central1-b. Объекты записи хранятся в Yandex Object Storage, регион ru-central1. Основная база данных использует Yandex Managed PostgreSQL.",
        },
        {
          type: "p",
          text: "Оператор не утверждает, что все персональные данные обрабатываются исключительно на территории Российской Федерации. География обработки на стороне Voximplant уточняется. При обработке персональных данных за пределами Российской Федерации к такой обработке применяются требования законодательства Российской Федерации о трансграничной передаче персональных данных.",
        },
      ],
    },
    {
      heading: "12. Сроки хранения",
      blocks: [
        {
          type: "p",
          text: "Персональные данные хранятся не дольше, чем этого требуют цели их обработки или иные применимые законные основания, после чего удаляются либо обезличиваются, если закон не предусматривает иное.",
        },
        {
          type: "p",
          text: "Сервис в настоящее время не устанавливает и не применяет фиксированные продуктовые сроки хранения для аккаунтов, сессий, записей, транскриптов и ИИ-анализов. Оператор не обещает автоматическое удаление по истечении заранее заданного календарного срока, если такое удаление не реализовано.",
        },
      ],
    },
    {
      heading: "13. Права субъекта. Удаление аккаунта",
      blocks: [
        {
          type: "p",
          text: `Субъект персональных данных может обратиться к оператору по адресу ${LEGAL_CONTACT_EMAIL} по вопросам, связанным с доступом к своим персональным данным, их уточнением, прекращением или ограничением обработки, отзывом согласия и удалением аккаунта, а также по иным вопросам обработки персональных данных.`,
        },
        {
          type: "p",
          text: "Самостоятельная кнопка удаления аккаунта в сервисе не предоставляется. Запрос рассматривается оператором. Немедленное удаление не гарантируется. Сроки рассмотрения определяются применимым законодательством, а не отдельным сервисным SLA.",
        },
        {
          type: "p",
          text: "По запросу об удалении аккаунта оператор может сочетать удаление и обезличивание: прекратить доступ к аккаунту, удалить прямую связь с аккаунтом лица, удалить персональные данные, которые более не требуется сохранять, и сохранить историю учебной сессии только там, где она достаточно обезличена. Простая замена отображаемого имени сама по себе не считается полным обезличиванием.",
        },
        {
          type: "p",
          text: "Если аудиозапись содержит участие обратившегося пользователя, в обычном порядке такая запись удаляется, а не выдаётся за обезличенную. Удаление касается объектов хранения приложения. Удаление копии на стороне Voximplant, если она существует, зависит от возможностей и процедур провайдера; срок хранения на стороне провайдера оператором не подтверждён.",
        },
        {
          type: "p",
          text: "Транскрипт может быть сохранён только при достаточном обезличивании. Если надёжное обезличивание конкретного транскрипта недостижимо, транскрипт удаляется. Персональная ИИ-обратная связь обратившегося пользователя удаляется; общие материалы проверяются на идентифицирующие сведения. Если безопасное редактирование не гарантирует достаточное обезличивание, анализ удаляется.",
        },
      ],
    },
    {
      heading: "14. Меры защиты",
      blocks: [
        {
          type: "p",
          text: "Оператор принимает организационные и технические меры, направленные на защиту персональных данных, включая разграничение доступа, передачу данных по защищённым соединениям TLS, хранение пароля только в виде хеша и использование защищённого сессионного cookie. Полный перечень мер защиты и сведения о средствах криптографической защиты в этом публичном документе не раскрываются сверх необходимого.",
        },
      ],
    },
    {
      heading: "15. Изменение Политики",
      blocks: [
        {
          type: "p",
          text: "Оператор может обновлять эту Политику. Актуальная редакция публикуется на этой странице с указанием версии и даты обновления. Если изменение требует нового подтверждения или согласия, пользователи, у которых нет записей текущего правового релиза, подтверждают их в приложении до продолжения обычного использования платформы. Не каждое изменение текста требует повторного подтверждения.",
        },
      ],
    },
  ],
};

const enPrivacy: LegalDocument = {
  route: "/privacy",
  title: "Privacy Policy",
  sections: [
    {
      heading: "1. Operator and service",
      blocks: [
        {
          type: "p",
          text: `The personal-data operator is ${LEGAL_OPERATOR_EN_LEGAL}. The operator acts as a natural person. The service is the training platform ${LEGAL_PRODUCT_EN}.`,
        },
        {
          type: "p",
          text: `Contact email: ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
    {
      heading: "2. About this document",
      blocks: [
        {
          type: "p",
          text: "This Policy describes the personal data processed when the service is used, the purposes of processing, the external services involved, and the rights of the data subject.",
        },
        {
          type: "p",
          text: `It applies together with the [[Terms of Use|/terms]], the [[Personal Data Processing Consent|/data-processing-consent]], the [[Cookie and Browser Storage Policy|/cookie-policy]], and the [[AI & External Services Notice|/ai-processing-notice]].`,
        },
        {
          type: "p",
          text: "Personal data is processed in accordance with Federal Law No. 152-FZ of 27 July 2006 “On Personal Data”.",
        },
      ],
    },
    {
      heading: "3. Legal bases",
      blocks: [
        {
          type: "p",
          text: "Processing is based on the data subject’s consent and on what is necessary to provide the requested service, including account creation and maintenance, training sessions, and related technical operations.",
        },
        {
          type: "p",
          text: "The operator may continue processing without consent where the law allows it, including to comply with legal requirements, protect rights and legitimate interests, or execute a court act.",
        },
      ],
    },
    {
      heading: "4. Purposes of processing",
      blocks: [
        {
          type: "p",
          text: "Personal data is processed for the following purposes:",
        },
        {
          type: "ul",
          items: [
            "account creation and authentication;",
            "account administration, including review of registration and status changes;",
            "organisation and conduct of training negotiation sessions;",
            "participation, role, and session-access management;",
            "audio recording of a training session;",
            "transcription of the recording;",
            "transcript enhancement;",
            "AI analysis of a training session and preparation of training feedback;",
            "display of permitted session materials and training feedback;",
            "security, abuse prevention, and protection of service operation;",
            "transactional and service email that the service sends;",
            "technical operation, diagnostics, and incident handling.",
          ],
        },
        {
          type: "p",
          text: "No marketing mail is sent. The operator does not process data to promote goods or services through direct marketing contacts.",
        },
      ],
    },
    {
      heading: "5. Categories of personal data",
      blocks: [
        {
          type: "p",
          text: "Depending on use of the service, the following may be processed:",
        },
        {
          type: "ul",
          items: [
            "email address;",
            "display name;",
            "password hash (the service does not store a raw password);",
            "account status and registration-review information;",
            "account and session timestamps;",
            "User-Agent where collected;",
            "IP address in web-server and security technical logs;",
            "a hash, fingerprint, or other transformed IP-derived value for certain account, session, consent, or security records;",
            "event and session participation, including roles;",
            "notes entered by the user;",
            "audio recording of a training session;",
            "transcript, transcript segments, and speaker mapping;",
            "AI analysis and training feedback;",
            "technical identifiers needed to operate the service;",
            "email delivery and security metadata, including delivery, bounce, or complaint information if such events are received from the mail provider.",
          ],
        },
        {
          type: "p",
          text: "A voice recording is used for the training record, transcription, and analysis. The service does not use it as biometric personal data to identify a person.",
        },
        {
          type: "p",
          text: "The service is not intended for special-category personal data, state secrets, trade secrets, payment details, credentials, or other information that must not be used in training practice.",
        },
      ],
    },
    {
      heading: "6. Training sessions, recording, transcript, and AI",
      blocks: [
        {
          type: "p",
          text: "The service is intended for training negotiation sessions. In the current production configuration, recording is audio-only. Recording starts as part of the facilitator-controlled training-session lifecycle. The interface shows a recording indication.",
        },
        {
          type: "p",
          text: "A separate recording-consent mark is not created for each participant at the moment recording starts. Consent to the relevant processing is stored as a separate record of the current legal release, as described in the Personal Data Processing Consent.",
        },
        {
          type: "p",
          text: "The recording is used as training-session material, for automatic transcription after the recording is completed, and for later analysis. Application recording objects are stored in Yandex Object Storage.",
        },
        {
          type: "p",
          text: "Live communications and recording infrastructure are provided by Voximplant. The operator does not state that Voximplant keeps no copy of a recording, and does not state a provider-side retention period: those facts have not been confirmed by the operator.",
        },
        {
          type: "p",
          text: "Transcription is performed through Yandex SpeechKit. Transcript enhancement and AI-supported negotiation analysis are performed through AI services provided via Yandex Cloud infrastructure. The specific model name may change without changing the purpose of processing.",
        },
        {
          type: "p",
          text: "Analysis may process the transcript, open case and session context, role objectives, constraints, and briefing information where required for analysis, participant display names, session participant identifiers, participant notes, and other session context required for the analysis. Email addresses are not sent to AI analysis. Automatic personal-data scrubbing before submission to the AI service is not applied.",
        },
        {
          type: "p",
          text: "AI output may contain errors, be incomplete, or fail to reflect the actual negotiation. It is supplementary training material, not objective truth and not professional advice. AI does not negotiate instead of the user. Users should critically evaluate AI-generated conclusions.",
        },
      ],
    },
    {
      heading: "7. Access to session materials",
      blocks: [
        {
          type: "p",
          text: "Access to session materials depends on role and on what has been explicitly granted.",
        },
        {
          type: "ul",
          items: [
            "The facilitator may access the recording, the transcript, and the full analysis available to the facilitator.",
            "Negotiating participants may access the recording and transcript through session materials. A participant-specific or shared AI projection is provided after explicit publication and grant.",
            "Observers may receive the observer-safe projection of published materials after explicit publication and grant. Observers do not receive other participants’ personal feedback.",
          ],
        },
        {
          type: "p",
          text: "Session materials are not public website pages. Access is limited to people admitted to the relevant session in the service.",
        },
      ],
    },
    {
      heading: "8. External services",
      blocks: [
        {
          type: "p",
          text: "External services are used to operate the service. In the current production configuration these are:",
        },
        {
          type: "ul",
          items: [
            "Voximplant — live communications and recording infrastructure;",
            "Yandex Object Storage — storage of application recording objects; object-storage region ru-central1;",
            "Yandex Cloud — application hosting (virtual-machine zone ru-central1-b);",
            "Yandex Managed PostgreSQL — primary database;",
            "Yandex SpeechKit — transcription;",
            "AI services provided through Yandex Cloud infrastructure — transcript enhancement and AI analysis;",
            "Yandex Cloud Postbox — delivery of service email;",
            "Yandex Data Streams / Yandex Cloud event infrastructure — processing or transport of technical delivery, bounce, or complaint events.",
          ],
        },
        {
          type: "p",
          text: "The operator does not state that external services do not retain submitted data, do not use it to train their own models, or do not process it outside the Russian Federation, unless that is separately confirmed.",
        },
      ],
    },
    {
      heading: "9. Email",
      blocks: [
        {
          type: "p",
          text: "The service may send messages related to account security and operation, including password reset and other operational notices that the service sends. Delivery is performed through Yandex Cloud Postbox. Technical delivery, bounce, or complaint events may be processed or transported through Yandex Data Streams / Yandex Cloud event infrastructure.",
        },
        {
          type: "p",
          text: "No marketing mail is sent. Event invitation email is not currently sent.",
        },
      ],
    },
    {
      heading: "10. Cookies and browser storage",
      blocks: [
        {
          type: "p",
          text: `Cookies, localStorage, and sessionStorage are described in the [[Cookie and Browser Storage Policy|/cookie-policy]]. Analytics and marketing tracking are not currently enabled.`,
        },
      ],
    },
    {
      heading: "11. Place of processing and cross-border transfer",
      blocks: [
        {
          type: "p",
          text: "The application is hosted in Yandex Cloud, virtual-machine zone ru-central1-b. Recording objects are stored in Yandex Object Storage, region ru-central1. The primary database uses Yandex Managed PostgreSQL.",
        },
        {
          type: "p",
          text: "The operator does not state that all personal data is processed only in the Russian Federation. Voximplant processing geography is being clarified. Where personal data is processed outside the Russian Federation, such processing is subject to the requirements of the Russian Federation’s legislation on cross-border transfer of personal data.",
        },
      ],
    },
    {
      heading: "12. Retention",
      blocks: [
        {
          type: "p",
          text: "Personal data is kept no longer than required for the relevant processing purposes or other applicable legal grounds, after which it is deleted or anonymized unless the law provides otherwise.",
        },
        {
          type: "p",
          text: "The product does not currently set or enforce fixed retention periods for accounts, sessions, recordings, transcripts, or AI analyses. The operator does not promise automatic deletion after a preset calendar period unless such deletion is implemented.",
        },
      ],
    },
    {
      heading: "13. Data-subject rights. Account deletion",
      blocks: [
        {
          type: "p",
          text: `A data subject may contact the operator at ${LEGAL_CONTACT_EMAIL} about access to personal data, correction, termination or restriction of processing, withdrawal of consent, account deletion, and other personal-data questions.`,
        },
        {
          type: "p",
          text: "There is no self-service Delete Account button. A request is handled by the operator. Immediate deletion is not promised. Time limits follow applicable law and are not a separate product SLA.",
        },
        {
          type: "p",
          text: "An account-deletion request may result in a combination of deletion and anonymization: terminate account access, remove direct links to the person’s account, delete personal data that no longer needs to remain, and keep training-session history only where it has been sufficiently anonymized. Simply replacing a display name is not treated as complete anonymization.",
        },
        {
          type: "p",
          text: "If an audio recording contains the requesting user’s participation, the normal process is to delete that recording rather than treat it as anonymized. Deletion covers application storage objects. Deletion of any provider-side Voximplant copy, if one exists, depends on the provider’s capabilities and procedures; the provider-side retention period has not been confirmed by the operator.",
        },
        {
          type: "p",
          text: "A transcript may be retained only where it is sufficiently anonymized. If reliable anonymization of the specific transcript is not feasible, it is deleted. The requesting user’s personal AI feedback is removed; shared analysis is reviewed for identifying references. If safely editing an analysis cannot guarantee sufficient anonymization, the analysis is deleted.",
        },
      ],
    },
    {
      heading: "14. Security measures",
      blocks: [
        {
          type: "p",
          text: "The operator takes organisational and technical measures to protect personal data, including access control, TLS-protected transmission, storing passwords only as hashes, and a protected session cookie. The full list of security measures and cryptographic-tool details is not disclosed in this public document beyond what is necessary.",
        },
      ],
    },
    {
      heading: "15. Changes to this Policy",
      blocks: [
        {
          type: "p",
          text: "The operator may update this Policy. The current edition is published on this page with the version and update date. If a change requires a new acknowledgement or consent, users who do not yet have the current legal-release records confirm them in the application before continuing ordinary use of the platform. Not every wording change requires re-confirmation.",
        },
      ],
    },
  ],
};
