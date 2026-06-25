import type { Metadata } from "next";
import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = {
  title: "AI Processing Notice",
};

export default async function AiProcessingNoticePage() {
  const locale = await getServerLocale();
  const d = await getDictionary(locale);
  const isRu = locale === "ru";

  return (
    <div className="min-h-screen bg-[#020617]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          ⚠️ {d.legal.draftNotice}
        </div>

        <h1 className="text-3xl font-bold text-slate-50 mb-2">{d.legal.aiProcessingNotice}</h1>
        <p className="text-slate-500 text-sm mb-10">
          {isRu ? "Последнее обновление: черновик MVP" : "Last updated: MVP draft"}
        </p>

        <article className="space-y-8 text-slate-300">
          {isRu ? (
            <>
              <section className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-5 py-4">
                <h2 className="text-lg font-semibold text-amber-100 mb-2">⚠️ Важное предупреждение</h2>
                <p className="text-amber-200 text-sm">Функции транскрибации и AI-анализа могут передавать данные сессии внешним AI-провайдерам, расположенным за пределами Российской Федерации. Никогда не загружайте конфиденциальные данные в кейсы или сессии.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. Внешние AI-провайдеры</h2>
                <p>Для транскрибации и AI-разбора переговоров используются внешние AI-сервисы (в частности, OpenAI). Данные могут обрабатываться на серверах, расположенных в ЕС или США, в соответствии с политикой конфиденциальности соответствующего провайдера.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. Что не следует передавать на AI-анализ</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm text-amber-100">
                  <li>Реальные персональные данные участников или клиентов</li>
                  <li>Коммерческую тайну, конфиденциальные сведения</li>
                  <li>Государственную тайну или засекреченную информацию</li>
                  <li>Медицинские данные</li>
                  <li>Финансовые реквизиты и учётные данные</li>
                  <li>Любую информацию, которую нельзя передавать третьим лицам</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Точность AI-вывода</h2>
                <p>AI-выводы могут быть неточными, неполными или не соответствовать реальной ситуации. Они предназначены исключительно для учебного анализа и не являются объективной оценкой переговорных навыков.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. AI-обратная связь только для обучения</h2>
                <p>AI-разбор предоставляется исключительно в образовательных целях. Он не является профессиональной, юридической или деловой консультацией. Результаты не следует использовать при принятии реальных бизнес-решений.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Обязанности фасилитатора</h2>
                <p>Фасилитатор должен проверить AI-отчёт перед тем, как поделиться им с участниками. Общий отчёт очищается от приватных данных ролей, однако фасилитатор несёт ответственность за то, чтобы отчёт не содержал конфиденциальных сведений.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Sanitization общего отчёта</h2>
                <p>При публикации отчёта участникам платформа автоматически удаляет приватные ролевые инструкции и данные фасилитатора. Тем не менее, фасилитатор должен убедиться, что содержание сессии не включало реальные конфиденциальные данные.</p>
              </section>
            </>
          ) : (
            <>
              <section className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-5 py-4">
                <h2 className="text-lg font-semibold text-amber-100 mb-2">⚠️ Important warning</h2>
                <p className="text-amber-200 text-sm">Transcription and AI analysis features may transmit session data to external AI providers located outside your country. Never upload confidential data to cases or sessions.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">1. External AI Providers</h2>
                <p>Transcription and AI analysis of negotiations use external AI services (in particular, OpenAI). Data may be processed on servers located in the EU or USA, subject to the respective provider&apos;s privacy policy.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">2. What should not be submitted for AI analysis</h2>
                <ul className="list-disc pl-6 space-y-1 text-sm text-amber-100">
                  <li>Real personal data of participants or clients</li>
                  <li>Trade secrets, confidential information</li>
                  <li>State secrets or classified information</li>
                  <li>Medical data</li>
                  <li>Financial credentials and account data</li>
                  <li>Any information that must not be shared with third parties</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">3. Accuracy of AI Output</h2>
                <p>AI outputs may be inaccurate, incomplete, or not reflect the actual situation. They are intended solely for training analysis and are not an objective evaluation of negotiation skills.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">4. AI Feedback is for Training Only</h2>
                <p>AI analysis is provided for educational purposes only. It does not constitute professional, legal, or business advice. Results should not be used in making real business decisions.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">5. Facilitator Responsibilities</h2>
                <p>The facilitator should review the AI report before sharing it with participants. The shared report is sanitized to remove private role data, but the facilitator is responsible for ensuring it does not contain confidential information.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">6. Sanitization of Shared Report</h2>
                <p>When sharing a report with participants, the platform automatically removes private role instructions and facilitator-only data. However, the facilitator must ensure that the session content itself did not include real confidential data.</p>
              </section>
            </>
          )}
        </article>

        <div className="mt-10 border-t border-slate-800 pt-6 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-slate-300">{d.legal.privacyPolicy}</Link>
          <Link href="/terms" className="hover:text-slate-300">{d.legal.termsOfUse}</Link>
          <Link href="/cookie-policy" className="hover:text-slate-300">{d.legal.cookiePolicy}</Link>
          <Link href="/data-processing-consent" className="hover:text-slate-300">{d.legal.dataProcessingConsent}</Link>
        </div>
      </div>
    </div>
  );
}
