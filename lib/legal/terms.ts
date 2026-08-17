import type { Locale } from "@/lib/i18n/config";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR_EN_LEGAL,
  LEGAL_OPERATOR_RU,
  LEGAL_PRODUCT_EN,
  LEGAL_PRODUCT_RU,
} from "@/lib/legal/meta";
import type { LegalDocument } from "@/lib/legal/types";

export function getTermsDocument(locale: Locale): LegalDocument {
  return locale === "ru" ? ruTerms : enTerms;
}

const ruTerms: LegalDocument = {
  route: "/terms",
  title: "Пользовательское соглашение",
  sections: [
    {
      heading: "1. Стороны и предмет",
      blocks: [
        {
          type: "p",
          text: `Настоящее Соглашение регулирует использование учебной платформы ${LEGAL_PRODUCT_RU}. Сервис предоставляется ${LEGAL_OPERATOR_RU}.`,
        },
        {
          type: "p",
          text: `Контакт: ${LEGAL_CONTACT_EMAIL}.`,
        },
        {
          type: "p",
          text: "Регистрируясь или иным образом используя сервис, пользователь принимает условия этого Соглашения и подтверждает, что ознакомился с Политикой обработки персональных данных.",
        },
      ],
    },
    {
      heading: "2. Назначение сервиса",
      blocks: [
        {
          type: "p",
          text: "Сервис предназначен для организации и проведения учебных переговорных сессий: работы с учебными кейсами и ролями, проведения сессии, аудиозаписи, транскрибации и ИИ-разбора в учебных целях.",
        },
        {
          type: "p",
          text: "Сервис не является площадкой для заключения реальных сделок, не предоставляет юридических, финансовых, медицинских или иных профессиональных консультаций и не ведёт переговоры вместо пользователя.",
        },
      ],
    },
    {
      heading: "3. Аккаунт",
      blocks: [
        {
          type: "p",
          text: "Для использования платформы создаётся аккаунт. Пользователь указывает отображаемое имя, адрес электронной почты и пароль. Пароль хранится в виде хеша.",
        },
        {
          type: "p",
          text: "Новая регистрация, как правило, требует рассмотрения оператором. Оператор может одобрить, отклонить или позднее ограничить аккаунт, если это необходимо для работы сервиса или соблюдения закона.",
        },
        {
          type: "p",
          text: "Пользователь отвечает за сохранность своих учётных данных и не передаёт доступ к аккаунту третьим лицам.",
        },
      ],
    },
    {
      heading: "4. Допустимое использование",
      blocks: [
        {
          type: "p",
          text: "Пользователь обязуется использовать сервис только для учебных целей и соблюдать применимое законодательство.",
        },
        {
          type: "p",
          text: "Не следует размещать в кейсах, заметках, переговорах и иных материалах ненужные реальные сведения о третьих лицах, секреты, платёжные данные, учётные данные, сведения ограниченного доступа и иную информацию, которую нельзя передавать для учебной тренировки.",
        },
        {
          type: "p",
          text: "Запрещается вмешиваться в работу сервиса, пытаться получить несанкционированный доступ, обходить ограничения доступа или использовать сервис способом, который нарушает права других лиц.",
        },
      ],
    },
    {
      heading: "5. Запись, транскрипт и ИИ",
      blocks: [
        {
          type: "p",
          text: "Учебная сессия может записываться в звуке. Запись запускается в рамках жизненного цикла сессии, которым управляет фасилитатор. В интерфейсе отображается признак записи.",
        },
        {
          type: "p",
          text: "Запись может автоматически транскрибироваться, транскрипт может улучшаться, а по материалам сессии может формироваться ИИ-анализ. Подробности обработки описаны в Политике обработки персональных данных и в Уведомлении об ИИ и внешних сервисах.",
        },
        {
          type: "p",
          text: "Результат ИИ является дополнительным учебным материалом. Он может содержать ошибки и не заменяет собственную оценку пользователя или фасилитатора.",
        },
      ],
    },
    {
      heading: "6. Материалы и доступ",
      blocks: [
        {
          type: "p",
          text: "Пользователь сохраняет права на собственные учебные материалы в пределах, допускаемых законом. Оператор получает право использовать их только для предоставления сервиса, включая запись, транскрибацию, анализ и отображение разрешённых материалов участникам соответствующей сессии.",
        },
        {
          type: "p",
          text: "Доступ к материалам сессии зависит от роли и от явной публикации или предоставления доступа. Наблюдатели не получают персональную обратную связь других участников.",
        },
      ],
    },
    {
      heading: "7. Ограничение ответственности",
      blocks: [
        {
          type: "p",
          text: "Сервис предоставляется «как есть». Оператор не гарантирует бесперебойную работу, полную сохранность всех данных или пригодность сервиса для конкретной цели, кроме обязанностей, прямо установленных законом.",
        },
        {
          type: "p",
          text: "Пользователь самостоятельно отвечает за содержание учебных материалов и сведения, которые произносит или вводит в ходе сессии.",
        },
      ],
    },
    {
      heading: "8. Прекращение использования",
      blocks: [
        {
          type: "p",
          text: `Пользователь может прекратить использование сервиса и обратиться по адресу ${LEGAL_CONTACT_EMAIL} с запросом об удалении аккаунта. Самостоятельная кнопка удаления аккаунта не предоставляется. Обработка запроса описана в Политике обработки персональных данных.`,
        },
        {
          type: "p",
          text: "Оператор может ограничить или прекратить доступ при нарушении этого Соглашения, требований закона или при необходимости защиты сервиса и других пользователей.",
        },
      ],
    },
    {
      heading: "9. Изменение условий",
      blocks: [
        {
          type: "p",
          text: "Оператор может обновлять это Соглашение. Актуальная редакция публикуется на этой странице с указанием версии и даты обновления. Если изменение требует нового подтверждения, оно запрашивается в приложении. Не каждое изменение текста требует повторного подтверждения.",
        },
      ],
    },
  ],
};

