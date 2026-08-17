"use client";

import Link from "next/link";
import { useActionState, useSyncExternalStore, Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { logoutUser } from "@/app/actions/auth";
import { acceptCurrentLegalRelease } from "@/app/actions/legal-release";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalReleaseCheckboxes } from "@/components/legal-release-checkboxes";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useI18n } from "@/lib/i18n/useI18n";
import { getCurrentLegalAcknowledgementUi } from "@/lib/legal/acknowledgements";
import { buildLegalDocumentHref } from "@/lib/legal/legal-document-return";
import { sanitizeLegalUpdateReturnUrl } from "@/lib/legal/legal-update-return-url";
import {
  clearLegalUpdateDraft,
  emptyLegalUpdateDraft,
  readLegalUpdateDraft,
  subscribeLegalUpdateDraft,
  writeLegalUpdateDraft,
  type LegalUpdateDraft,
} from "@/lib/legal/legal-update-draft";
import { PUBLIC_CONTACT_EMAIL, PUBLIC_CONTACT_MAILTO } from "@/lib/seo/indexing";

const LEGAL_UPDATE_DOCUMENT_LINKS = [
  { href: "/terms", key: "legal.termsOfUse" },
  { href: "/privacy", key: "legal.privacyPolicy" },
  { href: "/data-processing-consent", key: "legal.dataProcessingConsent" },
  { href: "/ai-processing-notice", key: "legal.aiProcessingNotice" },
] as const;

const LEGAL_UPDATE_RETURN = {
  returnTo: "/legal-update",
  returnContext: "legal-update" as const,
};

function fieldNameToConsentType(fieldName: string): keyof LegalUpdateDraft | null {
  const match = getCurrentLegalAcknowledgementUi().find(
    (item) => item.fieldName === fieldName,
  );
  return match?.consentType ?? null;
}

function draftToFieldMap(draft: LegalUpdateDraft): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const item of getCurrentLegalAcknowledgementUi()) {
    map[item.fieldName] = draft[item.consentType] === true;
  }
  return map;
}

function LegalUpdateForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const returnUrl = sanitizeLegalUpdateReturnUrl(searchParams.get("returnUrl")) ?? "";
  const [state, action, pending] = useActionState(acceptCurrentLegalRelease, {});
  const draft = useSyncExternalStore(
    subscribeLegalUpdateDraft,
    readLegalUpdateDraft,
    emptyLegalUpdateDraft,
  );

  const handleCheckedChange = (fieldName: string, checked: boolean) => {
    const consentType = fieldNameToConsentType(fieldName);
    if (!consentType) return;
    writeLegalUpdateDraft({ ...draft, [consentType]: checked });
  };

  return (
    <div className="min-h-full flex flex-col">
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <BrandLogo size="md" variant="full" priority href="/" className="hidden sm:inline-flex" />
          <BrandLogo size="md" variant="compact" priority href="/" className="sm:hidden" />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div
          className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8"
          data-testid="legal-update-card"
        >
          <h1 className="text-2xl font-bold text-slate-50 mb-3">
            {t("legalUpdate.title")}
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">
            {t("legalUpdate.body")}
          </p>

          <div className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {LEGAL_UPDATE_DOCUMENT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={buildLegalDocumentHref(link.href, LEGAL_UPDATE_RETURN)}
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                {t(link.key)}
              </Link>
            ))}
          </div>

          <form
            action={action}
            className="space-y-4"
            onSubmit={() => {
              const acknowledgements = getCurrentLegalAcknowledgementUi();
              const allChecked = acknowledgements.every(
                (item) => draft[item.consentType] === true,
              );
              if (allChecked) {
                clearLegalUpdateDraft();
              }
            }}
          >
            <input type="hidden" name="returnUrl" value={returnUrl} />
            <LegalReleaseCheckboxes
              openDocumentsInNewTab={false}
              returnContext="legal-update"
              returnTo="/legal-update"
              checkedByField={draftToFieldMap(draft)}
              onCheckedChange={handleCheckedChange}
            />

            {state.errors?.consents ? (
              <p className="text-sm text-red-400 rounded-lg bg-red-950/40 border border-red-800/50 px-3 py-2">
                {t(state.errors.consents[0] as Parameters<typeof t>[0]) ??
                  state.errors.consents[0]}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              data-testid="legal-update-confirm"
              className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? t("legalUpdate.confirming") : t("legalUpdate.confirm")}
            </button>
          </form>

          <form
            action={logoutUser}
            className="mt-4"
            onSubmit={() => {
              clearLegalUpdateDraft();
            }}
          >
            <button
              type="submit"
              data-testid="legal-update-logout"
              className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 transition-colors"
            >
              {t("auth.logout")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            {t("legalUpdate.support")}{" "}
            <a
              href={PUBLIC_CONTACT_MAILTO}
              className="text-cyan-400 hover:text-cyan-300"
            >
              {PUBLIC_CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

export function LegalUpdateView() {
  return (
    <Suspense>
      <LegalUpdateForm />
    </Suspense>
  );
}
