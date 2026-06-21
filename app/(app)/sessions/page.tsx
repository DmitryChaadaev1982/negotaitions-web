import Link from "next/link";

import { Card, CardContent } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { SessionStatusBadge } from "@/components/session-status-badge";
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

export default async function SessionsPage() {
  const facilitator = await getDemoFacilitator();

  const sessions = await prisma.session.findMany({
    where: { facilitatorId: facilitator.id },
    orderBy: { createdAt: "desc" },
    include: {
      negotiationCase: {
        select: { title: true },
      },
      _count: { select: { participants: true } },
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sessions"
        description="Manage negotiation practice sessions. Create sessions from cases, assign participants, and share join links."
        action={
          <Link
            href="/sessions/new"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            New session
          </Link>
        }
      />

      <Card>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-slate-600">
                No sessions yet. Create one from an existing case.
              </p>
              <Link
                href="/sessions/new"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Create session
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
                      Case
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      Participants
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
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link
                          href={`/sessions/${session.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {session.title}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {session.negotiationCase.title}
                      </td>
                      <td className="px-6 py-4">
                        <SessionStatusBadge status={session.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {session._count.participants}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {formatDate(session.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/sessions/${session.id}`}
                          className="text-sm font-medium text-slate-700 hover:text-slate-900"
                        >
                          Manage
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
