import type { Metadata } from "next";
import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { CookieSettingsButton } from "@/components/cookie-banner";

export const metadata: Metadata = {
  title: "Cookie Policy",
};

export default async function CookiePolicyPage() {
  const locale = await getServerLocale();
  const d = await getDictionary(locale);
  const isRu = locale === "ru";

  return (
    <div className="min-h-screen bg-[#020617]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          ⚠️ {d.legal.draftNotice}
        </div>

        <h1 className="text-3xl font-bold text-slate-50 mb-2">{d.legal.cookiePolicy}</h1>
        <p className="text-slate-500 text-sm mb-10">
          {isRu ? "Последнее обновление: черновик MVP" : "Last updated: MVP draft"}
        </p>

        <article className="space-y-8 text-slate-300">
          {isRu ? (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Что такое cookie и локальное хранилище</h2>
                <p>Cookie — небольшие текстовые файлы, которые сайт сохраняет в вашем браузере. Локальное хранилище (localStorage) — аналогичный механизм для данных на стороне клиента.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Что мы используем</h2>
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">auth_session — сессионный cookie</h3>
                    <p className="text-sm text-slate-400">HttpOnly, защищённый cookie для аутентификации пользователя. Хранит только токен сессии (не пароль, не персональные данные). Обязателен для работы авторизации.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Необходимый</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions_locale — языковые предпочтения</h3>
                    <p className="text-sm text-slate-400">Cookie и localStorage. Сохраняет выбранный язык интерфейса (RU/EN). Не содержит персональных данных.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Необходимый / Функциональный</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions.recovery.v1 — восстановление гостевой сессии</h3>
                    <p className="text-sm text-slate-400">localStorage. Хранит токены доступа к текущей сессии для гостевого переподключения. Автоматически истекает через 12 часов. Не передаётся третьим лицам.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Необходимый</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions.cookieConsent.v1 — настройки cookie</h3>
                    <p className="text-sm text-slate-400">localStorage. Хранит ваши предпочтения по cookie (принять/отклонить). Не содержит токенов аутентификации или персональных данных.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Необходимый</span>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Аналитические и маркетинговые cookie</h2>
                <p>В настоящее время аналитические и маркетинговые cookie не используются. Если они будут добавлены в будущем, использование будет возможно только с вашего явного согласия.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Как изменить настройки</h2>
                <p className="mb-3">Вы можете изменить настройки cookie в любой момент:</p>
                <CookieSettingsButton className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors" />
                <p className="mt-3 text-sm text-slate-500">Также можно очистить localStorage и cookie через настройки браузера.</p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">What are cookies and local storage</h2>
                <p>Cookies are small text files a website saves in your browser. Local storage (localStorage) is a similar mechanism for client-side data.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">What we use</h2>
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">auth_session — session cookie</h3>
                    <p className="text-sm text-slate-400">HttpOnly, secure cookie for user authentication. Stores only a session token (not password or personal data). Required for the auth system.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Strictly Necessary</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions_locale — language preference</h3>
                    <p className="text-sm text-slate-400">Cookie and localStorage. Stores your chosen interface language (RU/EN). Contains no personal data.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Strictly Necessary / Functional</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions.recovery.v1 — guest session recovery</h3>
                    <p className="text-sm text-slate-400">localStorage. Stores access tokens for the current session to allow guest reconnection. Expires automatically after 12 hours. Not shared with third parties.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Strictly Necessary</span>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                    <h3 className="font-semibold text-slate-100 mb-1">negotaitions.cookieConsent.v1 — cookie preferences</h3>
                    <p className="text-sm text-slate-400">localStorage. Stores your cookie consent choices (accept/reject). Contains no authentication tokens or personal data.</p>
                    <span className="mt-2 inline-block text-xs text-emerald-400 font-medium">Strictly Necessary</span>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">Analytics & marketing cookies</h2>
                <p>No analytics or marketing cookies are currently used. If they are added in the future, their use will only be enabled with your explicit consent.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-3">How to change your preferences</h2>
                <p className="mb-3">You can change your cookie preferences at any time:</p>
                <CookieSettingsButton className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors" />
                <p className="mt-3 text-sm text-slate-500">You can also clear localStorage and cookies via your browser settings.</p>
              </section>
            </>
          )}
        </article>

        <div className="mt-10 border-t border-slate-800 pt-6 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-slate-300">{d.legal.privacyPolicy}</Link>
          <Link href="/terms" className="hover:text-slate-300">{d.legal.termsOfUse}</Link>
          <Link href="/data-processing-consent" className="hover:text-slate-300">{d.legal.dataProcessingConsent}</Link>
          <Link href="/ai-processing-notice" className="hover:text-slate-300">{d.legal.aiProcessingNotice}</Link>
        </div>
      </div>
    </div>
  );
}
