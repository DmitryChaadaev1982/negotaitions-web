import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

import { AccountEventJoinView } from "@/components/account-event-join-view";
import { TrainingEventStatus } from "@/app/generated/prisma/client";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { BrandLogo } from "@/components/ui/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { eventVisibilityWhere } from "@/lib/visibility";
import { normalizeUserEmail } from "@/lib/invite-email";
import Link from "next/link";

export const dynamic = "force-dynamic";

type JoinEventPageProps = {
  params: Promise<{ id: string }>;
};

export default async function JoinEventPage({ params }: JoinEventPageProps) {
  const { id } = await params;

  const event = await prisma.trainingEvent.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
    },
  });

  if (!event) {
    notFound();
  }

  const locale = await getServerLocale();
  const dict = getDictionary(locale);

  // Show event-unavailable page for cancelled/completed events.
  if (
    event.deletedAt ||
    event.status === TrainingEventStatus.CANCELLED ||
    event.status === TrainingEventStatus.COMPLETED
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4 text-center">
        <h1 className="text-xl font-bold text-slate-50">
          {event.status === TrainingEventStatus.CANCELLED
            ? dict.events.eventCancelled
            : dict.events.eventCompleted}
        </h1>
        <p className="max-w-md text-slate-400">{dict.events.eventUnavailable}</p>
      </div>
    );
  }

  // Guest join is closed — require authenticated user.
  const currentUser = await getOptionalCurrentUser();

  if (!currentUser) {
    // Redirect to login with returnUrl so the user comes back after auth.
    const returnUrl = encodeURIComponent(`/events/${id}/join`);
    redirect(`/login?returnUrl=${returnUrl}`);
  }

  // Non-active authenticated user — show status page.
  const isActive = isAdmin(currentUser) || currentUser.status === "ACTIVE";
  if (!isActive) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4 text-center">
        <div className="mb-8 flex w-full max-w-md items-center justify-between">
          <BrandLogo size="md" href={undefined} />
          <LanguageSwitcher />
        </div>
        <h1 className="text-xl font-bold text-slate-50">
          {dict.events.accountNotActive}
        </h1>
        <p className="max-w-md text-slate-400">
          {dict.events.accountNotActiveDescription}
        </p>
        <Link
          href="/pending-approval"
          className="mt-2 text-sm text-cyan-400 hover:text-cyan-300"
        >
          {dict.common.back}
        </Link>
      </div>
    );
  }

  if (!isAdmin(currentUser)) {
    const visibleEvent = await prisma.trainingEvent.findFirst({
      where: {
        id: event.id,
        ...eventVisibilityWhere(currentUser.id, normalizeUserEmail(currentUser.email)),
      },
      select: { id: true },
    });

    if (!visibleEvent) {
      notFound();
    }
  }

  // Authenticated ACTIVE user — show preference selection join view.
  return (
    <AccountEventJoinView eventId={event.id} eventTitle={event.title} />
  );
}
