import { Fragment } from "react";

import { cn } from "@/lib/cn";
import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_CONTACT_MAILTO,
} from "@/lib/seo/indexing";

const mailtoClass =
  "font-medium text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70";

export function PublicSupportEmailLink({
  className,
  testId = "support-email",
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <a
      href={PUBLIC_CONTACT_MAILTO}
      data-testid={testId}
      className={cn(mailtoClass, className)}
    >
      {PUBLIC_CONTACT_EMAIL}
    </a>
  );
}

export function TextWithSupportEmail({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(PUBLIC_CONTACT_EMAIL);
  if (parts.length === 1) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {part}
          {index < parts.length - 1 ? <PublicSupportEmailLink /> : null}
        </Fragment>
      ))}
    </span>
  );
}