const enTerms: LegalDocument = {
  route: "/terms",
  title: "Terms of Use",
  sections: [
    {
      heading: "1. Parties and subject",
      blocks: [
        {
          type: "p",
          text: `These Terms govern use of the training platform ${LEGAL_PRODUCT_EN}. The service is provided by ${LEGAL_OPERATOR_EN_LEGAL}.`,
        },
        {
          type: "p",
          text: `Contact: ${LEGAL_CONTACT_EMAIL}.`,
        },
        {
          type: "p",
          text: "By registering or otherwise using the service, the user accepts these Terms and confirms that they have reviewed the Privacy Policy.",
        },
      ],
    },
    {
      heading: "2. Purpose of the service",
      blocks: [
        {
          type: "p",
          text: "The service is intended for organising and running training negotiation sessions: working with training cases and roles, conducting a session, audio recording, transcription, and AI review for training purposes.",
        },
        {
          type: "p",
          text: "The service is not a venue for concluding real deals, does not provide legal, financial, medical, or other professional advice, and does not negotiate instead of the user.",
        },
      ],
    },
    {
      heading: "3. Account",
      blocks: [
        {
          type: "p",
          text: "An account is created to use the platform. The user provides a display name, email address, and password. The password is stored as a hash.",
        },
        {
          type: "p",
          text: "New registration is generally reviewed by the operator. The operator may approve, reject, or later restrict an account where needed to operate the service or comply with law.",
        },
        {
          type: "p",
          text: "The user is responsible for keeping account credentials safe and must not share account access with third parties.",
        },
      ],
    },
    {
      heading: "4. Acceptable use",
      blocks: [
        {
          type: "p",
          text: "The user agrees to use the service only for training purposes and to comply with applicable law.",
        },
        {
          type: "p",
          text: "Users should not place in cases, notes, negotiations, or other materials unnecessary real information about third parties, secrets, payment data, credentials, restricted-access information, or other information that must not be used in training practice.",
        },
        {
          type: "p",
          text: "It is prohibited to interfere with the service, attempt unauthorised access, bypass access restrictions, or use the service in a way that infringes other people’s rights.",
        },
      ],
    },
    {
      heading: "5. Recording, transcript, and AI",
      blocks: [
        {
          type: "p",
          text: "A training session may be recorded in audio. Recording starts as part of the facilitator-controlled session lifecycle. The interface shows a recording indication.",
        },
        {
          type: "p",
          text: "A recording may be transcribed automatically, the transcript may be enhanced, and AI analysis may be produced from session materials. Processing details are described in the Privacy Policy and the AI & External Services Notice.",
        },
        {
          type: "p",
          text: "AI output is supplementary training material. It may contain errors and does not replace the user’s or facilitator’s own judgement.",
        },
      ],
    },
    {
      heading: "6. Materials and access",
      blocks: [
        {
          type: "p",
          text: "The user retains rights in their own training materials to the extent permitted by law. The operator may use them only to provide the service, including recording, transcription, analysis, and display of permitted materials to people in the relevant session.",
        },
        {
          type: "p",
          text: "Access to session materials depends on role and on explicit publication or grant. Observers do not receive other participants’ personal feedback.",
        },
      ],
    },
    {
      heading: "7. Limitation of liability",
      blocks: [
        {
          type: "p",
          text: "The service is provided “as is”. The operator does not guarantee uninterrupted operation, complete preservation of all data, or fitness for a particular purpose, except for duties expressly imposed by law.",
        },
        {
          type: "p",
          text: "The user is responsible for the content of training materials and for information spoken or entered during a session.",
        },
      ],
    },
    {
      heading: "8. Ending use",
      blocks: [
        {
          type: "p",
          text: `The user may stop using the service and contact ${LEGAL_CONTACT_EMAIL} to request account deletion. There is no self-service Delete Account button. How a request is handled is described in the Privacy Policy.`,
        },
        {
          type: "p",
          text: "The operator may restrict or terminate access for breach of these Terms, legal requirements, or to protect the service and other users.",
        },
      ],
    },
    {
      heading: "9. Changes",
      blocks: [
        {
          type: "p",
          text: "The operator may update these Terms. The current edition is published on this page with the version and update date. If a change requires a new acknowledgement, it is requested in the application. Not every wording change requires re-confirmation.",
        },
      ],
    },
  ],
};
