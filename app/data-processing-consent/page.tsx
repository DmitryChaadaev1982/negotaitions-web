import type { Metadata } from "next";
import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LegalPageLanguageSwitcher } from "@/components/legal-page-language-switcher";

export const metadata: Metadata = {
  title: "Data Processing Consent",
};

export default async function DataProcessingConsentPage() {
  const locale = await getServerLocale();
  const d = await getDictionary(locale);
  const isRu = locale === "ru";

  return (
    <div className="min-h-screen bg-[#020617]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <LegalPageLanguageSwitcher />

        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          ⚠️ {d.legal.draftNotice}
        </div>

        <h1 className="text-3xl font-bold text-slate-50 mb-2">{d.legal.dataProcessingConsent}</h1>
        <p className="text-slate-500 text-sm mb-10">
          {isRu ? "Последнее обновление: черновик MVP" : "Last updated: MVP draft"}
        </p>

        <article className="space-y-8 text-slate-300">
          {isRu ? (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">Что вы принимаете при регистрации</h2>
                <p>Регистрируясь в NegotAItions, вы даёте согласие на следующую обработку данных:</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. Данные регистрации аккаунта</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Имя (отображаемое), адрес email, хэш пароля</li>
                  <li>Статус аккаунта, временные метки входа и подтверждения</li>
                  <li>Цель: идентификация пользователя, управление доступом</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. Данные учебных сессий</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Заголовки и описания кейсов, созданных вами</li>
                  <li>Метаданные сессий: временные метки, статус, токены доступа участников</li>
                  <li>Заметки, введённые в ходе сессии</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Запись, транскрибация, AI-анализ</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Аудиозаписи сессий (при наличии согласия участников)</li>
                  <li>Транскрипты, формируемые внешними AI-сервисами</li>
                  <li>AI-отчёты, формируемые внешними AI-провайдерами</li>
                </ul>
                <p className="mt-2 text-amber-200 text-sm">Пожалуйста, не произносите и не записывайте реальные персональные или конфиденциальные данные в ходе сессии.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. Технические журналы</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Технические журналы сервиса: хэши IP-адресов, заголовки User-Agent</li>
                  <li>Журналы административных действий</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Трансграничная передача данных</h2>
                <p className="text-amber-200">Данные могут обрабатываться внешними провайдерами, расположенными за пределами Российской Федерации, включая ЕС и США (LiveKit, OpenAI, Yandex Object Storage). Продолжая использование сервиса, вы даёте согласие на такую передачу.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Отзыв согласия и удаление данных</h2>
                <p>[Placeholder — процедура отзыва согласия и удаления данных будет реализована перед production-запуском. Для MVP: обратитесь к администратору.]</p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">What you consent to at registration</h2>
                <p>By registering with NegotAItions, you consent to the following data processing:</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. Account Registration Data</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Display name, email address, password hash</li>
                  <li>Account status, login and approval timestamps</li>
                  <li>Purpose: user identification and access control</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. Training Session Data</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Titles and descriptions of cases you create</li>
                  <li>Session metadata: timestamps, status, participant access tokens</li>
                  <li>Notes entered during sessions</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Recording, Transcription, AI Analysis</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Audio recordings of sessions (where participant consent is obtained)</li>
                  <li>Transcripts generated by external AI services</li>
                  <li>AI analysis reports generated by external AI providers</li>
                </ul>
                <p className="mt-2 text-amber-200 text-sm">Please do not speak or record real personal or confidential data during sessions.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. Technical Logs</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Service technical logs: IP address hashes, User-Agent headers</li>
                  <li>Admin action logs</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Cross-Border Data Transfer</h2>
                <p className="text-amber-200">Data may be processed by external providers located outside your country, including the EU and USA (LiveKit, OpenAI, Yandex Object Storage). By continuing to use the service, you consent to such transfer.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Withdrawal & Deletion</h2>
                <p>[Placeholder — consent withdrawal and data deletion process will be implemented before production launch. For MVP: contact the administrator.]</p>
              </section>
            </>
          )}
        </article>

        <div className="mt-10 border-t border-slate-800 pt-6 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-slate-300">{d.legal.privacyPolicy}</Link>
          <Link href="/terms" className="hover:text-slate-300">{d.legal.termsOfUse}</Link>
          <Link href="/cookie-policy" className="hover:text-slate-300">{d.legal.cookiePolicy}</Link>
          <Link href="/ai-processing-notice" className="hover:text-slate-300">{d.legal.aiProcessingNotice}</Link>
        </div>
      </div>
    </div>
  );
}
