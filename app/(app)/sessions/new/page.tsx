import Link from "next/link";

import { NewSessionForm } from "@/components/new-session-form";
import { PageHeader } from "@/components/page-header";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type NewSessionPageProps = {
  searchParams: Promise<{ caseId?: string }>;
};

export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  const { caseId } = await searchParams;
  const facilitator = await getDemoFacilitator();

  const cases = await prisma.negotiationCase.findMany({
    where: { facilitatorId: facilitator.id },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      defaultDurationSeconds: true,
    },
  });

  const defaultCaseId =
    caseId && cases.some((negotiationCase) => negotiationCase.id === caseId)
      ? caseId
      : cases[0]?.id;

  return (
    <div className="space-y-8">
      <PageHeader
        title="New session"
        description="Create a practice session from an existing case."
        action={
          <Link
            href="/sessions"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to sessions
          </Link>
        }
      />

      {cases.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600 shadow-sm">
          You need at least one case before creating a session.{" "}
          <Link href="/cases/new" className="font-medium text-slate-900">
            Create a case
          </Link>{" "}
          first.
        </div>
      ) : (
        <NewSessionForm cases={cases} defaultCaseId={defaultCaseId} />
      )}
    </div>
  );
}
