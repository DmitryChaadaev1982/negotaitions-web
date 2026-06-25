import type { Metadata } from "next";
import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = {
  title: "Terms of Use",
};

export default async function TermsPage() {
  const locale = await getServerLocale();
  const d = await getDictionary(locale);
  const isRu = locale === "ru";

  return (
    <div className="min-h-screen bg-[#020617]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          ⚠️ {d.legal.draftNotice}
        </div>

        <h1 className="text-3xl font-bold text-slate-50 mb-2">{d.legal.termsOfUse}</h1>
        <p className="text-slate-500 text-sm mb-10">
          {isRu ? "Последнее обновление: черновик MVP" : "Last updated: MVP draft"}
        </p>

        <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200 mb-8">
          {isRu
            ? "⚠️ NegotAItions — учебная MVP-платформа. Не загружайте реальные персональные данные, коммерческую тайну или конфиденциальные сведения. Используйте вымышленные имена, компании и обстоятельства."
            : "⚠️ NegotAItions is a training MVP platform. Do not upload real personal data, trade secrets, or confidential information. Use fictional names, companies, and circumstances."}
        </div>

        <article className="space-y-8 text-slate-300">
          {isRu ? (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. Назначение</h2>
                <p>NegotAItions предназначен исключительно для учебных и демонстрационных сценариев переговоров. Сервис не является площадкой для реальных деловых переговоров и не предоставляет юридических, деловых или профессиональных консультаций.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. Допустимое использование</h2>
                <p>Пользователи обязуются:</p>
                <ul className="list-disc pl-6 space-y-1 mt-2 text-sm">
                  <li>Использовать только вымышленные имена, компании, суммы и обстоятельства в учебных кейсах</li>
                  <li>Не использовать сервис для обработки реальных данных клиентов, сотрудников, партнёров</li>
                  <li>Соблюдать применимое законодательство</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Запрет на загрузку чувствительных данных</h2>
                <p className="text-amber-200">Категорически запрещается загружать или упоминать в кейсах, записях, транскриптах:</p>
                <ul className="list-disc pl-6 space-y-1 mt-2 text-sm text-amber-100">
                  <li>Реальные персональные данные третьих лиц</li>
                  <li>Коммерческую тайну и конфиденциальные сведения</li>
                  <li>Сведения, составляющие государственную тайну</li>
                  <li>Медицинские данные и данные о здоровье</li>
                  <li>Финансовые реквизиты, учётные данные, пароли</li>
                  <li>Данные о клиентах, сотрудниках, партнёрах, сделках</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. Ответственность пользователя</h2>
                <p>Пользователь несёт ответственность за содержание создаваемых кейсов, за информацию, озвучиваемую на сессиях, и за соблюдение требований применимого законодательства при использовании сервиса.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Запись и AI-функции</h2>
                <p>Сервис поддерживает запись сессий, транскрибацию и AI-разбор с использованием внешних провайдеров. Фасилитатор обязан уведомить участников о записи перед её началом.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Ограничения сервиса</h2>
                <p>Сервис предоставляется в режиме MVP «как есть». Оператор не гарантирует бесперебойную работу, сохранность данных или соответствие требованиям конкретной юрисдикции. AI-обратная связь является учебной и не является профессиональной консультацией.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">7. AI не является консультантом</h2>
                <p>Все AI-отчёты и обратная связь носят исключительно учебный характер. Они не являются юридической, деловой, финансовой или иной профессиональной консультацией. Фасилитатор должен проверять отчёты перед их публикацией.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">8. Контакты</h2>
                <p>[Placeholder — укажите контактный email перед production-запуском.]</p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. Purpose</h2>
                <p>NegotAItions is intended solely for training and demonstration negotiation scenarios. The service is not a platform for real business negotiations and does not provide legal, business, or professional advice.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. Acceptable Use</h2>
                <p>Users agree to:</p>
                <ul className="list-disc pl-6 space-y-1 mt-2 text-sm">
                  <li>Use only fictional names, companies, amounts, and circumstances in training cases</li>
                  <li>Not use the service to process real data about clients, employees, or partners</li>
                  <li>Comply with applicable law</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Prohibition on Sensitive Data</h2>
                <p className="text-amber-200">It is strictly prohibited to upload or reference in cases, recordings, or transcripts:</p>
                <ul className="list-disc pl-6 space-y-1 mt-2 text-sm text-amber-100">
                  <li>Real personal data of third parties</li>
                  <li>Trade secrets and confidential information</li>
                  <li>State secrets or classified information</li>
                  <li>Medical data or health information</li>
                  <li>Financial credentials, account data, passwords</li>
                  <li>Data about real clients, employees, partners, or deals</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. User Responsibility</h2>
                <p>Users are responsible for the content of cases they create, information shared during sessions, and compliance with applicable law when using the service.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Recording & AI Features</h2>
                <p>The service supports session recording, transcription, and AI analysis via external providers. The facilitator must inform participants about recording before it begins.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Service Limitations</h2>
                <p>The service is provided as MVP &quot;as is&quot;. The operator does not guarantee uninterrupted operation, data preservation, or compliance with requirements of any specific jurisdiction. AI feedback is for training purposes and is not professional advice.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">7. AI Is Not a Professional Advisor</h2>
                <p>All AI reports and feedback are for training purposes only. They do not constitute legal, business, financial, or other professional advice. Facilitators should review reports before sharing.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">8. Contact</h2>
                <p>[Placeholder — add contact email before production launch.]</p>
              </section>
            </>
          )}
        </article>

        <div className="mt-10 border-t border-slate-800 pt-6 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-slate-300">{d.legal.privacyPolicy}</Link>
          <Link href="/cookie-policy" className="hover:text-slate-300">{d.legal.cookiePolicy}</Link>
          <Link href="/data-processing-consent" className="hover:text-slate-300">{d.legal.dataProcessingConsent}</Link>
          <Link href="/ai-processing-notice" className="hover:text-slate-300">{d.legal.aiProcessingNotice}</Link>
        </div>
      </div>
    </div>
  );
}
