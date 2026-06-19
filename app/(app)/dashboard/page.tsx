import Link from "next/link";

import { Badge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { getAppName } from "@/lib/config";
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

export default async function DashboardPage() {
  const appName = getAppName();
  const facilitator = await getDemoFacilitator();

  const [caseCount, recentCases] = await Promise.all([
    prisma.negotiationCase.count({
      where: { facilitatorId: facilitator.id },
    }),
    prisma.negotiationCase.findMany({
      where: { facilitatorId: facilitator.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        _count: { select: { roles: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`${appName} is a negotiation training platform for facilitators. Design role-based cases, run practice sessions, and help teams build real negotiation skills in a structured environment.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <p className="text-sm font-medium text-slate-500">Total cases</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {caseCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm font-medium text-slate-500">Your role</p>
            <div className="mt-2">
              <Badge>Facilitator</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardContent className="py-5">
            <p className="text-sm font-medium text-slate-500">Quick action</p>
            <Link
              href="/cases/new"
              className="mt-3 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Create new case
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">
              Recent cases
            </h2>
            <Link
              href="/cases"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentCases.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-600">
              No cases yet.{" "}
              <Link href="/cases/new" className="font-medium text-slate-900">
                Create your first case
              </Link>
              .
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {recentCases.map((negotiationCase) => (
                    <tr key={negotiationCase.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link
                          href={`/cases/${negotiationCase.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {negotiationCase.title}
                        </Link>
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
