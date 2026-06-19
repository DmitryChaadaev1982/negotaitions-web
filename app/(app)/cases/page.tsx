import Link from "next/link";

import { Badge } from "@/components/badge";
import { Card, CardContent } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function CasesPage() {
  const facilitator = await getDemoFacilitator();

  const cases = await prisma.negotiationCase.findMany({
    where: { facilitatorId: facilitator.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { roles: true } },
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cases"
        description="Browse and manage negotiation training cases. Each case defines the scenario context and participant roles."
        action={
          <Link
            href="/cases/new"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            New case
          </Link>
        }
      />

      <Card>
        <CardContent className="p-0">
          {cases.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-slate-600">
                No cases found. Create one to get started.
              </p>
              <Link
                href="/cases/new"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Create case
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Difficulty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Roles
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {cases.map((negotiationCase) => (
                    <tr key={negotiationCase.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">
                          {negotiationCase.title}
                        </div>
                        <p className="mt-1 line-clamp-1 max-w-md text-sm text-slate-500">
                          {negotiationCase.businessContext}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={negotiationCase.difficulty}>
                          {negotiationCase.difficulty}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {negotiationCase._count.roles}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {formatDate(negotiationCase.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/cases/${negotiationCase.id}`}
                          className="text-sm font-medium text-slate-700 hover:text-slate-900"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
