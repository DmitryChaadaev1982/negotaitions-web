"use client";

import Link from "next/link";

import { getCurrentLegalAcknowledgementUi } from "@/lib/legal/acknowledgements";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  buildLegalDocumentHref,
  type LegalReturnContext,
} from "@/lib/legal/legal-document-return";

export function LegalReleaseCheckboxes({
  openDocumentsInNewTab = true,
  returnContext,
  returnTo,
  checkedByField,
  onCheckedChange,
}: {
  openDocumentsInNewTab?: boolean;
  returnContext?: LegalReturnContext;
  returnTo?: string;
  checkedByField?: Record<string, boolean>;
  onCheckedChange?: (fieldName: string, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const acknowledgements = getCurrentLegalAcknowledgementUi();
  const documentReturn =
    returnContext && returnTo
      ? { returnTo, returnContext }
      : undefined;

  return (
    <div className="space-y-3 pt-1">
      {acknowledgements.map((item) => (
        <label key={item.consentType} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name={item.fieldName}
            value="1"
            required
            {...(checkedByField
              ? {
                  checked: Boolean(checkedByField[item.fieldName]),
                  onChange: (
                    event: { target: { checked: boolean } },
                  ) => onCheckedChange?.(item.fieldName, event.target.checked),
                }
              : {})}
            data-testid={item.testId}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
          />
          <span className="text-xs text-slate-300 leading-relaxed">
            {t(item.startKey)}
            <Link
              href={
                documentReturn
                  ? buildLegalDocumentHref(
                      item.links[0]?.href ?? "/terms",
                      documentReturn,
                    )
                  : (item.links[0]?.href ?? "/terms")
              }
              target={openDocumentsInNewTab ? "_blank" : undefined}
              rel={openDocumentsInNewTab ? "noreferrer" : undefined}
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
            >
              {t(item.links[0]?.labelKey ?? "legal.termsOfUse")}
            </Link>
            {item.middleKey ? t(item.middleKey) : null}
            {item.links[1] ? (
              <Link
                href={
                  documentReturn
                    ? buildLegalDocumentHref(item.links[1].href, documentReturn)
                    : item.links[1].href
                }
                target={openDocumentsInNewTab ? "_blank" : undefined}
                rel={openDocumentsInNewTab ? "noreferrer" : undefined}
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                {t(item.links[1].labelKey)}
              </Link>
            ) : null}
            {t(item.endKey)}
          </span>
        </label>
      ))}
    </div>
  );
}
