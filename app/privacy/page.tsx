import type { Metadata } from "next";
import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default async function PrivacyPage() {
  const locale = await getServerLocale();
  const d = await getDictionary(locale);

  const isRu = locale === "ru";

  return (
    <div className="min-h-screen bg-[#020617]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* Draft notice */}
        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          ⚠️ {d.legal.draftNotice}
        </div>

        <h1 className="text-3xl font-bold text-slate-50 mb-2">{d.legal.privacyPolicy}</h1>
        <p className="text-slate-500 text-sm mb-10">
          {isRu ? "Последнее обновление: черновик MVP" : "Last updated: MVP draft"}
        </p>

        <article className="prose prose-invert prose-slate max-w-none space-y-8 text-slate-300">

          {isRu ? (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100">1. Оператор</h2>
                <p>[Placeholder — укажите наименование оператора, юридический адрес и контакты перед production-запуском]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">2. Назначение сервиса</h2>
                <p>NegotAItions — учебная платформа для тренировки переговоров в виде ролевых игр. Сервис предназначен исключительно для обучения и демонстрационных сценариев. Пользователи должны использовать вымышленные имена, компании и обстоятельства.</p>
                <p className="text-amber-200 text-sm border border-amber-500/30 bg-amber-900/20 rounded px-3 py-2 mt-2">
                  Сервис не предназначен для хранения реальных персональных данных третьих лиц, коммерческой тайны, конфиденциальных сведений, медицинских данных или финансовых реквизитов.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">3. Данные аккаунта</h2>
                <p>При регистрации мы собираем: имя пользователя, адрес электронной почты, хэш пароля, статус аккаунта и временные метки активности. Email используется только для идентификации; маркетинговые рассылки не осуществляются.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">4. Данные мероприятий и сессий</h2>
                <p>Создаваемые мероприятия и сессии переговоров содержат метаданные (названия, временные метки, ссылки-токены). Токены участников хранятся в базе данных и используются для управления доступом.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">5. Аудио/видеозаписи</h2>
                <p>Запись сессий осуществляется через LiveKit (облачный сервис). Записи хранятся в объектном хранилище (Yandex Object Storage или совместимый S3-провайдер). Доступ к записям имеет только фасилитатор сессии.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">6. Транскрипты</h2>
                <p>Транскрибация выполняется через внешние сервисы (OpenAI Whisper или аналоги). Текст транскрипта сохраняется в базе данных. Участникам доступны только те транскрипты, которые явно предоставлены фасилитатором.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">7. AI-отчёты</h2>
                <p>AI-разбор формируется с использованием внешних AI-провайдеров (OpenAI или аналогов). Фасилитатор может поделиться очищенной версией отчёта с участниками. Полный отчёт доступен только фасилитатору.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">8. Cookie и локальное хранилище</h2>
                <p>Мы используем необходимые cookie и localStorage: сессионный cookie для аутентификации, языковые предпочтения и данные восстановления гостевой сессии. Подробнее: <Link href="/cookie-policy" className="text-cyan-400 hover:text-cyan-300">{d.legal.cookiePolicy}</Link>.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">9. Инфраструктура и внешние провайдеры</h2>
                <p>MVP-версия сервиса может использовать инфраструктуру и AI-сервисы, расположенные за пределами Российской Федерации, включая ЕС и США (LiveKit, OpenAI, Yandex Object Storage). Передача данных осуществляется по защищённым каналам TLS.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">10. Сроки хранения</h2>
                <p>[Placeholder — сроки хранения будут определены перед production-запуском. Предварительно: данные аккаунта хранятся до удаления аккаунта; материалы сессий хранятся до ручного удаления администратором или по запросу пользователя.]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">11. Удаление данных</h2>
                <p>[Placeholder — процедура запроса на удаление данных будет реализована перед production-запуском. Для MVP: обратитесь к администратору.]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">12. Контакты</h2>
                <p>[Placeholder — укажите контактный email и/или почтовый адрес оператора перед production-запуском.]</p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h2 className="text-xl font-semibold text-slate-100">1. Operator</h2>
                <p>[Placeholder — add operator name, legal address, and contact details before production launch]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">2. Service Purpose</h2>
                <p>NegotAItions is a training platform for role-play negotiation practice. The service is intended exclusively for training and demo scenarios. Users should use fictional names, companies, and circumstances.</p>
                <p className="text-amber-200 text-sm border border-amber-500/30 bg-amber-900/20 rounded px-3 py-2 mt-2">
                  The service is not intended for storing real personal data of third parties, trade secrets, confidential information, medical data, or financial credentials.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">3. Account Data</h2>
                <p>At registration we collect: display name, email address, password hash, account status, and activity timestamps. Email is used for identification only; no marketing communications are sent.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">4. Event & Session Data</h2>
                <p>Events and negotiation sessions you create contain metadata (titles, timestamps, access tokens). Participant tokens are stored in the database and used for access control.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">5. Audio / Video Recordings</h2>
                <p>Session recording is processed via LiveKit (cloud service). Recordings are stored in object storage (Yandex Object Storage or compatible S3 provider). Only the session facilitator can access recordings.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">6. Transcripts</h2>
                <p>Transcription is performed via external services (OpenAI Whisper or equivalent). Transcript text is stored in the database. Participants can only access transcripts explicitly shared by the facilitator.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">7. AI Analysis Reports</h2>
                <p>AI analysis is generated using external AI providers (OpenAI or equivalent). The facilitator may share a sanitized version of the report with participants. The full report is facilitator-only.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">8. Cookies & Local Storage</h2>
                <p>We use necessary cookies and localStorage: an auth session cookie, language preferences, and guest session recovery data. See our <Link href="/cookie-policy" className="text-cyan-400 hover:text-cyan-300">{d.legal.cookiePolicy}</Link> for details.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">9. Infrastructure & External Providers</h2>
                <p>The MVP version of this service may use infrastructure and AI services located outside the Russian Federation, including the EU and USA (LiveKit, OpenAI, Yandex Object Storage). Data is transmitted over TLS-secured connections.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">10. Retention</h2>
                <p>[Placeholder — retention periods will be finalized before production launch. Preliminary: account data retained until account deletion; session materials retained until manually deleted by admin or by user request.]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">11. Deletion Requests</h2>
                <p>[Placeholder — data deletion request process will be implemented before production launch. For MVP: contact the administrator.]</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100">12. Contact</h2>
                <p>[Placeholder — add operator contact email and/or postal address before production launch.]</p>
              </section>
            </>
          )}
        </article>

        <div className="mt-10 border-t border-slate-800 pt-6 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/terms" className="hover:text-slate-300">{d.legal.termsOfUse}</Link>
          <Link href="/cookie-policy" className="hover:text-slate-300">{d.legal.cookiePolicy}</Link>
          <Link href="/data-processing-consent" className="hover:text-slate-300">{d.legal.dataProcessingConsent}</Link>
          <Link href="/ai-processing-notice" className="hover:text-slate-300">{d.legal.aiProcessingNotice}</Link>
        </div>
      </div>
    </div>
  );
}
