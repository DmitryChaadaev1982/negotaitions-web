import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { getDemoFacilitator } from "@/lib/demo-user";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type CaseDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { id } = await params;
  const facilitator = await getDemoFacilitator();

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id,
      facilitatorId: facilitator.id,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!negotiationCase) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={negotiationCase.title}
        description="Case details and role briefings for facilitators."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/sessions/new?caseId=${negotiationCase.id}`}
              className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Create session
            </Link>
            <Link
              href="/cases"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Back to cases
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={negotiationCase.difficulty}>
          {negotiationCase.difficulty}
        </Badge>
        <Badge>{negotiationCase.roles.length} roles</Badge>
        <Badge>
          Default duration: {secondsToDisplayMinutes(negotiationCase.defaultDurationSeconds)} minutes
        </Badge>
        <span className="text-sm text-slate-500">
          Created {formatDate(negotiationCase.createdAt)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Business context
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {negotiationCase.businessContext}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Public instructions
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {negotiationCase.publicInstructions}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">Roles</h2>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    Role name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    Private instructions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {negotiationCase.roles.map((role, index) => (
                  <tr key={role.id}>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {role.name}
                    </td>
                    <td className="px-6 py-4 text-sm leading-6 text-slate-700">
                      <p className="whitespace-pre-wrap">
                        {role.privateInstructions}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
