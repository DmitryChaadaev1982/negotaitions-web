import type { Locale } from "@/lib/i18n/config";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/meta";
import type { LegalDocument } from "@/lib/legal/types";

export function getCookieDocument(locale: Locale): LegalDocument {
  return locale === "ru" ? ruCookies : enCookies;
}

const ruCookies: LegalDocument = {
  route: "/cookie-policy",
  title: "Политика использования cookie и хранения данных в браузере",
  sections: [
    {
      heading: "1. О документе",
      blocks: [
        {
          type: "p",
          text: "Эта Политика описывает, какие сведения сервис сохраняет в браузере: HTTP-cookie, localStorage и sessionStorage. localStorage и sessionStorage не являются HTTP-cookie.",
        },
        {
          type: "p",
          text: "Необязательная аналитика публичного сайта может использовать Яндекс Метрику только после согласия на аналитику. Маркетинговые трекеры не подключены.",
        },
      ],
    },
    {
      heading: "2. Что сохраняется",
      blocks: [
        {
          type: "p",
          text: "auth_session — HTTP-cookie. Защищённый HttpOnly-cookie сессии аккаунта. Нужен для входа. Относится к необходимым сведениям.",
        },
        {
          type: "p",
          text: "negotaitions_locale — cookie и localStorage. Сохраняет выбранный язык интерфейса (ru или en). Нужен для отображения сервиса на выбранном языке.",
        },
        {
          type: "p",
          text: "negotaitions.cookieConsent.v2 — localStorage, не HTTP-cookie. Сохраняет выбор в отношении необходимых, аналитических и маркетинговых категорий. Исторический ключ v1 не используется как согласие на аналитику.",
        },
        {
          type: "p",
          text: "negotaitions.recovery.v1 — localStorage, не HTTP-cookie. Сохраняет технические подсказки для повторного входа в мероприятие или сессию: тип контекста и при наличии идентификаторы мероприятия или сессии. Гостевые токены доступа в этом хранилище не сохраняются.",
        },
        {
          type: "p",
          text: "negotiations.session-left:{sessionId} — sessionStorage, не HTTP-cookie. Кратковременный признак выхода из комнаты сессии. Действует, пока открыта вкладка браузера.",
        },
      ],
    },
    {
      heading: "3. Аналитика и маркетинг",
      blocks: [
        {
          type: "p",
          text: "Яндекс Метрика может загружаться только на публичных страницах сайта (главная, Об авторе, FAQ, Поддержка) и только если вы дали согласие на аналитику. Она использует cookie и хранилище браузера для учёта посещаемости публичного сайта. Вебвизор (запись сессий) в этой конфигурации не включается. Метрика не загружается в личном кабинете, комнате переговоров, на страницах входа и регистрации и на странице /legal-update. Маркетинговые cookie и скрипты не используются. Отзыв согласия на аналитику останавливает дальнейшую работу Яндекс Метрики в этом приложении; сведения, уже переданные в Яндекс Метрику, это действие не удаляет.",
        },
      ],
    },
    {
      heading: "4. Управление выбором",
      blocks: [
        {
          type: "p",
          text: "Необходимые сведения, без которых сервис не может выполнить запрошенную функцию входа или сохранить язык, используются для работы сервиса. Необязательные категории можно принять, отклонить или изменить через настройки cookie на сайте, а также удалить через настройки браузера.",
        },
        {
          type: "p",
          text: `Вопросы по обработке персональных данных можно направить на ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
  ],
};

const enCookies: LegalDocument = {
  route: "/cookie-policy",
  title: "Cookie and Browser Storage Policy",
  sections: [
    {
      heading: "1. About this document",
      blocks: [
        {
          type: "p",
          text: "This Policy describes what the service stores in the browser: HTTP cookies, localStorage, and sessionStorage. localStorage and sessionStorage are not HTTP cookies.",
        },
        {
          type: "p",
          text: "Optional public-site analytics may use Yandex Metrica only after analytics consent. Marketing trackers are not enabled.",
        },
      ],
    },
    {
      heading: "2. What is stored",
      blocks: [
        {
          type: "p",
          text: "auth_session — HTTP cookie. A protected HttpOnly account-session cookie. Required for sign-in. This is necessary storage.",
        },
        {
          type: "p",
          text: "negotaitions_locale — cookie and localStorage. Stores the chosen interface language (ru or en). Needed to show the service in the selected language.",
        },
        {
          type: "p",
          text: "negotaitions.cookieConsent.v2 — localStorage, not an HTTP cookie. Stores the choice for necessary, analytics, and marketing categories. The historical v1 key is not treated as analytics consent.",
        },
        {
          type: "p",
          text: "negotaitions.recovery.v1 — localStorage, not an HTTP cookie. Stores technical rejoin hints for an event or session: context type and, where present, event or session identifiers. Guest access tokens are not stored in this key.",
        },
        {
          type: "p",
          text: "negotiations.session-left:{sessionId} — sessionStorage, not an HTTP cookie. A short-lived flag that the user left the session room. It lasts while the browser tab remains open.",
        },
      ],
    },
    {
      heading: "3. Analytics and marketing",
      blocks: [
        {
          type: "p",
          text: "Yandex Metrica may load only on public site pages (home, About, FAQ, Support) and only if you have given analytics consent. It uses cookies and browser storage for public-site traffic statistics. Webvisor / session replay is not enabled in this configuration. Metrica does not load in the authenticated application, negotiation room, sign-in or registration pages, or /legal-update. Marketing cookies and scripts are not used. Withdrawing analytics consent stops further Yandex Metrica use by this application; it does not erase data already sent to Yandex Metrica.",
        },
      ],
    },
    {
      heading: "4. Managing your choice",
      blocks: [
        {
          type: "p",
          text: "Necessary items without which the service cannot perform the requested sign-in function or remember language are used to operate the service. Optional categories can be accepted, rejected, or changed through cookie settings on the site, and can also be cleared in browser settings.",
        },
        {
          type: "p",
          text: `Questions about personal-data processing can be sent to ${LEGAL_CONTACT_EMAIL}.`,
        },
      ],
    },
  ],
};
